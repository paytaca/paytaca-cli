import {
  chatCompletions,
  type ChatMessage,
} from './client.js'
import { resolveBackendUrl } from './config.js'
import { parsePaymentRequiredJson } from '../utils/x402.js'
import type { PaymentRequirements } from '../types/x402.js'

export interface AiChatOptions {
  messages: ChatMessage[]
  model?: string
  system?: string
  walletHash: string
  backendUrl?: string
  temperature?: number
  maxTokens?: number
}

export interface AiChatResult {
  success: boolean
  status: number
  model?: string
  content?: string
  usage?: unknown
  paymentRequired?: boolean
  accepts?: PaymentRequirements[]
  message?: string
  raw?: unknown
  error?: string
}

export async function aiChat(opts: AiChatOptions): Promise<AiChatResult> {
  const baseUrl = resolveBackendUrl(opts.backendUrl)
  const messages: ChatMessage[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push(...opts.messages)

  let result
  try {
    result = await chatCompletions({
      backendUrl: baseUrl,
      walletHash: opts.walletHash,
      body: {
        model: opts.model,
        messages,
        stream: false,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      },
    })
  } catch (err: any) {
    return { success: false, status: 0, error: err?.message || String(err) }
  }

  if (result.status === 402) {
    const required = parsePaymentRequiredJson(result.data)
    return {
      success: false,
      status: 402,
      paymentRequired: true,
      accepts: required?.accepts,
      message:
        'Payment required. Buy a plan with `paytaca ai purchase --model <model> --minutes <n>` or the buy_plan MCP tool, then retry.',
      raw: result.data,
    }
  }

  if (!result.ok) {
    return {
      success: false,
      status: result.status,
      error: `Backend returned ${result.status} ${result.statusText}.`,
      raw: result.data,
    }
  }

  const data: any = result.data
  const content = data?.choices?.[0]?.message?.content
  return {
    success: true,
    status: result.status,
    model: data?.model,
    content: typeof content === 'string' ? content : undefined,
    usage: data?.usage,
    raw: data,
  }
}