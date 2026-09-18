/**
 * Paytaca image generation client + orchestration.
 *
 * Flow: mint a wallet-derived OAuth token, create an order (returns a
 * CashScript contract address + sats price), pay BCH on-chain, confirm the
 * payment (backend verifies the tx via Watchtower), poll until the image is
 * ready, save it under ~/.paytaca/images, and release the one-shot cache.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { requireWallet, type WalletContext } from '../core/context.js'
import { isValidBchAddress } from '../core/wallet.js'
import {
  createAuthMaterial,
  registerOAuthUser,
  createAccessToken,
} from './oauth.js'
import { AiApiError } from './client.js'
import { resolveBackendUrl, apiUrl, PAYTACA_DIR } from './config.js'

export const IMAGE_DIR = path.join(PAYTACA_DIR, 'images')

export interface ImageModel {
  id: string
  display_name?: string
  pricing_unit?: string
  cost_per_unit_usd?: number
  supported_parameters?: string[]
}

/** A created, unpaid image order (the "quote" shown before spending). */
export interface ImageOrderQuote {
  orderId: string
  prompt: string
  model?: string
  pricingUnit?: string
  contractAddress: string
  amountSats: number
  amountUsd?: number
  estimatedCostUsd?: number
}

export interface ImageOrderStatus {
  id?: string
  status?: string
  image?: string | null
  media_type?: string
  error?: string
  settlement_txid?: string
  note?: string
}

export interface ImageHistoryEntry {
  id: string
  prompt?: string
  model?: string
  model_display_name?: string
  status?: string
  price_usd?: number
  price_sats?: number
  estimated_cost_usd?: number
  actual_cost_usd?: number
  prompt_tokens?: number
  created_at?: string
  completed_at?: string
}

export interface ImageHistoryResult {
  count?: number
  page?: number
  page_size?: number
  data?: ImageHistoryEntry[]
}

export interface ListImageModelsOptions {
  backendUrl?: string
  pricingUnit?: string
  search?: string
  ordering?: string
}

export interface HistoryOptions {
  backendUrl?: string
  page?: number
  pageSize?: number
}

export interface CreateImageOrderOptions {
  prompt: string
  model?: string
  aspectRatio?: string
  quality?: string
  resolution?: string
  isChipnet?: boolean
  backendUrl?: string
}

export interface FulfillImageOrderOptions {
  isChipnet?: boolean
  backendUrl?: string
  confirmAttempts?: number
  confirmSpacingMs?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export type GenerateImageOptions = CreateImageOrderOptions &
  FulfillImageOrderOptions

export interface GenerateImageResult {
  success: boolean
  paid: boolean
  orderId?: string
  model?: string
  amountSats?: number
  amountUsd?: number
  estimatedCostUsd?: number
  txid?: string
  status?: string
  path?: string
  mediaType?: string
  base64?: string
  error?: string
}

const REQUEST_TIMEOUT_MS = 30000
const DEFAULT_CONFIRM_ATTEMPTS = 5
const DEFAULT_CONFIRM_SPACING_MS = 4000
const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_POLL_TIMEOUT_MS = 180000

const ALLOWED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseResponse(response: Response, label: string): Promise<any> {
  const text = await response.text()
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && (body.error || body.detail)) ||
      (typeof body === 'string' && body) ||
      response.statusText
    throw new AiApiError(
      `${label} failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      body
    )
  }
  return body
}

async function authedRequest(
  baseUrl: string,
  apiPath: string,
  token: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }
): Promise<any> {
  let response: Response
  try {
    response = await fetch(apiUrl(baseUrl, apiPath), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(init.body !== undefined
        ? { body: JSON.stringify(init.body) }
        : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }
  return parseResponse(response, `${init.method} ${apiPath}`)
}

async function mintAccessToken(
  ctx: WalletContext,
  backendUrl?: string
): Promise<string> {
  const material = createAuthMaterial(ctx.mnemonic, ctx.walletHash)
  await registerOAuthUser(material, { backendUrl })
  return createAccessToken(material, { backendUrl })
}

export async function listImageModels(
  opts: ListImageModelsOptions = {}
): Promise<ImageModel[]> {
  const base = resolveBackendUrl(opts.backendUrl)
  const url = new URL(apiUrl(base, '/v1/image-models'))
  if (opts.pricingUnit) url.searchParams.set('pricing_unit', opts.pricingUnit)
  if (opts.search) url.searchParams.set('search', opts.search)
  if (opts.ordering) url.searchParams.set('ordering', opts.ordering)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }
  const body = await parseResponse(response, 'GET /v1/image-models')
  return Array.isArray(body?.data) ? body.data : []
}

export async function getImageHistory(
  opts: HistoryOptions = {}
): Promise<ImageHistoryResult> {
  const ctx = requireWallet()
  const token = await mintAccessToken(ctx, opts.backendUrl)
  const base = resolveBackendUrl(opts.backendUrl)
  const url = new URL(apiUrl(base, '/v1/images/history'))
  if (opts.page) url.searchParams.set('page', String(opts.page))
  if (opts.pageSize) url.searchParams.set('page_size', String(opts.pageSize))
  return authedRequest(base, url.pathname + url.search, token)
}

/** Create an image order (no funds move). Returns the quote to pay. */
export async function createImageOrder(
  opts: CreateImageOrderOptions
): Promise<ImageOrderQuote> {
  const prompt = String(opts.prompt || '').trim()
  if (!prompt) throw new Error('Missing prompt.')

  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const ctx = requireWallet(isChipnet)
  const token = await mintAccessToken(ctx, baseUrl)

  const addresses = ctx.bch.getAddressSetAt(0)
  const body: Record<string, string> = {
    prompt,
    refund_address: addresses.receiving,
  }
  if (opts.model) body.model = opts.model
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio
  if (opts.quality) body.quality = opts.quality
  if (opts.resolution) body.resolution = opts.resolution

  const order = await authedRequest(baseUrl, '/v1/images', token, {
    method: 'POST',
    body,
  })

  const amountSats = Number(order?.amount_sats) || 0
  if (!order?.id || !order?.contract_address || amountSats <= 0) {
    throw new AiApiError('Malformed image order response.', 200, order)
  }

  return {
    orderId: String(order.id),
    prompt,
    model: order.model,
    pricingUnit: order.pricing_unit,
    contractAddress: String(order.contract_address),
    amountSats,
    amountUsd: order.amount_usd,
    estimatedCostUsd: order.estimated_cost_usd,
  }
}

async function confirmPaymentWithRetry(
  baseUrl: string,
  token: string,
  orderId: string,
  txid: string,
  attempts: number,
  spacingMs: number
): Promise<void> {
  let lastError: AiApiError | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      await authedRequest(
        baseUrl,
        `/v1/images/${encodeURIComponent(orderId)}/confirm-payment`,
        token,
        { method: 'POST', body: { txid } }
      )
      return
    } catch (err) {
      if (!(err instanceof AiApiError)) throw err
      if (err.status === 400 && /already/i.test(err.message)) return
      if (err.status && err.status >= 400 && err.status < 500) throw err
      lastError = err
      if (i < attempts - 1) await sleep(spacingMs)
    }
  }
  throw lastError ?? new Error('Payment confirmation failed.')
}

async function pollOrderStatus(
  baseUrl: string,
  token: string,
  orderId: string,
  intervalMs: number,
  timeoutMs: number
): Promise<ImageOrderStatus> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = (await authedRequest(
      baseUrl,
      `/v1/images/${encodeURIComponent(orderId)}/status`,
      token
    )) as ImageOrderStatus

    if (status.status === 'failed') {
      throw new Error(
        `Image generation failed${status.error ? `: ${status.error}` : '.'}`
      )
    }
    if (status.status === 'refunded') {
      throw new Error(
        `The order was refunded${
          status.settlement_txid
            ? ` (settlement txid ${status.settlement_txid})`
            : ''
        }.`
      )
    }
    if (
      (status.status === 'generation_complete' ||
        status.status === 'completed') &&
      status.image
    ) {
      return status
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for image generation (order ${orderId} is "${
          status.status ?? 'unknown'
        }").`
      )
    }
    await sleep(intervalMs)
  }
}

function saveImage(orderId: string, mediaType: string, base64: string): string {
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`Backend returned an unsupported media type: ${mediaType}`)
  }
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new Error('Backend returned an empty image payload.')
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) {
    throw new Error(
      'Backend returned an image payload that is not valid base64.'
    )
  }
  mkdirSync(IMAGE_DIR, { recursive: true })
  const ext = MEDIA_TYPE_EXTENSIONS[mediaType]
  const safeId = orderId.replace(/[^a-zA-Z0-9_-]/g, '')
  const filePath = path.join(IMAGE_DIR, `${safeId}.${ext}`)
  writeFileSync(filePath, Buffer.from(base64, 'base64'))
  chmodSync(filePath, 0o600)
  return filePath
}

/**
 * Pay an existing image order, wait for the image, and save it.
 * Returns a buy_plan-style result: `paid` indicates funds moved.
 */
export async function fulfillImageOrder(
  quote: ImageOrderQuote,
  opts: FulfillImageOrderOptions = {}
): Promise<GenerateImageResult> {
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const base: GenerateImageResult = {
    success: false,
    paid: false,
    orderId: quote.orderId,
    model: quote.model,
    amountSats: quote.amountSats,
    amountUsd: quote.amountUsd,
    estimatedCostUsd: quote.estimatedCostUsd,
  }

  let ctx: WalletContext
  let token: string
  try {
    ctx = requireWallet(isChipnet)
    token = await mintAccessToken(ctx, baseUrl)
  } catch (err: any) {
    return { ...base, error: err?.message || String(err) }
  }

  if (!isValidBchAddress(quote.contractAddress, isChipnet)) {
    return { ...base, error: 'Backend returned an invalid payment address.' }
  }

  try {
    const balance = await ctx.bch.getBalance()
    const availableSats = Math.round(balance.spendable * 1e8)
    if (availableSats < quote.amountSats) {
      return {
        ...base,
        error: `Insufficient balance: ${(availableSats / 1e8).toFixed(
          8
        )} BCH available but the image order costs ${(
          quote.amountSats / 1e8
        ).toFixed(8)} BCH.`,
      }
    }
  } catch {
    // Balance check is best-effort; the payment flow will surface real errors.
  }

  let txid: string
  try {
    const changeAddress = ctx.bch.getAddressSetAt(0).change
    const sendResult = await ctx.bch.sendBch(
      quote.amountSats / 1e8,
      quote.contractAddress,
      changeAddress
    )
    if (!sendResult.success || !sendResult.txid) {
      return {
        ...base,
        error: sendResult.error || 'Transaction broadcast failed.',
      }
    }
    txid = sendResult.txid
  } catch (err: any) {
    return { ...base, error: err?.message || String(err) }
  }

  const paid: GenerateImageResult = { ...base, paid: true, txid }

  try {
    await confirmPaymentWithRetry(
      baseUrl,
      token,
      quote.orderId,
      txid,
      opts.confirmAttempts ?? DEFAULT_CONFIRM_ATTEMPTS,
      opts.confirmSpacingMs ?? DEFAULT_CONFIRM_SPACING_MS
    )
  } catch (err: any) {
    return {
      ...paid,
      error: `Payment was broadcast (txid ${txid}) but the backend could not confirm it yet: ${
        err?.message || err
      }. The order remains pending — retry in a moment or check the order history.`,
    }
  }

  let status: ImageOrderStatus
  try {
    status = await pollOrderStatus(
      baseUrl,
      token,
      quote.orderId,
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
    )
  } catch (err: any) {
    return {
      ...paid,
      error: `${
        err?.message || err
      } Payment already made (txid ${txid}); order ${quote.orderId}.`,
    }
  }

  let filePath: string
  try {
    filePath = saveImage(quote.orderId, status.media_type ?? '', status.image ?? '')
  } catch (err: any) {
    return {
      ...paid,
      status: status.status,
      mediaType: status.media_type,
      base64: status.image ?? undefined,
      error: `${err?.message || err} The image was generated but could not be saved.`,
    }
  }

  // Release the backend's one-shot cache; best-effort.
  try {
    await authedRequest(
      baseUrl,
      `/v1/images/${encodeURIComponent(quote.orderId)}/confirm`,
      token,
      { method: 'POST' }
    )
  } catch {
    // Non-critical — the image is already delivered and saved.
  }

  return {
    ...paid,
    success: true,
    status: status.status,
    path: filePath,
    mediaType: status.media_type,
    base64: status.image ?? undefined,
  }
}

/** End-to-end: create the order, then pay and deliver it. */
export async function generateImage(
  opts: GenerateImageOptions
): Promise<GenerateImageResult> {
  let quote: ImageOrderQuote
  try {
    quote = await createImageOrder(opts)
  } catch (err: any) {
    return { success: false, paid: false, error: err?.message || String(err) }
  }
  return fulfillImageOrder(quote, opts)
}
