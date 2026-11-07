import { randomBytes, randomInt } from 'node:crypto'
import { ExchangeLab } from '@cashlab/cauldron'
import { PayoutAmountRuleType } from '@cashlab/common'
import {
  cashAddressToLockingBytecode,
  binToHex,
} from '@cashlab/common/libauth.js'
import { requireWallet, type WalletContext } from '../core/context.js'
import {
  buildBchPaymentUri,
  buildTokenPaymentUri,
  isValidBchAddress,
} from '../core/wallet.js'
import { LibauthHDWallet } from '../wallet/keys.js'
import { X402Payer } from '../wallet/x402.js'
import {
  parsePaymentRequiredJson,
  selectBchPaymentRequirements,
} from '../utils/x402.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import {
  fetchPoolsForToken,
  fetchCauldronFee,
} from '../wallet/cauldron/api.js'
import { apiPoolToMicroPool, microPoolToPoolV0 } from '../wallet/cauldron/pools.js'
import {
  attemptTrade,
  watchtowerUtxosToSpendableCoins,
  type WatchtowerUtxo,
} from '../wallet/cauldron/transact.js'
import {
  computePlatformFee,
  estimateTokenNeededForBch,
} from '../wallet/cauldron/swap.js'
import { getBchUsdPrice } from '../utils/prices.js'
import type { PaymentRequirements } from '../types/x402.js'
import {
  getConfig,
  getWalletStatus,
  type AiConfig,
  type AiModelConfig,
  type PriceTier,
  type TopupQuote,
} from './client.js'
import { LIFT_TOKEN_ID, resolveBackendUrl, apiUrl } from './config.js'
import { selectModel, selectTier, formatDuration } from './models.js'
import { findSession, hasActiveCredits } from './credits.js'

export type PaymentMethod = 'bch' | 'lift'
export type PaymentSource = 'internal' | 'external'

/** Payment details a user can hand to another wallet. */
export interface ExternalPaymentDetails {
  paymentMethod: PaymentMethod
  /** Address to pay: the server's BCH address, or a token-aware LIFT address. */
  address: string
  /** BIP21 URI for BCH, or a PayPro-style token URI for LIFT. */
  paymentUri: string
  /** Exact amount requested for BCH (includes the payment tag). */
  amountSats: number
  /** Token details for LIFT payments (base units). */
  tokenCategory?: string
  tokenAmount?: string
  tokenDecimals?: number
  tokenSymbol?: string
  /** Seconds until the underlying x402 quote expires. */
  expiresInSeconds: number
}

/**
 * An external payment request that has been quoted but not settled yet.
 * `pendingId` is passed back to `settleExternalPayment` after the user pays.
 */
export interface ExternalPaymentPreparation {
  success: boolean
  kind: 'plan' | 'topup'
  paymentSource: 'external'
  pendingId?: string
  paymentMethod?: PaymentMethod
  priceSats?: number
  model?: string
  displayName?: string
  minutes?: number
  amountUsd?: number
  balanceUsd?: number
  topupPresets?: number[]
  minTopupUsd?: number
  external?: ExternalPaymentDetails
  error?: string
}

export interface BuyPlanOptions {
  model: string
  minutes: number
  paymentMethod?: PaymentMethod
  isChipnet?: boolean
  confirmed?: boolean
  backendUrl?: string
  skipProbe?: boolean
  skipActiveCreditGuard?: boolean
  /** Where the funds come from. Defaults to the internal wallet. */
  payFrom?: PaymentSource
  /** Called with the payment request just before waiting for an external payment. */
  onExternalPayment?: (
    details: ExternalPaymentDetails
  ) => void | Promise<void>
}

export interface BuyPlanResult {
  success: boolean
  paid: boolean
  model?: string
  displayName?: string
  minutes?: number
  priceSats?: number
  paymentMethod?: PaymentMethod
  paymentSource?: PaymentSource
  txid?: string
  recipientAddress?: string
  status?: number
  sessionActivated?: boolean
  timeRemainingSeconds?: number
  data?: unknown
  error?: string
  /** Present for external payments (also on timeouts, so the user can retry). */
  paymentUri?: string
  paymentAddress?: string
  paymentAmountSats?: number
  tokenAmount?: string
  tokenSymbol?: string
  tokenDecimals?: number
}

const PLAN_PROBE_SAMPLES = 3
const PLAN_PROBE_SPACING_MS = 500
const PLAN_PROBE_PRICE_DRIFT_TOLERANCE = 0.05

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function probePlanStability(
  baseUrl: string,
  modelId: string,
  minutes: number
): Promise<void> {
  let okSamples = 0
  const prices: number[] = []
  let lastError = ''

  for (let i = 0; i < PLAN_PROBE_SAMPLES; i++) {
    try {
      const config = await getConfig({ backendUrl: baseUrl, timeoutMs: 6000 })
      const model = selectModel(config.models || [], modelId)
      if (!model) {
        lastError = `model ${modelId} not in plan config`
      } else {
        const tier = selectTier(model, minutes)
        if (!tier) {
          lastError = `no ${minutes}-min plan for ${modelId}`
        } else {
          prices.push(Number(tier.price_sats) || 0)
          okSamples++
        }
      }
    } catch (err: any) {
      lastError = err?.message || String(err)
    }
    if (i < PLAN_PROBE_SAMPLES - 1) await sleep(PLAN_PROBE_SPACING_MS)
  }

  if (okSamples === PLAN_PROBE_SAMPLES && prices.length > 0) {
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const drift = min > 0 ? (max - min) / min : max === min ? 0 : Infinity
    if (drift <= PLAN_PROBE_PRICE_DRIFT_TOLERANCE) return
    throw new Error(
      `Backend plan price was unstable before purchase (${prices.join(', ')} sats). No payment was broadcast — please retry in a few seconds.`
    )
  }
  throw new Error(
    `Backend plan endpoint was unreachable before purchase (reachable ${okSamples}/${PLAN_PROBE_SAMPLES}${
      lastError ? `, last error: ${lastError}` : ''
    }). No payment was broadcast — please retry in a few seconds.`
  )
}

interface BuildPlanRequest {
  url: string
  headers: Record<string, string>
  body: string
}

function buildPlanRequest(
  baseUrl: string,
  walletHash: string,
  model: AiModelConfig,
  tier: PriceTier,
  paymentMethod: PaymentMethod
): BuildPlanRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Wallet-Hash': walletHash,
    'X-Model-Id': model.id,
    'X-Duration-Minutes': String(tier.minutes),
    'X-Plan-Probe': '1',
  }
  if (paymentMethod === 'lift') headers['X-Payment-Method'] = 'lift'
  return {
    url: `${apiUrl(baseUrl, '/v1/chat/completions')}?wallet_hash=${encodeURIComponent(
      walletHash
    )}`,
    headers,
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content: 'ok' }],
      stream: false,
      max_tokens: 1,
    }),
  }
}

async function payWithLift(
  ctx: WalletContext,
  hdWallet: LibauthHDWallet,
  requirements: PaymentRequirements,
  changeAddress: string,
  isChipnet: boolean
): Promise<{ txid: string; vout: number }> {
  const tokenId = LIFT_TOKEN_ID
  const amountSats = BigInt(requirements.amount)

  const [apiPools, allUtxos, tokenUtxos] = await Promise.all([
    fetchPoolsForToken(tokenId),
    ctx.bch.getUtxos(),
    ctx.bch.getUtxos({ category: tokenId }),
  ])
  if (!apiPools || apiPools.length === 0) {
    throw new Error('No active Cauldron pools for the payment token.')
  }
  const pools = apiPools.map(apiPoolToMicroPool).map(microPoolToPoolV0)

  const tokenBalance = (tokenUtxos || []).reduce(
    (sum: bigint, u: WatchtowerUtxo) => sum + BigInt(u.amount || 0),
    0n
  )
  if (tokenBalance <= 0n) {
    throw new Error(
      'No LIFT tokens in the wallet. Add LIFT to pay this plan with tokens, or pay with BCH.'
    )
  }

  const bchUtxos = allUtxos.filter((utxo: WatchtowerUtxo) => !utxo.is_cashtoken)
  const spendableCoins = watchtowerUtxosToSpendableCoins({
    utxos: [...bchUtxos, ...(tokenUtxos || [])],
    wallet: hdWallet,
  })
  if (spendableCoins.length === 0) {
    throw new Error('No spendable UTXOs available.')
  }

  const payToDecoded = cashAddressToLockingBytecode(requirements.payTo)
  if (!payToDecoded || typeof payToDecoded === 'string' || !payToDecoded.bytecode) {
    throw new Error(`Invalid payment address: ${requirements.payTo}`)
  }
  const changeDecoded = cashAddressToLockingBytecode(changeAddress)
  if (!changeDecoded || typeof changeDecoded === 'string' || !changeDecoded.bytecode) {
    throw new Error(`Invalid change address: ${changeAddress}`)
  }

  const feeConfig = await fetchCauldronFee(isChipnet).catch(() => null)
  const bchUsdPrice = feeConfig
    ? await getBchUsdPrice(isChipnet).catch(() => null)
    : null

  const exlab = new ExchangeLab()
  let trade = null
  let tradeTx = null
  let lastError: Error | null = null

  for (const buffer of [2000n, 20000n, 100000n]) {
    try {
      trade = attemptTrade({
        pools,
        isBuyingToken: false,
        supply: undefined,
        demand: amountSats + buffer,
      })
      const payoutRules: any[] = [
        {
          type: PayoutAmountRuleType.FIXED,
          locking_bytecode: payToDecoded.bytecode,
          amount: amountSats,
        },
      ]

      const platformFee = feeConfig
        ? computePlatformFee({
            tradeResult: trade,
            isBuyingToken: false,
            feeConfig,
            bchUsdPrice,
          })
        : null
      if (platformFee) {
        const feeDecoded = cashAddressToLockingBytecode(platformFee.to)
        if (feeDecoded && typeof feeDecoded !== 'string' && feeDecoded.bytecode) {
          payoutRules.push({
            type: PayoutAmountRuleType.FIXED,
            locking_bytecode: feeDecoded.bytecode,
            amount: platformFee.amount,
          })
        }
      }

      payoutRules.push({
        type: PayoutAmountRuleType.CHANGE,
        locking_bytecode: changeDecoded.bytecode,
        allow_mixing_native_and_token: false,
        allow_mixing_native_and_token_when_bch_change_is_dust: false,
        add_change_to_txfee_when_bch_change_is_dust: true,
      })

      tradeTx = exlab.createTradeTx(
        trade.entries,
        spendableCoins,
        payoutRules,
        null,
        1n
      )
      exlab.verifyTradeTx(tradeTx)
      break
    } catch (err: any) {
      lastError = err
    }
  }

  if (!tradeTx) {
    const supply = (trade as any)?.summary?.supply
    if (supply && tokenBalance < supply) {
      throw new Error(
        `Insufficient LIFT balance: this payment needs ${supply} base units but the wallet has ${tokenBalance}.`
      )
    }
    throw new Error(
      `Could not fund the payment by selling LIFT: ${
        lastError?.message || 'unknown error'
      }`
    )
  }

  const tx = (tradeTx as any).libauth_generated_transaction
  const payToHex = binToHex(payToDecoded.bytecode)
  const vout = tx.outputs.findIndex(
    (o: any) => binToHex(o.lockingBytecode) === payToHex
  )
  if (vout === -1) throw new Error('Payment output missing from built transaction.')

  const txHex = binToHex((tradeTx as any).txbin)
  const broadcastResponse = await (ctx.bch.watchtower as any).BCH._api.post(
    'broadcast/',
    { transaction: txHex }
  )
  const data = broadcastResponse.data
  if (data?.result) {
    data[data.success ? 'txid' : 'error'] = data.result
    delete data.result
  }
  if (!data?.success || !data?.txid) {
    throw new Error(data?.error || 'Broadcast failed')
  }
  return { txid: data.txid, vout }
}

export async function payRequirements(
  ctx: WalletContext,
  hdWallet: LibauthHDWallet,
  requirements: PaymentRequirements,
  paymentMethod: PaymentMethod,
  isChipnet: boolean
): Promise<{ txid: string; vout: number }> {
  const changeAddress = ctx.bch.getAddressSetAt(0).change
  if (paymentMethod === 'lift') {
    return payWithLift(ctx, hdWallet, requirements, changeAddress, isChipnet)
  }
  if (!isValidBchAddress(requirements.payTo, isChipnet)) {
    throw new Error('Server returned an invalid BCH payment address.')
  }
  const amountBch = Number(requirements.amount) / 1e8
  const sendResult = await ctx.bch.sendBch(
    amountBch,
    requirements.payTo,
    changeAddress
  )
  if (!sendResult.success || !sendResult.txid) {
    throw new Error(sendResult.error || 'Transaction broadcast failed.')
  }
  return { txid: sendResult.txid, vout: 0 }
}

function resolveModelTier(
  config: AiConfig,
  modelQuery: string,
  minutes: number
): { model: AiModelConfig; tier: PriceTier } {
  const model = selectModel(config.models || [], modelQuery)
  if (!model) {
    throw new Error(`Unknown model "${modelQuery}". Run \`paytaca ai models\` to list available models.`)
  }
  const tier = selectTier(model, minutes)
  if (!tier) {
    throw new Error(
      `No ${minutes}-minute plan available for ${model.display_name || model.id}.`
    )
  }
  return { model, tier }
}

// ── Shared x402 helpers ──────────────────────────────────────────────

interface X402QuoteContext {
  url: string
  headers: Record<string, string>
  body: string
  requirements: PaymentRequirements
  resourceUrl: string
  isChipnet: boolean
  paymentMethod: PaymentMethod
}

interface X402Payment {
  txid: string
  vout: number
  /** Value reported as the funding UTXO amount in the payment payload. */
  amount: string
}

function normalizePaymentSource(source: unknown): PaymentSource {
  return source === 'external' ? 'external' : 'internal'
}

/** Quote lifetime from the server, minus a small margin to submit the claim. */
function externalTimeoutMs(requirements: PaymentRequirements): number {
  const maxSeconds = Number(requirements.maxTimeoutSeconds)
  // The backend expires its payment reservation ~10 min after the quote, so a
  // long fallback wait could invite a payment that lands on a dead address.
  const fallbackSeconds = 5 * 60
  const seconds =
    Number.isFinite(maxSeconds) && maxSeconds > 0
      ? Math.min(maxSeconds, fallbackSeconds)
      : fallbackSeconds
  return Math.max(30, seconds - 10) * 1000
}

function satsToBch(sats: number): string {
  return (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function watchtowerApi(ctx: WalletContext): any {
  return (ctx.bch.watchtower as any).BCH._api
}

async function scanAddress(ctx: WalletContext, address: string): Promise<void> {
  try {
    await watchtowerApi(ctx).get(`utxo/address/${address}/scan/`)
  } catch {
    // Throttled or unsupported; the regular listing below still works.
  }
}

async function listBchUtxos(
  ctx: WalletContext,
  address: string
): Promise<WatchtowerUtxo[]> {
  const res = await watchtowerApi(ctx).get(`utxo/bch/${address}/`)
  return Array.isArray(res?.data?.utxos) ? res.data.utxos : []
}

async function listTokenUtxos(
  ctx: WalletContext,
  address: string
): Promise<WatchtowerUtxo[]> {
  const res = await watchtowerApi(ctx).get(
    `utxo/ct/${address}/?is_cashtoken=true`
  )
  return Array.isArray(res?.data?.utxos) ? res.data.utxos : []
}

async function nextAddressIndex(ctx: WalletContext): Promise<number> {
  try {
    const last = await ctx.bch.getLastAddressIndex()
    return typeof last === 'number' && last >= 0 ? last + 1 : 0
  } catch {
    return 0
  }
}

interface ExternalMeta {
  details: ExternalPaymentDetails
  /** BCH UTXOs already at the shared server address before we started waiting. */
  knownUtxos: string[]
  /** Fresh LIFT address the user deposits to (LIFT only). */
  depositAddress?: string
}

async function buildExternalMeta(
  ctx: WalletContext,
  quote: Pick<
    X402QuoteContext,
    'requirements' | 'paymentMethod' | 'isChipnet'
  >
): Promise<ExternalMeta> {
  const requiredSats = Number(quote.requirements.amount)
  if (!Number.isInteger(requiredSats) || requiredSats <= 0) {
    throw new Error('Server returned an invalid payment amount.')
  }
  const expiresInSeconds = Math.max(
    1,
    Math.round(externalTimeoutMs(quote.requirements) / 1000)
  )

  if (quote.paymentMethod === 'bch') {
    if (!isValidBchAddress(quote.requirements.payTo, quote.isChipnet)) {
      throw new Error('Server returned an invalid BCH payment address.')
    }
    // A unique amount makes the payment identifiable even though several users
    // may share the same server address. Any extra sats remain a server credit.
    const tag = randomInt(1, 1000)
    const amountSats = requiredSats + tag
    const utxos = await listBchUtxos(ctx, quote.requirements.payTo)
    return {
      details: {
        paymentMethod: 'bch',
        address: quote.requirements.payTo,
        paymentUri: buildBchPaymentUri(
          quote.requirements.payTo,
          Number(satsToBch(amountSats))
        ),
        amountSats,
        expiresInSeconds,
      },
      knownUtxos: utxos.map((utxo) => `${utxo.txid}:${utxo.vout}`),
    }
  }

  if (quote.isChipnet) {
    throw new Error('LIFT payments are not supported on chipnet.')
  }
  // Quote enough LIFT to cover the BCH amount plus the swap buffer and fees.
  const estimate = await estimateTokenNeededForBch({
    tokenId: LIFT_TOKEN_ID,
    bchDemandSats: BigInt(requiredSats + 20_000),
    isChipnet: false,
  })
  const tokenAmount = estimate.tokenAmount + estimate.tokenAmount / 50n
  const index = await nextAddressIndex(ctx)
  try {
    await ctx.bch.getNewAddressSet(index)
  } catch {
    // Non-critical: the address is shown anyway.
  }
  const address = ctx.bch.getTokenAddressSetAt(index).receiving
  return {
    details: {
      paymentMethod: 'lift',
      address,
      paymentUri: buildTokenPaymentUri(
        address,
        LIFT_TOKEN_ID,
        Number(tokenAmount)
      ),
      amountSats: requiredSats,
      tokenCategory: LIFT_TOKEN_ID,
      tokenAmount: tokenAmount.toString(),
      tokenDecimals: estimate.decimals,
      tokenSymbol: estimate.symbol,
      expiresInSeconds,
    },
    knownUtxos: [],
    depositAddress: address,
  }
}

function externalResultFields(
  source: PaymentSource,
  meta?: ExternalMeta
): Partial<BuyPlanResult> {
  if (!meta) return { paymentSource: source }
  return {
    paymentSource: source,
    paymentUri: meta.details.paymentUri,
    paymentAddress: meta.details.address,
    paymentAmountSats: meta.details.amountSats,
    tokenAmount: meta.details.tokenAmount,
    tokenSymbol: meta.details.tokenSymbol,
    tokenDecimals: meta.details.tokenDecimals,
  }
}

async function waitForExternalBch(
  ctx: WalletContext,
  payTo: string,
  minSats: number,
  known: Set<string>,
  timeoutMs: number
): Promise<{ txid: string; vout: number; value: number } | null> {
  const deadline = Date.now() + timeoutMs
  let nextScan = Date.now() + 60_000
  let closest: { txid: string; vout: number; value: number } | null = null
  while (Date.now() < deadline) {
    if (Date.now() >= nextScan) {
      await scanAddress(ctx, payTo)
      nextScan = Date.now() + 60_000
    }
    let utxos: WatchtowerUtxo[] = []
    try {
      utxos = await listBchUtxos(ctx, payTo)
    } catch {
      // Transient indexer error; try again.
    }
    for (const utxo of utxos) {
      if (known.has(`${utxo.txid}:${utxo.vout}`)) continue
      const value = Number(utxo.value) || 0
      if (value < minSats) continue
      if (value === minSats) return { txid: utxo.txid, vout: utxo.vout, value }
      if (!closest || value < closest.value) {
        closest = { txid: utxo.txid, vout: utxo.vout, value }
      }
    }
    if (closest) return closest
    await sleep(5000)
  }
  return null
}

async function waitForLiftDeposit(
  ctx: WalletContext,
  address: string,
  tokenId: string,
  needed: bigint,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let nextScan = Date.now() + 60_000
  const lowerTokenId = tokenId.toLowerCase()
  while (Date.now() < deadline) {
    if (Date.now() >= nextScan) {
      await scanAddress(ctx, address)
      nextScan = Date.now() + 60_000
    }
    let utxos: WatchtowerUtxo[] = []
    try {
      utxos = await listTokenUtxos(ctx, address)
    } catch {
      // Transient indexer error; try again.
    }
    const total = utxos
      .filter((utxo) => (utxo.tokenid || '').toLowerCase() === lowerTokenId)
      .reduce((sum, utxo) => sum + BigInt(utxo.amount || 0), 0n)
    if (total >= needed) return true
    await sleep(5000)
  }
  return false
}

async function ensureLiftSpendable(
  ctx: WalletContext,
  needed: bigint
): Promise<void> {
  const deadline = Date.now() + 120_000
  let nextScan = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const utxos = await ctx.bch.getUtxos({ category: LIFT_TOKEN_ID })
      const total = (utxos || []).reduce(
        (sum: bigint, utxo: WatchtowerUtxo) =>
          sum + BigInt(utxo.amount || 0),
        0n
      )
      if (total >= needed) return
    } catch {
      // Not indexed yet; retry.
    }
    if (Date.now() >= nextScan) {
      try {
        await ctx.bch.scanUtxos({ background: false })
      } catch {
        // Non-critical.
      }
      nextScan = Date.now() + 10_000
    }
    await sleep(3000)
  }
  throw new Error(
    'The LIFT deposit was detected but is not spendable yet. Wait a moment and retry.'
  )
}

async function submitPayment(
  payer: X402Payer,
  quote: X402QuoteContext,
  payment: X402Payment,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: any; timedOut?: string }> {
  const paymentPayload = await payer.createPaymentPayload(
    quote.requirements,
    quote.resourceUrl,
    payment.txid,
    payment.vout,
    payment.amount
  )
  const headers = {
    ...quote.headers,
    'PAYMENT-SIGNATURE': JSON.stringify(paymentPayload),
  }
  try {
    const response = await fetch(quote.url, {
      method: 'POST',
      headers,
      body: quote.body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { ok: response.ok, status: response.status, data }
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      timedOut: err?.message || String(err),
    }
  }
}

// ── Plan purchase ────────────────────────────────────────────────────

interface PlanQuoteContext extends X402QuoteContext {
  baseUrl: string
  model: AiModelConfig
  minutes: number
  priceSats: number
}

function planResultBase(quote: PlanQuoteContext): Partial<BuyPlanResult> {
  return {
    model: quote.model.id,
    displayName: quote.model.display_name,
    minutes: quote.minutes,
    priceSats: quote.priceSats,
    paymentMethod: quote.paymentMethod,
  }
}

async function quotePlan(
  opts: BuyPlanOptions,
  source: PaymentSource
): Promise<
  | { ok: true; ctx: WalletContext; quote: PlanQuoteContext }
  | { ok: false; result: BuyPlanResult }
> {
  const paymentMethod: PaymentMethod =
    opts.paymentMethod === 'lift' ? 'lift' : 'bch'
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)

  const modelQuery = String(opts.model || '').trim()
  const minutes = Number(opts.minutes)
  if (!modelQuery) {
    return { ok: false, result: { success: false, paid: false, error: 'Missing model.' } }
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return {
      ok: false,
      result: { success: false, paid: false, error: 'Missing or invalid minutes.' },
    }
  }

  let ctx: WalletContext
  let model: AiModelConfig
  let tier: PriceTier
  try {
    ctx = requireWallet(isChipnet)
    const config = await getConfig({ backendUrl: baseUrl })
    const resolved = resolveModelTier(config, modelQuery, minutes)
    model = resolved.model
    tier = resolved.tier
  } catch (err: any) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        error: err?.message || String(err),
        paymentSource: source,
      },
    }
  }

  const priceSats = Number(tier.price_sats) || 0

  if (!opts.skipActiveCreditGuard) {
    try {
      const status = await getWalletStatus(ctx.walletHash, {
        backendUrl: baseUrl,
      })
      if (hasActiveCredits(status, model.id)) {
        const session = findSession(status, model.id)
        const remaining = formatDuration(session?.time_remaining_seconds ?? 0)
        return {
          ok: false,
          result: {
            success: false,
            paid: false,
            model: model.id,
            displayName: model.display_name,
            paymentSource: source,
            error: `${model.display_name || model.id} still has ${remaining} of active credits. A new plan cannot be purchased until they are used up or expire.`,
          },
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        result: {
          success: false,
          paid: false,
          paymentSource: source,
          error: `Could not check existing credits before purchase: ${err?.message || err}`,
        },
      }
    }
  }

  if (source === 'internal' && paymentMethod === 'bch') {
    try {
      const balance = await ctx.bch.getBalance()
      const availableSats = Math.round(balance.spendable * 1e8)
      if (priceSats > 0 && availableSats < priceSats) {
        return {
          ok: false,
          result: {
            success: false,
            paid: false,
            model: model.id,
            displayName: model.display_name,
            priceSats,
            paymentSource: source,
            error: `Insufficient balance: ${(availableSats / 1e8).toFixed(
              8
            )} BCH available but the ${minutes}-minute plan costs ${(
              priceSats / 1e8
            ).toFixed(8)} BCH.`,
          },
        }
      }
    } catch {
      // Balance check is best-effort; the payment flow will surface real errors.
    }
  }

  if (!opts.skipProbe && process.env.PAYTACA_PLAN_PROBE !== '0') {
    try {
      await probePlanStability(baseUrl, model.id, tier.minutes)
    } catch (err: any) {
      return {
        ok: false,
        result: {
          success: false,
          paid: false,
          paymentSource: source,
          error: err?.message || String(err),
        },
      }
    }
  }

  const { url, headers, body } = buildPlanRequest(
    baseUrl,
    ctx.walletHash,
    model,
    tier,
    paymentMethod
  )

  let firstResponse: Response
  try {
    firstResponse = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(240000),
    })
  } catch (err: any) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        paymentSource: source,
        error: `Request failed: ${err?.message || err}`,
      },
    }
  }

  const firstText = await firstResponse.text()
  let firstData: any
  try {
    firstData = JSON.parse(firstText)
  } catch {
    firstData = firstText
  }

  const base = {
    model: model.id,
    displayName: model.display_name,
    minutes: tier.minutes,
    priceSats,
    paymentMethod,
    paymentSource: source,
  }

  if (firstResponse.status !== 402) {
    return {
      ok: false,
      result: {
        success: true,
        paid: false,
        ...base,
        status: firstResponse.status,
        data: firstData,
        error: firstResponse.ok
          ? 'No purchase made: the model already has active credits, so the request was served without payment.'
          : `Unexpected response (${firstResponse.status}).`,
      },
    }
  }

  const paymentRequired = parsePaymentRequiredJson(firstData)
  if (!paymentRequired) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        status: 402,
        ...base,
        error: 'Could not parse PaymentRequired from 402 response body.',
      },
    }
  }

  const requirements = selectBchPaymentRequirements(
    paymentRequired,
    isChipnet ? 'chipnet' : 'mainnet'
  )
  if (!requirements) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        status: 402,
        ...base,
        error: 'Server does not accept BCH payment for this plan.',
      },
    }
  }

  return {
    ok: true,
    ctx,
    quote: {
      url,
      headers,
      body,
      requirements,
      resourceUrl: paymentRequired.resource.url,
      isChipnet,
      paymentMethod,
      baseUrl,
      model,
      minutes: tier.minutes,
      priceSats,
    },
  }
}

async function settlePlan(
  ctx: WalletContext,
  quote: PlanQuoteContext,
  source: PaymentSource,
  external?: ExternalMeta,
  existingPayment?: X402Payment,
  onPayment?: (payment: X402Payment) => void
): Promise<BuyPlanResult> {
  const base = planResultBase(quote)
  const hdWallet = new LibauthHDWallet(
    ctx.mnemonic,
    BCH_DERIVATION_PATH,
    quote.isChipnet ? 'chipnet' : 'mainnet'
  )
  const payer = new X402Payer({ hdWallet, addressIndex: 0 })
  const timeoutMs = externalTimeoutMs(quote.requirements)

  let payment = existingPayment
  if (!payment && source === 'external' && external) {
    if (quote.paymentMethod === 'bch') {
      const found = await waitForExternalBch(
        ctx,
        quote.requirements.payTo,
        external.details.amountSats,
        new Set(external.knownUtxos),
        timeoutMs
      )
      if (!found) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error:
            'No external BCH payment was detected before the quote expired. Check the amount and address, then request a new payment.',
        }
      }
      payment = {
        txid: found.txid,
        vout: found.vout,
        amount: String(found.value),
      }
    } else {
      const needed = BigInt(external.details.tokenAmount || '0')
      const detected = await waitForLiftDeposit(
        ctx,
        external.details.address,
        external.details.tokenCategory || LIFT_TOKEN_ID,
        needed,
        timeoutMs
      )
      if (!detected) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error:
            'No external LIFT deposit was detected before the quote expired. Check the amount and address, then request a new payment.',
        }
      }
      try {
        await ensureLiftSpendable(ctx, needed)
        const paid = await payRequirements(
          ctx,
          hdWallet,
          quote.requirements,
          'lift',
          quote.isChipnet
        )
        payment = {
          txid: paid.txid,
          vout: paid.vout,
          amount: quote.requirements.amount,
        }
      } catch (err: any) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error: err?.message || String(err),
        }
      }
    }
    onPayment?.(payment)
  } else if (!payment) {
    try {
      const paid = await payRequirements(
        ctx,
        hdWallet,
        quote.requirements,
        quote.paymentMethod,
        quote.isChipnet
      )
      payment = {
        txid: paid.txid,
        vout: paid.vout,
        amount: quote.requirements.amount,
      }
      onPayment?.(payment)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...base,
        ...externalResultFields(source),
        error: err?.message || String(err),
      }
    }
  }

  const fields = {
    ...base,
    ...externalResultFields(source, external),
  }

  const submitted = await submitPayment(payer, quote, payment, 240000)
  if (submitted.timedOut) {
    return {
      success: true,
      paid: true,
      ...fields,
      txid: payment.txid,
      recipientAddress: quote.requirements.payTo,
      error: `Payment was sent but the response timed out: ${submitted.timedOut}. Check credits with \`paytaca ai credits\`.`,
    }
  }

  let sessionActivated = false
  let timeRemainingSeconds: number | undefined
  try {
    const status = await getWalletStatus(ctx.walletHash, {
      backendUrl: quote.baseUrl,
    })
    const session = findSession(status, quote.model.id)
    sessionActivated = hasActiveCredits(status, quote.model.id)
    timeRemainingSeconds = session?.time_remaining_seconds
  } catch {
    // Non-critical.
  }

  return {
    success: submitted.ok,
    paid: true,
    ...fields,
    txid: payment.txid,
    recipientAddress: quote.requirements.payTo,
    status: submitted.status,
    sessionActivated,
    timeRemainingSeconds,
    data: submitted.data,
    error: submitted.ok
      ? undefined
      : `Payment broadcast (txid ${payment.txid}) but the backend returned ${submitted.status}.`,
  }
}

export async function buyPlan(opts: BuyPlanOptions): Promise<BuyPlanResult> {
  const source = normalizePaymentSource(opts.payFrom)
  const quoted = await quotePlan(opts, source)
  if (!quoted.ok) return quoted.result

  const { ctx, quote } = quoted

  if (!opts.confirmed) {
    return {
      success: false,
      paid: false,
      status: 402,
      ...planResultBase(quote),
      ...externalResultFields(source),
      recipientAddress: quote.requirements.payTo,
      error: 'Payment not confirmed.',
    }
  }

  if (source === 'external') {
    let meta: ExternalMeta
    try {
      meta = await buildExternalMeta(ctx, quote)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...planResultBase(quote),
        ...externalResultFields(source),
        error: err?.message || String(err),
      }
    }
    try {
      await opts.onExternalPayment?.(meta.details)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...planResultBase(quote),
        ...externalResultFields(source, meta),
        error: `Could not present the external payment request: ${
          err?.message || err
        }`,
      }
    }
    return settlePlan(ctx, quote, source, meta)
  }

  return settlePlan(ctx, quote, source)
}

export async function preparePlanPayment(
  opts: BuyPlanOptions
): Promise<ExternalPaymentPreparation> {
  const quoted = await quotePlan({ ...opts, confirmed: true }, 'external')
  if (!quoted.ok) {
    const result = quoted.result
    return {
      success: false,
      kind: 'plan',
      paymentSource: 'external',
      model: result.model,
      displayName: result.displayName,
      minutes: result.minutes,
      priceSats: result.priceSats,
      paymentMethod: result.paymentMethod,
      error: result.error,
    }
  }

  const { ctx, quote } = quoted
  let meta: ExternalMeta
  try {
    meta = await buildExternalMeta(ctx, quote)
  } catch (err: any) {
    return {
      success: false,
      kind: 'plan',
      paymentSource: 'external',
      model: quote.model.id,
      displayName: quote.model.display_name,
      minutes: quote.minutes,
      priceSats: quote.priceSats,
      paymentMethod: quote.paymentMethod,
      error: err?.message || String(err),
    }
  }

  prunePendingPayments()
  const pendingId = randomBytes(16).toString('hex')
  pendingPayments.set(pendingId, {
    id: pendingId,
    kind: 'plan',
    createdAt: Date.now(),
    quote,
    meta,
  })

  return {
    success: true,
    kind: 'plan',
    paymentSource: 'external',
    pendingId,
    model: quote.model.id,
    displayName: quote.model.display_name,
    minutes: quote.minutes,
    priceSats: quote.priceSats,
    paymentMethod: quote.paymentMethod,
    external: meta.details,
  }
}

// ── Balance top-up ───────────────────────────────────────────────────

export interface TopUpOptions {
  amountUsd?: number
  paymentMethod?: PaymentMethod
  isChipnet?: boolean
  confirmed?: boolean
  backendUrl?: string
  /** Where the funds come from. Defaults to the internal wallet. */
  payFrom?: PaymentSource
  /** Called with the payment request just before waiting for an external payment. */
  onExternalPayment?: (
    details: ExternalPaymentDetails
  ) => void | Promise<void>
}

export interface TopUpResult {
  success: boolean
  paid: boolean
  amountUsd?: number
  balanceUsd?: number
  topupPresets?: number[]
  minTopupUsd?: number
  priceSats?: number
  paymentMethod?: PaymentMethod
  paymentSource?: PaymentSource
  txid?: string
  recipientAddress?: string
  status?: number
  data?: unknown
  error?: string
  paymentUri?: string
  paymentAddress?: string
  paymentAmountSats?: number
  tokenAmount?: string
  tokenSymbol?: string
  tokenDecimals?: number
}

function buildTopupRequest(
  baseUrl: string,
  walletHash: string,
  amountUsd: number | undefined,
  paymentMethod: PaymentMethod
): BuildPlanRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Wallet-Hash': walletHash,
  }
  if (amountUsd !== undefined) headers['X-Topup-Usd'] = String(amountUsd)
  if (paymentMethod === 'lift') headers['X-Payment-Method'] = 'lift'

  const payload: Record<string, unknown> = { payment_method: paymentMethod }
  if (amountUsd !== undefined) payload.amount_usd = amountUsd

  return {
    url: `${apiUrl(baseUrl, '/v1/wallet/topup')}?wallet_hash=${encodeURIComponent(
      walletHash
    )}`,
    headers,
    body: JSON.stringify(payload),
  }
}

interface TopupQuoteContext extends X402QuoteContext {
  baseUrl: string
  amountUsd?: number
  effectiveUsd?: number
  balanceUsd?: number
  topupPresets?: number[]
  minTopupUsd?: number
  priceSats: number
}

function topupResultBase(quote: TopupQuoteContext): Partial<TopUpResult> {
  return {
    amountUsd: quote.effectiveUsd ?? quote.amountUsd,
    paymentMethod: quote.paymentMethod,
    priceSats: quote.priceSats,
  }
}

async function quoteTopup(
  opts: TopUpOptions,
  source: PaymentSource
): Promise<
  | { ok: true; ctx: WalletContext; quote: TopupQuoteContext }
  | { ok: false; result: TopUpResult }
> {
  const paymentMethod: PaymentMethod =
    opts.paymentMethod === 'lift' ? 'lift' : 'bch'
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)

  const parsedAmount = Number(opts.amountUsd)
  const amountUsd =
    opts.amountUsd !== undefined &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0
      ? parsedAmount
      : undefined

  let ctx: WalletContext
  try {
    ctx = requireWallet(isChipnet)
  } catch (err: any) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        paymentSource: source,
        error: err?.message || String(err),
      },
    }
  }

  const { url, headers, body } = buildTopupRequest(
    baseUrl,
    ctx.walletHash,
    amountUsd,
    paymentMethod
  )

  let firstResponse: Response
  try {
    firstResponse = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(120000),
    })
  } catch (err: any) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        paymentSource: source,
        error: `Request failed: ${err?.message || err}`,
      },
    }
  }

  const firstText = await firstResponse.text()
  let firstData: any
  try {
    firstData = JSON.parse(firstText)
  } catch {
    firstData = firstText
  }

  const quote: TopupQuote | null =
    firstData && typeof firstData === 'object' ? (firstData as TopupQuote) : null

  if (firstResponse.status !== 402) {
    return {
      ok: false,
      result: {
        success: firstResponse.ok,
        paid: false,
        amountUsd: quote?.topup_amount_usd ?? amountUsd,
        balanceUsd: quote?.balance_usd,
        topupPresets: quote?.topup_presets,
        minTopupUsd: quote?.min_topup_usd,
        paymentMethod,
        paymentSource: source,
        status: firstResponse.status,
        data: firstData,
        error: firstResponse.ok
          ? undefined
          : (firstData as any)?.error ||
            `Unexpected response (${firstResponse.status}).`,
      },
    }
  }

  const paymentRequired = parsePaymentRequiredJson(firstData)
  if (!paymentRequired) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        status: 402,
        paymentMethod,
        paymentSource: source,
        error: 'Could not parse PaymentRequired from 402 response body.',
      },
    }
  }
  const requirements = selectBchPaymentRequirements(
    paymentRequired,
    isChipnet ? 'chipnet' : 'mainnet'
  )
  if (!requirements) {
    return {
      ok: false,
      result: {
        success: false,
        paid: false,
        status: 402,
        paymentMethod,
        paymentSource: source,
        error: 'Server does not accept BCH payment for balance top-ups.',
      },
    }
  }

  return {
    ok: true,
    ctx,
    quote: {
      url,
      headers,
      body,
      requirements,
      resourceUrl: paymentRequired.resource.url,
      isChipnet,
      paymentMethod,
      baseUrl,
      amountUsd,
      effectiveUsd: quote?.topup_amount_usd,
      balanceUsd: quote?.balance_usd,
      topupPresets: quote?.topup_presets,
      minTopupUsd: quote?.min_topup_usd,
      priceSats: Number(requirements.amount) || 0,
    },
  }
}

async function settleTopup(
  ctx: WalletContext,
  quote: TopupQuoteContext,
  source: PaymentSource,
  external?: ExternalMeta,
  existingPayment?: X402Payment,
  onPayment?: (payment: X402Payment) => void
): Promise<TopUpResult> {
  const base = topupResultBase(quote)
  const hdWallet = new LibauthHDWallet(
    ctx.mnemonic,
    BCH_DERIVATION_PATH,
    quote.isChipnet ? 'chipnet' : 'mainnet'
  )
  const payer = new X402Payer({ hdWallet, addressIndex: 0 })
  const timeoutMs = externalTimeoutMs(quote.requirements)

  let payment = existingPayment
  if (!payment && source === 'external' && external) {
    if (quote.paymentMethod === 'bch') {
      const found = await waitForExternalBch(
        ctx,
        quote.requirements.payTo,
        external.details.amountSats,
        new Set(external.knownUtxos),
        timeoutMs
      )
      if (!found) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error:
            'No external BCH payment was detected before the quote expired. Check the amount and address, then request a new payment.',
        }
      }
      payment = {
        txid: found.txid,
        vout: found.vout,
        amount: String(found.value),
      }
    } else {
      const needed = BigInt(external.details.tokenAmount || '0')
      const detected = await waitForLiftDeposit(
        ctx,
        external.details.address,
        external.details.tokenCategory || LIFT_TOKEN_ID,
        needed,
        timeoutMs
      )
      if (!detected) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error:
            'No external LIFT deposit was detected before the quote expired. Check the amount and address, then request a new payment.',
        }
      }
      try {
        await ensureLiftSpendable(ctx, needed)
        const paid = await payRequirements(
          ctx,
          hdWallet,
          quote.requirements,
          'lift',
          quote.isChipnet
        )
        payment = {
          txid: paid.txid,
          vout: paid.vout,
          amount: quote.requirements.amount,
        }
      } catch (err: any) {
        return {
          success: false,
          paid: false,
          status: 402,
          ...base,
          ...externalResultFields(source, external),
          error: err?.message || String(err),
        }
      }
    }
    onPayment?.(payment)
  } else if (!payment) {
    try {
      const paid = await payRequirements(
        ctx,
        hdWallet,
        quote.requirements,
        quote.paymentMethod,
        quote.isChipnet
      )
      payment = {
        txid: paid.txid,
        vout: paid.vout,
        amount: quote.requirements.amount,
      }
      onPayment?.(payment)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...base,
        ...externalResultFields(source),
        error: err?.message || String(err),
      }
    }
  }

  const fields = {
    ...base,
    ...externalResultFields(source, external),
  }

  const submitted = await submitPayment(payer, quote, payment, 120000)
  if (submitted.timedOut) {
    return {
      success: true,
      paid: true,
      ...fields,
      txid: payment.txid,
      recipientAddress: quote.requirements.payTo,
      error: `Payment was sent but the response timed out: ${submitted.timedOut}. Check your balance with \`paytaca ai balance\`.`,
    }
  }

  const retryData = submitted.data
  const creditedUsd =
    retryData && typeof retryData === 'object' ? retryData.amount_usd : undefined
  const newBalance =
    retryData && typeof retryData === 'object' ? retryData.balance_usd : undefined

  return {
    success: submitted.ok,
    paid: true,
    ...fields,
    amountUsd: creditedUsd ?? base.amountUsd,
    balanceUsd: newBalance,
    txid: payment.txid,
    recipientAddress: quote.requirements.payTo,
    status: submitted.status,
    data: retryData,
    error: submitted.ok
      ? undefined
      : `Payment broadcast (txid ${payment.txid}) but the backend returned ${submitted.status}.`,
  }
}

export async function topUpBalance(opts: TopUpOptions): Promise<TopUpResult> {
  const source = normalizePaymentSource(opts.payFrom)
  const quoted = await quoteTopup(opts, source)
  if (!quoted.ok) return quoted.result

  const { ctx, quote } = quoted

  if (!opts.confirmed) {
    return {
      success: false,
      paid: false,
      status: 402,
      ...topupResultBase(quote),
      balanceUsd: quote.balanceUsd,
      topupPresets: quote.topupPresets,
      minTopupUsd: quote.minTopupUsd,
      ...externalResultFields(source),
      recipientAddress: quote.requirements.payTo,
      error: 'Payment not confirmed.',
    }
  }

  if (source === 'external') {
    let meta: ExternalMeta
    try {
      meta = await buildExternalMeta(ctx, quote)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...topupResultBase(quote),
        balanceUsd: quote.balanceUsd,
        ...externalResultFields(source),
        error: err?.message || String(err),
      }
    }
    try {
      await opts.onExternalPayment?.(meta.details)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        status: 402,
        ...topupResultBase(quote),
        ...externalResultFields(source, meta),
        error: `Could not present the external payment request: ${
          err?.message || err
        }`,
      }
    }
    return settleTopup(ctx, quote, source, meta)
  }

  const result = await settleTopup(ctx, quote, source)
  return {
    ...result,
    balanceUsd: result.balanceUsd ?? quote.balanceUsd,
    topupPresets: quote.topupPresets,
    minTopupUsd: quote.minTopupUsd,
  }
}

export async function prepareTopupPayment(
  opts: TopUpOptions
): Promise<ExternalPaymentPreparation> {
  const quoted = await quoteTopup({ ...opts, confirmed: true }, 'external')
  if (!quoted.ok) {
    const result = quoted.result
    return {
      success: false,
      kind: 'topup',
      paymentSource: 'external',
      amountUsd: result.amountUsd,
      balanceUsd: result.balanceUsd,
      topupPresets: result.topupPresets,
      minTopupUsd: result.minTopupUsd,
      priceSats: result.priceSats,
      paymentMethod: result.paymentMethod,
      error: result.error,
    }
  }

  const { ctx, quote } = quoted
  let meta: ExternalMeta
  try {
    meta = await buildExternalMeta(ctx, quote)
  } catch (err: any) {
    return {
      success: false,
      kind: 'topup',
      paymentSource: 'external',
      amountUsd: quote.effectiveUsd ?? quote.amountUsd,
      balanceUsd: quote.balanceUsd,
      topupPresets: quote.topupPresets,
      minTopupUsd: quote.minTopupUsd,
      priceSats: quote.priceSats,
      paymentMethod: quote.paymentMethod,
      error: err?.message || String(err),
    }
  }

  prunePendingPayments()
  const pendingId = randomBytes(16).toString('hex')
  pendingPayments.set(pendingId, {
    id: pendingId,
    kind: 'topup',
    createdAt: Date.now(),
    quote,
    meta,
  })

  return {
    success: true,
    kind: 'topup',
    paymentSource: 'external',
    pendingId,
    amountUsd: quote.effectiveUsd ?? quote.amountUsd,
    balanceUsd: quote.balanceUsd,
    topupPresets: quote.topupPresets,
    minTopupUsd: quote.minTopupUsd,
    priceSats: quote.priceSats,
    paymentMethod: quote.paymentMethod,
    external: meta.details,
  }
}

// ── Pending external payments ────────────────────────────────────────

interface PendingExternalBase {
  id: string
  kind: 'plan' | 'topup'
  createdAt: number
  meta: ExternalMeta
  /** Set once the external funds were found / our payment was broadcast. */
  payment?: X402Payment
  settling?: boolean
}

interface PendingExternalPlan extends PendingExternalBase {
  kind: 'plan'
  quote: PlanQuoteContext
}

interface PendingExternalTopup extends PendingExternalBase {
  kind: 'topup'
  quote: TopupQuoteContext
}

type PendingExternalPayment = PendingExternalPlan | PendingExternalTopup

const pendingPayments = new Map<string, PendingExternalPayment>()
const PENDING_TTL_MS = 20 * 60_000

function prunePendingPayments(): void {
  const now = Date.now()
  for (const [id, pending] of pendingPayments) {
    const ttl = pending.payment ? PENDING_TTL_MS * 3 : PENDING_TTL_MS
    if (now - pending.createdAt > ttl) pendingPayments.delete(id)
  }
}

/**
 * Finish an external payment prepared by `preparePlanPayment` or
 * `prepareTopupPayment`. The pending record is removed once the backend
 * confirms the payment; a failed attempt keeps it so it can be retried
 * without asking the user to pay again.
 */
export async function settleExternalPayment(
  pendingId: string,
  expectedKind?: 'plan' | 'topup'
): Promise<BuyPlanResult | TopUpResult> {
  prunePendingPayments()
  const pending = pendingPayments.get(String(pendingId || '').trim())
  if (!pending) {
    return {
      success: false,
      paid: false,
      error:
        'Unknown or expired external payment request. Start a new payment.',
    }
  }
  if (expectedKind && pending.kind !== expectedKind) {
    return {
      success: false,
      paid: false,
      error:
        pending.kind === 'plan'
          ? 'This pending payment is for a plan purchase, not a balance top-up.'
          : 'This pending payment is for a balance top-up, not a plan purchase.',
    }
  }
  if (pending.settling) {
    return {
      success: false,
      paid: false,
      error: 'This external payment is already being finalized.',
    }
  }

  pending.settling = true
  try {
    let ctx: WalletContext
    try {
      ctx = requireWallet(pending.quote.isChipnet)
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        error: err?.message || String(err),
      }
    }

    const onPayment = (payment: X402Payment) => {
      pending.payment = payment
      pending.createdAt = Date.now()
    }
    const result =
      pending.kind === 'plan'
        ? await settlePlan(
            ctx,
            pending.quote,
            'external',
            pending.meta,
            pending.payment,
            onPayment
          )
        : await settleTopup(
            ctx,
            pending.quote,
            'external',
            pending.meta,
            pending.payment,
            onPayment
          )

    if (result.success && result.paid) {
      pendingPayments.delete(pending.id)
    }
    return result
  } finally {
    pending.settling = false
  }
}
