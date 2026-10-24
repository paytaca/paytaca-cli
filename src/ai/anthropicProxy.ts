/**
 * Anthropic-compatible gateway for Claude Code.
 *
 * The Paytaca AI backend speaks OpenAI-style `/v1/chat/completions`. Claude
 * Code speaks Anthropic `/v1/messages` and streams Anthropic SSE events. This
 * module translates between the two so `ANTHROPIC_BASE_URL` can point at
 * `paytaca mcp --proxy`.
 */

import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PAYTACA_DIR, apiUrl, resolveBackendUrl } from './config.js'
import { getConfig, type AiConfig } from './client.js'

export const DEFAULT_PROXY_PORT = 7475
export const PROXY_STATE_FILE = join(PAYTACA_DIR, 'anthropic-proxy.json')
export const PROXY_SERVICE = 'paytaca-anthropic-proxy'

export interface ProxyState {
  pid: number
  port: number
  url: string
  startedAt: string
}

export function resolveProxyPort(explicit?: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit
  const fromEnv = Number(process.env.PAYTACA_ANTHROPIC_PORT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_PROXY_PORT
}

export function proxyBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function readProxyState(): ProxyState | null {
  try {
    const parsed = JSON.parse(readFileSync(PROXY_STATE_FILE, 'utf-8'))
    if (
      parsed &&
      typeof parsed.pid === 'number' &&
      typeof parsed.port === 'number'
    ) {
      return parsed as ProxyState
    }
    return null
  } catch {
    return null
  }
}

function writeProxyState(state: ProxyState): void {
  mkdirSync(dirname(PROXY_STATE_FILE), { recursive: true })
  writeFileSync(PROXY_STATE_FILE, JSON.stringify(state, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

function clearProxyState(): void {
  rmSync(PROXY_STATE_FILE, { force: true })
}

// ── request translation ──────────────────────────────────────────────

export interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { type?: string; media_type?: string; data?: string; url?: string }
}

export interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

export interface AnthropicTool {
  name?: string
  description?: string
  input_schema?: unknown
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]
  stream: boolean
  max_tokens?: number
  temperature?: number
  tools?: { type: 'function'; function: { name: string; description?: string; parameters: unknown } }[]
  tool_choice?: unknown
  reasoning?: { effort?: string; exclude?: boolean }
}

function blockText(block: AnthropicContentBlock): string {
  return typeof block.text === 'string' ? block.text : ''
}

export function flattenAnthropicText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is AnthropicContentBlock => Boolean(block) && typeof block === 'object')
    .map((block) => {
      if (block.type === 'tool_result') return flattenAnthropicText(block.content)
      return blockText(block)
    })
    .filter((text) => text.length > 0)
    .join('\n')
}

function imagePart(block: AnthropicContentBlock): unknown | null {
  const source = block.source
  if (!source) return null
  if (source.type === 'base64' && source.data) {
    return {
      type: 'image_url',
      image_url: { url: `data:${source.media_type || 'image/png'};base64,${source.data}` },
    }
  }
  if (source.type === 'url' && source.url) {
    return { type: 'image_url', image_url: { url: source.url } }
  }
  return null
}

export function buildSystemPrompt(system: unknown): string | null {
  if (typeof system === 'string') return system || null
  if (!Array.isArray(system)) return null
  const text = system
    .filter((block): block is AnthropicContentBlock => Boolean(block) && typeof block === 'object')
    .map(blockText)
    .filter((value) => value.length > 0)
    .join('\n\n')
  return text || null
}

export function toOpenAIMessages(
  system: unknown,
  messages: AnthropicMessage[]
): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  const prompt = buildSystemPrompt(system)
  if (prompt) out.push({ role: 'system', content: prompt })

  for (const message of messages || []) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user'
    const content = message?.content

    if (typeof content === 'string' || content === undefined || content === null) {
      out.push({ role, content: typeof content === 'string' ? content : '' })
      continue
    }

    if (!Array.isArray(content)) {
      out.push({ role, content: '' })
      continue
    }

    const toolCalls: OpenAIToolCall[] = []
    const textParts: string[] = []
    const parts: unknown[] = []
    const toolResults: OpenAIMessage[] = []

    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      switch (block.type) {
        case 'text': {
          const text = blockText(block)
          if (text) {
            textParts.push(text)
            parts.push({ type: 'text', text })
          }
          break
        }
        case 'image': {
          const part = imagePart(block)
          if (part) parts.push(part)
          break
        }
        case 'tool_use': {
          if (role === 'assistant' && block.name) {
            toolCalls.push({
              id: block.id || `call_${randomBytes(8).toString('hex')}`,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            })
          }
          break
        }
        case 'tool_result': {
          toolResults.push({
            role: 'tool',
            content: flattenAnthropicText(block.content),
            tool_call_id: block.tool_use_id || '',
          })
          break
        }
        case 'thinking':
        case 'redacted_thinking':
          break
        default: {
          const text = blockText(block)
          if (text) {
            textParts.push(text)
            parts.push({ type: 'text', text })
          }
        }
      }
    }

    if (role === 'assistant') {
      const assistant: OpenAIMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : toolCalls.length > 0 ? null : '',
      }
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls
      out.push(assistant)
      continue
    }

    for (const result of toolResults) out.push(result)

    const hasImages = parts.some((part) => (part as { type?: string })?.type === 'image_url')
    if (hasImages) {
      out.push({ role: 'user', content: parts as unknown as string })
    } else if (textParts.length > 0) {
      out.push({ role: 'user', content: textParts.join('\n') })
    }
  }

  return out
}

export function toOpenAITools(tools: AnthropicTool[] | undefined): OpenAIRequest['tools'] {
  if (!Array.isArray(tools)) return undefined
  const mapped = tools
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name.length > 0)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name as string,
        description: tool.description,
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }))
  return mapped.length > 0 ? mapped : undefined
}

/**
 * Translate Anthropic's reasoning controls into the OpenAI/OpenRouter shape.
 *
 * Claude Code asks for thinking in two ways: `thinking: {type:'adaptive'}` plus
 * `output_config: {effort}`, or a fixed `thinking: {type:'enabled',
 * budget_tokens}`. Neither exists on the OpenAI-compatible wire, so they are
 * carried across as `reasoning.effort`.
 *
 * The requested level is deliberately NOT clamped here: the gateway has no
 * reliable view of which levels each model accepts, and the backend already
 * normalises onto the model's own list before it reaches the provider.
 */
export function toOpenAIReasoning(
  body: Record<string, any>
): OpenAIRequest['reasoning'] {
  const thinking = body.thinking
  if (thinking && typeof thinking === 'object') {
    const type = typeof thinking.type === 'string' ? thinking.type.toLowerCase() : ''
    if (type === 'disabled') return { effort: 'none' }
  }

  const outputConfig = body.output_config
  if (outputConfig && typeof outputConfig === 'object') {
    const effort = outputConfig.effort
    if (typeof effort === 'string' && effort.trim()) {
      return { effort: effort.trim().toLowerCase() }
    }
  }

  if (thinking && typeof thinking === 'object') {
    const type = typeof thinking.type === 'string' ? thinking.type.toLowerCase() : ''
    if (type === 'enabled' || type === 'adaptive') {
      const budget = thinking.budget_tokens
      if (typeof budget === 'number' && budget > 0) {
        return { effort: budgetToEffort(budget) }
      }
      return { effort: 'medium' }
    }
  }

  return undefined
}

/** Bucket an Anthropic token budget onto a coarse effort level. */
export function budgetToEffort(budgetTokens: number): string {
  if (budgetTokens <= 0) return 'none'
  if (budgetTokens < 2048) return 'low'
  if (budgetTokens < 8192) return 'medium'
  if (budgetTokens < 24576) return 'high'
  return 'max'
}

export function buildOpenAIRequest(
  body: Record<string, any>,
  model: string
): OpenAIRequest {
  const request: OpenAIRequest = {
    model,
    messages: toOpenAIMessages(body.system, body.messages || []),
    stream: body.stream === true,
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > 0) {
    request.max_tokens = body.max_tokens
  }
  if (typeof body.temperature === 'number') {
    request.temperature = body.temperature
  }
  const tools = toOpenAITools(body.tools)
  if (tools) request.tools = tools
  if (body.tool_choice !== undefined) request.tool_choice = body.tool_choice
  const reasoning = toOpenAIReasoning(body)
  if (reasoning) request.reasoning = reasoning
  return request
}

/**
 * The backend normalises `finish_reason` to `stop` after continuing truncated
 * replies, so a response carrying `tool_calls` must be reported as `tool_use`
 * regardless of what the upstream said.
 */
export function mapStopReason(
  reason: string | null | undefined,
  hasToolCalls = false
): string {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return hasToolCalls ? 'tool_use' : 'end_turn'
  }
}

// ── response translation ─────────────────────────────────────────────

export function newMessageId(): string {
  return `msg_${randomBytes(12).toString('hex')}`
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export interface AnthropicResponseBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export function buildAnthropicMessage(
  id: string,
  model: string,
  data: any
): Record<string, unknown> {
  const choice = (data?.choices || [])[0] || {}
  const message = choice.message || {}
  const content: AnthropicResponseBlock[] = []

  const text = typeof message.content === 'string' ? message.content : ''
  if (text) content.push({ type: 'text', text })

  const toolCalls = message.tool_calls || []
  for (const call of toolCalls) {
    let input: unknown = {}
    try {
      input = JSON.parse(call?.function?.arguments || '{}')
    } catch {
      input = {}
    }
    content.push({
      type: 'tool_use',
      id: call?.id || `toolu_${randomBytes(10).toString('hex')}`,
      name: call?.function?.name || 'unknown',
      input,
    })
  }

  if (content.length === 0) content.push({ type: 'text', text: '' })

  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapStopReason(choice.finish_reason, toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: data?.usage?.prompt_tokens ?? 0,
      output_tokens: data?.usage?.completion_tokens ?? 0,
    },
  }
}

export interface StreamTranslator {
  start(): string
  handleChunk(parsed: any): string
  finish(): string
}

/**
 * Turns OpenAI streaming chunks into Anthropic SSE events. Text streams as one
 * block; each upstream tool call gets its own `tool_use` block whose input is
 * relayed as `input_json_delta` fragments.
 */
export function createStreamTranslator(id: string, model: string): StreamTranslator {
  let nextIndex = 0
  let openBlock: { index: number; kind: 'text' | 'tool_use' } | null = null
  const toolBlocks = new Map<number, { blockIndex: number }>()
  let stopReason: string | null = null
  let outputTokens = 0
  let inputTokens = 0
  let finished = false

  function closeOpenBlock(): string {
    if (!openBlock) return ''
    const events = sse('content_block_stop', {
      type: 'content_block_stop',
      index: openBlock.index,
    })
    openBlock = null
    return events
  }

  function openText(): string {
    if (openBlock?.kind === 'text') return ''
    let events = closeOpenBlock()
    const index = nextIndex++
    openBlock = { index, kind: 'text' }
    events += sse('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' },
    })
    return events
  }

  function openTool(toolIndex: number, call: any): string {
    const existing = toolBlocks.get(toolIndex)
    if (existing) return ''
    let events = closeOpenBlock()
    const index = nextIndex++
    toolBlocks.set(toolIndex, { blockIndex: index })
    openBlock = { index, kind: 'tool_use' }
    events += sse('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: call?.id || `toolu_${randomBytes(10).toString('hex')}`,
        name: call?.function?.name || 'unknown',
        input: {},
      },
    })
    return events
  }

  return {
    start(): string {
      return sse('message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })
    },

    handleChunk(parsed: any): string {
      if (!parsed || typeof parsed !== 'object') return ''
      let events = ''

      const usage = parsed.usage
      if (usage) {
        if (typeof usage.prompt_tokens === 'number') inputTokens = usage.prompt_tokens
        if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens
      }

      const choice = (parsed.choices || [])[0]
      if (!choice) return events
      const delta = choice.delta || {}

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        events += openText()
        events += sse('content_block_delta', {
          type: 'content_block_delta',
          index: openBlock?.index ?? 0,
          delta: { type: 'text_delta', text: delta.content },
        })
      }

      for (const call of delta.tool_calls || []) {
        const toolIndex = typeof call.index === 'number' ? call.index : 0
        events += openTool(toolIndex, call)
        const blockIndex = toolBlocks.get(toolIndex)?.blockIndex ?? openBlock?.index ?? 0
        const fragment = call?.function?.arguments
        if (typeof fragment === 'string' && fragment.length > 0) {
          events += sse('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: fragment },
          })
        }
      }

      if (choice.finish_reason) {
        stopReason = mapStopReason(choice.finish_reason, toolBlocks.size > 0)
      }
      return events
    },

    finish(): string {
      if (finished) return ''
      finished = true
      let events = closeOpenBlock()
      if (nextIndex === 0) {
        events += openText() + sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '' },
        })
        events += closeOpenBlock()
      }
      events += sse('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: stopReason || mapStopReason(null, toolBlocks.size > 0),
          stop_sequence: null,
        },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      })
      events += sse('message_stop', { type: 'message_stop' })
      return events
    },
  }
}

// ── upstream call ────────────────────────────────────────────────────

export interface ProxyAuth {
  apiKey: string | null
}

export function extractApiKey(headers: http.IncomingHttpHeaders): string | null {
  const raw = headers['x-api-key']
  const fromHeader = Array.isArray(raw) ? raw[0] : raw
  if (fromHeader && fromHeader.trim()) return fromHeader.trim()

  const auth = headers['authorization']
  const value = Array.isArray(auth) ? auth[0] : auth
  if (value) {
    const match = value.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
  }
  return null
}

function anthropicError(
  res: http.ServerResponse,
  status: number,
  type: string,
  message: string
): void {
  const body = JSON.stringify({ type: 'error', error: { type, message } })
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function errorTypeForStatus(status: number): string {
  if (status === 401) return 'authentication_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  if (status >= 400 && status < 500) return 'invalid_request_error'
  return 'api_error'
}

function paymentHint(status: number, message: string): string {
  if (status !== 402) return message
  return (
    `${message}\n\nThis wallet has no Paytaca AI credits left. ` +
    'Add a pay-as-you-go balance with `paytaca ai topup`, ' +
    'or buy a time plan with `paytaca ai purchase --model <id> --minutes <n>`.'
  )
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let split = buffer.indexOf('\n\n')
      while (split !== -1) {
        const event = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        for (const line of event.split('\n')) {
          if (line.startsWith('data:')) yield line.slice(5).trim()
        }
        split = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export interface ProxyContext {
  backendUrl: string
  config: AiConfig
  configLoadedAt: number
}

async function loadConfig(ctx: ProxyContext): Promise<AiConfig> {
  if (Date.now() - ctx.configLoadedAt < 60_000 && ctx.config.models) return ctx.config
  try {
    ctx.config = await getConfig({ backendUrl: ctx.backendUrl })
    ctx.configLoadedAt = Date.now()
  } catch {
    // Keep the last known catalogue; a transient backend hiccup should not
    // break an in-flight Claude Code session.
  }
  return ctx.config
}

export const MODEL_ALIAS_PREFIX = 'paytaca-claude-'

/**
 * Claude Code's gateway model discovery drops every id that does not contain
 * `claude` or `anthropic`, which every Paytaca model id fails. Exposing each
 * model under an alias containing `claude` is what makes it appear in the
 * `/model` picker; `resolveModel` maps the alias back to the real id.
 *
 * `claude` deliberately sits mid-string rather than at the start: Claude Code
 * only honours CLAUDE_CODE_MAX_CONTEXT_TOKENS for ids that do *not* begin with
 * `claude-`, so a `claude-paytaca-…` prefix would silently restore the 200k
 * assumption.
 */
export function modelAlias(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${MODEL_ALIAS_PREFIX}${slug}`
}

/** Picker caption, e.g. `xiaomi/mimo-v2.6-flash - via Paytaca AI`. */
export function modelDescription(modelId: string): string {
  return `${modelId} - via Paytaca AI`
}

function aliasIndex(config: AiConfig): Map<string, string> {
  const index = new Map<string, string>()
  const used = new Set<string>()
  for (const model of config.models || []) {
    if (!model?.id) continue
    let alias = modelAlias(model.id)
    let suffix = 2
    while (used.has(alias)) alias = `${modelAlias(model.id)}-${suffix++}`
    used.add(alias)
    index.set(alias, model.id)
  }
  return index
}

export function resolveModel(requested: string | undefined, config: AiConfig): string {
  const models = config.models || []
  if (requested) {
    const exact = models.find((model) => model.id === requested)
    if (exact) return exact.id
    const byAlias = aliasIndex(config).get(requested)
    if (byAlias) return byAlias
    const byName = models.find(
      (model) => (model.display_name || '').toLowerCase() === requested.toLowerCase()
    )
    if (byName) return byName.id
  }
  return config.default_model || models[0]?.id || requested || ''
}

async function handleMessages(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ProxyContext
): Promise<void> {
  const apiKey = extractApiKey(req.headers)
  if (!apiKey) {
    anthropicError(
      res,
      401,
      'authentication_error',
      'No Paytaca API key. Set ANTHROPIC_AUTH_TOKEN (see `paytaca ai configure claude`).'
    )
    return
  }

  const body = await readJsonBody(req)
  const config = await loadConfig(ctx)
  const model = resolveModel(body.model, config)
  if (!model) {
    anthropicError(res, 400, 'invalid_request_error', 'No Paytaca AI model available.')
    return
  }

  const payload = buildOpenAIRequest(body, model)
  const upstream = await fetch(apiUrl(ctx.backendUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!upstream.ok) {
    const text = await upstream.text()
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error?.message || parsed?.error || parsed?.detail || text
    } catch {
      // Non-JSON error bodies (proxy pages, HTML) are passed through as-is.
    }
    anthropicError(
      res,
      upstream.status,
      errorTypeForStatus(upstream.status),
      paymentHint(upstream.status, typeof message === 'string' ? message : String(message))
    )
    return
  }

  const id = newMessageId()

  if (payload.stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    if (!upstream.body) {
      res.end()
      return
    }
    const translator = createStreamTranslator(id, model)
    res.write(translator.start())
    try {
      for await (const data of readSseData(upstream.body)) {
        if (!data || data === '[DONE]') continue
        try {
          res.write(translator.handleChunk(JSON.parse(data)))
        } catch {
          // A single malformed upstream chunk should not abort the stream.
        }
      }
    } catch {
      // Client disconnect or upstream truncation — still emit a terminator so
      // Claude Code does not hang waiting for message_stop.
    }
    res.write(translator.finish())
    res.end()
    return
  }

  const data = await upstream.json().catch(() => null)
  const message = buildAnthropicMessage(id, model, data)
  const bodyText = JSON.stringify(message)
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(bodyText),
  })
  res.end(bodyText)
}

async function handleModels(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ProxyContext
): Promise<void> {
  const config = await loadConfig(ctx)
  const now = Math.floor(Date.now() / 1000)
  const aliases = aliasIndex(config)
  const data = (config.models || [])
    .filter((model) => model?.id)
    .map((model) => {
      const alias = modelAlias(model.id)
      return {
        id: alias,
        type: 'model',
        // Claude Code shows `display_name` in the picker when it differs from
        // the id, so this is what the user actually reads.
        display_name: model.display_name || model.id,
        description: modelDescription(model.id),
        created_at: new Date(0).toISOString(),
        created: now,
      }
    })
    .filter((entry) => aliases.has(entry.id))
  const body = JSON.stringify({
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  })
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function handleCountTokens(body: Record<string, any>, res: http.ServerResponse): void {
  const text = [
    buildSystemPrompt(body.system) || '',
    flattenAnthropicText(body.messages || []),
  ].join(' ')
  const estimate = Math.max(1, Math.ceil(text.length / 4))
  const payload = JSON.stringify({ input_tokens: estimate })
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function createProxyServer(options: { backendUrl?: string } = {}): http.Server {
  const ctx: ProxyContext = {
    backendUrl: resolveBackendUrl(options.backendUrl),
    config: { models: [] },
    configLoadedAt: 0,
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (process.env.PAYTACA_PROXY_DEBUG) {
      console.error(`[proxy] ${req.method} ${req.url}`)
    }

    const fail = (error: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      anthropicError(res, 500, 'api_error', error instanceof Error ? error.message : String(error))
    }

    if (req.method === 'HEAD' || req.method === 'GET') {
      if (path === '/health' || path === '/api/hello' || path === '/') {
        const body = JSON.stringify({ ok: true, service: PROXY_SERVICE })
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        })
        res.end(req.method === 'HEAD' ? undefined : body)
        return
      }
      if (path === '/v1/models') {
        handleModels(req, res, ctx).catch(fail)
        return
      }
    }

    if (req.method === 'POST' && path === '/v1/messages') {
      handleMessages(req, res, ctx).catch(fail)
      return
    }

    if (req.method === 'POST' && path === '/v1/messages/count_tokens') {
      readJsonBody(req)
        .then((body) => handleCountTokens(body, res))
        .catch(fail)
      return
    }

    anthropicError(res, 404, 'not_found_error', `Unknown endpoint ${path}.`)
  })
}

export interface StartProxyOptions {
  port?: number
  host?: string
  backendUrl?: string
  onListening?: () => void
}

export function startProxy(options: StartProxyOptions = {}): http.Server {
  const port = resolveProxyPort(options.port)
  const host = options.host || '127.0.0.1'
  const server = createProxyServer({ backendUrl: options.backendUrl })

  server.listen(port, host, () => {
    writeProxyState({
      pid: process.pid,
      port,
      url: proxyBaseUrl(port),
      startedAt: new Date().toISOString(),
    })
    options.onListening?.()
  })

  const shutdown = () => {
    clearProxyState()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return server
}

async function probe(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const response = await fetch(`${proxyBaseUrl(port)}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body = await response.json().catch(() => null)
    return (body as { service?: string } | null)?.service === PROXY_SERVICE
  } catch {
    return false
  }
}

export async function isProxyRunning(port: number): Promise<boolean> {
  return probe(port)
}

function binPath(): string {
  return fileURLToPath(new URL('../../bin/paytaca.js', import.meta.url))
}

export async function ensureProxyRunning(
  options: { port?: number; backendUrl?: string; timeoutMs?: number } = {}
): Promise<{ url: string; port: number; spawned: boolean }> {
  const port = resolveProxyPort(options.port)
  if (await probe(port)) {
    return { url: proxyBaseUrl(port), port, spawned: false }
  }

  const args = [binPath(), 'mcp', '--proxy', '--port', String(port)]
  if (options.backendUrl) args.push('--backend', options.backendUrl)

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PAYTACA_ANTHROPIC_PORT: String(port) },
  })
  child.unref()

  const deadline = Date.now() + (options.timeoutMs ?? 8000)
  while (Date.now() < deadline) {
    if (await probe(port, 400)) {
      return { url: proxyBaseUrl(port), port, spawned: true }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error(
    `The Paytaca Anthropic gateway did not start on port ${port}. ` +
      'Run `paytaca mcp --proxy` in a terminal to see the error.'
  )
}

export function stopProxy(): { stopped: boolean; pid?: number; port?: number } {
  const state = readProxyState()
  if (!state) return { stopped: false }
  try {
    process.kill(state.pid, 'SIGTERM')
    clearProxyState()
    return { stopped: true, pid: state.pid, port: state.port }
  } catch {
    clearProxyState()
    return { stopped: false }
  }
}

export function proxyStateExists(): boolean {
  return existsSync(PROXY_STATE_FILE)
}
