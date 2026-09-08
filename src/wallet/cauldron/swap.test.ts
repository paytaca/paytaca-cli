import { afterEach, describe, it, expect, vi } from 'vitest'
import type { TradeResult } from '@cashlab/cauldron'
import { computePlatformFee, formatQuote, PLATFORM_FEE_DUST_LIMIT } from './swap.js'
import { fetchCauldronFee } from './api.js'

const FEE_ADDRESS = 'bitcoincash:qp9szr5k40z88m5jhmpytqt8pq5zfz0yvcs7q5lef7'

function fakeTradeResult(summary: {
  supply: bigint
  demand: bigint
  trade_fee: bigint
}): TradeResult {
  return {
    entries: [],
    summary: { ...summary, rate: 0n },
  } as unknown as TradeResult
}

const feeConfig = {
  address: FEE_ADDRESS,
  feeRateBps: 30,
  maxUsd: 1,
}

describe('computePlatformFee', () => {
  it('charges 0.3% of (demand - trade_fee) on sells', () => {
    // 999_000 sats * 30/10000 = 2_997 sats; cap at $500/BCH = 200_000 sats
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 500_000n, demand: 1_000_000n, trade_fee: 1_000n }),
      isBuyingToken: false,
      feeConfig,
      bchUsdPrice: 500,
    })
    expect(fee).toEqual({ to: FEE_ADDRESS, amount: 2_997n })
  })

  it('charges 0.3% of (supply - trade_fee) on buys', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 2_000_000n, demand: 1_000_000n, trade_fee: 2_000n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 500,
    })
    // 1_998_000 * 30/10000 = 5_994
    expect(fee?.amount).toBe(5_994n)
  })

  it('caps the fee at max_usd worth of BCH at the current price', () => {
    // 4 BCH trade -> 0.3% = 1_200_000 sats; $1 at $100/BCH = 1_000_000 sats
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 400_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 100,
    })
    expect(fee?.amount).toBe(1_000_000n)
  })

  it('does not cap when 0.3% is below the cap', () => {
    // 1 BCH trade -> 0.3% = 300_000 sats < cap 1_000_000 sats
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 100,
    })
    expect(fee?.amount).toBe(300_000n)
  })

  it('does not charge below the dust limit', () => {
    // 100_000 sats * 1bp/10000 = 10 sats < 546 -> no fee at all
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig: { ...feeConfig, feeRateBps: 1 },
      bchUsdPrice: 100,
    })
    expect(fee).toBeNull()
  })

  it('returns null when no fee address is configured', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig: { ...feeConfig, address: null },
      bchUsdPrice: 100,
    })
    expect(fee).toBeNull()
  })

  it('returns null when the BCH price is unavailable (no fee on price failure)', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: null,
    })
    expect(fee).toBeNull()
  })

  it('returns null for non-positive BCH prices', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 0,
    })
    expect(fee).toBeNull()
  })

  it('returns null when a tiny price makes the cap itself dust', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 100_000_000n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 1_000_000_000,
    })
    // cap = floor(1/1e9 * 1e8) = 0 sats -> no fee
    expect(fee).toBeNull()
  })

  it('treats a zero or negative trade size as no fee', () => {
    const fee = computePlatformFee({
      tradeResult: fakeTradeResult({ supply: 0n, demand: 1n, trade_fee: 0n }),
      isBuyingToken: true,
      feeConfig,
      bchUsdPrice: 100,
    })
    expect(fee).toBeNull()
  })

  it('exposes the dust limit constant as 546 sats', () => {
    expect(PLATFORM_FEE_DUST_LIMIT).toBe(546n)
  })
})

describe('formatQuote', () => {
  const tokenData = {
    token_id: 'abc',
    display_name: 'Test Token',
    display_symbol: 'TT',
    price_now: 1,
    price_now_usd: 1,
    tvl_sats: 1,
    bcmr: {
      name: 'Test Token',
      description: '',
      token: { category: 'abc', decimals: 2, symbol: 'TT' },
    },
  } as any

  function quote(overrides: any = {}) {
    return {
      tokenId: 'abc',
      tokenData,
      direction: 'sell',
      isBuyingToken: false,
      pools: [],
      tradeResult: fakeTradeResult({ supply: 500_000n, demand: 1_000_000n, trade_fee: 1_000n }),
      rate: '2.0',
      tokenAmount: 500_000n,
      bchAmount: 1_000_000n,
      tradeFee: 1_000n,
      ...overrides,
    }
  }

  it('lists the platform fee line when a fee is applied', () => {
    const text = formatQuote(quote({
      platformFee: { to: FEE_ADDRESS, amount: 2_997n },
      platformFeeRateBps: 30,
    }))
    expect(text).toContain('Platform fee (0.3%): ~0.00002997 BCH')
    expect(text).toContain('Trade fee: ~0.00001000 BCH')
  })

  it('marks capped fees and omits the line entirely when no fee', () => {
    const capped = formatQuote(quote({
      platformFee: { to: FEE_ADDRESS, amount: 2_000n },
      platformFeeRateBps: 30,
    }))
    expect(capped).toContain('Platform fee (0.3%, capped)')

    const noFee = formatQuote(quote())
    expect(noFee).not.toContain('Platform fee')
  })
})

describe('fetchCauldronFee', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the watchtower response and defaults missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ address: FEE_ADDRESS, fee_rate_bps: 30, max_usd: '1.00' }), { status: 200 })
    ))
    const config = await fetchCauldronFee()
    expect(config).toEqual({ address: FEE_ADDRESS, feeRateBps: 30, maxUsd: 1 })
  })

  it('maps an empty address to null (feature disabled)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ address: '' }), { status: 200 })
    ))
    const config = await fetchCauldronFee()
    expect(config.address).toBeNull()
    expect(config.feeRateBps).toBe(30)
    expect(config.maxUsd).toBe(1)
  })

  it('throws a CauldronApiError on http failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(fetchCauldronFee()).rejects.toThrow('cauldron-fee request failed (500')
  })
})
