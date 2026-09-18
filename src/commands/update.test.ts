import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  NPM_PACKAGE,
  buildNpmInstallArgs,
  compareVersions,
  fetchLatestVersion,
  isOutdated,
  resolveRegistryUrl,
} from './update.js'

describe('compareVersions', () => {
  it('treats identical versions as equal', () => {
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('compares patch, minor, and major segments', () => {
    expect(compareVersions('0.7.0', '0.7.1')).toBe(-1)
    expect(compareVersions('0.7.1', '0.7.0')).toBe(1)
    expect(compareVersions('0.7.0', '0.8.0')).toBe(-1)
    expect(compareVersions('0.8.0', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
  })

  it('compares numerically, not lexically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('2.0.19', '2.0.100')).toBe(-1)
  })

  it('strips a leading v prefix', () => {
    expect(compareVersions('v0.7.0', '0.8.0')).toBe(-1)
  })

  it('ranks a release above its prereleases', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBe(1)
  })

  it('compares prerelease identifiers', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })
})

describe('isOutdated', () => {
  it('is true when current is behind latest', () => {
    expect(isOutdated('0.7.0', '0.8.0')).toBe(true)
    expect(isOutdated('0.7.0', '0.7.1')).toBe(true)
  })

  it('is false when current matches or exceeds latest', () => {
    expect(isOutdated('0.7.0', '0.7.0')).toBe(false)
    expect(isOutdated('0.8.0', '0.7.0')).toBe(false)
  })
})

describe('resolveRegistryUrl', () => {
  afterEach(() => {
    delete process.env.PAYTACA_NPM_REGISTRY
  })

  it('defaults to the public npm registry', () => {
    expect(resolveRegistryUrl()).toBe('https://registry.npmjs.org')
  })

  it('prefers an explicit override and trims trailing slashes', () => {
    expect(resolveRegistryUrl('https://registry.example.com///')).toBe(
      'https://registry.example.com'
    )
  })

  it('uses PAYTACA_NPM_REGISTRY when no explicit override is given', () => {
    process.env.PAYTACA_NPM_REGISTRY = 'https://registry.example.com'
    expect(resolveRegistryUrl()).toBe('https://registry.example.com')
  })

  it('rejects non-http base URLs', () => {
    expect(() => resolveRegistryUrl('ftp://registry.example.com')).toThrow(
      /Invalid npm registry URL/
    )
  })
})

describe('buildNpmInstallArgs', () => {
  it('installs the package globally with a fixed latest spec', () => {
    expect(buildNpmInstallArgs()).toEqual(['install', '-g', `${NPM_PACKAGE}@latest`])
  })
})

describe('fetchLatestVersion', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(body), { status }) as Response
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('returns the version from the registry', async () => {
    const fetchMock = mockFetch(200, { name: NPM_PACKAGE, version: '1.2.3' })
    await expect(fetchLatestVersion()).resolves.toBe('1.2.3')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/paytaca-cli/latest',
      expect.objectContaining({ signal: expect.anything() })
    )
  })

  it('honors a registry override', async () => {
    const fetchMock = mockFetch(200, { version: '1.0.0' })
    await fetchLatestVersion({ registryUrl: 'https://registry.example.com' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/paytaca-cli/latest',
      expect.anything()
    )
  })

  it('rejects on non-2xx responses', async () => {
    mockFetch(404, { error: 'not found' })
    await expect(fetchLatestVersion()).rejects.toThrow(/npm registry returned 404/)
  })

  it('rejects when the version field is missing or malformed', async () => {
    mockFetch(200, { name: NPM_PACKAGE })
    await expect(fetchLatestVersion()).rejects.toThrow(/Unexpected registry response/)

    mockFetch(200, { version: 'not-a-version' })
    await expect(fetchLatestVersion()).rejects.toThrow(/Unexpected registry response/)
  })
})
