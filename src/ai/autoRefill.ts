import fs from 'fs'
import { PAYTACA_DIR, AUTO_REFILL_FILE } from './config.js'

export type PaymentMethod = 'bch' | 'lift'

export interface AutoRefillState {
  enabled: boolean
  model?: string
  minutes?: number
  maxMinutes?: number
  spentMinutes?: number
  paymentMethod?: PaymentMethod
  startedAt?: string
  lastRefillAt?: string
}

export function readAutoRefillState(): AutoRefillState | null {
  try {
    const raw = fs.readFileSync(AUTO_REFILL_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as AutoRefillState
  } catch {
    return null
  }
}

export function writeAutoRefillState(state: AutoRefillState): void {
  fs.mkdirSync(PAYTACA_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(AUTO_REFILL_FILE, JSON.stringify(state, null, 2), {
    mode: 0o600,
  })
}

export interface ArmAutoRefillOptions {
  model?: string
  minutes?: number
  maxMinutes?: number
  paymentMethod?: PaymentMethod
}

export function armAutoRefill(opts: ArmAutoRefillOptions): AutoRefillState {
  const existing = readAutoRefillState()
  const state: AutoRefillState = {
    enabled: true,
    model: opts.model ?? existing?.model,
    minutes: opts.minutes ?? existing?.minutes,
    maxMinutes: opts.maxMinutes ?? existing?.maxMinutes,
    spentMinutes: existing?.spentMinutes ?? 0,
    paymentMethod: opts.paymentMethod ?? existing?.paymentMethod ?? 'bch',
    startedAt: new Date().toISOString(),
    lastRefillAt: existing?.lastRefillAt,
  }
  writeAutoRefillState(state)
  return state
}

export function disarmAutoRefill(): AutoRefillState {
  const existing = readAutoRefillState()
  const state: AutoRefillState = {
    ...(existing || {}),
    enabled: false,
  }
  writeAutoRefillState(state)
  return state
}

export function remainingBudget(state: AutoRefillState | null): number | null {
  if (!state || state.maxMinutes === undefined) return null
  return Math.max(0, state.maxMinutes - (state.spentMinutes ?? 0))
}

export function autoRefillCanBuy(
  state: AutoRefillState | null,
  model: string,
  minutes: number
): { canBuy: boolean; reason?: string } {
  if (!state || !state.enabled) {
    return { canBuy: false, reason: 'Auto-refill is not enabled.' }
  }
  if (state.model && state.model !== model) {
    return {
      canBuy: false,
      reason: `Auto-refill is armed for ${state.model}, not ${model}.`,
    }
  }
  if (state.minutes && state.minutes !== minutes) {
    return {
      canBuy: false,
      reason: `Auto-refill is armed for ${state.minutes}-minute plans, not ${minutes}.`,
    }
  }
  const budget = remainingBudget(state)
  if (budget !== null && budget < minutes) {
    return {
      canBuy: false,
      reason: `Auto-refill budget exhausted (${budget} min left).`,
    }
  }
  return { canBuy: true }
}