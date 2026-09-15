import { ExchangeLab } from '@cashlab/cauldron'
import { PayoutAmountRuleType } from '@cashlab/common'
import {
  cashAddressToLockingBytecode,
  binToHex,
} from '@cashlab/common/libauth.js'
import { requireWallet, type WalletContext } from '../core/context.js'
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
import { computePlatformFee } from '../wallet/cauldron/swap.js'
import { getBchUsdPrice } from '../utils/prices.js'
import type { PaymentRequirements } from '../types/x402.js'
import {
  getConfig,
  getWalletStatus,
  type AiConfig,
  type AiModelConfig,
  type PriceTier,
} from './client.js'
import { LIFT_TOKEN_ID, resolveBackendUrl, apiUrl } from './config.js'
import { selectModel, selectTier, formatDuration } from './models.js'
import { findSession, hasActiveCredits } from './credits.js'

export type PaymentMethod = 'bch' | 'lift'

export interface BuyPlanOptions {
  model: string
  minutes: number
  paymentMethod?: PaymentMethod
  isChipnet?: boolean
  confirmed?: boolean
  backendUrl?: string
  skipProbe?: boolean
  skipActiveCreditGuard?: boolean
}

export interface BuyPlanResult {
  success: boolean
  paid: boolean
  model?: string
  displayName?: string
  minutes?: number
  priceSats?: number
  paymentMethod?: PaymentMethod
  txid?: string
  recipientAddress?: string
  status?: number
  sessionActivated?: boolean
  timeRemainingSeconds?: number
  data?: unknown
  error?: string
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

export async function buyPlan(opts: BuyPlanOptions): Promise<BuyPlanResult> {
  const paymentMethod: PaymentMethod =
    opts.paymentMethod === 'lift' ? 'lift' : 'bch'
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)

  const modelQuery = String(opts.model || '').trim()
  const minutes = Number(opts.minutes)
  if (!modelQuery) {
    return { success: false, paid: false, error: 'Missing model.' }
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { success: false, paid: false, error: 'Missing or invalid minutes.' }
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
    return { success: false, paid: false, error: err?.message || String(err) }
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
          success: false,
          paid: false,
          model: model.id,
          displayName: model.display_name,
          error: `${model.display_name || model.id} still has ${remaining} of active credits. A new plan cannot be purchased until they are used up or expire.`,
        }
      }
    } catch (err: any) {
      return {
        success: false,
        paid: false,
        error: `Could not check existing credits before purchase: ${err?.message || err}`,
      }
    }
  }

  if (paymentMethod === 'bch') {
    try {
      const balance = await ctx.bch.getBalance()
      const availableSats = Math.round(balance.spendable * 1e8)
      if (priceSats > 0 && availableSats < priceSats) {
        return {
          success: false,
          paid: false,
          model: model.id,
          displayName: model.display_name,
          priceSats,
          error: `Insufficient balance: ${(availableSats / 1e8).toFixed(
            8
          )} BCH available but the ${minutes}-minute plan costs ${(
            priceSats / 1e8
          ).toFixed(8)} BCH.`,
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
      return { success: false, paid: false, error: err?.message || String(err) }
    }
  }

  const hdWallet = new LibauthHDWallet(
    ctx.mnemonic,
    BCH_DERIVATION_PATH,
    isChipnet ? 'chipnet' : 'mainnet'
  )
  const x402Payer = new X402Payer({ hdWallet, addressIndex: 0 })
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
    return { success: false, paid: false, error: `Request failed: ${err?.message || err}` }
  }

  const firstText = await firstResponse.text()
  let firstData: any
  try {
    firstData = JSON.parse(firstText)
  } catch {
    firstData = firstText
  }

  if (firstResponse.status !== 402) {
    return {
      success: true,
      paid: false,
      model: model.id,
      displayName: model.display_name,
      minutes: tier.minutes,
      priceSats,
      paymentMethod,
      status: firstResponse.status,
      data: firstData,
      error:
        firstResponse.ok
          ? 'No purchase made: the model already has active credits, so the request was served without payment.'
          : `Unexpected response (${firstResponse.status}).`,
    }
  }

  const paymentRequired = parsePaymentRequiredJson(firstData)
  if (!paymentRequired) {
    return {
      success: false,
      paid: false,
      status: 402,
      error: 'Could not parse PaymentRequired from 402 response body.',
    }
  }
  const requirements = selectBchPaymentRequirements(
    paymentRequired,
    isChipnet ? 'chipnet' : 'mainnet'
  )
  if (!requirements) {
    return {
      success: false,
      paid: false,
      status: 402,
      error: 'Server does not accept BCH payment for this plan.',
    }
  }

  if (!opts.confirmed) {
    return {
      success: false,
      paid: false,
      status: 402,
      model: model.id,
      displayName: model.display_name,
      minutes: tier.minutes,
      priceSats,
      paymentMethod,
      recipientAddress: requirements.payTo,
      error: 'Payment not confirmed.',
    }
  }

  const changeAddress = ctx.bch.getAddressSetAt(0).change
  let txid: string
  let vout = 0
  try {
    if (paymentMethod === 'lift') {
      const result = await payWithLift(
        ctx,
        hdWallet,
        requirements,
        changeAddress,
        isChipnet
      )
      txid = result.txid
      vout = result.vout
    } else {
      const amountBch = Number(requirements.amount) / 1e8
      const sendResult = await ctx.bch.sendBch(
        amountBch,
        requirements.payTo,
        changeAddress
      )
      if (!sendResult.success || !sendResult.txid) {
        return {
          success: false,
          paid: false,
          status: 402,
          error: sendResult.error || 'Transaction broadcast failed.',
        }
      }
      txid = sendResult.txid
    }
  } catch (err: any) {
    return { success: false, paid: false, status: 402, error: err?.message || String(err) }
  }

  const paymentPayload = await x402Payer.createPaymentPayload(
    requirements,
    paymentRequired.resource.url,
    txid,
    vout,
    requirements.amount
  )
  const retryHeaders = {
    ...headers,
    'PAYMENT-SIGNATURE': JSON.stringify(paymentPayload),
  }

  let retryResponse: Response
  try {
    retryResponse = await fetch(url, {
      method: 'POST',
      headers: retryHeaders,
      body,
      signal: AbortSignal.timeout(240000),
    })
  } catch (err: any) {
    return {
      success: true,
      paid: true,
      model: model.id,
      displayName: model.display_name,
      minutes: tier.minutes,
      priceSats,
      paymentMethod,
      txid,
      recipientAddress: requirements.payTo,
      error: `Payment was broadcast but the response timed out: ${err?.message || err}. Check credits with \`paytaca ai credits\`.`,
    }
  }

  const retryText = await retryResponse.text()
  let retryData: any
  try {
    retryData = JSON.parse(retryText)
  } catch {
    retryData = retryText
  }

  let sessionActivated = false
  let timeRemainingSeconds: number | undefined
  try {
    const status = await getWalletStatus(ctx.walletHash, { backendUrl: baseUrl })
    const session = findSession(status, model.id)
    sessionActivated = hasActiveCredits(status, model.id)
    timeRemainingSeconds = session?.time_remaining_seconds
  } catch {
    // Non-critical.
  }

  return {
    success: retryResponse.ok,
    paid: true,
    model: model.id,
    displayName: model.display_name,
    minutes: tier.minutes,
    priceSats,
    paymentMethod,
    txid,
    recipientAddress: requirements.payTo,
    status: retryResponse.status,
    sessionActivated,
    timeRemainingSeconds,
    data: retryData,
    error: retryResponse.ok
      ? undefined
      : `Payment broadcast (txid ${txid}) but the backend returned ${retryResponse.status}.`,
  }
}