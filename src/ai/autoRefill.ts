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

export const AUTO_REFILL_STALE_MS = 24 * 60 * 60 * 1000

export interface RefillBuyOptions {
  model: string
  minutes: number
  paymentMethod: PaymentMethod
}

export interface RefillBuyResult {
  success: boolean
  paid?: boolean
  error?: string
}

export interface RefillTickDeps {
  hasActiveCredits: (model: string) => Promise<boolean>
  buy: (opts: RefillBuyOptions) => Promise<RefillBuyResult>
  readState?: () => AutoRefillState | null
  writeState?: (state: AutoRefillState) => void
  now?: () => number
}

export type RefillTickResult =
  | { action: 'idle' }
  | { action: 'skipped'; reason: string }
  | { action: 'refilled'; state: AutoRefillState }
  | { action: 'disarmed'; reason: string; state: AutoRefillState }

export async function autoRefillTick(
  deps: RefillTickDeps
): Promise<RefillTickResult> {
  const read = deps.readState ?? readAutoRefillState
  const write = deps.writeState ?? writeAutoRefillState
  const now = deps.now ? deps.now() : Date.now()

  const state = read()
  if (!state || !state.enabled) return { action: 'idle' }

  const disarm = (reason: string): RefillTickResult => {
    const next: AutoRefillState = { ...state, enabled: false }
    write(next)
    return { action: 'disarmed', reason, state: next }
  }

  const anchor = state.lastRefillAt || state.startedAt
  if (anchor) {
    const anchorMs = Date.parse(anchor)
    if (Number.isFinite(anchorMs) && now - anchorMs > AUTO_REFILL_STALE_MS) {
      return disarm('no refill in 24h')
    }
  }

  const model = state.model
  const minutes = state.minutes
  if (!model || !minutes || minutes <= 0) {
    return disarm('incomplete config')
  }

  const budget = remainingBudget(state)
  if (budget !== null && budget < minutes) {
    return disarm('budget exhausted')
  }

  let active: boolean
  try {
    active = await deps.hasActiveCredits(model)
  } catch (err: any) {
    return { action: 'skipped', reason: `credit check failed: ${err?.message || err}` }
  }
  if (active) return { action: 'idle' }

  let result: RefillBuyResult
  try {
    result = await deps.buy({
      model,
      minutes,
      paymentMethod: state.paymentMethod || 'bch',
    })
  } catch (err: any) {
    return { action: 'skipped', reason: `purchase failed: ${err?.message || err}` }
  }
  if (!result.success || !result.paid) {
    return disarm(result.error || 'purchase failed')
  }

  const next: AutoRefillState = {
    ...state,
    spentMinutes: (state.spentMinutes ?? 0) + minutes,
    lastRefillAt: new Date(now).toISOString(),
  }
  const nextBudget = remainingBudget(next)
  if (nextBudget !== null && nextBudget < minutes) next.enabled = false
  write(next)
  return { action: 'refilled', state: next }
}

export interface RefillLoopOptions extends RefillTickDeps {
  intervalMs?: number
  onEvent?: (result: RefillTickResult) => void
}

export function startAutoRefillLoop(opts: RefillLoopOptions): () => void {
  const intervalMs = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : 60_000
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const result = await autoRefillTick(opts)
      if (result.action !== 'idle') opts.onEvent?.(result)
    } catch (err: any) {
      opts.onEvent?.({ action: 'skipped', reason: err?.message || String(err) })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  void tick()
  return () => clearInterval(timer)
}