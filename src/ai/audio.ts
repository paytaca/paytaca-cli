/**
 * Paytaca audio (text-to-speech) generation client + orchestration.
 *
 * Mirrors the video flow: mint a wallet-derived OAuth token, create an order
 * (returns a CashScript contract address + sats price), pay BCH on-chain,
 * confirm the payment (backend verifies the tx via Watchtower), poll until the
 * audio is ready, save it under ~/.paytaca/audio, and release the one-shot
 * cache.
 */

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
import { downloadMedia, fetchMedia, type FetchedMedia } from './media-download.js'

export const AUDIO_DIR = path.join(PAYTACA_DIR, 'audio')

export type AudioResponseFormat = 'mp3' | 'pcm'

export interface AudioModel {
  id: string
  display_name?: string
  cost_per_unit_usd?: number
  output_cost_per_unit_usd?: number | null
  supported_voices?: string[]
  supported_parameters?: Record<string, unknown>
}

/** A created, unpaid audio order (the "quote" shown before spending). */
export interface AudioOrderQuote {
  orderId: string
  prompt: string
  model?: string
  contractAddress: string
  amountSats: number
  amountUsd?: number
  estimatedCostUsd?: number
  voice?: string
  responseFormat?: string
  speed?: number
}

export interface AudioOrderStatus {
  id?: string
  status?: string
  media_type?: string
  model?: string
  error?: string
  settlement_txid?: string
  note?: string
  /** True when the audio bytes are still cached server-side and downloadable. */
  ready?: boolean
  /** Byte size of the cached audio, when ready. */
  size_bytes?: number
  /** Backend path to stream the audio from, when ready. */
  content_path?: string
}

export interface AudioHistoryEntry {
  id: string
  prompt?: string
  model?: string
  model_display_name?: string
  voice?: string
  response_format?: string
  status?: string
  price_usd?: number
  price_sats?: number
  estimated_cost_usd?: number
  actual_cost_usd?: number
  input_characters?: number
  created_at?: string
  completed_at?: string
  filepath?: string
}

export interface AudioHistoryResult {
  count?: number
  page?: number
  page_size?: number
  data?: AudioHistoryEntry[]
}

export interface ListAudioModelsOptions {
  backendUrl?: string
  search?: string
  ordering?: string
}

export interface HistoryOptions {
  backendUrl?: string
  page?: number
  pageSize?: number
}

export interface CreateAudioOrderOptions {
  prompt: string
  model?: string
  voice?: string
  responseFormat?: AudioResponseFormat | string
  speed?: number
  inputAudio?: string
  isChipnet?: boolean
  backendUrl?: string
}

export interface FulfillAudioOrderOptions {
  isChipnet?: boolean
  backendUrl?: string
  confirmAttempts?: number
  confirmSpacingMs?: number
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /**
   * When true, poll only for order metadata and do NOT download/save the audio
   * (nor release the backend cache). Used by MCP, where the inline audio
   * payload could exceed the transport timeout; the CLI command performs the
   * actual download.
   */
  deferDownload?: boolean
}

export type GenerateAudioOptions = CreateAudioOrderOptions &
  FulfillAudioOrderOptions

export interface GenerateAudioResult {
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
  /** True when generation finished but the audio was not downloaded here. */
  ready?: boolean
  /** False when the caller requested a metadata-only check (no download). */
  downloaded?: boolean
  /** Backend note, e.g. "Audio data has been delivered or expired". */
  note?: string
  error?: string
}

const REQUEST_TIMEOUT_MS = 30000
// The content endpoint streams the whole audio, so the download timeout must
// be far longer than other requests.
const MEDIA_REQUEST_TIMEOUT_MS = 300000
const DEFAULT_CONFIRM_ATTEMPTS = 5
const DEFAULT_CONFIRM_SPACING_MS = 4000
const DEFAULT_POLL_INTERVAL_MS = 5000
const DEFAULT_POLL_TIMEOUT_MS = 600000

const ALLOWED_MEDIA_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/pcm',
  'audio/ogg',
  'audio/webm',
])

export const AUDIO_MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/pcm': 'pcm',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
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
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  timeoutMs = REQUEST_TIMEOUT_MS
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
      signal: AbortSignal.timeout(timeoutMs),
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

export async function listAudioModels(
  opts: ListAudioModelsOptions = {}
): Promise<AudioModel[]> {
  const base = resolveBackendUrl(opts.backendUrl)
  const url = new URL(apiUrl(base, '/v1/audio/models'))
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
  const body = await parseResponse(response, 'GET /v1/audio/models')
  return Array.isArray(body?.data) ? body.data : []
}

export async function getAudioHistory(
  opts: HistoryOptions = {}
): Promise<AudioHistoryResult> {
  const ctx = requireWallet()
  const token = await mintAccessToken(ctx, opts.backendUrl)
  const base = resolveBackendUrl(opts.backendUrl)
  const url = new URL(apiUrl(base, '/v1/audio/history'))
  if (opts.page) url.searchParams.set('page', String(opts.page))
  if (opts.pageSize) url.searchParams.set('page_size', String(opts.pageSize))
  return authedRequest(base, url.pathname + url.search, token)
}

/** Create an audio order (no funds move). Returns the quote to pay. */
export async function createAudioOrder(
  opts: CreateAudioOrderOptions
): Promise<AudioOrderQuote> {
  const prompt = String(opts.prompt || '').trim()
  if (!prompt) throw new Error('Missing prompt.')

  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const ctx = requireWallet(isChipnet)
  const token = await mintAccessToken(ctx, baseUrl)

  const addresses = ctx.bch.getAddressSetAt(0)
  const body: Record<string, unknown> = {
    prompt,
    refund_address: addresses.receiving,
  }
  if (opts.model) body.model = opts.model
  if (opts.voice) body.voice = opts.voice
  if (opts.responseFormat) body.response_format = opts.responseFormat
  if (opts.speed !== undefined) body.speed = opts.speed
  if (opts.inputAudio) body.input_audio = opts.inputAudio

  const order = await authedRequest(baseUrl, '/v1/audio/generate', token, {
    method: 'POST',
    body,
  })

  const amountSats = Number(order?.amount_sats) || 0
  if (!order?.id || !order?.contract_address || amountSats <= 0) {
    throw new AiApiError('Malformed audio order response.', 200, order)
  }

  return {
    orderId: String(order.id),
    prompt,
    model: order.model,
    contractAddress: String(order.contract_address),
    amountSats,
    amountUsd: order.amount_usd,
    estimatedCostUsd: order.estimated_cost_usd,
    voice: order.voice,
    responseFormat: order.response_format,
    speed: order.speed,
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
        `/v1/audio/${encodeURIComponent(orderId)}/confirm-payment`,
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

function isReadyStatus(status?: string): boolean {
  return status === 'generation_complete' || status === 'completed'
}

/**
 * Poll the (metadata-only) status endpoint until the order is ready or the
 * deadline is reached. Status responses no longer carry inline audio bytes, so
 * this is always a small JSON read; the bytes are streamed separately from the
 * content endpoint when `download` is true.
 */
async function pollOrderStatus(
  baseUrl: string,
  token: string,
  orderId: string,
  intervalMs: number,
  timeoutMs: number,
  download = true
): Promise<AudioOrderStatus> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = (await authedRequest(
      baseUrl,
      `/v1/audio/${encodeURIComponent(orderId)}/status`,
      token
    )) as AudioOrderStatus

    if (status.status === 'failed') {
      throw new Error(
        `Audio generation failed${status.error ? `: ${status.error}` : '.'}`
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
    if (isReadyStatus(status.status)) {
      if (!download) return status
      // Completed, but the cached audio is gone (already delivered via
      // POST /confirm or past the cache TTL): terminal, not pending.
      if (status.ready === false) {
        throw new Error(
          status.note || 'Audio data has been delivered or expired.'
        )
      }
      return status
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for audio generation (order ${orderId} is "${
          status.status ?? 'unknown'
        }").`
      )
    }
    await sleep(intervalMs)
  }
}

function audioContentPath(orderId: string, status: AudioOrderStatus): string {
  return (
    status.content_path ?? `/v1/audio/${encodeURIComponent(orderId)}/content`
  )
}

/**
 * Fetch a generated audio clip's bytes from the backend content endpoint (no
 * disk write). Returns null when the wallet is unavailable or the clip is gone.
 */
export async function fetchAudioContent(
  orderId: string,
  opts: { isChipnet?: boolean; backendUrl?: string } = {}
): Promise<FetchedMedia | null> {
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  let token: string
  try {
    const ctx = requireWallet(Boolean(opts.isChipnet))
    token = await mintAccessToken(ctx, baseUrl)
  } catch {
    return null
  }
  try {
    return await fetchMedia({
      baseUrl,
      token,
      contentPath: audioContentPath(orderId, {} as AudioOrderStatus),
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      timeoutMs: MEDIA_REQUEST_TIMEOUT_MS,
    })
  } catch {
    return null
  }
}

/**
 * Pay an existing audio order, wait for the audio, and save it.
 * Returns a buy_plan-style result: `paid` indicates funds moved.
 */
export async function fulfillAudioOrder(
  quote: AudioOrderQuote,
  opts: FulfillAudioOrderOptions = {}
): Promise<GenerateAudioResult> {
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const deferDownload = Boolean(opts.deferDownload)
  const base: GenerateAudioResult = {
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
        )} BCH available but the audio order costs ${(
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

  const paid: GenerateAudioResult = { ...base, paid: true, txid }

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

  let status: AudioOrderStatus
  try {
    status = await pollOrderStatus(
      baseUrl,
      token,
      quote.orderId,
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      !deferDownload
    )
  } catch (err: any) {
    return {
      ...paid,
      error: `${
        err?.message || err
      } Payment already made (txid ${txid}); order ${quote.orderId}.`,
    }
  }

  // Metadata-only mode: report readiness without pulling the audio or
  // releasing the backend cache, so the CLI can download it later.
  if (deferDownload) {
    return {
      ...paid,
      success: true,
      ready: true,
      downloaded: false,
      status: status.status,
      model: status.model ?? quote.model,
      mediaType: status.media_type,
      note: status.note,
    }
  }

  let media: { path: string; mediaType: string }
  try {
    media = await downloadMedia({
      baseUrl,
      token,
      contentPath: audioContentPath(quote.orderId, status),
      mediaType: status.media_type,
      orderId: quote.orderId,
      dir: AUDIO_DIR,
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      extensionByMediaType: AUDIO_MEDIA_TYPE_EXTENSIONS,
      defaultExtension: 'mp3',
      timeoutMs: MEDIA_REQUEST_TIMEOUT_MS,
    })
  } catch (err: any) {
    return {
      ...paid,
      status: status.status,
      mediaType: status.media_type,
      error: `${err?.message || err} The audio was generated but could not be saved.`,
    }
  }

  // Release the backend's one-shot cache; best-effort.
  try {
    await authedRequest(
      baseUrl,
      `/v1/audio/${encodeURIComponent(quote.orderId)}/confirm`,
      token,
      { method: 'POST' }
    )
  } catch {
    // Non-critical — the audio is already delivered and saved.
  }

  return {
    ...paid,
    success: true,
    status: status.status,
    path: media.path,
    model: status.model ?? quote.model,
    mediaType: media.mediaType,
  }
}

/** End-to-end: create the order, then pay and deliver it. */
export async function generateAudio(
  opts: GenerateAudioOptions
): Promise<GenerateAudioResult> {
  let quote: AudioOrderQuote
  try {
    quote = await createAudioOrder(opts)
  } catch (err: any) {
    return { success: false, paid: false, error: err?.message || String(err) }
  }
  return fulfillAudioOrder(quote, opts)
}

/** True when the tool should return a "processing" status instead of an error. */
export function isStillProcessing(result: GenerateAudioResult): boolean {
  return (
    !result.success &&
    result.paid &&
    !!result.orderId &&
    !!result.error &&
    /timed out/i.test(result.error)
  )
}

export interface PollStatusOptions {
  isChipnet?: boolean
  backendUrl?: string
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /**
   * When false, only fetch order metadata (no audio download/save and no cache
   * release). Used by MCP to avoid transferring the inline audio.
   */
  download?: boolean
}

/**
 * Poll an existing audio order by ID until the audio is ready or the
 * deadline is reached. Mints a fresh OAuth token and saves the audio
 * to ~/.paytaca/audio when generation is complete. With `download: false`
 * it reports only readiness/metadata and leaves the audio for the CLI.
 */
export async function getAudioOrderStatus(
  orderId: string,
  opts: PollStatusOptions = {}
): Promise<GenerateAudioResult> {
  const isChipnet = Boolean(opts.isChipnet)
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const download = opts.download !== false
  const base: GenerateAudioResult = {
    success: false,
    paid: true,
    orderId,
  }

  let ctx: WalletContext
  let token: string
  try {
    ctx = requireWallet(isChipnet)
    token = await mintAccessToken(ctx, baseUrl)
  } catch (err: any) {
    return { ...base, error: err?.message || String(err) }
  }

  let status: AudioOrderStatus
  try {
    status = await pollOrderStatus(
      baseUrl,
      token,
      orderId,
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      download
    )
  } catch (err: any) {
    return { ...base, error: err?.message || String(err) }
  }

  if (!download) {
    return {
      ...base,
      success: true,
      ready: true,
      downloaded: false,
      status: status.status,
      model: status.model,
      mediaType: status.media_type,
      note: status.note,
    }
  }

  let media: { path: string; mediaType: string }
  try {
    media = await downloadMedia({
      baseUrl,
      token,
      contentPath: audioContentPath(orderId, status),
      mediaType: status.media_type,
      orderId,
      dir: AUDIO_DIR,
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      extensionByMediaType: AUDIO_MEDIA_TYPE_EXTENSIONS,
      defaultExtension: 'mp3',
      timeoutMs: MEDIA_REQUEST_TIMEOUT_MS,
    })
  } catch (err: any) {
    return {
      ...base,
      status: status.status,
      mediaType: status.media_type,
      error: `${err?.message || err} The audio was generated but could not be saved.`,
    }
  }

  try {
    await authedRequest(
      baseUrl,
      `/v1/audio/${encodeURIComponent(orderId)}/confirm`,
      token,
      { method: 'POST' }
    )
  } catch {
    // Non-critical.
  }

  return {
    ...base,
    success: true,
    status: status.status,
    path: media.path,
    model: status.model,
    mediaType: media.mediaType,
  }
}
