import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiConfig } from './client.js'
import {
  buildCreditStatusLines,
  buildOpencodeProvider,
  buildPiProvider,
  deepMerge,
  extractExistingApiKey,
  extractOmpDefaultModel,
  extractOmpProviderApiKey,
  extractPiApiKey,
  isValidApiKey,
  OPENCODE_PROVIDER_NPM,
  OPENCODE_PROVIDER_PACKAGE,
  parseJsonConfig,
  parseOpencodeAuthExport,
  parseOpencodeMajor,
  readHarnessApiKey,
  replaceOmpDefaultModel,
  resolveOpencodeMajor,
  serializeOmpProviderYaml,
  shouldClearOpencodeCredentials,
  shouldReprovisionApiKey,
  staleOpencodeCredentialIds,
  upsertOmpProviderYaml,
} from './configure.js'

const CONFIG: AiConfig = {
  models: [
    { id: 'deepseek/deepseek-v4-flash', display_name: 'DeepSeek V4 Flash', price_tiers: [] },
    { id: 'z-ai/glm-5.3-flash', display_name: 'GLM 5.3 Flash', price_tiers: [] },
  ],
  default_model: 'deepseek/deepseek-v4-flash',
}

describe('configure', () => {
  it('deep merges nested config without dropping sibling keys', () => {
    const existing = {
      provider: { other: { name: 'Other' }, 'paytaca-ai': { name: 'old' } },
      mcp: { other: { type: 'local' } },
      theme: 'dark',
    }
    const merged = deepMerge(existing, {
      provider: { 'paytaca-ai': { name: 'new' } },
      mcp: { paytaca: { type: 'local' } },
    })
    expect(merged).toEqual({
      provider: {
        other: { name: 'Other' },
        'paytaca-ai': { name: 'new' },
      },
      mcp: { other: { type: 'local' }, paytaca: { type: 'local' } },
      theme: 'dark',
    })
  })

  it('builds the opencode provider with a model per backend model', () => {
    const provider = buildOpencodeProvider(CONFIG, 'https://api.paytaca.ai', 'sk-pytc-test')
    expect(provider.npm).toBe(OPENCODE_PROVIDER_NPM)
    expect(provider.name).toBe('Paytaca AI')
    expect(provider.options).toEqual({
      baseURL: 'https://api.paytaca.ai/v1',
      apiKey: 'sk-pytc-test',
    })
    expect(Object.keys(provider.models as Record<string, unknown>)).toEqual([
      'deepseek/deepseek-v4-flash',
      'z-ai/glm-5.3-flash',
    ])
  })

  it('reads an existing provider api key for idempotent re-runs', () => {
    expect(
      extractExistingApiKey({
        provider: { 'paytaca-ai': { options: { apiKey: 'sk-pytc-existing' } } },
      })
    ).toBe('sk-pytc-existing')
    expect(extractExistingApiKey({ provider: {} })).toBeNull()
    expect(extractExistingApiKey({})).toBeNull()
    expect(
      extractExistingApiKey({ provider: { 'paytaca-ai': { options: {} } } })
    ).toBeNull()
  })

  it('builds the opencode v2 provider with package and settings keys', () => {
    const provider = buildOpencodeProvider(
      CONFIG,
      'https://api.paytaca.ai',
      'sk-pytc-test',
      2
    )
    expect(provider.package).toBe(OPENCODE_PROVIDER_PACKAGE)
    expect(provider.name).toBe('Paytaca AI')
    expect(provider.npm).toBeUndefined()
    expect(provider.settings).toEqual({
      baseURL: 'https://api.paytaca.ai/v1',
      apiKey: 'sk-pytc-test',
    })
    expect(provider.options).toBeUndefined()
    expect(Object.keys(provider.models as Record<string, unknown>)).toEqual([
      'deepseek/deepseek-v4-flash',
      'z-ai/glm-5.3-flash',
    ])
  })

  it('reads an existing v2 provider api key from settings', () => {
    expect(
      extractExistingApiKey({
        providers: { 'paytaca-ai': { settings: { apiKey: 'sk-pytc-v2' } } },
      })
    ).toBe('sk-pytc-v2')
    expect(
      extractExistingApiKey({
        providers: { 'paytaca-ai': { settings: {} } },
      })
    ).toBeNull()
    expect(
      extractExistingApiKey({
        provider: { 'paytaca-ai': { options: { apiKey: 'sk-pytc-v1' } } },
        providers: { 'paytaca-ai': { settings: { apiKey: 'sk-pytc-v2' } } },
      })
    ).toBe('sk-pytc-v1')
  })

  it('parses the opencode major version', () => {
    expect(parseOpencodeMajor('1.18.35\n')).toBe(1)
    expect(parseOpencodeMajor('2.0.0')).toBe(2)
    expect(parseOpencodeMajor('opencode v2.0.0')).toBe(2)
    expect(parseOpencodeMajor('no version here')).toBeNull()
  })

  it('falls back to config shape when the opencode version is unknown', () => {
    expect(resolveOpencodeMajor(2, { provider: {} })).toBe(2)
    expect(resolveOpencodeMajor(1, { providers: {} })).toBe(1)
    expect(resolveOpencodeMajor(null, { providers: {} }, null)).toBe(2)
    expect(resolveOpencodeMajor(null, { provider: {} }, null)).toBe(1)
    expect(resolveOpencodeMajor(null, { providers: {} }, 1)).toBe(1)
  })

  it('never clears stored credentials on opencode v1', () => {
    expect(shouldClearOpencodeCredentials(1)).toBe(false)
    expect(shouldClearOpencodeCredentials(0)).toBe(false)
    expect(shouldClearOpencodeCredentials(2)).toBe(true)
    expect(shouldClearOpencodeCredentials(3)).toBe(true)
  })

  it('replaces a stored key only for a mismatch or an invalid key', () => {
    expect(shouldReprovisionApiKey('mismatch')).toBe(true)
    expect(shouldReprovisionApiKey('invalid')).toBe(true)
    expect(shouldReprovisionApiKey('match')).toBe(false)
    expect(shouldReprovisionApiKey('unknown')).toBe(false)
  })

  it('reads the configured opencode api key without writing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paytaca-doctor-'))
    try {
      const configPath = join(dir, 'opencode.json')
      writeFileSync(
        configPath,
        JSON.stringify({
          providers: { 'paytaca-ai': { settings: { apiKey: 'sk-pytc-doctor' } } },
        })
      )
      expect(readHarnessApiKey('opencode', { path: configPath })).toEqual({
        path: configPath,
        apiKey: 'sk-pytc-doctor',
      })

      const missing = join(dir, 'missing.json')
      expect(readHarnessApiKey('opencode', { path: missing })).toEqual({
        path: missing,
        apiKey: null,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads the configured pi api key from models.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paytaca-doctor-'))
    try {
      writeFileSync(
        join(dir, 'models.json'),
        JSON.stringify({ providers: { 'paytaca-ai': { apiKey: 'sk-pytc-pi' } } })
      )
      expect(readHarnessApiKey('pi', { path: join(dir, 'mcp.json') })).toEqual({
        path: join(dir, 'models.json'),
        apiKey: 'sk-pytc-pi',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds the pi provider with a model per backend model', () => {
    const provider = buildPiProvider(CONFIG, 'https://api.paytaca.ai', 'sk-pytc-test')
    expect(provider.baseUrl).toBe('https://api.paytaca.ai/v1')
    expect(provider.apiKey).toBe('sk-pytc-test')
    expect(provider.api).toBe('openai-completions')
    expect(provider.models).toEqual([
      {
        id: 'deepseek/deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: 'z-ai/glm-5.3-flash',
        name: 'GLM 5.3 Flash',
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ])
  })

  it('reads an existing pi provider api key for idempotent re-runs', () => {
    expect(
      extractPiApiKey({ providers: { 'paytaca-ai': { apiKey: 'sk-pytc-existing' } } })
    ).toBe('sk-pytc-existing')
    expect(extractPiApiKey({ providers: {} })).toBeNull()
    expect(extractPiApiKey({})).toBeNull()
    expect(extractPiApiKey({ providers: { 'paytaca-ai': {} } })).toBeNull()
  })

  it('extracts the omp saved default model from config.yml', () => {
    const yaml = 'setupVersion: 2\nmodelRoles:\n  default: paytaca-ai/z-ai/glm-5.3\n'
    expect(extractOmpDefaultModel(yaml)).toBe('paytaca-ai/z-ai/glm-5.3')
    expect(extractOmpDefaultModel('modelRoles:\n  default: anthropic/claude-x\n')).toBe(
      'anthropic/claude-x'
    )
    expect(extractOmpDefaultModel('modelRoles: {}\n')).toBeNull()
    expect(extractOmpDefaultModel('')).toBeNull()
    expect(extractOmpDefaultModel('modelRoles:\n  smol: paytaca-ai/z-ai/glm-5.3-flash\n')).toBeNull()
  })

  it('replaces only the omp modelRoles default line', () => {
    const yaml = 'setupVersion: 2\nmodelRoles:\n  default: paytaca-ai/z-ai/glm-5.3\n'
    expect(replaceOmpDefaultModel(yaml, 'paytaca-ai/z-ai/glm-5.3-flash')).toBe(
      'setupVersion: 2\nmodelRoles:\n  default: paytaca-ai/z-ai/glm-5.3-flash\n'
    )
    expect(replaceOmpDefaultModel('other: 1\n', 'paytaca-ai/x')).toBeNull()
  })

  it('ignores unresolved environment and command api key references', () => {
    const withKey = (apiKey: string) =>
      extractPiApiKey({ providers: { 'paytaca-ai': { apiKey } } })
    delete process.env.PAYTACA_TEST_KEY
    expect(withKey('$PAYTACA_TEST_KEY')).toBeNull()
    expect(withKey('${PAYTACA_TEST_KEY}')).toBeNull()
    process.env.PAYTACA_TEST_KEY = 'sk-pytc-from-env'
    expect(withKey('$PAYTACA_TEST_KEY')).toBe('$PAYTACA_TEST_KEY')
    delete process.env.PAYTACA_TEST_KEY
    expect(withKey('!paytaca ai api-key show')).toBeNull()
  })

  it('validates API keys supplied for read-only wallets', () => {
    expect(isValidApiKey('sk-pytc-0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(true)
    expect(isValidApiKey('  sk-pytc-0123456789abcdef  ')).toBe(true)
    expect(isValidApiKey('sk-pytc-')).toBe(false)
    expect(isValidApiKey('sk-other-0123456789abcdef')).toBe(false)
    expect(isValidApiKey('')).toBe(false)
  })

  it('parses opencode JSONC configs with comments and trailing commas', () => {
    const raw = `{
      // the schema, with a URL that must not be treated as a comment
      "$schema": "https://opencode.ai/config.json",
      "plugin": [
        "opencode-agent-memory",
        "@tarquinen/opencode-dcp@latest",
      ],
      /* block comment */
      "lsp": true,
    }`
    expect(parseJsonConfig(raw)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      plugin: ['opencode-agent-memory', '@tarquinen/opencode-dcp@latest'],
      lsp: true,
    })
    expect(parseJsonConfig('')).toEqual({})
    expect(parseJsonConfig('{ "a": 1 }')).toEqual({ a: 1 })
  })

  it('serializes an omp provider block as yaml', () => {
    const provider = buildPiProvider(CONFIG, 'https://api.paytaca.ai', 'sk-pytc-test')
    expect(serializeOmpProviderYaml('paytaca-ai', provider)).toBe(
      [
        '  paytaca-ai:',
        '    baseUrl: https://api.paytaca.ai/v1',
        '    apiKey: sk-pytc-test',
        '    api: openai-completions',
        '    models:',
        '      - id: deepseek/deepseek-v4-flash',
        '        name: DeepSeek V4 Flash',
        '        contextWindow: 128000',
        '        maxTokens: 8192',
        '      - id: z-ai/glm-5.3-flash',
        '        name: GLM 5.3 Flash',
        '        contextWindow: 128000',
        '        maxTokens: 8192',
      ].join('\n')
    )
  })

  it('replaces an existing omp provider block in-place', () => {
    const existing = [
      'providers:',
      '  paytaca-ai:',
      '    baseUrl: https://old.example/v1',
      '    apiKey: sk-pytc-old',
      '    api: openai-completions',
      '    models:',
      '      - id: old/model',
      '        name: Old',
      '        contextWindow: 1',
      '        maxTokens: 1',
      '  other:',
      '    baseUrl: https://other.example/v1',
      '',
    ].join('\n')
    const provider = { baseUrl: 'https://api.paytaca.ai/v1', apiKey: 'sk-pytc-new', api: 'openai-completions', models: [{ id: 'z-ai/glm-5.3', name: 'GLM 5.3', contextWindow: 128000, maxTokens: 8192 }] }
    const updated = upsertOmpProviderYaml(existing, 'paytaca-ai', provider)
    expect(updated).toContain('    apiKey: sk-pytc-new')
    expect(updated).not.toContain('sk-pytc-old')
    expect(updated).toContain('  other:')
    expect(updated).toContain('    baseUrl: https://other.example/v1')
    expect(upsertOmpProviderYaml(updated, 'paytaca-ai', provider)).toBe(updated)
  })

  it('adds an omp provider block when missing', () => {
    const existing = 'providers:\n  other:\n    baseUrl: https://other.example/v1\n'
    const updated = upsertOmpProviderYaml(existing, 'paytaca-ai', {
      baseUrl: 'https://api.paytaca.ai/v1',
      apiKey: 'sk-pytc-new',
      api: 'openai-completions',
      models: [],
    })
    expect(updated).toBe(
      [
        'providers:',
        '  paytaca-ai:',
        '    baseUrl: https://api.paytaca.ai/v1',
        '    apiKey: sk-pytc-new',
        '    api: openai-completions',
        '  other:',
        '    baseUrl: https://other.example/v1',
        '',
      ].join('\n')
    )
  })

  it('creates a providers section when the omp yaml is empty', () => {
    const updated = upsertOmpProviderYaml('', 'paytaca-ai', { apiKey: 'sk-pytc-new' })
    expect(updated).toBe('providers:\n  paytaca-ai:\n    apiKey: sk-pytc-new\n')
  })

  it('extracts the paytaca api key from omp yaml', () => {
    const yaml = [
      'providers:',
      '  paytaca-ai:',
      '    baseUrl: https://api.paytaca.ai/v1',
      '    apiKey: sk-pytc-from-yaml',
      '    api: openai-completions',
      '  other:',
      '    apiKey: sk-other',
      '',
    ].join('\n')
    expect(extractOmpProviderApiKey(yaml)).toBe('sk-pytc-from-yaml')
    expect(extractOmpProviderApiKey('providers:\n  other:\n    apiKey: sk-other\n')).toBeNull()
    expect(extractOmpProviderApiKey('')).toBeNull()
  })

  it('parses opencode auth export credentials without leaking unrelated fields', () => {
    const raw = JSON.stringify([
      {
        id: 'cred_1',
        integrationID: 'paytaca-ai',
        label: 'API key',
        active: true,
        value: { type: 'key', key: 'sk-paytaca-wallet-auth' },
      },
      { id: 'cred_2', integrationID: 'gmi', value: { type: 'key', key: 'eyJ…' } },
      { id: 'cred_3', integrationID: 'paytaca-ai', value: { type: 'oauth' } },
      { integrationID: 'missing-id' },
      'not-an-object',
    ])
    expect(parseOpencodeAuthExport(raw)).toEqual([
      { id: 'cred_1', integrationID: 'paytaca-ai', key: 'sk-paytaca-wallet-auth' },
      { id: 'cred_2', integrationID: 'gmi', key: 'eyJ…' },
      { id: 'cred_3', integrationID: 'paytaca-ai', key: undefined },
    ])
    expect(parseOpencodeAuthExport('not json')).toEqual([])
    expect(parseOpencodeAuthExport('{}')).toEqual([])
    expect(parseOpencodeAuthExport('[]')).toEqual([])
  })

  it('flags only stale paytaca credentials that differ from the configured key', () => {
    const stored = parseOpencodeAuthExport(
      JSON.stringify([
        { id: 'cred_placeholder', integrationID: 'paytaca-ai', value: { type: 'key', key: 'sk-paytaca-wallet-auth' } },
        { id: 'cred_matching', integrationID: 'paytaca-ai', value: { type: 'key', key: 'sk-pytc-current' } },
        { id: 'cred_noauth', integrationID: 'paytaca-ai', value: { type: 'oauth' } },
        { id: 'cred_other', integrationID: 'gmi', value: { type: 'key', key: 'sk-paytaca-wallet-auth' } },
      ])
    )
    expect(staleOpencodeCredentialIds(stored, 'paytaca-ai', 'sk-pytc-current')).toEqual([
      'cred_placeholder',
    ])
    expect(staleOpencodeCredentialIds(stored, 'gmi', 'sk-pytc-current')).toEqual([
      'cred_other',
    ])
    expect(staleOpencodeCredentialIds([], 'paytaca-ai', 'sk-pytc-current')).toEqual([])
  })
})

describe('buildCreditStatusLines', () => {
  const base = {
    creditsActive: false,
    paygEnabled: true,
    paygBalanceUsd: 0,
    planSuggestion: {
      modelId: 'xiaomi/mimo-v2.6-flash',
      displayName: 'MiMo V2.6 Flash',
      minutes: 30,
      priceSats: 1000,
    },
    canSign: true,
  }

  it('reports a funded pay-as-you-go balance as usable', () => {
    const lines = buildCreditStatusLines({ ...base, paygBalanceUsd: 1.32 })
    expect(lines[0]).toEqual({
      tone: 'success',
      text: 'Pay-as-you-go balance available — ready to use.',
    })
    expect(lines[1].text).toContain('$1.32')
  })

  it('treats time credits and pay-as-you-go as independent ways to pay', () => {
    const lines = buildCreditStatusLines({
      ...base,
      creditsActive: true,
      paygBalanceUsd: 0.5,
    })
    expect(lines[0].text).toBe('AI credits active — ready to use.')
    expect(lines[1].text).toContain('$0.50')
  })

  it('offers both a time plan and pay-as-you-go when nothing is funded', () => {
    const lines = buildCreditStatusLines(base)
    expect(lines[0]).toEqual({
      tone: 'warning',
      text: 'No active AI credits or pay-as-you-go balance.',
    })
    const text = lines.map((line) => line.text).join('\n')
    expect(text).toContain('paytaca ai purchase --model xiaomi/mimo-v2.6-flash --minutes 30')
    expect(text).toContain('paytaca ai topup')
  })

  it('ignores a disabled or dust pay-as-you-go balance', () => {
    const disabled = buildCreditStatusLines({ ...base, paygEnabled: false, paygBalanceUsd: 5 })
    expect(disabled[0].tone).toBe('warning')

    const dust = buildCreditStatusLines({ ...base, paygBalanceUsd: 0.0001 })
    expect(dust[0].tone).toBe('warning')
  })

  it('points a read-only wallet at the full wallet for funding', () => {
    const lines = buildCreditStatusLines({ ...base, canSign: false })
    expect(lines.map((l) => l.text).join('\n')).toContain('Fund from your full wallet:')
  })
})
