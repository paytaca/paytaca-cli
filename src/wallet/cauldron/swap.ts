/**
 * Cauldron swap orchestration: quote estimation and on-chain execution.
 *
 * This is the generic swap primitive (token ⇄ BCH). Higher-level callers
 * (e.g. an MCP payment wrapper) can use estimateSwap() to price a swap and
 * executeSwap() to broadcast it, mirroring the paytaca-app cauldron flow.
 */

import { ExchangeLab, type PoolV0, type TradeResult } from '@cashlab/cauldron'
import { binToHex } from '@cashlab/common/libauth.js'
import type { BchWallet } from '../bch.js'
import { LibauthHDWallet } from '../keys.js'
import { getBchUsdPrice } from '../../utils/prices.js'
import {
  fetchCauldronFee,
  fetchPoolsForToken,
  fetchTokenData,
  type PlatformFeeConfig,
  type CauldronTokenData,
} from './api.js'
import { apiPoolToMicroPool, microPoolToPoolV0, parseRate } from './pools.js'
import {
  attemptTrade,
  createInputAndOutput,
  watchtowerUtxosToSpendableCoins,
  type PlatformFee,
  type WatchtowerUtxo,
} from './transact.js'

export type SwapDirection = 'buy' | 'sell'

/** Platform fees below this are not charged at all (P2PKH dust threshold). */
export const PLATFORM_FEE_DUST_LIMIT = 546n

export interface SwapQuote {
  tokenId: string
  tokenData: CauldronTokenData
  direction: SwapDirection
  isBuyingToken: boolean
  pools: PoolV0[]
  tradeResult: TradeResult
  /** Human-readable price. */
  rate: string
  /** Token amount in base units. */
  tokenAmount: bigint
  /** BCH amount involved in base units (satoshis). */
  bchAmount: bigint
  /** Trade fee in satoshis. */
  tradeFee: bigint
  /** Paytaca platform fee charged on top of the trade (absent = no fee). */
  platformFee?: PlatformFee
}

export interface EstimateSwapOpts {
  /** 64-char hex token category. */
  tokenId: string
  /** 'buy' = spend BCH to receive tokens, 'sell' = spend tokens to receive BCH. */
  direction: SwapDirection
  /** Token amount in base units (sell: amount supplied; buy: amount received). */
  amount: bigint
  /** Use chipnet watchtower endpoints for fee config and BCH price. */
  isChipnet?: boolean
}

export interface ExecuteSwapOpts extends EstimateSwapOpts {
  bchWallet: BchWallet
  mnemonic: string
  derivationPath: string
}

export interface SwapResult {
  success: boolean
  txid?: string
  transaction?: string
  error?: string
  quote?: SwapQuote
}

/**
 * Compute the Paytaca platform fee for a trade (mirrors paytaca-app
 * trade.vue: 0.3% of the trade size, capped at max_usd worth of BCH).
 *
 * The fee is charged only when ALL of these hold:
 *   - the fee address is configured (feature enabled)
 *   - the live BCH price is fetchable (price failure -> no fee)
 *   - the computed fee is >= PLATFORM_FEE_DUST_LIMIT (below -> no fee)
 */
export function computePlatformFee(opts: {
  tradeResult: TradeResult
  isBuyingToken: boolean
  feeConfig: PlatformFeeConfig
  bchUsdPrice: number | null
}): PlatformFee | null {
  const { tradeResult, isBuyingToken, feeConfig, bchUsdPrice } = opts

  if (!feeConfig.address) return null
  if (bchUsdPrice == null || !isFinite(bchUsdPrice) || bchUsdPrice <= 0) {
    return null
  }

  const summary = tradeResult.summary
  // BCH side of the trade, excluding the DEX's own trade fee.
  const tradeSizeSats = (isBuyingToken ? summary.supply : summary.demand) - summary.trade_fee
  if (tradeSizeSats <= 0n) return null

  const rateBps = BigInt(Math.max(0, Math.round(feeConfig.feeRateBps)))
  let feeSats = tradeSizeSats * rateBps / 10000n

  // Cap the fee at max_usd worth of BCH at the current price. Computed in
  // bigint space so large caps / tiny prices cannot lose integer precision.
  const maxUsdScaled = BigInt(Math.round(feeConfig.maxUsd * 1e8))
  const priceScaled = BigInt(Math.round(bchUsdPrice * 1e8))
  if (maxUsdScaled <= 0n || priceScaled <= 0n) return null
  const capSats = maxUsdScaled * 100_000_000n / priceScaled
  if (capSats <= 0n) return null
  if (feeSats > capSats) feeSats = capSats

  if (feeSats < PLATFORM_FEE_DUST_LIMIT) return null
  return { to: feeConfig.address, amount: feeSats }
}

/**
 * Estimate a swap: fetch pools + token data and compute the best-rate trade.
 */
export async function estimateSwap(
  opts: EstimateSwapOpts
): Promise<SwapQuote> {
  const { tokenId, direction, amount } = opts
  const isChipnet = opts.isChipnet ?? false

  const [tokenData, apiPools, feeConfig] = await Promise.all([
    fetchTokenData(tokenId),
    fetchPoolsForToken(tokenId),
    // Fee config failure -> feature off for this swap (degrade silently)
    fetchCauldronFee(isChipnet).catch(() => null),
  ])
  if (!tokenData) {
    throw new Error(`No cauldron token data found for ${tokenId}`)
  }
  if (apiPools.length === 0) {
    throw new Error(`No active cauldron pools for token ${tokenId}`)
  }

  const pools = apiPools.map(apiPoolToMicroPool).map(microPoolToPoolV0)
  const isBuyingToken = direction === 'buy'
  const tradeResult = attemptTrade({
    pools,
    isBuyingToken,
    supply: isBuyingToken ? undefined : amount,
    demand: isBuyingToken ? amount : undefined,
  })

  // supply/demand semantics depend on direction:
  //   sell: supply=token, demand=BCH
  //   buy:  supply=BCH,   demand=token
  const tokenAmount = isBuyingToken
    ? tradeResult.summary.demand
    : tradeResult.summary.supply
  const bchAmount = isBuyingToken
    ? tradeResult.summary.supply
    : tradeResult.summary.demand
  const decimals = tokenData.bcmr.token.decimals

  // Platform fee: only when enabled + live price available (no fee otherwise)
  let platformFee: PlatformFee | null = null
  if (feeConfig) {
    const bchUsdPrice = await getBchUsdPrice(isChipnet).catch(() => null)
    platformFee = computePlatformFee({
      tradeResult,
      isBuyingToken,
      feeConfig,
      bchUsdPrice,
    })
  }

  return {
    tokenId,
    tokenData,
    direction,
    isBuyingToken,
    pools,
    tradeResult,
    rate: parseRate(tradeResult.summary.rate, decimals, isBuyingToken),
    tokenAmount,
    bchAmount,
    tradeFee: tradeResult.summary.trade_fee,
    ...(platformFee ? { platformFee } : {}),
  }
}

/**
 * Format a SwapQuote for human display.
 */
export function formatQuote(quote: SwapQuote): string {
  const { tokenData, direction, rate, tokenAmount, bchAmount, tradeFee } = quote
  const decimals = tokenData.bcmr.token.decimals
  const tokenSymbol = tokenData.bcmr.token.symbol || tokenData.display_symbol

  const tokenFormatted = (Number(tokenAmount) / 10 ** decimals).toFixed(decimals)
  const bchFormatted = (Number(bchAmount) / 10 ** 8).toFixed(8)
  const feeFormatted = (Number(tradeFee) / 10 ** 8).toFixed(8)

  let platformFeeLine: string | null = null
  if (quote.platformFee) {
    const feeFormattedPlatform = (Number(quote.platformFee.amount) / 10 ** 8).toFixed(8)
    platformFeeLine = `Platform fee: ~${feeFormattedPlatform} BCH`
  }

  if (direction === 'sell') {
    // Rate semantics (matches paytaca-app): '1 {demandSymbol} ≈ {rate} {supplySymbol}'.
    // Selling tokens → demand is BCH, rate is tokens-per-BCH.
    const lines = [
      `Sell ${tokenFormatted} ${tokenSymbol} for ${bchFormatted} BCH`,
      `Rate: 1 BCH ≈ ${rate} ${tokenSymbol}`,
      `Trade fee: ~${feeFormatted} BCH`,
    ]
    if (platformFeeLine) lines.push(platformFeeLine)
    return lines.join('\n')
  }
  // Buying tokens → demand is the token, rate is BCH-per-token.
  const lines = [
    `Buy ${tokenFormatted} ${tokenSymbol} for ${bchFormatted} BCH`,
    `Rate: 1 ${tokenSymbol} ≈ ${rate} BCH`,
    `Trade fee: ~${feeFormatted} BCH`,
  ]
  if (platformFeeLine) lines.push(platformFeeLine)
  return lines.join('\n')
}

/**
 * Execute a swap: build + sign the trade transaction and broadcast it.
 */
export async function executeSwap(opts: ExecuteSwapOpts): Promise<SwapResult> {
  const { bchWallet, mnemonic, derivationPath } = opts

  let quote: SwapQuote
  try {
    quote = await estimateSwap(opts)
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }

  let txHex: string
  try {
    const tradeTx = await buildSignedTradeTx({
      bchWallet,
      mnemonic,
      derivationPath,
      quote,
    })
    txHex = binToHex(tradeTx.txbin)
  } catch (err: any) {
    return { success: false, error: err?.message || String(err), quote }
  }

  try {
    const broadcastResponse = await (
      bchWallet.watchtower as any
    ).BCH._api.post('broadcast/', { transaction: txHex })
    const data = broadcastResponse.data

    // Mempool test API compatibility
    if (data?.result) {
      data[data.success ? 'txid' : 'error'] = data.result
      delete data.result
    }

    return {
      success: Boolean(data?.success),
      txid: data?.txid,
      transaction: txHex,
      error: data?.error,
      quote,
    }
  } catch (err: any) {
    return {
      success: false,
      transaction: txHex,
      error: err?.message || String(err),
      quote,
    }
  }
}

/**
 * Build + sign the trade transaction (no broadcast).
 */
export async function buildSignedTradeTx(opts: {
  bchWallet: BchWallet
  mnemonic: string
  derivationPath: string
  quote: SwapQuote
}) {
  const { bchWallet, mnemonic, derivationPath, quote } = opts

  const hdWallet = new LibauthHDWallet(
    mnemonic,
    derivationPath,
    bchWallet.isChipnet ? 'chipnet' : 'mainnet'
  )
  const spendableCoins = await collectSpendableCoins({
    bchWallet,
    hdWallet,
    tokenId: quote.tokenId,
    isBuyingToken: quote.isBuyingToken,
  })

  const { inputCoins, payouts } = createInputAndOutput({
    tradeResult: quote.tradeResult,
    spendableCoins,
    platformFee: quote.platformFee,
  })

  const exlab = new ExchangeLab()
  const tradeTx = exlab.createTradeTx(
    quote.tradeResult.entries,
    inputCoins,
    payouts,
    null,
    1n
  )
  exlab.verifyTradeTx(tradeTx)

  return tradeTx
}

/**
 * Collect the wallet UTXOs needed for the swap as SpendableCoins.
 * Selling needs the token's UTXOs + BCH; buying needs BCH only.
 */
async function collectSpendableCoins(opts: {
  bchWallet: BchWallet
  hdWallet: LibauthHDWallet
  tokenId: string
  isBuyingToken: boolean
}): Promise<ReturnType<typeof watchtowerUtxosToSpendableCoins>> {
  const { bchWallet, hdWallet, tokenId, isBuyingToken } = opts

  // BCH inputs: all UTXOs, filtered client-side to non-token ones so that
  // other token holdings are never accidentally consumed.
  const [allUtxos, tokenUtxos] = await Promise.all([
    bchWallet.getUtxos(),
    isBuyingToken ? Promise.resolve([] as WatchtowerUtxo[]) : bchWallet.getUtxos({ category: tokenId }),
  ])

  const bchUtxos = allUtxos.filter((utxo: WatchtowerUtxo) => !utxo.is_cashtoken)
  const utxos = [...bchUtxos, ...(tokenUtxos as WatchtowerUtxo[])]

  return watchtowerUtxosToSpendableCoins({ utxos, wallet: hdWallet })
}