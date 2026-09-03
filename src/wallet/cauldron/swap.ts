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
import {
  fetchPoolsForToken,
  fetchTokenData,
  type CauldronTokenData,
} from './api.js'
import { apiPoolToMicroPool, microPoolToPoolV0, parseRate } from './pools.js'
import {
  attemptTrade,
  createInputAndOutput,
  watchtowerUtxosToSpendableCoins,
  type WatchtowerUtxo,
} from './transact.js'

export type SwapDirection = 'buy' | 'sell'

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
}

export interface EstimateSwapOpts {
  /** 64-char hex token category. */
  tokenId: string
  /** 'buy' = spend BCH to receive tokens, 'sell' = spend tokens to receive BCH. */
  direction: SwapDirection
  /** Token amount in base units (sell: amount supplied; buy: amount received). */
  amount: bigint
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
 * Estimate a swap: fetch pools + token data and compute the best-rate trade.
 */
export async function estimateSwap(
  opts: EstimateSwapOpts
): Promise<SwapQuote> {
  const { tokenId, direction, amount } = opts

  const [tokenData, apiPools] = await Promise.all([
    fetchTokenData(tokenId),
    fetchPoolsForToken(tokenId),
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

  if (direction === 'sell') {
    // Rate semantics (matches paytaca-app): '1 {demandSymbol} ≈ {rate} {supplySymbol}'.
    // Selling tokens → demand is BCH, rate is tokens-per-BCH.
    return [
      `Sell ${tokenFormatted} ${tokenSymbol} for ${bchFormatted} BCH`,
      `Rate: 1 BCH ≈ ${rate} ${tokenSymbol}`,
      `Trade fee: ~${feeFormatted} BCH`,
    ].join('\n')
  }
  // Buying tokens → demand is the token, rate is BCH-per-token.
  return [
    `Buy ${tokenFormatted} ${tokenSymbol} for ${bchFormatted} BCH`,
    `Rate: 1 ${tokenSymbol} ≈ ${rate} BCH`,
    `Trade fee: ~${feeFormatted} BCH`,
  ].join('\n')
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

  const hdWallet = new LibauthHDWallet(mnemonic, derivationPath)
  const spendableCoins = await collectSpendableCoins({
    bchWallet,
    hdWallet,
    tokenId: quote.tokenId,
    isBuyingToken: quote.isBuyingToken,
  })

  const { inputCoins, payouts } = createInputAndOutput({
    tradeResult: quote.tradeResult,
    spendableCoins,
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