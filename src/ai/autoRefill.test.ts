import { describe, it, expect } from 'vitest'
import type { AutoRefillState } from './autoRefill.js'
import { autoRefillCanBuy, remainingBudget } from './autoRefill.js'

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