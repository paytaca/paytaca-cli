/**
 * Harness configuration: writes the MCP server entry and the Paytaca AI
 * provider (models + API key) — the opencode provider block or the Pi
 * models.json — so AI models are usable right after `paytaca ai configure`.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { CLIENTS, buildTemplate, type ClientTemplate, type McpClient } from '../commands/mcp.js'
import {
  ensureProxyRunning,
  modelAlias,
  modelDescription,
  proxyBaseUrl,
  resolveProxyPort,
} from './anthropicProxy.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getConfig, getWalletStatus, type AiConfig, type AiModelConfig } from './client.js'
import { resolveBackendUrl } from './config.js'
import {
  hasActiveCredits,
  paygBalanceUsd,
  paygEnabled,
  summarizeAllCredits,
  type CreditsSummary,
} from './credits.js'
import { checkApiKeyWalletIdentity, type KeyIdentity } from './identity.js'
import { selectModel, selectTier } from './models.js'
import { provisionApiKey } from './oauth.js'

export const OPENCODE_PROVIDER_ID = 'paytaca-ai'
export const PI_PROVIDER_ID = 'paytaca-ai'
export const OMP_PROVIDER_ID = 'paytaca-ai'
export const OPENCODE_PROVIDER_NPM = '@ai-sdk/openai-compatible'
export const OPENCODE_PROVIDER_PACKAGE = '@opencode/ai/providers/openai-compatible'

/**
 * Context window advertised to harnesses. The catalogue often reports ~1M
 * tokens, but agentic harnesses re-send the whole transcript on every turn, so
 * advertising the full window lets one session burn a plan in a handful of
 * turns. This is a deliberate cost cap, not a stale default: raise it only
 * after re-checking the plan budgets in the backend.
 */
export const COST_SAFE_CONTEXT = 128_000

/**
 * Largest output budget advertised to harnesses. Matches the backend's
 * `MAX_OUTPUT_TOKENS` default; the backend caps any `max_tokens` at the
 * model's own ceiling regardless of what a harness asks for.
 */
export const HARNESS_MAX_OUTPUT = 16_384

/**
 * Per-model limits written into a harness config, bounded by the cost caps
 * above. A model with a smaller real window keeps that smaller window.
 */
export function harnessLimits(model?: AiModelConfig): {
  context: number
  output: number
} {
  const context = Math.min(
    positiveInt(model?.context_input_limit) ?? COST_SAFE_CONTEXT,
    COST_SAFE_CONTEXT
  )
  const output = Math.min(
    positiveInt(model?.max_output_tokens) ?? HARNESS_MAX_OUTPUT,
    HARNESS_MAX_OUTPUT
  )
  return { context, output }
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null
}

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
  instructions: string
  mcpInstalled: boolean
  providerInstalled: boolean
  providerError?: string
  canSign: boolean
  apiKeyReused: boolean
  apiKeyProvided: boolean
  apiKeyReplaced?: boolean
  apiKeyPrefix?: string
  models: { id: string; name: string }[]
  creditsActive: boolean
  credits: CreditsSummary[]
  /** Pay-as-you-go balance in USD, when the backend reports one. */
  paygBalanceUsd?: number
  paygEnabled?: boolean
  planSuggestion?: PlanSuggestion
  warnings?: string[]
}

export type CreditStatusTone = 'success' | 'warning' | 'dim'

export interface CreditStatusLine {
  tone: CreditStatusTone
  text: string
}

export const PAYG_USABLE_MIN_USD = 0.001

/**
 * How to tell the user they can (or cannot) spend. A time plan and a
 * pay-as-you-go balance are independent ways to pay, so either one alone is
 * enough and the empty case must offer both.
 */
export function buildCreditStatusLines(
  result: Pick<
    ConfigureResult,
    'creditsActive' | 'paygEnabled' | 'paygBalanceUsd' | 'planSuggestion' | 'canSign'
  >
): CreditStatusLine[] {
  const balance = result.paygBalanceUsd ?? 0
  const paygUsable = Boolean(result.paygEnabled) && balance >= PAYG_USABLE_MIN_USD
  const money = `$${balance.toFixed(2)}`

  if (result.creditsActive) {
    const lines: CreditStatusLine[] = [
      { tone: 'success', text: 'AI credits active — ready to use.' },
    ]
    if (paygUsable) {
      lines.push({ tone: 'dim', text: `Pay-as-you-go balance: ${money}` })
    }
    return lines
  }

  if (paygUsable) {
    return [
      { tone: 'success', text: 'Pay-as-you-go balance available — ready to use.' },
      { tone: 'dim', text: `Balance: ${money}` },
    ]
  }

  const lines: CreditStatusLine[] = [
    { tone: 'warning', text: 'No active AI credits or pay-as-you-go balance.' },
  ]
  const prefix = result.canSign ? '' : 'Fund from your full wallet: '
  if (result.planSuggestion) {
    lines.push({
      tone: 'dim',
      text:
        `Buy a time plan:  ${prefix}paytaca ai purchase ` +
        `--model ${result.planSuggestion.modelId} --minutes ${result.planSuggestion.minutes}`,
    })
  }
  lines.push({ tone: 'dim', text: `Or prepay per token: ${prefix}paytaca ai topup` })
  return lines
}

export interface ConfigureOptions {
  harness: McpClient
  chipnet?: boolean
  backendUrl?: string
  path?: string
  apiKey?: string
  opencodeVersion?: number | null
  requestApiKey?: () => Promise<string | null>
}

export function isValidApiKey(key: string): boolean {
  return /^sk-pytc-[A-Za-z0-9]{8,}$/.test(key.trim())
}

/**
 * A stored API key should be replaced only when we have positive evidence it is
 * unusable for this wallet — an invalid key, or one that resolves to a wallet
 * other than the active one. `unknown` keeps the existing key so a healthy
 * config is never churned just because the backend could not be compared.
 */
export function shouldReprovisionApiKey(identity: KeyIdentity): boolean {
  return identity === 'mismatch' || identity === 'invalid'
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

export function parseOpencodeMajor(versionOutput: string): number | null {
  const match = versionOutput.trim().match(/(\d+)\./)
  if (!match) return null
  const major = Number(match[1])
  return Number.isFinite(major) ? major : null
}

export function detectOpencodeMajorVersion(): number | null {
  try {
    const output = execFileSync('opencode', ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseOpencodeMajor(output)
  } catch {
    return null
  }
}

export function resolveOpencodeMajor(
  explicit: number | null | undefined,
  existing: Record<string, unknown>,
  detected: number | null = detectOpencodeMajorVersion()
): number {
  if (typeof explicit === 'number') return explicit
  if (detected !== null) return detected
  if (isPlainObject(existing.providers)) return 2
  return 1
}

export function shouldClearOpencodeCredentials(opencodeMajor: number): boolean {
  return opencodeMajor >= 2
}

/**
 * Reasoning menu for a model, as the effort levels its provider accepts.
 *
 * The catalogue is the source of truth because the accepted sets differ per
 * model (GLM 5.3 takes max/high/low and cannot be switched off, DeepSeek V4 Pro
 * takes xhigh/high/none). An empty list means the model exposes no effort
 * control, and harnesses are told nothing rather than being handed a guess.
 */
export function reasoningEfforts(model: AiModelConfig): string[] {
  const efforts = Array.isArray(model.reasoning_efforts)
    ? model.reasoning_efforts.filter(
        (effort): effort is string => typeof effort === 'string' && effort.length > 0
      )
    : []
  return model.reasoning_mandatory
    ? efforts.filter((effort) => effort !== 'none')
    : efforts
}

export function buildOpencodeProvider(
  config: AiConfig,
  backendUrl: string,
  apiKey: string,
  opencodeMajor: number = 1
): Record<string, unknown> {
  const models: Record<string, unknown> = {}
  for (const model of config.models || []) {
    if (!model?.id) continue
    const efforts = reasoningEfforts(model)
    const entry: Record<string, unknown> = {
      name: model.display_name || model.id,
      limit: harnessLimits(model),
    }
    if (efforts.length > 0) {
      if (opencodeMajor >= 2) {
        // v2 describes capability; the agent then offers the menu itself.
        // `effort` lists real levels; switching reasoning off is `toggle`,
        // which renders a separate "none" variant. Listing "none" as an
        // effort level is not the documented shape and may be ignored.
        const levels = efforts.filter((effort) => effort !== 'none')
        const reasoning: Record<string, unknown> = { supported: true }
        if (levels.length > 0) reasoning.effort = levels
        if (levels.length < efforts.length) reasoning.toggle = true
        entry.capabilities = { reasoning }
      } else {
        entry.reasoning = true
      }
    }
    models[model.id] = entry
  }
  if (opencodeMajor >= 2) {
    return {
      name: 'Paytaca AI',
      package: OPENCODE_PROVIDER_PACKAGE,
      settings: { baseURL: `${backendUrl}/v1`, apiKey },
      models,
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
  return (
    extractOpencodeKeyV1(config, providerId) ??
    extractOpencodeKeyV2(config, providerId)
  )
}

function extractOpencodeKeyV1(
  config: Record<string, unknown>,
  providerId: string
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

function extractOpencodeKeyV2(
  config: Record<string, unknown>,
  providerId: string
): string | null {
  const providers = config.providers
  if (!isPlainObject(providers)) return null
  const entry = providers[providerId]
  if (!isPlainObject(entry)) return null
  const settings = entry.settings
  if (!isPlainObject(settings)) return null
  const apiKey = settings.apiKey
  return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null
}

function stripOtherOpencodeShape(
  config: Record<string, unknown>,
  opencodeMajor: number
): Record<string, unknown> {
  let out = config

  const otherKey = opencodeMajor >= 2 ? 'provider' : 'providers'
  const entry = out[otherKey]
  if (isPlainObject(entry) && OPENCODE_PROVIDER_ID in entry) {
    const trimmed = { ...entry }
    delete trimmed[OPENCODE_PROVIDER_ID]
    out = { ...out }
    if (Object.keys(trimmed).length === 0) delete out[otherKey]
    else out[otherKey] = trimmed
  }

  const mcp = out.mcp
  if (isPlainObject(mcp)) {
    if (opencodeMajor >= 2) {
      if ('paytaca' in mcp) {
        const nextMcp = { ...mcp }
        delete nextMcp.paytaca
        out = { ...out, mcp: nextMcp }
      }
    } else {
      const servers = mcp.servers
      if (isPlainObject(servers) && 'paytaca' in servers) {
        const nextServers = { ...servers }
        delete nextServers.paytaca
        const nextMcp = { ...mcp }
        if (Object.keys(nextServers).length === 0) delete nextMcp.servers
        else nextMcp.servers = nextServers
        out = { ...out, mcp: nextMcp }
      }
    }
  }

  return out
}

export interface OpencodeStoredCredential {
  id: string
  integrationID: string
  key?: string
}

export function parseOpencodeAuthExport(raw: string): OpencodeStoredCredential[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: OpencodeStoredCredential[] = []
  for (const entry of parsed) {
    if (!isPlainObject(entry)) continue
    const { id, integrationID, value } = entry
    if (typeof id !== 'string' || typeof integrationID !== 'string') continue
    const key = isPlainObject(value) && typeof value.key === 'string' ? value.key : undefined
    out.push({ id, integrationID, key })
  }
  return out
}

export function staleOpencodeCredentialIds(
  stored: OpencodeStoredCredential[],
  providerId: string,
  apiKey: string
): string[] {
  return stored
    .filter((c) => c.integrationID === providerId && c.key !== undefined && c.key !== apiKey)
    .map((c) => c.id)
}

export function clearStaleOpencodeCredentials(
  providerId: string,
  apiKey: string
): { removed: number; error?: string } {
  let ids: string[]
  try {
    ids = staleOpencodeCredentialIdsFromCli(providerId, apiKey)
  } catch (err: any) {
    return { removed: 0, error: err?.message || String(err) }
  }
  let removed = 0
  for (const id of ids) {
    try {
      execFileSync('opencode', ['auth', 'logout', providerId, id], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      removed += 1
    } catch {
      // Best-effort: a leftover credential just means the user must sign in again.
    }
  }
  return { removed }
}

/**
 * Read-only counterpart of {@link clearStaleOpencodeCredentials}: returns the
 * ids of stored credentials that shadow the configured key without logging out.
 */
export function staleOpencodeCredentialIdsFromCli(
  providerId: string,
  apiKey: string
): string[] {
  const raw = execFileSync('opencode', ['auth', 'export'], {
    encoding: 'utf-8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return staleOpencodeCredentialIds(parseOpencodeAuthExport(raw), providerId, apiKey)
}

export function buildPiProvider(
  config: AiConfig,
  backendUrl: string,
  apiKey: string
): Record<string, unknown> {
  const models = (config.models || [])
    .filter((model) => model?.id)
    .map((model) => {
      const efforts = reasoningEfforts(model)
      const limits = harnessLimits(model)
      const entry: Record<string, unknown> = {
        id: model.id,
        name: model.display_name || model.id,
        contextWindow: limits.context,
        maxTokens: limits.output,
      }
      if (efforts.length > 0) {
        entry.reasoning = true
        entry.thinking = {
          mode: 'effort',
          efforts,
          requiresEffort: Boolean(model.reasoning_mandatory),
          ...(model.reasoning_default_effort
            ? { defaultLevel: model.reasoning_default_effort }
            : {}),
        }
      }
      return entry
    })
  return {
    baseUrl: `${backendUrl}/v1`,
    apiKey,
    api: 'openai-completions',
    models,
  }
}

export const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')

/**
 * Claude Code cannot talk to an OpenAI-compatible endpoint, so the provider is
 * a local Anthropic gateway (`paytaca mcp --proxy`) plus the environment that
 * points Claude Code at it.
 */
export function buildClaudeSettings(
  config: AiConfig,
  gatewayUrl: string,
  apiKey: string
): Record<string, unknown> {
  const model = config.default_model || config.models?.[0]?.id
  const selected = (config.models || []).find((entry) => entry?.id === model)
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: gatewayUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
  }
  if (model) {
    // Use the gateway alias, not the provider id: Claude Code keys its picker
    // on the id it is given, and only ids containing `claude` survive discovery.
    const alias = modelAlias(model)
    env.ANTHROPIC_MODEL = alias
    env.ANTHROPIC_DEFAULT_MODEL = alias
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = alias
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = selected?.display_name || model
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = modelDescription(model)
    // Claude Code assumes 200k for a model id it does not recognise and warns
    // at startup. Declare the window, capped at the same cost-safe limit the
    // other harnesses get: claiming the full ~1M window stops compaction and
    // makes every turn re-send the whole transcript.
    const window = positiveInt(selected?.context_input_limit)
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(
      Math.min(window ?? COST_SAFE_CONTEXT, COST_SAFE_CONTEXT)
    )
  }
  const settings: Record<string, unknown> = { env }
  if (model) settings.model = modelAlias(model)
  return settings
}

export function extractClaudeApiKey(settings: Record<string, unknown>): string | null {
  const env = settings.env
  if (!isPlainObject(env)) return null
  for (const key of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
    const value = env[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/** Read a Claude settings file without throwing; used by `ai doctor`. */
export function readClaudeSettings(path: string | null): Record<string, unknown> {
  if (!path) return {}
  return readJsonSafe(path)
}

export function extractClaudeBaseUrl(settings: Record<string, unknown>): string | null {
  const env = settings.env
  if (!isPlainObject(env)) return null
  const value = env.ANTHROPIC_BASE_URL
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeApiKeyRef(raw: string): string | null {
  const envName = raw.trim().match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/)
  if (envName) {
    if (process.env[envName[1]]) return raw
    return null
  }
  if (raw.trim().startsWith('!')) return null
  return raw
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
  return normalizeApiKeyRef(apiKey)
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

function countIndent(line: string): number {
  const match = line.match(/^ */)
  return match ? match[0].length : 0
}

function isIgnorableLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = value == null ? '' : String(value)
  if (text === '') return "''"
  const unsafe =
    /^(true|false|null|~|yes|no|on|off)$/i.test(text) ||
    /^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/.test(text) ||
    /^\s|\s$/.test(text) ||
    /[\n\t]/.test(text) ||
    /:(\s|$)/.test(text) ||
    /\s#/.test(text) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text)
  return unsafe ? JSON.stringify(text) : text
}

function renderOmpEntry(
  key: string,
  value: unknown,
  indent: string,
  keyIndent: string,
  lead: string
): string[] {
  const head = lead ? `${indent}${lead}${key}:` : `${keyIndent}${key}:`

  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return [head, ...renderOmpMapping(Object.entries(value), `${keyIndent}  `)]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${head} []`]
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      return [`${head} [${value.map((item) => yamlScalar(item)).join(', ')}]`]
    }
    const lines = [head]
    for (const item of value) {
      if (isPlainObject(item)) {
        lines.push(...renderOmpMapping(Object.entries(item), `${keyIndent}  `, '- '))
      } else {
        lines.push(`${keyIndent}  - ${yamlScalar(item)}`)
      }
    }
    return lines
  }
  return [`${head} ${yamlScalar(value)}`]
}

function renderOmpMapping(
  entries: Array<[string, unknown]>,
  indent: string,
  firstPrefix = ''
): string[] {
  const keyIndent = indent + ' '.repeat(firstPrefix.length)
  const out: string[] = []
  let lead = firstPrefix
  for (const [key, value] of entries) {
    out.push(...renderOmpEntry(key, value, indent, keyIndent, lead))
    lead = ''
  }
  return out
}

export function serializeOmpProviderYaml(
  providerId: string,
  provider: Record<string, unknown>,
  indent = '  '
): string {
  const inner = indent + '  '
  const out: string[] = [`${indent}${providerId}:`]
  const models = Array.isArray(provider.models) ? provider.models : []
  const scalars = Object.entries(provider).filter(([key]) => key !== 'models')
  out.push(...renderOmpMapping(scalars, inner))
  if (models.length > 0) {
    out.push(`${inner}models:`)
    const itemIndent = inner + '  '
    for (const model of models) {
      if (!isPlainObject(model)) continue
      out.push(...renderOmpMapping(Object.entries(model), itemIndent, '- '))
    }
  }
  return out.join('\n')
}

function locateYamlProvider(lines: string[], providerId: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isIgnorableLine(line)) continue
    if (countIndent(line) !== 2) continue
    if (new RegExp(`^\\s{2}${escapeRegExp(providerId)}\\s*:\\s*$`).test(line)) return i
  }
  return -1
}

export function upsertOmpProviderYaml(
  existingYaml: string,
  providerId: string,
  provider: Record<string, unknown>
): string {
  const block = serializeOmpProviderYaml(providerId, provider).split('\n')
  const lines = existingYaml.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let providersIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isIgnorableLine(line)) continue
    if (countIndent(line) === 0 && /^providers\s*:\s*$/.test(line)) {
      providersIndex = i
      break
    }
  }

  if (providersIndex === -1) {
    const head = lines.length > 0 ? [...lines, '', 'providers:'] : ['providers:']
    return [...head, ...block].join('\n') + '\n'
  }

  const providerIndex = locateYamlProvider(lines.slice(providersIndex + 1), providerId)
  if (providerIndex === -1) {
    return [
      ...lines.slice(0, providersIndex + 1),
      ...block,
      ...lines.slice(providersIndex + 1),
    ].join('\n') + '\n'
  }

  const start = providersIndex + 1 + providerIndex
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (isIgnorableLine(line)) {
      end++
      continue
    }
    if (countIndent(line) <= 2) break
    end++
  }
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n') + '\n'
}

export function extractOmpProviderApiKey(
  yaml: string,
  providerId: string = OMP_PROVIDER_ID
): string | null {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  const start = locateYamlProvider(lines, providerId)
  if (start === -1) return null
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!isIgnorableLine(line) && countIndent(line) <= 2) break
    const match = line.match(/^\s+apiKey\s*:\s*(.+?)\s*$/)
    if (!match) continue
    let value = match[1]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value.length > 0 ? normalizeApiKeyRef(value) : null
  }
  return null
}

export interface HarnessApiKeyInfo {
  path: string | null
  apiKey: string | null
}

function readJsonSafe(path: string): Record<string, unknown> {
  try {
    return readJson(path)
  } catch {
    return {}
  }
}

/**
 * Read the API key already configured for a harness without writing anything.
 * Mirrors the file locations used by {@link configureHarness}, so `ai doctor`
 * inspects exactly what the harness will read at runtime.
 */
export const CODEX_PROVIDER_ID = 'paytaca-ai'
export const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml')
export const CODEX_MODEL_CATALOG_FILE = 'paytaca-models.json'

export interface CodexConfigInfo {
  path: string
  apiKey: string | null
  baseUrl: string | null
  model: string | null
  catalogPath: string | null
}

interface TomlTable {
  header: string
  lines: string[]
}

function tomlQuote(value: string): string {
  return JSON.stringify(value)
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlQuote).join(', ')}]`
}

function unquoteToml(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim().replace(/\s+#.*$/, '')
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return null
}

function splitToml(text: string): { top: string[]; tables: TomlTable[] } {
  const top: string[] = []
  const tables: TomlTable[] = []
  let current: TomlTable | null = null
  for (const line of text.split(/\r?\n/)) {
    const header = line.trim().match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/)
    if (header) {
      current = { header: header[1].trim(), lines: [] }
      tables.push(current)
      continue
    }
    if (current) current.lines.push(line)
    else top.push(line)
  }
  return { top, tables }
}

function tomlLineValue(lines: string[], key: string): string | null {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+)$`)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) return match[1].trim()
  }
  return null
}

function getTomlTable(tables: TomlTable[], header: string): TomlTable | null {
  return tables.find((table) => table.header === header) ?? null
}

function tomlBearer(raw: string | null): string | null {
  if (!raw) return null
  const match = raw.match(/Authorization\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/i)
  const value = unquoteToml(match ? match[1] : raw)
  if (!value) return null
  const bearer = value.match(/^Bearer\s+(.+)$/i)
  return (bearer ? bearer[1] : value).trim() || null
}

export function readCodexConfig(path: string = CODEX_CONFIG_PATH): CodexConfigInfo {
  let text = ''
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return { path, apiKey: null, baseUrl: null, model: null, catalogPath: null }
  }

  const { top, tables } = splitToml(text)
  const model = unquoteToml(tomlLineValue(top, 'model'))
  const catalogPath = unquoteToml(tomlLineValue(top, 'model_catalog_json'))
  const provider = getTomlTable(tables, `model_providers.${CODEX_PROVIDER_ID}`)

  let apiKey: string | null = null
  let baseUrl: string | null = null
  if (provider) {
    baseUrl = unquoteToml(tomlLineValue(provider.lines, 'base_url'))
    apiKey = tomlBearer(tomlLineValue(provider.lines, 'http_headers'))
    if (!apiKey) {
      apiKey = unquoteToml(tomlLineValue(provider.lines, 'experimental_bearer_token'))
    }
    const envKey = unquoteToml(tomlLineValue(provider.lines, 'env_key'))
    if (!apiKey && envKey && process.env[envKey]) apiKey = process.env[envKey] as string
  }

  if (!apiKey) {
    const headers = getTomlTable(
      tables,
      `model_providers.${CODEX_PROVIDER_ID}.http_headers`
    )
    if (headers) {
      apiKey = tomlBearer(
        tomlLineValue(headers.lines, 'Authorization') ??
          tomlLineValue(headers.lines, 'authorization')
      )
    }
  }

  return { path, apiKey, baseUrl, model, catalogPath }
}

export function readCodexApiKey(path?: string): string | null {
  return readCodexConfig(path).apiKey
}

export function readCodexBaseUrl(path?: string): string | null {
  return readCodexConfig(path).baseUrl
}

export function codexConfigParseError(path: string): string | null {
  if (!existsSync(path)) return null
  let text = ''
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return `Config at ${path} could not be read.`
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('[')) continue
    if (!/^\[\[?.+\]\]?\s*(?:#.*)?$/.test(trimmed)) {
      return `Config at ${path} could not be parsed (invalid TOML table header).`
    }
  }
  return null
}

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  none: 'Reasoning disabled for fast, low-cost answers',
  minimal: 'Minimal reasoning for simple tasks',
  low: 'Fast responses with lighter reasoning',
  medium: 'Balances speed and reasoning depth',
  high: 'Greater reasoning depth for complex problems',
  xhigh: 'Extra high reasoning depth for difficult problems',
  max: 'Maximum reasoning depth for the hardest problems',
  ultra: 'Maximum reasoning with automatic task delegation',
}

export function readBundledCodexCatalog(): { models?: Record<string, any>[] } | null {
  try {
    const raw = String(
      execFileSync('codex', ['debug', 'models', '--bundled'], {
        encoding: 'utf-8',
        timeout: 20_000,
        maxBuffer: 32 * 1024 * 1024,
      })
    )
    const start = raw.indexOf('{')
    if (start < 0) return null
    const parsed = JSON.parse(raw.slice(start))
    return parsed && Array.isArray(parsed.models) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Build a Codex model catalogue from the catalogue bundled with the installed
 * Codex binary. Cloning a real entry preserves the instructions template and
 * tool metadata Codex expects; only the Paytaca-specific fields are replaced.
 */
export function buildCodexModelCatalog(
  config: AiConfig,
  bundled: { models?: Record<string, any>[] } | null
): Record<string, unknown> | null {
  const bundle = bundled?.models
  if (!Array.isArray(bundle) || bundle.length === 0) return null

  const base =
    bundle.find(
      (entry) =>
        entry &&
        entry.visibility === 'list' &&
        entry.use_responses_lite === false &&
        entry.model_messages &&
        typeof entry.model_messages.instructions_template === 'string'
    ) ??
    bundle.find(
      (entry) =>
        entry &&
        entry.visibility === 'list' &&
        entry.model_messages &&
        typeof entry.model_messages.instructions_template === 'string'
    ) ??
    bundle[0]
  if (!base) return null

  const models: Record<string, unknown>[] = []
  for (const [index, model] of (config.models || []).entries()) {
    if (!model?.id) continue
    const efforts = reasoningEfforts(model)
    const limits = harnessLimits(model)
    const entry = JSON.parse(JSON.stringify(base)) as Record<string, any>
    const defaultEffort =
      model.reasoning_default_effort && efforts.includes(model.reasoning_default_effort)
        ? model.reasoning_default_effort
        : efforts[0] ?? null

    entry.slug = model.id
    entry.display_name = model.display_name || model.id
    entry.description = modelDescription(model.id)
    entry.visibility = 'list'
    entry.supported_in_api = true
    entry.priority = index
    entry.default_reasoning_level = defaultEffort
    entry.supported_reasoning_levels = efforts.map((effort) => ({
      effort,
      description: EFFORT_DESCRIPTIONS[effort] || effort,
    }))
    entry.context_window = limits.context
    entry.max_context_window = limits.context
    entry.effective_context_window_percent = 95
    entry.additional_speed_tiers = []
    entry.service_tiers = []
    entry.availability_nux = null
    entry.upgrade = null
    entry.include_skills_usage_instructions = false
    entry.include_plugin_usage_instructions = false
    entry.include_apps_usage_instructions = false
    entry.default_reasoning_summary = 'none'
    entry.supports_reasoning_summary_parameter = false
    entry.support_verbosity = false
    entry.default_verbosity = null
    entry.apply_patch_tool_type = 'freeform'
    entry.web_search_tool_type = 'text'
    entry.supports_search_tool = false
    entry.truncation_policy = { mode: 'tokens', limit: 10_000 }
    entry.supports_image_detail_original = false
    entry.experimental_supported_tools = []
    entry.input_modalities = ['text']
    entry.supports_experimental_context = false
    entry.use_responses_lite = false
    entry.supports_reasoning_effort_updates = false
    entry.node_repl_auto_review_required = false
    entry.node_repl_disabled = true
    entry.tool_mode = 'direct'
    entry.multi_agent_version = null
    entry.multi_agent_reasoning_effort = null
    entry.comp_hash = null
    models.push(entry)
  }

  return { models }
}

export interface CodexConfigInput {
  config?: AiConfig
  apiKey?: string | null
  gatewayUrl?: string | null
  catalogPath?: string | null
  chipnet?: boolean
  /** Update only the MCP server table, leaving any provider config intact. */
  mcpOnly?: boolean
}

const MANAGED_TOP_KEYS = [
  'model_provider',
  'model',
  'model_reasoning_effort',
  'model_context_window',
  'model_catalog_json',
]

const MANAGED_TABLES = [
  `model_providers.${CODEX_PROVIDER_ID}`,
  'mcp_servers.paytaca',
]

export function buildCodexConfigToml(
  existing: string,
  input: CodexConfigInput
): string {
  const mcpArgs = input.chipnet ? ['mcp', '--chipnet'] : ['mcp']
  const mcp = [
    '[mcp_servers.paytaca]',
    'command = "paytaca"',
    `args = ${tomlArray(mcpArgs)}`,
  ]

  if (input.mcpOnly) {
    const kept: string[] = []
    let skipTable = false
    for (const line of existing.split(/\r?\n/)) {
      const header = line.trim().match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/)
      if (header) {
        const name = header[1].trim()
        skipTable =
          name === 'mcp_servers.paytaca' || name.startsWith('mcp_servers.paytaca.')
        if (skipTable) continue
      }
      if (skipTable) continue
      kept.push(line)
    }
    return [...kept, '', ...mcp].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  }

  const config = input.config ?? { models: [] }
  const modelId = config.default_model || config.models?.[0]?.id
  const selected = (config.models || []).find((model) => model?.id === modelId)
  const efforts = selected ? reasoningEfforts(selected) : []
  const defaultEffort =
    selected?.reasoning_default_effort && efforts.includes(selected.reasoning_default_effort)
      ? selected.reasoning_default_effort
      : efforts[0] ?? null
  const limits = harnessLimits(selected)

  const topLevel = [`model_provider = ${tomlQuote(CODEX_PROVIDER_ID)}`]
  if (modelId) topLevel.push(`model = ${tomlQuote(modelId)}`)
  if (defaultEffort) topLevel.push(`model_reasoning_effort = ${tomlQuote(defaultEffort)}`)
  topLevel.push(`model_context_window = ${limits.context}`)
  if (input.catalogPath) {
    topLevel.push(`model_catalog_json = ${tomlQuote(input.catalogPath)}`)
  }

  const provider: string[] = []
  if (input.apiKey && input.gatewayUrl) {
    provider.push(
      `[model_providers.${CODEX_PROVIDER_ID}]`,
      'name = "Paytaca AI"',
      `base_url = ${tomlQuote(`${input.gatewayUrl}/v1`)}`,
      'wire_api = "responses"',
      `http_headers = { Authorization = ${tomlQuote(`Bearer ${input.apiKey}`)} }`,
      'request_max_retries = 2',
      'stream_max_retries = 2',
      'stream_idle_timeout_ms = 600000'
    )
  }

  const lines = existing.split(/\r?\n/)
  let firstTable = lines.findIndex((line) =>
    /^\[\[?\s*[^\]]+\s*\]\]?\s*(?:#.*)?$/.test(line.trim())
  )
  if (firstTable < 0) firstTable = lines.length
  const topRegion = lines
    .slice(0, firstTable)
    .filter((line) => {
      const key = line.trim().match(/^([A-Za-z0-9_-]+)\s*=/)
      return !key || !MANAGED_TOP_KEYS.includes(key[1])
    })
  const rest: string[] = []
  let skipTable = false
  for (const line of lines.slice(firstTable)) {
    const header = line.trim().match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/)
    if (header) {
      const name = header[1].trim()
      skipTable = MANAGED_TABLES.some(
        (managed) => name === managed || name.startsWith(`${managed}.`)
      )
      if (skipTable) continue
    }
    if (skipTable) continue
    rest.push(line)
  }

  const head = [...topRegion]
  while (head.length > 0 && head[0].trim() === '') head.shift()
  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop()

  const output = [
    ...head,
    ...topLevel,
    ...(rest.length > 0 ? ['', ...rest] : []),
    ...(provider.length > 0 ? ['', ...provider] : []),
    '',
    ...mcp,
  ]
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function readHarnessApiKey(
  harness: McpClient,
  options: { path?: string } = {}
): HarnessApiKeyInfo {
  const template = buildTemplate(harness, false)
  const target = options.path || template.path
  if (!target) return { path: null, apiKey: null }

  if (harness === 'opencode') {
    return { path: target, apiKey: extractExistingApiKey(readJsonSafe(target)) }
  }

  if (harness === 'claude') {
    const settingsPath = options.path || CLAUDE_SETTINGS_PATH
    return { path: settingsPath, apiKey: extractClaudeApiKey(readJsonSafe(settingsPath)) }
  }

  if (harness === 'codex') {
    return { path: target, apiKey: readCodexApiKey(target) }
  }

  const agentDir = dirname(target)
  if (harness === 'omp') {
    const yamlPath =
      ['models.yml', 'models.yaml']
        .map((name) => join(agentDir, name))
        .find((path) => existsSync(path)) ?? null
    if (yamlPath) {
      try {
        const apiKey = extractOmpProviderApiKey(readFileSync(yamlPath, 'utf-8'), OMP_PROVIDER_ID)
        return { path: yamlPath, apiKey }
      } catch {
        return { path: yamlPath, apiKey: null }
      }
    }
  }

  const modelsPath = join(agentDir, 'models.json')
  if (harness === 'pi') {
    const fromModels = extractPiApiKey(readJsonSafe(modelsPath))
    if (fromModels) return { path: modelsPath, apiKey: fromModels }
    const authPath = join(agentDir, 'auth.json')
    const auth = readJsonSafe(authPath)
    const entry = auth[PI_PROVIDER_ID]
    const key = isPlainObject(entry) && typeof entry.key === 'string' ? entry.key : null
    return { path: key ? authPath : modelsPath, apiKey: key }
  }

  return { path: modelsPath, apiKey: extractPiApiKey(readJsonSafe(modelsPath)) }
}

/**
 * Diagnose a harness file that exists but cannot be parsed. `readJsonSafe`
 * silently treats that as an empty config, which makes `ai doctor` report a
 * missing API key and hide the real (show-stopping) cause.
 */
export function harnessConfigParseError(
  harness: McpClient,
  options: { path?: string } = {}
): string | null {
  if (harness === 'omp') return null
  if (harness === 'codex') {
    return codexConfigParseError(options.path || CODEX_CONFIG_PATH)
  }
  const target = options.path || buildTemplate(harness, false).path
  if (!target) return null
  const paths = [target]
  if (harness === 'pi') {
    const modelsPath = join(dirname(target), 'models.json')
    if (existsSync(modelsPath)) paths.push(modelsPath)
  }
  for (const path of paths) {
    if (!existsSync(path)) continue
    try {
      parseJsonConfig(readFileSync(path, 'utf-8'))
    } catch {
      return `Config at ${path} could not be parsed (invalid JSON).`
    }
  }
  return null
}

export interface HarnessModelReasoning {
  /** Whether the model entry declares reasoning support at all. */
  supported: boolean
  /** Declared effort levels, or null when the format has no per-level list. */
  efforts: string[] | null
}

export interface HarnessReasoningConfig {
  /** True when the format has no per-model entries we can inspect (omp YAML). */
  coarse: boolean
  /** For coarse formats: whether any reasoning directive is present. */
  supportedAll?: boolean
  models: Record<string, HarnessModelReasoning>
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const levels = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0
  )
  return levels.length > 0 ? levels : null
}

/**
 * Read the reasoning capability stored in a harness config, without modifying
 * it. `ai doctor` compares this to the backend catalogue: a config written by
 * a release that predates reasoning support will keep hiding the effort menu
 * until `ai configure` runs again.
 *
 * Returns null for Claude Code (its menu is driven by the gateway) and for
 * unreadable paths.
 */
export function readHarnessReasoningConfig(
  harness: McpClient,
  options: { path?: string } = {}
): HarnessReasoningConfig | null {
  if (harness === 'claude') return null
  const target = options.path || buildTemplate(harness, false).path
  if (!target) return null

  if (harness === 'codex') {
    const info = readCodexConfig(target)
    if (!info.catalogPath) return { coarse: false, models: {} }
    const catalogPath =
      info.catalogPath.startsWith('~')
        ? join(homedir(), info.catalogPath.slice(1))
        : isAbsolute(info.catalogPath)
          ? info.catalogPath
          : join(dirname(target), info.catalogPath)
    const catalog = readJsonSafe(catalogPath)
    const entries = Array.isArray(catalog.models) ? catalog.models : []
    const models: Record<string, HarnessModelReasoning> = {}
    for (const raw of entries) {
      if (!isPlainObject(raw) || typeof raw.slug !== 'string') continue
      const levels = Array.isArray(raw.supported_reasoning_levels)
        ? raw.supported_reasoning_levels
            .map((level) =>
              isPlainObject(level) && typeof level.effort === 'string' ? level.effort : null
            )
            .filter((level): level is string => typeof level === 'string' && level.length > 0)
        : []
      models[raw.slug] = {
        supported: levels.length > 0,
        efforts: levels.length > 0 ? levels : null,
      }
    }
    return { coarse: false, models }
  }

  if (harness === 'opencode') {
    const config = readJsonSafe(target)
    const providers = isPlainObject(config.providers)
      ? config.providers
      : isPlainObject(config.provider)
        ? config.provider
        : null
    const provider = providers ? providers[OPENCODE_PROVIDER_ID] : null
    const modelEntries =
      isPlainObject(provider) && isPlainObject(provider.models) ? provider.models : {}
    const models: Record<string, HarnessModelReasoning> = {}
    for (const [id, raw] of Object.entries(modelEntries)) {
      if (!isPlainObject(raw)) continue
      const capabilities = isPlainObject(raw.capabilities) ? raw.capabilities : null
      const reasoning =
        capabilities && isPlainObject(capabilities.reasoning) ? capabilities.reasoning : null
      if (reasoning && reasoning.supported === true) {
        const levels = stringList(reasoning.effort) ?? []
        if (reasoning.toggle === true && !levels.includes('none')) levels.push('none')
        models[id] = { supported: true, efforts: levels.length > 0 ? levels : null }
      } else {
        models[id] = { supported: raw.reasoning === true, efforts: null }
      }
    }
    return { coarse: false, models }
  }

  const agentDir = dirname(target)

  if (harness === 'omp') {
    const yamlPath =
      ['models.yml', 'models.yaml']
        .map((name) => join(agentDir, name))
        .find((path) => existsSync(path)) ?? null
    if (!yamlPath) return { coarse: true, supportedAll: false, models: {} }
    let yaml = ''
    try {
      yaml = readFileSync(yamlPath, 'utf-8')
    } catch {
      return { coarse: true, supportedAll: false, models: {} }
    }
    return {
      coarse: true,
      supportedAll: /^\s+thinking\s*:/m.test(yaml) || /^\s+reasoning\s*:\s*true\s*$/m.test(yaml),
      models: {},
    }
  }

  const config = readJsonSafe(join(agentDir, 'models.json'))
  const provider = isPlainObject(config.providers) ? config.providers[PI_PROVIDER_ID] : null
  const entries =
    isPlainObject(provider) && Array.isArray(provider.models) ? provider.models : []
  const models: Record<string, HarnessModelReasoning> = {}
  for (const raw of entries) {
    if (!isPlainObject(raw) || typeof raw.id !== 'string') continue
    const thinking = isPlainObject(raw.thinking) ? raw.thinking : null
    const efforts = thinking ? stringList(thinking.efforts) : null
    models[raw.id] = {
      supported: raw.reasoning === true || Boolean(thinking),
      efforts,
    }
  }
  return { coarse: false, models }
}

/**
 * OpenCode major version as configuration sees it: an explicit value if the
 * caller supplied one, otherwise the installed binary, otherwise the config
 * shape. Used by `ai doctor` to know whether stored credentials can shadow keys.
 */
export function readOpencodeMajor(options: { path?: string; version?: number | null } = {}): number {
  const target = options.path || buildTemplate('opencode', false).path
  const existing = target ? readJsonSafe(target) : {}
  return resolveOpencodeMajor(options.version, existing)
}

async function resolveApiKey(
  existingKey: string | null,
  options: ConfigureOptions,
  wallet: NonNullable<ReturnType<typeof loadWalletRef>>,
  backendUrl: string,
  result: ConfigureResult
): Promise<string | null> {
  // An explicit --api-key always wins over whatever is already in the config.
  if (options.apiKey) {
    if (isValidApiKey(options.apiKey)) {
      result.apiKeyProvided = true
      const provided = options.apiKey.trim()
      await warnIfKeyNotForWallet(provided, wallet, backendUrl, result)
      return provided
    }
    result.providerError = 'Invalid API key: expected a Paytaca key like sk-pytc-…'
    return null
  }

  if (existingKey) {
    const identity = await checkApiKeyWalletIdentity(existingKey, wallet.walletHash, { backendUrl })
    if (shouldReprovisionApiKey(identity) && wallet.canSign && wallet.mnemonic) {
      const reason =
        identity === 'invalid'
          ? 'The stored API key is no longer valid'
          : 'The stored API key belongs to a different wallet'
      try {
        const created = await provisionApiKey({
          mnemonic: wallet.mnemonic,
          walletHash: wallet.walletHash,
          backendUrl,
          name: 'paytaca-cli',
        })
        result.apiKeyPrefix = created.keyPrefix
        result.apiKeyReplaced = true
        result.warnings = [
          ...(result.warnings ?? []),
          `${reason}. Replaced it with a key bound to this wallet in the harness config — restart the harness to pick it up.`,
        ]
        return created.key
      } catch (err: any) {
        result.apiKeyReused = true
        result.warnings = [
          ...(result.warnings ?? []),
          `${reason}, and a replacement could not be created (${err?.message || err}). Re-run \`paytaca ai configure\` from your full wallet.`,
        ]
        return existingKey
      }
    }
    if (shouldReprovisionApiKey(identity)) {
      const reason =
        identity === 'invalid'
          ? 'The stored API key is no longer valid'
          : 'The stored API key belongs to a different wallet'
      result.warnings = [
        ...(result.warnings ?? []),
        `${reason}. This read-only wallet cannot mint a replacement — pass --api-key with a key created from the wallet that holds your credits.`,
      ]
    }
    result.apiKeyReused = true
    return existingKey
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

async function warnIfKeyNotForWallet(
  apiKey: string,
  wallet: NonNullable<ReturnType<typeof loadWalletRef>>,
  backendUrl: string,
  result: ConfigureResult
): Promise<void> {
  const identity = await checkApiKeyWalletIdentity(apiKey, wallet.walletHash, { backendUrl })
  if (!shouldReprovisionApiKey(identity)) return
  result.warnings = [
    ...(result.warnings ?? []),
    'The API key you passed does not resolve to this wallet — the harness may see no credits. Re-run `paytaca ai configure` without --api-key to mint one for this wallet.',
  ]
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
  // For claude, `--path` names settings.json; the MCP entry keeps its own
  // fixed location in ~/.claude.json.
  const target =
    harness === 'claude'
      ? template.path
      : options.path || template.path

  const result: ConfigureResult = {
    harness,
    path: harness === 'claude' ? options.path || CLAUDE_SETTINGS_PATH : target,
    format: template.format,
    instructions: template.instructions,
    mcpInstalled: false,
    providerInstalled: false,
    canSign: wallet.canSign,
    apiKeyReused: false,
    apiKeyProvided: false,
    apiKeyReplaced: false,
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
    const opencodeMajor = resolveOpencodeMajor(options.opencodeVersion, existing)
    const opencodeTemplate = buildTemplate(harness, isChipnet, opencodeMajor)

    const apiKey = await resolveApiKey(
      extractExistingApiKey(existing),
      options,
      wallet,
      backendUrl,
      result
    )

    let merged = deepMerge(existing, opencodeTemplate.json as Record<string, unknown>)
    if (config && apiKey) {
      const provider = buildOpencodeProvider(config, backendUrl, apiKey, opencodeMajor)
      const providerKey = opencodeMajor >= 2 ? 'providers' : 'provider'
      merged = deepMerge(merged, { [providerKey]: { [OPENCODE_PROVIDER_ID]: provider } })
      result.models = (config.models || [])
        .filter((m) => m?.id)
        .map((m) => ({ id: m.id, name: m.display_name || m.id }))
      result.providerInstalled = true
    } else if (!result.providerError) {
      result.providerError = configError || 'Unable to load the AI configuration.'
    }

    merged = stripOtherOpencodeShape(merged, opencodeMajor)

    writeJsonFile(target, merged)
    result.mcpInstalled = true

    if (config && apiKey && shouldClearOpencodeCredentials(opencodeMajor)) {
      const cleared = clearStaleOpencodeCredentials(OPENCODE_PROVIDER_ID, apiKey)
      if (cleared.removed > 0) {
        result.warnings = [
          ...(result.warnings ?? []),
          `Removed ${cleared.removed} stale OpenCode credential(s) for ${OPENCODE_PROVIDER_ID} that were shadowing the API key in ${target}. Restart OpenCode if models still fail with "Invalid API key".`,
        ]
      }
    }
  } else if (harness === 'claude') {
    // Claude Code splits its config: MCP servers live in ~/.claude.json while
    // the model and env that point it at the gateway live in settings.json.
    // `--path` targets settings.json; MCP always follows the template path.
    if (!target) throw new Error('No known config file for claude. Use --path.')
    const settingsPath = options.path || CLAUDE_SETTINGS_PATH
    const existingMcp = readJson(target)
    const existingSettings = readJson(settingsPath)

    const apiKey = await resolveApiKey(
      extractClaudeApiKey(existingSettings),
      options,
      wallet,
      backendUrl,
      result
    )

    if (config && apiKey) {
      const port = resolveProxyPort()
      try {
        const gateway = await ensureProxyRunning({ port, backendUrl })
        writeJsonFile(
          settingsPath,
          deepMerge(existingSettings, buildClaudeSettings(config, gateway.url, apiKey))
        )
        result.path = settingsPath
        result.models = (config.models || [])
          .filter((m) => m?.id)
          .map((m) => ({ id: m.id, name: m.display_name || m.id }))
        result.providerInstalled = true
        if (gateway.spawned) {
          result.warnings = [
            ...(result.warnings ?? []),
            `Started the Paytaca Anthropic gateway at ${gateway.url}. Claude Code needs it running for every session — start it with \`paytaca mcp --proxy\` or re-run this command.`,
          ]
        }
      } catch (err: any) {
        result.providerError = err?.message || String(err)
      }
    } else if (!result.providerError) {
      result.providerError = configError || 'Unable to load the AI configuration.'
    }

    writeJsonFile(target, deepMerge(existingMcp, template.json as Record<string, unknown>))
    result.mcpInstalled = true
  } else if (harness === 'codex') {
    if (!target) throw new Error('No known config file for codex. Use --path.')
    const existing = existsSync(target) ? readFileSync(target, 'utf-8') : ''

    const apiKey = await resolveApiKey(
      readCodexApiKey(target),
      options,
      wallet,
      backendUrl,
      result
    )

    if (config && apiKey) {
      const port = resolveProxyPort()
      try {
        const gateway = await ensureProxyRunning({ port, backendUrl })
        const catalogPath = join(dirname(target), CODEX_MODEL_CATALOG_FILE)
        const bundled = readBundledCodexCatalog()
        const catalog = bundled ? buildCodexModelCatalog(config, bundled) : null
        if (catalog) writeJsonFile(catalogPath, catalog)
        writeFileSync(
          target,
          buildCodexConfigToml(existing, {
            config,
            apiKey,
            gatewayUrl: gateway.url,
            catalogPath: catalog ? catalogPath : null,
            chipnet: isChipnet,
          }),
          { encoding: 'utf-8', mode: 0o600 }
        )
        chmodSync(target, 0o600)
        result.path = target
        result.models = (config.models || [])
          .filter((m) => m?.id)
          .map((m) => ({ id: m.id, name: m.display_name || m.id }))
        result.providerInstalled = true
        if (gateway.spawned) {
          result.warnings = [
            ...(result.warnings ?? []),
            `Started the Paytaca gateway at ${gateway.url}. Codex needs it running for every session — start it with \`paytaca mcp --proxy\` or re-run this command.`,
          ]
        }
        if (!catalog) {
          result.warnings = [
            ...(result.warnings ?? []),
            'Could not read the model catalogue bundled with Codex. The provider still works, but Codex will not list Paytaca models in its picker until you update Codex and re-run this command.',
          ]
        }
      } catch (err: any) {
        result.providerError = err?.message || String(err)
      }
    } else if (!result.providerError) {
      result.providerError = configError || 'Unable to load the AI configuration.'
    }

    if (!result.providerInstalled) {
      writeFileSync(
        target,
        buildCodexConfigToml(existing, { mcpOnly: true, chipnet: isChipnet }),
        { encoding: 'utf-8', mode: 0o600 }
      )
      chmodSync(target, 0o600)
    }
    result.path = target
    result.mcpInstalled = true
  } else {
    if (!target) throw new Error(`No known config file for harness "${harness}". Use --path.`)
    const existingMcp = readJson(target)
    writeJsonFile(target, deepMerge(existingMcp, template.json as Record<string, unknown>))
    result.mcpInstalled = true

    ompAgentDir = dirname(target)
    const modelsPath = join(ompAgentDir, 'models.json')
    const existingModels = readJson(modelsPath)

    const ompYamlPath =
      harness === 'omp'
        ? ['models.yml', 'models.yaml']
            .map((name) => join(ompAgentDir as string, name))
            .find((path) => existsSync(path)) ?? null
        : null
    const ompYaml = ompYamlPath ? readFileSync(ompYamlPath, 'utf-8') : null

    apiKeyValue = await resolveApiKey(
      (ompYaml ? extractOmpProviderApiKey(ompYaml, OMP_PROVIDER_ID) : null) ??
        extractPiApiKey(existingModels),
      options,
      wallet,
      backendUrl,
      result
    )
    const apiKey = apiKeyValue

    if (config && apiKey) {
      const provider = buildPiProvider(config, backendUrl, apiKey)
      if (ompYamlPath && ompYaml !== null) {
        writeFileSync(ompYamlPath, upsertOmpProviderYaml(ompYaml, OMP_PROVIDER_ID, provider), {
          encoding: 'utf-8',
          mode: 0o600,
        })
      } else {
        writeJsonFile(modelsPath, deepMerge(existingModels, { providers: { [PI_PROVIDER_ID]: provider } }))
      }
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
    result.paygEnabled = paygEnabled(status)
    result.paygBalanceUsd = paygBalanceUsd(status)
  } catch {
    result.creditsActive = false
  }

  if (harness === 'omp' && ompAgentDir && config && apiKeyValue) {
    syncOmpDefaultModel(ompAgentDir, result.credits, result)
  }

  return result
}
