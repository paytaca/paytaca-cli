import { resolveBackendUrl, apiUrl } from './config.js'

export interface PriceTier {
  minutes: number
  price_usd?: number
  price_php?: number
  price_sats: number
}

export interface AiModelConfig {
  id: string
  display_name: string
  price_tiers: PriceTier[]
}

export interface AiConfig {
  models: AiModelConfig[]
  default_model?: string
  default_duration_minutes?: number
  context_retention_hours?: number
  lift_payment_discount_percent?: number
  proxy_url?: string
  image_models?: unknown[]
}

export interface WalletSession {
  model_id?: string
  ai_model?: string
  display_name?: string
  model_active?: boolean
  session_active?: boolean
  time_credits_seconds?: number
  time_used_seconds?: number
  time_remaining_seconds?: number
  token_limit?: number
}

export interface WalletStatus extends WalletSession {
  sessions?: WalletSession[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ChatResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  data: any
}

export class AiApiError extends Error {
  status?: number
  body?: unknown

  constructor(message: string, status?: number, body?: unknown) {
    super(message)
    this.name = 'AiApiError'
    this.status = status
    this.body = body
  }
}

export interface RequestOptions {
  backendUrl?: string
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

async function doFetch(
  url: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  return fetch(url, { ...init, signal })
}

async function parseBody(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export async function getConfig(opts: RequestOptions = {}): Promise<AiConfig> {
  const base = resolveBackendUrl(opts.backendUrl)
  let response: Response
  try {
    response = await doFetch(
      apiUrl(base, '/v1/config'),
      { method: 'GET', headers: opts.headers },
      opts.timeoutMs ?? 15000
    )
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }

  const body = await parseBody(response)
  if (!response.ok) {
    throw new AiApiError(
      `GET /v1/config failed (${response.status} ${response.statusText})`,
      response.status,
      body
    )
  }
  return body as AiConfig
}

export async function getWalletStatus(
  walletHash: string,
  opts: RequestOptions & { modelId?: string } = {}
): Promise<WalletStatus> {
  const base = resolveBackendUrl(opts.backendUrl)
  const url = new URL(apiUrl(base, '/v1/wallet/status'))
  if (opts.modelId) url.searchParams.set('model_id', opts.modelId)

  let response: Response
  try {
    response = await doFetch(
      url.toString(),
      {
        method: 'GET',
        headers: { 'X-Wallet-Hash': walletHash, ...(opts.headers || {}) },
      },
      opts.timeoutMs ?? 15000
    )
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }

  const body = await parseBody(response)
  if (!response.ok) {
    throw new AiApiError(
      `GET /v1/wallet/status failed (${response.status} ${response.statusText})`,
      response.status,
      body
    )
  }
  return body as WalletStatus
}

export interface ChatRequestOptions extends RequestOptions {
  walletHash: string
  body: {
    model?: string
    messages: ChatMessage[]
    stream?: boolean
    temperature?: number
    max_tokens?: number
    [key: string]: unknown
  }
}

export async function chatCompletions(
  opts: ChatRequestOptions
): Promise<ChatResult> {
  const base = resolveBackendUrl(opts.backendUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Wallet-Hash': opts.walletHash,
    ...(opts.headers || {}),
  }

  const response = await doFetch(
    apiUrl(base, '/v1/chat/completions'),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ stream: false, ...opts.body }),
    },
    opts.timeoutMs ?? 240000
  )

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: headersToObject(response.headers),
    data: await parseBody(response),
  }
}