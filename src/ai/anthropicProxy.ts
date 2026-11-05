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
  parallel_tool_calls?: boolean
  response_format?: unknown
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

// ── Responses API translation (Codex) ────────────────────────────────
//
// Codex speaks the OpenAI Responses API and always streams. The backend
// speaks chat completions, so this section translates requests and turns
// chat streaming chunks into the Responses SSE events Codex consumes.

export interface NamespacedTool {
  namespace: string
  name: string
}

export interface ResponsesToolTranslation {
  tools?: OpenAIRequest['tools']
  customTools: Set<string>
  namespaces: Map<string, NamespacedTool>
}

// Codex routes MCP tool calls only when the returned function_call item carries
// its namespace, so flattening a namespace to a plain chat-completions tool
// name must be reversible. Chat function names cannot carry the namespace
// field, so encode it as a prefix and decode it again on the way back.
export function flattenNamespaceToolName(namespace: string, name: string): string {
  return `${namespace}__${name}`
}

function namespacedToolFields(
  chatName: string,
  namespaces: Map<string, NamespacedTool>
): Record<string, string> {
  const nested = namespaces.get(chatName)
  if (!nested) return {}
  return { name: nested.name, namespace: nested.namespace }
}

function responsesContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
        return (part as any).text as string
      }
      return ''
    })
    .filter((text) => text.length > 0)
    .join('\n')
}

function responsesContentToChat(content: unknown): string | unknown[] | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null

  const parts: unknown[] = []
  let hasImage = false
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const block = part as Record<string, any>
    if (block.type === 'input_image' && typeof block.image_url === 'string') {
      hasImage = true
      parts.push({
        type: 'image_url',
        image_url: {
          url: block.image_url,
          ...(typeof block.detail === 'string' ? { detail: block.detail } : {}),
        },
      })
      continue
    }
    if (typeof block.text === 'string') {
      parts.push({ type: 'text', text: block.text })
    }
  }

  if (hasImage) return parts.length > 0 ? parts : null
  return responsesContentText(content) || null
}

function flattenResponsesToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          return (part as any).text as string
        }
        return ''
      })
      .filter((text) => text.length > 0)
      .join('\n')
  }
  if (output && typeof output === 'object') {
    const body = (output as Record<string, any>).body
    if (body !== undefined) return flattenResponsesToolOutput(body)
    try {
      return JSON.stringify(output)
    } catch {
      return String(output)
    }
  }
  return output == null ? '' : String(output)
}

export function responsesInputToMessages(
  input: unknown,
  instructions?: unknown
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({ role: 'system', content: instructions })
  }

  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, any>
    const type =
      typeof item.type === 'string'
        ? item.type
        : item.role
          ? 'message'
          : ''

    if (type === 'message') {
      const role =
        item.role === 'assistant'
          ? 'assistant'
          : item.role === 'user'
            ? 'user'
            : 'system'
      const content = responsesContentToChat(item.content)
      messages.push({ role, content: content as string | null })
      continue
    }

    if (type === 'function_call' || type === 'custom_tool_call') {
      const rawName = String(item.name || 'unknown')
      const name =
        typeof item.namespace === 'string' && item.namespace
          ? flattenNamespaceToolName(item.namespace, rawName)
          : rawName
      const callId =
        typeof item.call_id === 'string' && item.call_id
          ? item.call_id
          : typeof item.id === 'string' && item.id
            ? item.id
            : `call_${randomBytes(8).toString('hex')}`
      const args =
        type === 'custom_tool_call'
          ? JSON.stringify({ input: typeof item.input === 'string' ? item.input : '' })
          : typeof item.arguments === 'string'
            ? item.arguments
            : JSON.stringify(item.arguments ?? {})
      const last = messages[messages.length - 1]
      const call: OpenAIToolCall = {
        id: callId,
        type: 'function',
        function: { name, arguments: args },
      }
      if (last && last.role === 'assistant') {
        last.tool_calls = [...(last.tool_calls || []), call]
        if (last.content === undefined) last.content = null
      } else {
        messages.push({ role: 'assistant', content: null, tool_calls: [call] })
      }
      continue
    }

    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      messages.push({
        role: 'tool',
        tool_call_id:
          typeof item.call_id === 'string' && item.call_id
            ? item.call_id
            : typeof item.id === 'string'
              ? item.id
              : '',
        content: flattenResponsesToolOutput(item.output),
      })
      continue
    }
  }

  return messages
}

export function responsesToolsToChat(tools: unknown): ResponsesToolTranslation {
  const customTools = new Set<string>()
  const namespaces = new Map<string, NamespacedTool>()
  const out: NonNullable<OpenAIRequest['tools']> = []

  const visit = (raw: unknown, namespace?: string) => {
    if (!raw || typeof raw !== 'object') return
    const tool = raw as Record<string, any>
    const name =
      typeof tool.name === 'string'
        ? namespace
          ? flattenNamespaceToolName(namespace, tool.name)
          : tool.name
        : null
    if (tool.type === 'function' && name) {
      if (namespace) namespaces.set(name, { namespace, name: tool.name })
      out.push({
        type: 'function',
        function: {
          name,
          description:
            typeof tool.description === 'string' ? tool.description : undefined,
          parameters:
            tool.parameters && typeof tool.parameters === 'object'
              ? tool.parameters
              : { type: 'object', properties: {} },
        },
      })
      return
    }
    if (tool.type === 'custom' && name) {
      if (namespace) namespaces.set(name, { namespace, name: tool.name })
      customTools.add(name)
      out.push({
        type: 'function',
        function: {
          name,
          description:
            `${typeof tool.description === 'string' ? tool.description : tool.name}\n\n` +
            'Provide the complete raw tool input in the "input" string field.',
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Complete raw tool input.',
              },
            },
            required: ['input'],
            additionalProperties: false,
          },
        },
      })
      return
    }
    if (tool.type === 'namespace' && Array.isArray(tool.tools) && typeof tool.name === 'string') {
      for (const nested of tool.tools) visit(nested, tool.name)
    }
  }

  for (const tool of Array.isArray(tools) ? tools : []) visit(tool)
  return { tools: out.length > 0 ? out : undefined, customTools, namespaces }
}

function responsesToolChoice(choice: unknown): unknown {
  if (typeof choice === 'string') return choice
  if (choice && typeof choice === 'object') {
    const value = choice as Record<string, any>
    if (value.type === 'function' && typeof value.name === 'string') {
      return { type: 'function', function: { name: value.name } }
    }
  }
  return undefined
}

function responsesResponseFormat(text: unknown): unknown {
  if (!text || typeof text !== 'object') return undefined
  const format = (text as Record<string, any>).format
  if (!format || typeof format !== 'object') return undefined
  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: typeof format.name === 'string' ? format.name : 'output',
        schema: format.schema && typeof format.schema === 'object' ? format.schema : {},
        strict: Boolean(format.strict),
      },
    }
  }
  if (format.type === 'json_object') return { type: 'json_object' }
  if (format.type === 'text') return { type: 'text' }
  return undefined
}

export interface ResponsesTranslation {
  request: OpenAIRequest
  customTools: Set<string>
  namespaces: Map<string, NamespacedTool>
}

export function buildResponsesChatRequest(
  body: Record<string, any>,
  model: string
): ResponsesTranslation {
  const { tools, customTools, namespaces } = responsesToolsToChat(body.tools)
  const request: OpenAIRequest = {
    model,
    messages: responsesInputToMessages(body.input, body.instructions),
    stream: body.stream === true,
  }
  if (typeof body.max_output_tokens === 'number') request.max_tokens = body.max_output_tokens
  if (typeof body.temperature === 'number') request.temperature = body.temperature
  if (typeof body.top_p === 'number') {
    ;(request as Record<string, any>).top_p = body.top_p
  }
  if (tools) request.tools = tools
  const toolChoice = responsesToolChoice(body.tool_choice)
  if (toolChoice !== undefined) request.tool_choice = toolChoice
  if (typeof body.parallel_tool_calls === 'boolean') {
    request.parallel_tool_calls = body.parallel_tool_calls
  }
  const reasoning = body.reasoning
  if (reasoning && typeof reasoning === 'object' && typeof reasoning.effort === 'string') {
    request.reasoning = { effort: reasoning.effort }
    if (typeof reasoning.exclude === 'boolean') request.reasoning.exclude = reasoning.exclude
  }
  const responseFormat = responsesResponseFormat(body.text)
  if (responseFormat !== undefined) request.response_format = responseFormat
  return { request, customTools, namespaces }
}

function responsesUsage(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  totalTokens?: number
): Record<string, unknown> {
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: reasoningTokens },
    total_tokens:
      typeof totalTokens === 'number' && totalTokens > 0
        ? totalTokens
        : inputTokens + outputTokens,
  }
}

function responsesResponse(
  id: string,
  model: string,
  status: string,
  output: unknown[],
  usage?: Record<string, unknown>,
  error?: unknown
): Record<string, unknown> {
  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output,
    output_text: output
      .map((item) => {
        const value = item as Record<string, any>
        if (value?.type !== 'message' || !Array.isArray(value.content)) return ''
        return value.content
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .join('')
      })
      .join(''),
    error: error ?? null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: true,
    tool_choice: 'auto',
    tools: [],
    temperature: null,
    top_p: null,
    max_output_tokens: null,
    previous_response_id: null,
    reasoning: null,
    store: false,
    text: { format: { type: 'text' } },
    usage: usage ?? null,
  }
}

export interface ResponsesStreamTranslator {
  start(): string
  handleChunk(parsed: any): string
  finish(): string
}

export function createResponsesStreamTranslator(
  id: string,
  model: string,
  customTools: Set<string> = new Set(),
  namespaces: Map<string, NamespacedTool> = new Map()
): ResponsesStreamTranslator {
  const message = {
    id: `msg_${randomBytes(12).toString('hex')}`,
    started: false,
    done: false,
    text: '',
    index: 0,
  }
  const toolCalls = new Map<
    number,
    {
      id: string
      callId: string
      name: string
      args: string
      custom: boolean
      added: boolean
      done: boolean
      index: number
    }
  >()
  const output: unknown[] = []
  let nextOutputIndex = 0
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let totalTokens = 0
  let created = false
  let finished = false

  function openMessage(): string {
    if (message.started) return ''
    message.started = true
    message.index = nextOutputIndex++
    const item = {
      id: message.id,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    }
    return (
      sse('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: message.index,
        item,
      }) +
      sse('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: message.id,
        output_index: message.index,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      })
    )
  }

  function closeMessage(): string {
    if (!message.started || message.done) return ''
    message.done = true
    const part = { type: 'output_text', text: message.text }
    const item = {
      id: message.id,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [part],
    }
    output.push(item)
    return (
      sse('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: message.id,
        output_index: message.index,
        content_index: 0,
        text: message.text,
      }) +
      sse('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: message.id,
        output_index: message.index,
        content_index: 0,
        part,
      }) +
      sse('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: message.index,
        item,
      })
    )
  }

  function openTool(toolIndex: number, call: any): string {
    let state = toolCalls.get(toolIndex)
    if (!state) {
      const name = String(call?.function?.name || 'unknown')
      state = {
        id: `fc_${randomBytes(12).toString('hex')}`,
        callId:
          typeof call?.id === 'string' && call.id
            ? call.id
            : `call_${randomBytes(8).toString('hex')}`,
        name,
        args: '',
        custom: customTools.has(name),
        added: false,
        done: false,
        index: 0,
      }
      toolCalls.set(toolIndex, state)
    } else {
      if (typeof call?.id === 'string' && call.id) state.callId = call.id
      if (
        state.name === 'unknown' &&
        typeof call?.function?.name === 'string' &&
        call.function.name
      ) {
        state.name = call.function.name
        state.custom = customTools.has(state.name)
      }
    }

    if (state.added) return ''
    state.added = true
    state.index = nextOutputIndex++
    let events = closeMessage()
    const item = state.custom
      ? {
          id: state.id,
          type: 'custom_tool_call',
          status: 'in_progress',
          call_id: state.callId,
          name: state.name,
          input: '',
        }
      : {
          id: state.id,
          type: 'function_call',
          status: 'in_progress',
          call_id: state.callId,
          name: state.name,
          ...namespacedToolFields(state.name, namespaces),
          arguments: '',
        }
    events += sse('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: state.index,
      item,
    })
    return events
  }

  function customInput(args: string): string {
    if (!args) return ''
    try {
      const parsed = JSON.parse(args)
      if (parsed && typeof parsed === 'object' && typeof parsed.input === 'string') {
        return parsed.input
      }
    } catch {
      // The model may already have produced raw freeform text.
    }
    return args
  }

  function closeTool(state: {
    id: string
    callId: string
    name: string
    args: string
    custom: boolean
    added: boolean
    done: boolean
    index: number
  }): string {
    if (state.done) return ''
    state.done = true
    const item = state.custom
      ? {
          id: state.id,
          type: 'custom_tool_call',
          status: 'completed',
          call_id: state.callId,
          name: state.name,
          input: customInput(state.args),
        }
      : {
          id: state.id,
          type: 'function_call',
          status: 'completed',
          call_id: state.callId,
          name: state.name,
          ...namespacedToolFields(state.name, namespaces),
          arguments: state.args || '{}',
        }
    output.push(item)
    return sse('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: state.index,
      item,
    })
  }

  return {
    start(): string {
      if (created) return ''
      created = true
      return sse('response.created', {
        type: 'response.created',
        response: responsesResponse(id, model, 'in_progress', []),
      })
    },

    handleChunk(parsed: any): string {
      if (!parsed || typeof parsed !== 'object') return ''
      let events = ''

      const usage = parsed.usage
      if (usage && typeof usage === 'object') {
        if (typeof usage.prompt_tokens === 'number') inputTokens = usage.prompt_tokens
        if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens
        if (typeof usage.total_tokens === 'number') totalTokens = usage.total_tokens
        const details =
          usage.completion_tokens_details || usage.output_tokens_details || null
        if (details && typeof details.reasoning_tokens === 'number') {
          reasoningTokens = details.reasoning_tokens
        }
      }

      const choice = (parsed.choices || [])[0]
      if (!choice) return events
      const delta = choice.delta || {}

      const text =
        typeof delta.content === 'string'
          ? delta.content
          : Array.isArray(delta.content)
            ? delta.content
                .map((part: any) =>
                  typeof part?.text === 'string' ? part.text : ''
                )
                .join('')
            : ''
      if (text.length > 0) {
        events += openMessage()
        message.text += text
        events += sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          item_id: message.id,
          output_index: message.index,
          content_index: 0,
          delta: text,
        })
      }

      for (const call of delta.tool_calls || []) {
        const toolIndex = typeof call.index === 'number' ? call.index : 0
        events += openTool(toolIndex, call)
        const state = toolCalls.get(toolIndex)
        if (!state) continue
        const fragment = call?.function?.arguments
        if (typeof fragment === 'string' && fragment.length > 0) {
          state.args += fragment
          events += sse(
            state.custom
              ? 'response.custom_tool_call_input.delta'
              : 'response.function_call_arguments.delta',
            state.custom
              ? {
                  type: 'response.custom_tool_call_input.delta',
                  item_id: state.id,
                  call_id: state.callId,
                  output_index: state.index,
                  delta: fragment,
                }
              : {
                  type: 'response.function_call_arguments.delta',
                  item_id: state.id,
                  call_id: state.callId,
                  output_index: state.index,
                  delta: fragment,
                }
          )
        }
      }

      return events
    },

    finish(): string {
      if (finished) return ''
      finished = true
      let events = ''
      if (!message.started && toolCalls.size === 0) {
        events += openMessage()
      }
      events += closeMessage()
      for (const state of toolCalls.values()) {
        events += closeTool(state)
      }
      events += sse('response.completed', {
        type: 'response.completed',
        response: responsesResponse(
          id,
          model,
          'completed',
          output,
          responsesUsage(inputTokens, outputTokens, reasoningTokens, totalTokens)
        ),
      })
      return events
    },
  }
}

export function buildResponsesResponse(
  id: string,
  model: string,
  data: any,
  customTools: Set<string> = new Set(),
  namespaces: Map<string, NamespacedTool> = new Map()
): Record<string, unknown> {
  const choice = (data?.choices || [])[0] || {}
  const message = choice.message || {}
  const output: unknown[] = []

  const text = typeof message.content === 'string' ? message.content : ''
  output.push({
    id: `msg_${randomBytes(12).toString('hex')}`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: text ? [{ type: 'output_text', text }] : [],
  })

  for (const call of message.tool_calls || []) {
    const name = String(call?.function?.name || 'unknown')
    const args =
      typeof call?.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call?.function?.arguments ?? {})
    const common = {
      id: `fc_${randomBytes(12).toString('hex')}`,
      status: 'completed',
      call_id: call?.id || `call_${randomBytes(8).toString('hex')}`,
      name,
    }
    if (customTools.has(name) && args) {
      let input = args
      try {
        const parsed = JSON.parse(args)
        if (parsed && typeof parsed.input === 'string') input = parsed.input
      } catch {
        // raw freeform input
      }
      output.push({ ...common, type: 'custom_tool_call', input })
    } else {
      output.push({
        ...common,
        ...namespacedToolFields(name, namespaces),
        type: 'function_call',
        arguments: args || '{}',
      })
    }
  }

  const usage = data?.usage || {}
  return responsesResponse(
    id,
    model,
    'completed',
    output,
    responsesUsage(
      usage.prompt_tokens ?? 0,
      usage.completion_tokens ?? 0,
      usage.completion_tokens_details?.reasoning_tokens ?? 0,
      usage.total_tokens
    )
  )
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

function responsesError(
  res: http.ServerResponse,
  status: number,
  type: string,
  message: string
): void {
  const body = JSON.stringify({
    error: {
      message,
      type,
      code: type,
      param: null,
    },
  })
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function handleResponses(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ProxyContext
): Promise<void> {
  const apiKey = extractApiKey(req.headers)
  if (!apiKey) {
    responsesError(
      res,
      401,
      'authentication_error',
      'No Paytaca API key. Re-run `paytaca ai configure codex`.'
    )
    return
  }

  const body = await readJsonBody(req)
  const config = await loadConfig(ctx)
  const model = resolveModel(body.model, config)
  if (!model) {
    responsesError(res, 400, 'invalid_request_error', 'No Paytaca AI model available.')
    return
  }

  const { request: payload, customTools, namespaces } = buildResponsesChatRequest(body, model)
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
    responsesError(
      res,
      upstream.status,
      errorTypeForStatus(upstream.status),
      paymentHint(upstream.status, typeof message === 'string' ? message : String(message))
    )
    return
  }

  const id = `resp_${randomBytes(12).toString('hex')}`

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
    const translator = createResponsesStreamTranslator(id, model, customTools, namespaces)
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
      // Codex does not hang waiting for response.completed.
    }
    res.write(translator.finish())
    res.end()
    return
  }

  const data = await upstream.json().catch(() => null)
  const response = buildResponsesResponse(id, model, data, customTools, namespaces)
  const bodyText = JSON.stringify(response)
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

    if (req.method === 'POST' && path === '/v1/responses') {
      handleResponses(req, res, ctx).catch(fail)
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
