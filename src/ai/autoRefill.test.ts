import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AutoRefillState } from './autoRefill.js'
import {
  autoRefillCanBuy,
  remainingBudget,
  autoRefillTick,
  appendAutoRefillEvent,
  deleteAutoRefill,
  REFILL_COOLDOWN_MS,
  type RefillBuyOptions,
  type RefillEvent,
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
      buyResult?: {
        success: boolean
        paid?: boolean
        txid?: string
        priceSats?: number
        error?: string
      }
    } = {}
  ) {
    let stored = initial
    const buys: RefillBuyOptions[] = []
    const events: RefillEvent[] = []
    const deps: RefillTickDeps = {
      readState: () => stored,
      writeState: (s) => {
        stored = s
      },
      appendEvent: (e) => {
        events.push(e)
      },
      now: () => NOW,
      hasActiveCredits: async () => cfg.active ?? false,
      buy: async (o) => {
        buys.push(o)
        return cfg.buyResult ?? { success: true, paid: true }
      },
    }
    return { deps, buys, events, current: () => stored }
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

  it('skips within the cooldown window without buying', async () => {
    const h = harness(
      state({
        startedAt: new Date(NOW).toISOString(),
        lastRefillAt: new Date(NOW - 1000).toISOString(),
      })
    )
    const result = await autoRefillTick(h.deps)
    expect(result).toMatchObject({ action: 'skipped' })
    expect(h.buys).toHaveLength(0)
    expect(h.current()?.enabled).toBe(true)
  })

  it('allows a refill once the cooldown has elapsed', async () => {
    const h = harness(
      state({
        startedAt: new Date(NOW).toISOString(),
        lastRefillAt: new Date(NOW - REFILL_COOLDOWN_MS - 1000).toISOString(),
      })
    )
    expect((await autoRefillTick(h.deps)).action).toBe('refilled')
    expect(h.buys).toHaveLength(1)
  })

  it('records refillCount, txid and lastEvent on success', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }), {
      buyResult: { success: true, paid: true, txid: 'abc123', priceSats: 5000 },
    })
    expect((await autoRefillTick(h.deps)).action).toBe('refilled')
    expect(h.current()).toMatchObject({
      refillCount: 1,
      lastRefillTxid: 'abc123',
      lastEvent: {
        action: 'refilled',
        status: 'completed',
        txid: 'abc123',
        reason: null,
      },
    })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      action: 'refilled',
      status: 'completed',
      txid: 'abc123',
      priceSats: 5000,
      minutes: 15,
    })
  })

  it('emits a disarmed event when the budget runs out', async () => {
    const h = harness(
      state({ maxMinutes: 15, startedAt: new Date(NOW).toISOString() })
    )
    expect((await autoRefillTick(h.deps)).action).toBe('refilled')
    expect(h.current()?.lastEvent).toMatchObject({
      action: 'disarmed',
      reason: 'budget exhausted',
    })
    expect(h.events.map((e) => e.action)).toEqual(['refilled', 'disarmed'])
  })

  it('records a failed event when the purchase fails', async () => {
    const h = harness(state({ startedAt: new Date(NOW).toISOString() }), {
      buyResult: { success: false, paid: false, error: 'Insufficient balance' },
    })
    expect((await autoRefillTick(h.deps)).action).toBe('disarmed')
    expect(h.current()?.lastEvent).toMatchObject({
      action: 'disarmed',
      reason: 'Insufficient balance',
      status: 'failed',
    })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      action: 'disarmed',
      status: 'failed',
      reason: 'Insufficient balance',
    })
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

describe('auto-refill event log', () => {
  function tmpFile(): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-refill-')), 'events.jsonl')
  }

  it('appends events as JSONL', () => {
    const file = tmpFile()
    const event: RefillEvent = {
      action: 'refilled',
      reason: null,
      at: new Date().toISOString(),
      model: 'z-ai/glm-5.3-flash',
      minutes: 15,
      txid: 'abc',
      priceSats: 5000,
      paymentMethod: 'bch',
      status: 'completed',
    }
    appendAutoRefillEvent(event, file)
    appendAutoRefillEvent(event, file)
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ action: 'refilled', txid: 'abc' })
  })

  it('deleteAutoRefill removes the state file and tolerates a missing one', () => {
    const file = tmpFile()
    fs.writeFileSync(file, '{}')
    expect(deleteAutoRefill(file)).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
    expect(deleteAutoRefill(file)).toBe(false)
  })
})