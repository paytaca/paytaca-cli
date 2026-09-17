/**
 * Harness configuration: writes the MCP server entry and the Paytaca AI
 * provider (models + API key) — the opencode provider block or the Pi
 * models.json — so AI models are usable right after `paytaca ai configure`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CLIENTS, buildTemplate, type ClientTemplate, type McpClient } from '../commands/mcp.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getConfig, getWalletStatus, type AiConfig } from './client.js'
import { resolveBackendUrl } from './config.js'
import { hasActiveCredits, summarizeAllCredits, type CreditsSummary } from './credits.js'
import { selectModel, selectTier } from './models.js'
import { provisionApiKey } from './oauth.js'

export const OPENCODE_PROVIDER_ID = 'paytaca-ai'
export const PI_PROVIDER_ID = 'paytaca-ai'
export const OMP_PROVIDER_ID = 'paytaca-ai'
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
  format: 'json'
  instructions: string
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
  warnings?: string[]
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

export function buildPiProvider(
  config: AiConfig,
  backendUrl: string,
  apiKey: string
): Record<string, unknown> {
  const models = (config.models || [])
    .filter((model) => model?.id)
    .map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      contextWindow: DEFAULT_MODEL_CONTEXT,
      maxTokens: DEFAULT_MODEL_OUTPUT,
    }))
  return {
    baseUrl: `${backendUrl}/v1`,
    apiKey,
    api: 'openai-completions',
    models,
  }
}

export function extractPiApiKey(
  config: Record<string, unknown>,
  providerId: string = PI_PROVIDER_ID
): string | null {
  const providers = config.providers
  if (!isPlainObject(providers)) return null
  const entry = providers[providerId]
  if (!isPlainObject(entry)) return null
  const apiKey = entry.apiKey
  if (typeof apiKey !== 'string' || apiKey.length === 0) return null
  const envName = apiKey.trim().match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/)
  if (envName) {
    if (process.env[envName[1]]) return apiKey
    return null
  }
  if (apiKey.trim().startsWith('!')) return null
  return apiKey
}

const YAML_KEY_LINE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/

function locateModelRolesDefault(
  lines: string[]
): { index: number; indent: number; value: string } | null {
  let rolesIndent: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(YAML_KEY_LINE)
    if (!match) continue
    const indent = match[1].length
    const key = match[2]
    const value = match[3].trim()
    if (rolesIndent === null || indent <= rolesIndent) {
      rolesIndent = key === 'modelRoles' && value === '' ? indent : null
      continue
    }
    if (key === 'default' && value !== '') return { index: i, indent, value }
  }
  return null
}

export function extractOmpDefaultModel(yaml: string): string | null {
  return locateModelRolesDefault(yaml.split('\n'))?.value ?? null
}

export function replaceOmpDefaultModel(yaml: string, nextModelRef: string): string | null {
  const lines = yaml.split('\n')
  const found = locateModelRolesDefault(lines)
  if (!found) return null
  lines[found.index] = `${' '.repeat(found.indent)}default: ${nextModelRef}`
  return lines.join('\n')
}

async function resolveApiKey(
  existingKey: string | null,
  options: ConfigureOptions,
  wallet: NonNullable<ReturnType<typeof loadWalletRef>>,
  backendUrl: string,
  result: ConfigureResult
): Promise<string | null> {
  if (existingKey) {
    result.apiKeyReused = true
    return existingKey
  }
  if (options.apiKey) {
    if (isValidApiKey(options.apiKey)) {
      result.apiKeyProvided = true
      return options.apiKey.trim()
    }
    result.providerError = 'Invalid API key: expected a Paytaca key like sk-pytc-…'
    return null
  }
  if (wallet.canSign && wallet.mnemonic) {
    try {
      const created = await provisionApiKey({
        mnemonic: wallet.mnemonic,
        walletHash: wallet.walletHash,
        backendUrl,
        name: 'paytaca-cli',
      })
      result.apiKeyPrefix = created.keyPrefix
      return created.key
    } catch (err: any) {
      result.providerError = err?.message || String(err)
      return null
    }
  }
  if (options.requestApiKey) {
    const entered = await options.requestApiKey()
    if (entered && isValidApiKey(entered)) {
      result.apiKeyProvided = true
      return entered.trim()
    }
    result.providerError =
      'No API key provided. A full wallet is required to create one automatically.'
    return null
  }
  result.providerError =
    'This wallet is read-only. Pass --api-key <key> with a key created from your full wallet.'
  return null
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

function syncOmpDefaultModel(
  agentDir: string,
  credits: CreditsSummary[],
  result: ConfigureResult
): void {
  const configPath = join(agentDir, 'config.yml')
  if (!existsSync(configPath)) return
  let yaml: string
  try {
    yaml = readFileSync(configPath, 'utf-8')
  } catch {
    return
  }
  const current = extractOmpDefaultModel(yaml)
  if (!current || !current.startsWith(`${OMP_PROVIDER_ID}/`)) return
  const modelId = current.slice(OMP_PROVIDER_ID.length + 1)
  const session = credits.find((c) => c.modelId === modelId)
  if (session?.active && session.timeRemainingSeconds > 0) return
  const fallback = credits
    .filter((c) => c.modelId && c.active && c.timeRemainingSeconds > 0)
    .sort((a, b) => b.timeRemainingSeconds - a.timeRemainingSeconds)[0]
  if (!fallback?.modelId) return
  const next = `${OMP_PROVIDER_ID}/${fallback.modelId}`
  const updated = replaceOmpDefaultModel(yaml, next)
  if (updated === null || updated === yaml) return
  writeFileSync(configPath, updated, 'utf-8')
  result.warnings = [
    ...(result.warnings ?? []),
    `Switched ${configPath} modelRoles.default to ${next} — ${modelId} has no active credits.`,
  ]
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
    instructions: template.instructions,
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

  let apiKeyValue: string | null = null
  let ompAgentDir: string | null = null

  if (harness === 'opencode') {
    if (!target) throw new Error('No known config path for opencode. Use --path.')
    const existing = readJson(target)
    const mcpEntry = (template.json as any)?.mcp?.paytaca

    const apiKey = await resolveApiKey(
      extractExistingApiKey(existing),
      options,
      wallet,
      backendUrl,
      result
    )

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
    const existingMcp = readJson(target)
    writeJsonFile(target, deepMerge(existingMcp, template.json as Record<string, unknown>))
    result.mcpInstalled = true

    ompAgentDir = dirname(target)
    const modelsPath = join(ompAgentDir, 'models.json')
    const existingModels = readJson(modelsPath)
    apiKeyValue = await resolveApiKey(
      extractPiApiKey(existingModels),
      options,
      wallet,
      backendUrl,
      result
    )
    const apiKey = apiKeyValue

    if (harness === 'omp') {
      const yamlPath = ['models.yml', 'models.yaml']
        .map((name) => join(ompAgentDir as string, name))
        .find((path) => existsSync(path))
      if (yamlPath) {
        result.warnings = [
          `${yamlPath} exists — omp prefers it over models.json, so the Paytaca provider there may be ignored.`,
        ]
      }
    }

    if (config && apiKey) {
      const provider = buildPiProvider(config, backendUrl, apiKey)
      writeJsonFile(modelsPath, deepMerge(existingModels, { providers: { [PI_PROVIDER_ID]: provider } }))
      if (harness === 'pi') {
        const authPath = join(dirname(target), 'auth.json')
        const existingAuth = readJson(authPath)
        const entry = existingAuth[PI_PROVIDER_ID]
        if (!isPlainObject(entry) || entry.key !== apiKey) {
          writeJsonFile(authPath, deepMerge(existingAuth, {
            [PI_PROVIDER_ID]: { type: 'api_key', key: apiKey },
          }))
        }
      }
      result.models = (config.models || [])
        .filter((m) => m?.id)
        .map((m) => ({ id: m.id, name: m.display_name || m.id }))
      result.providerInstalled = true
    } else if (!result.providerError) {
      result.providerError = configError || 'Unable to load the AI configuration.'
    }
  }

  if (config) result.planSuggestion = buildPlanSuggestion(config)

  try {
    const status = await getWalletStatus(wallet.walletHash, { backendUrl })
    result.credits = summarizeAllCredits(status)
    result.creditsActive = hasActiveCredits(status)
  } catch {
    result.creditsActive = false
  }

  if (harness === 'omp' && ompAgentDir && config && apiKeyValue) {
    syncOmpDefaultModel(ompAgentDir, result.credits, result)
  }

  return result
}
