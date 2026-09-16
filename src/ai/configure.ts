/**
 * Harness configuration: writes the MCP server entry and, for opencode, also
 * the Paytaca AI provider (models + API key) so AI models are usable right
 * after `paytaca ai configure`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CLIENTS, buildTemplate, type ClientTemplate, type McpClient } from '../commands/mcp.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getConfig, getWalletStatus, type AiConfig } from './client.js'
import { resolveBackendUrl } from './config.js'
import { hasActiveCredits, summarizeAllCredits, type CreditsSummary } from './credits.js'
import { selectModel, selectTier } from './models.js'
import { provisionApiKey } from './oauth.js'

export const OPENCODE_PROVIDER_ID = 'paytaca-ai'
export const OPENCODE_PROVIDER_NPM = '@ai-sdk/openai-compatible'
export const DEFAULT_MODEL_CONTEXT = 128000
export const DEFAULT_MODEL_OUTPUT = 8192

export interface PlanSuggestion {
  modelId: string
  displayName: string
  minutes: number
  priceSats: number
  priceUsd?: number
}

export interface ConfigureResult {
  harness: McpClient
  path: string | null
  format: 'json' | 'toml'
  mcpInstalled: boolean
  providerInstalled: boolean
  providerError?: string
  canSign: boolean
  apiKeyReused: boolean
  apiKeyProvided: boolean
  apiKeyPrefix?: string
  models: { id: string; name: string }[]
  creditsActive: boolean
  credits: CreditsSummary[]
  planSuggestion?: PlanSuggestion
}

export interface ConfigureOptions {
  harness: McpClient
  chipnet?: boolean
  backendUrl?: string
  path?: string
  apiKey?: string
  requestApiKey?: () => Promise<string | null>
}

export function isValidApiKey(key: string): boolean {
  return /^sk-pytc-[A-Za-z0-9]{8,}$/.test(key.trim())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(target[key])
      ? deepMerge(target[key] as Record<string, unknown>, value)
      : value
  }
  return out
}

export function buildOpencodeProvider(
  config: AiConfig,
  backendUrl: string,
  apiKey: string
): Record<string, unknown> {
  const models: Record<string, unknown> = {}
  for (const model of config.models || []) {
    if (!model?.id) continue
    models[model.id] = {
      name: model.display_name || model.id,
      limit: { context: DEFAULT_MODEL_CONTEXT, output: DEFAULT_MODEL_OUTPUT },
    }
  }
  return {
    npm: OPENCODE_PROVIDER_NPM,
    name: 'Paytaca AI',
    options: { baseURL: `${backendUrl}/v1`, apiKey },
    models,
  }
}

export function extractExistingApiKey(
  config: Record<string, unknown>,
  providerId: string = OPENCODE_PROVIDER_ID
): string | null {
  const provider = config.provider
  if (!isPlainObject(provider)) return null
  const entry = provider[providerId]
  if (!isPlainObject(entry)) return null
  const options = entry.options
  if (!isPlainObject(options)) return null
  const apiKey = options.apiKey
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null
}

function stripJsonComments(input: string): string {
  let out = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const next = input[i + 1]
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        out += char
      }
      continue
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    out += char
  }
  return out
}

function stripTrailingCommas(input: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (inString) {
      out += char
      if (char === '\\') {
        out += input[i + 1] ?? ''
        i++
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (input[j] === '}' || input[j] === ']') continue
    }
    out += char
  }
  return out
}

export function parseJsonConfig(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = JSON.parse(stripTrailingCommas(stripJsonComments(raw)))
  }
  return isPlainObject(parsed) ? parsed : {}
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return parseJsonConfig(readFileSync(path, 'utf-8'))
  } catch {
    throw new Error(`Existing config at ${path} could not be parsed; not overwriting.`)
  }
}

function writeJsonFile(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function appendToml(path: string, toml: string): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  if (existing.includes('[mcp_servers.paytaca]')) return
  mkdirSync(dirname(path), { recursive: true })
  const separator = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : ''
  writeFileSync(path, existing + separator + toml, 'utf-8')
  chmodSync(path, 0o600)
}

function buildPlanSuggestion(config: AiConfig): PlanSuggestion | undefined {
  const models = config.models || []
  const model = selectModel(models, config.default_model || '') || models[0]
  if (!model?.id) return undefined
  const wanted = config.default_duration_minutes
  const tier = (wanted !== undefined ? selectTier(model, wanted) : null) || model.price_tiers?.[0]
  if (!tier) return undefined
  return {
    modelId: model.id,
    displayName: model.display_name || model.id,
    minutes: tier.minutes,
    priceSats: Number(tier.price_sats) || 0,
    priceUsd: tier.price_usd,
  }
}

export async function configureHarness(options: ConfigureOptions): Promise<ConfigureResult> {
  const { harness } = options
  if (!CLIENTS.includes(harness)) {
    throw new Error(`Unknown harness "${harness}". Use one of: ${CLIENTS.join(', ')}.`)
  }

  const isChipnet = Boolean(options.chipnet)
  const backendUrl = resolveBackendUrl(options.backendUrl)
  const wallet = loadWalletRef()
  if (!wallet) throw new WalletNotConfiguredError()
  const template: ClientTemplate = buildTemplate(harness, isChipnet)
  const target = options.path || template.path

  const result: ConfigureResult = {
    harness,
    path: target,
    format: template.format,
    mcpInstalled: false,
    providerInstalled: false,
    canSign: wallet.canSign,
    apiKeyReused: false,
    apiKeyProvided: false,
    models: [],
    creditsActive: false,
    credits: [],
  }

  let config: AiConfig | null = null
  let configError: string | undefined
  try {
    config = await getConfig({ backendUrl })
  } catch (err: any) {
    configError = err?.message || String(err)
  }

  if (harness === 'opencode') {
    if (!target) throw new Error('No known config path for opencode. Use --path.')
    const existing = readJson(target)
    const mcpEntry = (template.json as any)?.mcp?.paytaca

    let apiKey = extractExistingApiKey(existing)
    if (apiKey) {
      result.apiKeyReused = true
    } else if (options.apiKey) {
      if (isValidApiKey(options.apiKey)) {
        apiKey = options.apiKey.trim()
        result.apiKeyProvided = true
      } else {
        result.providerError = 'Invalid API key: expected a Paytaca key like sk-pytc-…'
      }
    } else if (wallet.canSign && wallet.mnemonic) {
      try {
        const created = await provisionApiKey({
          mnemonic: wallet.mnemonic,
          walletHash: wallet.walletHash,
          backendUrl,
          name: 'paytaca-cli',
        })
        apiKey = created.key
        result.apiKeyPrefix = created.keyPrefix
      } catch (err: any) {
        result.providerError = err?.message || String(err)
      }
    } else if (options.requestApiKey) {
      const entered = await options.requestApiKey()
      if (entered && isValidApiKey(entered)) {
        apiKey = entered.trim()
        result.apiKeyProvided = true
      } else {
        result.providerError =
          'No API key provided. A full wallet is required to create one automatically.'
      }
    } else {
      result.providerError =
        'This wallet is read-only. Pass --api-key <key> with a key created from your full wallet.'
    }

    let merged = deepMerge(existing, { mcp: { paytaca: mcpEntry } })
    if (config && apiKey) {
      const provider = buildOpencodeProvider(config, backendUrl, apiKey)
      merged = deepMerge(merged, { provider: { [OPENCODE_PROVIDER_ID]: provider } })
      result.models = (config.models || [])
        .filter((m) => m?.id)
        .map((m) => ({ id: m.id, name: m.display_name || m.id }))
      result.providerInstalled = true
    } else if (!result.providerError) {
      result.providerError = configError || 'Unable to load the AI configuration.'
    }

    writeJsonFile(target, merged)
    result.mcpInstalled = true
  } else {
    if (!target) throw new Error(`No known config file for harness "${harness}". Use --path.`)
    if (template.format === 'toml') {
      appendToml(target, template.toml as string)
    } else {
      const existing = readJson(target)
      writeJsonFile(target, deepMerge(existing, template.json as Record<string, unknown>))
    }
    result.mcpInstalled = true
  }

  if (config) result.planSuggestion = buildPlanSuggestion(config)

  try {
    const status = await getWalletStatus(wallet.walletHash, { backendUrl })
    result.credits = summarizeAllCredits(status)
    result.creditsActive = hasActiveCredits(status)
  } catch {
    result.creditsActive = false
  }

  return result
}
