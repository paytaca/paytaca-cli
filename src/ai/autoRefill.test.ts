import { describe, it, expect } from 'vitest'
import type { AutoRefillState } from './autoRefill.js'
import {
  autoRefillCanBuy,
  remainingBudget,
  autoRefillTick,
  AUTO_REFILL_STALE_MS,
  type RefillBuyOptions,
  type RefillTickDeps,
} from './autoRefill.js'

function state(overrides: Partial<AutoRefillState> = {}): AutoRefillState {
  return {
    enabled: true,
    model: 'z-ai/glm-5.3-flash',
    minutes: 15,
    maxMinutes: 60,
    spentMinutes: 0,
    paymentMethod: 'bch',
    ...overrides,
  }
}

describe('remainingBudget', () => {
  it('is maxMinutes minus spent', () => {
    expect(remainingBudget(state({ spentMinutes: 30 }))).toBe(30)
  })

  it('never goes negative', () => {
    expect(remainingBudget(state({ spentMinutes: 90 }))).toBe(0)
  })

  it('is null without state or maxMinutes', () => {
    expect(remainingBudget(null)).toBeNull()
    expect(remainingBudget({ enabled: true })).toBeNull()
  })
})

describe('autoRefillCanBuy', () => {
  it('allows a purchase within budget', () => {
    expect(autoRefillCanBuy(state(), 'z-ai/glm-5.3-flash', 15)).toEqual({
      canBuy: true,
    })
  })

  it('refuses when disabled', () => {
    const result = autoRefillCanBuy(state({ enabled: false }), 'z-ai/glm-5.3-flash', 15)
    expect(result.canBuy).toBe(false)
    expect(result.reason).toMatch(/not enabled/i)
  })

  it('refuses another model', () => {
    const result = autoRefillCanBuy(state(), 'deepseek/deepseek-v4-pro', 15)
    expect(result.canBuy).toBe(false)
    expect(result.reason).toMatch(/armed for/i)
  })

  it('refuses another plan duration', () => {
    expect(autoRefillCanBuy(state(), 'z-ai/glm-5.3-flash', 30).canBuy).toBe(false)
  })

  it('refuses when the budget is exhausted', () => {
    const result = autoRefillCanBuy(
      state({ spentMinutes: 60 }),
      'z-ai/glm-5.3-flash',
      15
    )
    expect(result.canBuy).toBe(false)
    expect(result.reason).toMatch(/budget exhausted/i)
  })

  it('refuses null state', () => {
    expect(autoRefillCanBuy(null, 'z-ai/glm-5.3-flash', 15).canBuy).toBe(false)
  })
})

describe('autoRefillTick', () => {
  const NOW = Date.parse('2026-09-19T12:00:00.000Z')

  function harness(
    initial: AutoRefillState | null,
    cfg: {
      active?: boolean
      buyResult?: { success: boolean; paid?: boolean; error?: string }
    } = {}
  ) {
    let stored = initial
    const buys: RefillBuyOptions[] = []
    const deps: RefillTickDeps = {
      readState: () => stored,
      writeState: (s) => {
        stored = s
      },
      now: () => NOW,
      hasActiveCredits: async () => cfg.active ?? false,
      buy: async (o) => {
        buys.push(o)
        return cfg.buyResult ?? { success: true, paid: true }
      },
    }
    return { deps, buys, current: () => stored }
  }

  it('does nothing when not armed', async () => {
    const h = harness(null)
    expect(await autoRefillTick(h.deps)).toEqual({ action: 'idle' })
    expect(h.buys).toHaveLength(0)
  })

  it('waits while credits are active', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }), {
      active: true,
    })
    expect(await autoRefillTick(h.deps)).toEqual({ action: 'idle' })
    expect(h.buys).toHaveLength(0)
  })

  it('buys the armed plan when credits run out', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }))
    const result = await autoRefillTick(h.deps)
    expect(h.buys).toEqual([
      { model: 'z-ai/glm-5.3-flash', minutes: 15, paymentMethod: 'bch' },
    ])
    expect(result).toMatchObject({ action: 'refilled' })
    expect(h.current()).toMatchObject({
      spentMinutes: 15,
      lastRefillAt: new Date(NOW).toISOString(),
      enabled: true,
    })
  })

  it('disarms after the last affordable refill', async () => {
    const h = harness(
      state({ maxMinutes: 15, startedAt: new Date(NOW).toISOString() })
    )
    expect((await autoRefillTick(h.deps)).action).toBe('refilled')
    expect(h.current()?.enabled).toBe(false)
  })

  it('disarms when the budget is already exhausted', async () => {
    const h = harness(
      state({
        maxMinutes: 15,
        spentMinutes: 15,
        startedAt: new Date(NOW).toISOString(),
      })
    )
    expect(await autoRefillTick(h.deps)).toMatchObject({
      action: 'disarmed',
      reason: 'budget exhausted',
    })
    expect(h.buys).toHaveLength(0)
  })

  it('disarms when the purchase fails', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }), {
      buyResult: { success: false, paid: false, error: 'Insufficient balance' },
    })
    expect(await autoRefillTick(h.deps)).toMatchObject({
      action: 'disarmed',
      reason: 'Insufficient balance',
    })
    expect(h.current()?.enabled).toBe(false)
  })

  it('disarms stale state', async () => {
    const h = harness(
      state({
        startedAt: new Date(NOW - AUTO_REFILL_STALE_MS - 1000).toISOString(),
      })
    )
    expect((await autoRefillTick(h.deps)).action).toBe('disarmed')
    expect(h.current()?.enabled).toBe(false)
  })

  it('skips without disarming when the credit check errors', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }))
    h.deps.hasActiveCredits = async () => {
      throw new Error('offline')
    }
    expect(await autoRefillTick(h.deps)).toMatchObject({ action: 'skipped' })
    expect(h.current()?.enabled).toBe(true)
  })
})