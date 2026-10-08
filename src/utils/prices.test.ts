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
  formatBch,
  formatCostUsd,
  resolveSpendCost,
  formatSpendCost,
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
  it('formats as USD', () => {
    expect(formatUsd(2.007)).toBe('2.01 USD')
  })

  it('returns an em dash for non-finite input', () => {
    expect(formatUsd(Number.NaN)).toBe('—')
  })
})

describe('formatBch', () => {
  it('renders sats as an 8-decimal BCH amount', () => {
    expect(formatBch(12345)).toBe('0.00012345 BCH')
  })

  it('handles whole BCH amounts', () => {
    expect(formatBch(100000000)).toBe('1.00000000 BCH')
  })
})

describe('formatCostUsd', () => {
  it('formats sub-dollar amounts with the usual two decimals', () => {
    expect(formatCostUsd(0.5)).toBe('$0.50')
  })

  it('keeps precision for sub-cent amounts', () => {
    expect(formatCostUsd(0.012)).toBe('$0.012')
    expect(formatCostUsd(0.0004)).toBe('$0.0004')
  })

  it('returns an em dash for non-finite input', () => {
    expect(formatCostUsd(Number.NaN)).toBe('—')
  })
})

describe('resolveSpendCost', () => {
  it('uses the backend USD quote without hitting the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const cost = await resolveSpendCost(12345, 0.25, false)
    expect(cost.usd).toBe(0.25)
    expect(cost.bch).toBe('0.00012345 BCH')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to the live BCH/USD rate when no USD quote is given', async () => {
    stubFetch({ prices: [{ asset: 'BCH', currency: 'USD', price_value: '50000' }] })
    const cost = await resolveSpendCost(100000, undefined, false)
    expect(cost.usd).toBeCloseTo(50, 10)
  })

  it('leaves USD null when the price lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const cost = await resolveSpendCost(100000, undefined, false)
    expect(cost.usd).toBeNull()
  })
})

describe('formatSpendCost', () => {
  it('shows USD and BCH when a USD quote is available', () => {
    expect(formatSpendCost({ amountSats: 12345, usd: 0.5, bch: '0.00012345 BCH' })).toBe(
      '$0.50 (0.00012345 BCH)'
    )
  })

  it('shows BCH only when USD is unavailable', () => {
    expect(formatSpendCost({ amountSats: 12345, usd: null, bch: '0.00012345 BCH' })).toBe(
      '0.00012345 BCH'
    )
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