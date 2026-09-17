import { describe, it, expect } from 'vitest'
import type { AiConfig } from './client.js'
import {
  buildOpencodeProvider,
  buildPiProvider,
  deepMerge,
  extractExistingApiKey,
  extractPiApiKey,
  isValidApiKey,
  OPENCODE_PROVIDER_NPM,
  parseJsonConfig,
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
})
