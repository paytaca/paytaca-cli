/**
 * Harness configuration: writes the MCP server entry and the Paytaca AI
 * provider (models + API key) — the opencode provider block or the Pi
 * models.json — so AI models are usable right after `paytaca ai configure`.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CLIENTS, buildTemplate, type ClientTemplate, type McpClient } from '../commands/mcp.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getConfig, getWalletStatus, type AiConfig } from './client.js'
import { resolveBackendUrl } from './config.js'
import { hasActiveCredits, summarizeAllCredits, type CreditsSummary } from './credits.js'
import { checkApiKeyWalletIdentity, type KeyIdentity } from './identity.js'
import { selectModel, selectTier } from './models.js'
import { provisionApiKey } from './oauth.js'

export const OPENCODE_PROVIDER_ID = 'paytaca-ai'
export const PI_PROVIDER_ID = 'paytaca-ai'
export const OMP_PROVIDER_ID = 'paytaca-ai'
export const OPENCODE_PROVIDER_NPM = '@ai-sdk/openai-compatible'
export const OPENCODE_PROVIDER_PACKAGE = '@opencode/ai/providers/openai-compatible'
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
  apiKeyReplaced?: boolean
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

export function buildOpencodeProvider(
  config: AiConfig,
  backendUrl: string,
  apiKey: string,
  opencodeMajor: number = 1
): Record<string, unknown> {
  const models: Record<string, unknown> = {}
  for (const model of config.models || []) {
    if (!model?.id) continue
    models[model.id] = {
      name: model.display_name || model.id,
      limit: { context: DEFAULT_MODEL_CONTEXT, output: DEFAULT_MODEL_OUTPUT },
    }
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

export function serializeOmpProviderYaml(
  providerId: string,
  provider: Record<string, unknown>,
  indent = '  '
): string {
  const inner = indent + '  '
  const out: string[] = [`${indent}${providerId}:`]
  const models = Array.isArray(provider.models) ? provider.models : []
  for (const [key, value] of Object.entries(provider)) {
    if (key === 'models') continue
    out.push(`${inner}${key}: ${yamlScalar(value)}`)
  }
  if (models.length > 0) {
    out.push(`${inner}models:`)
    const itemIndent = inner + '  '
    for (const model of models) {
      if (!isPlainObject(model)) continue
      let first = true
      for (const [key, value] of Object.entries(model)) {
        out.push(`${first ? `${itemIndent}- ` : `${itemIndent}  `}${key}: ${yamlScalar(value)}`)
        first = false
      }
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
  } catch {
    result.creditsActive = false
  }

  if (harness === 'omp' && ompAgentDir && config && apiKeyValue) {
    syncOmpDefaultModel(ompAgentDir, result.credits, result)
  }

  return result
}
