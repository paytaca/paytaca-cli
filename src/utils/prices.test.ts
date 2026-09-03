/**
 * Tests for the watchtower asset-prices utilities.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchAssetPrices,
  getUsdPerToken,
  getBchUsdPrice,
  tokenAmountToUsd,
  formatUsd,
} from './prices.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(json: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(json),
  }))
}

describe('tokenAmountToUsd', () => {
  it('converts raw base units to USD using the display-token price', () => {
    // 10000 base units, 2 decimals = 100.00 tokens @ $0.02 each
    expect(tokenAmountToUsd(10000, 2, 0.02)).toBeCloseTo(2, 10)
  })

  it('handles zero decimals', () => {
    expect(tokenAmountToUsd(5, 0, 1.5)).toBeCloseTo(7.5, 10)
  })
})

describe('formatUsd', () => {
  it('formats as USD currency', () => {
    expect(formatUsd(2.007)).toBe('$2.01')
  })

  it('returns an em dash for non-finite input', () => {
    expect(formatUsd(Number.NaN)).toBe('—')
  })
})

describe('fetchAssetPrices', () => {
  it('returns the raw prices array', async () => {
    stubFetch({ prices: [{ asset: 'ct/abc', currency: 'USD', price_value: '10' }] })
    const result = await fetchAssetPrices(['ct/abc'])
    expect(result).toHaveLength(1)
    expect(result[0].price_value).toBe('10')
  })

  it('returns [] when the response has no prices', async () => {
    stubFetch({ prices: [] })
    expect(await fetchAssetPrices(['ct/abc'])).toEqual([])
  })
})

describe('getUsdPerToken', () => {
  it('takes the reciprocal of the tokens-per-USD quote', async () => {
    stubFetch({
      prices: [{ asset: 'ct/abc', currency: 'USD', price_value: '50' }],
    })
    expect(await getUsdPerToken('abc')).toBeCloseTo(0.02, 10)
  })

  it('returns null for a token with no market price', async () => {
    stubFetch({ prices: [] })
    expect(await getUsdPerToken('abc')).toBeNull()
  })
})

describe('getBchUsdPrice', () => {
  it('returns the USD-per-BCH quote directly', async () => {
    stubFetch({ prices: [{ asset: 'BCH', currency: 'USD', price_value: '247.8' }] })
    expect(await getBchUsdPrice()).toBeCloseTo(247.8, 10)
  })
})