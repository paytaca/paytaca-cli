import fs from 'fs'
import {
  PAYTACA_DIR,
  AUTO_REFILL_FILE,
  AUTO_REFILL_EVENTS_FILE,
} from './config.js'

export type PaymentMethod = 'bch' | 'lift'

export type AutoRefillMode = 'model' | 'payg'

export interface RefillLastEvent {
  action: 'refilled' | 'disarmed'
  reason: string | null
  at: string
  txid: string | null
  status: 'completed' | 'failed'
}

export interface RefillEvent extends RefillLastEvent {
  model: string | null
  minutes: number | null
  priceSats: number | null
  paymentMethod: PaymentMethod | null
}

export interface AutoRefillState {
  enabled: boolean
  mode?: AutoRefillMode
  model?: string
  minutes?: number
  maxMinutes?: number
  spentMinutes?: number
  amountUsd?: number
  thresholdUsd?: number
  maxUsd?: number
  spentUsd?: number
  refillCount?: number
  paymentMethod?: PaymentMethod
  startedAt?: string
  lastRefillAt?: string
  lastRefillTxid?: string | null
  lastEvent?: RefillLastEvent
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
  const tmp = `${AUTO_REFILL_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), {
    mode: 0o600,
  })
  fs.renameSync(tmp, AUTO_REFILL_FILE)
}

export function appendAutoRefillEvent(
  event: RefillEvent,
  file: string = AUTO_REFILL_EVENTS_FILE
): void {
  fs.mkdirSync(PAYTACA_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 })
}

export function deleteAutoRefill(file: string = AUTO_REFILL_FILE): boolean {
  try {
    fs.unlinkSync(file)
    return true
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false
    throw err
  }
}

export interface ArmAutoRefillOptions {
  mode?: AutoRefillMode
  model?: string
  minutes?: number
  maxMinutes?: number
  amountUsd?: number
  thresholdUsd?: number
  maxUsd?: number
  paymentMethod?: PaymentMethod
}

export function armAutoRefill(opts: ArmAutoRefillOptions): AutoRefillState {
  const existing = readAutoRefillState()
  const state: AutoRefillState = {
    enabled: true,
    mode: opts.mode ?? existing?.mode,
    model: opts.model ?? existing?.model,
    minutes: opts.minutes ?? existing?.minutes,
    maxMinutes: opts.maxMinutes ?? existing?.maxMinutes,
    spentMinutes: existing?.spentMinutes ?? 0,
    amountUsd: opts.amountUsd ?? existing?.amountUsd,
    thresholdUsd: opts.thresholdUsd ?? existing?.thresholdUsd,
    maxUsd: opts.maxUsd ?? existing?.maxUsd,
    spentUsd: existing?.spentUsd ?? 0,
    refillCount: existing?.refillCount ?? 0,
    paymentMethod: opts.paymentMethod ?? existing?.paymentMethod ?? 'bch',
    startedAt: new Date().toISOString(),
    lastRefillAt: existing?.lastRefillAt,
    lastRefillTxid: existing?.lastRefillTxid ?? null,
    lastEvent: existing?.lastEvent,
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

export function remainingUsdBudget(state: AutoRefillState | null): number | null {
  if (!state || state.maxUsd === undefined) return null
  return Math.max(0, state.maxUsd - (state.spentUsd ?? 0))
}

export function isPaygMode(state: AutoRefillState | null): boolean {
  return state?.mode === 'payg'
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

export const REFILL_COOLDOWN_MS = 5 * 60 * 1000

// Top up proactively once the armed model's remaining credits fall to (or
// below) this many seconds, instead of waiting for a zero balance. The
// background loop runs every 60s, so this keeps a buffer that outlasts a
// typical turn and prevents a mid-session 402 / "payment required" response.
export const REFILL_LEAD_SECONDS = 120

export interface RefillBuyOptions {
  model: string
  minutes: number
  paymentMethod: PaymentMethod
}

export interface RefillBuyResult {
  success: boolean
  paid?: boolean
  txid?: string
  priceSats?: number
  error?: string
}

export interface RefillTopUpOptions {
  amountUsd: number
  paymentMethod: PaymentMethod
}

export interface RefillTickDeps {
  hasActiveCredits: (model: string) => Promise<boolean>
  buy: (opts: RefillBuyOptions) => Promise<RefillBuyResult>
  remainingSeconds?: (model: string) => Promise<number | null>
  paygBalance?: () => Promise<number>
  topUp?: (opts: RefillTopUpOptions) => Promise<RefillBuyResult>
  readState?: () => AutoRefillState | null
  writeState?: (state: AutoRefillState) => void
  appendEvent?: (event: RefillEvent) => void
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
  const append = deps.appendEvent ?? appendAutoRefillEvent
  const now = deps.now ? deps.now() : Date.now()

  const disarmWithState = (
    current: AutoRefillState,
    reason: string,
    extra?: { txid?: string | null; priceSats?: number | null; status?: 'completed' | 'failed' }
  ): RefillTickResult => {
    const at = new Date(now).toISOString()
    const next: AutoRefillState = {
      ...current,
      enabled: false,
      lastEvent: {
        action: 'disarmed',
        reason,
        at,
        txid: extra?.txid ?? null,
        status: extra?.status ?? 'completed',
      },
    }
    write(next)
    append({
      action: 'disarmed',
      reason,
      at,
      model: current.model ?? null,
      minutes: current.minutes ?? null,
      txid: extra?.txid ?? null,
      priceSats: extra?.priceSats ?? null,
      paymentMethod: current.paymentMethod ?? null,
      status: extra?.status ?? 'completed',
    })
    return { action: 'disarmed', reason, state: next }
  }

  const state = read()
  if (!state || !state.enabled) return { action: 'idle' }

  if (state.mode === 'payg') {
    const amountUsd = state.amountUsd
    const thresholdUsd = state.thresholdUsd ?? 0
    if (!amountUsd || amountUsd <= 0 || thresholdUsd < 0) {
      return disarmWithState(state, 'incomplete config')
    }
    const budget = remainingUsdBudget(state)
    if (budget !== null && budget < amountUsd) {
      return disarmWithState(state, 'budget exhausted')
    }
    if (!deps.paygBalance || !deps.topUp) {
      return { action: 'skipped', reason: 'pay-as-you-go top-up unavailable' }
    }

    let balance: number
    try {
      balance = await deps.paygBalance()
    } catch (err: any) {
      return { action: 'skipped', reason: `balance check failed: ${err?.message || err}` }
    }
    if (balance > thresholdUsd) return { action: 'idle' }

    const fresh = read()
    if (!fresh || !fresh.enabled || fresh.mode !== 'payg') return { action: 'idle' }
    if (fresh.lastRefillAt) {
      const last = Date.parse(fresh.lastRefillAt)
      if (Number.isFinite(last) && now - last < REFILL_COOLDOWN_MS) {
        return { action: 'skipped', reason: 'cooldown: last top-up less than 5 minutes ago' }
      }
    }
    const freshAmount = fresh.amountUsd
    if (!freshAmount || freshAmount <= 0) {
      return disarmWithState(fresh, 'incomplete config')
    }
    const freshBudget = remainingUsdBudget(fresh)
    if (freshBudget !== null && freshBudget < freshAmount) {
      return disarmWithState(fresh, 'budget exhausted')
    }

    let result: RefillBuyResult
    try {
      result = await deps.topUp({
        amountUsd: freshAmount,
        paymentMethod: fresh.paymentMethod || 'bch',
      })
    } catch (err: any) {
      return { action: 'skipped', reason: `top-up failed: ${err?.message || err}` }
    }
    if (!result.success || !result.paid) {
      return disarmWithState(fresh, result.error || 'top-up failed', {
        priceSats: result.priceSats ?? null,
        status: 'failed',
      })
    }

    const at = new Date(now).toISOString()
    const txid = result.txid ?? null
    const next: AutoRefillState = {
      ...fresh,
      spentUsd: (fresh.spentUsd ?? 0) + freshAmount,
      refillCount: (fresh.refillCount ?? 0) + 1,
      lastRefillAt: at,
      lastRefillTxid: txid,
      lastEvent: { action: 'refilled', reason: null, at, txid, status: 'completed' },
    }
    const nextBudget = remainingUsdBudget(next)
    let exhausted = false
    if (nextBudget !== null && nextBudget < freshAmount) {
      exhausted = true
      next.enabled = false
      next.lastEvent = {
        action: 'disarmed',
        reason: 'budget exhausted',
        at,
        txid,
        status: 'completed',
      }
    }
    write(next)
    append({
      action: 'refilled',
      reason: null,
      at,
      model: null,
      minutes: null,
      txid,
      priceSats: result.priceSats ?? null,
      paymentMethod: fresh.paymentMethod ?? null,
      status: 'completed',
    })
    if (exhausted) {
      append({
        action: 'disarmed',
        reason: 'budget exhausted',
        at,
        model: null,
        minutes: null,
        txid,
        priceSats: result.priceSats ?? null,
        paymentMethod: fresh.paymentMethod ?? null,
        status: 'completed',
      })
    }
    return { action: 'refilled', state: next }
  }

  const model = state.model
  const minutes = state.minutes
  if (!model || !minutes || minutes <= 0) {
    return disarmWithState(state, 'incomplete config')
  }

  const budget = remainingBudget(state)
  if (budget !== null && budget < minutes) {
    return disarmWithState(state, 'budget exhausted')
  }

  // Prefer remaining-seconds awareness so we top up BEFORE the buffer empties
  // (a mid-turn 402 is what forces the user to manually resume). Fall back to
  // the binary active/zero check when remaining time is unavailable.
  let remaining: number | null = null
  if (deps.remainingSeconds) {
    try {
      remaining = await deps.remainingSeconds(model)
    } catch (err: any) {
      return { action: 'skipped', reason: `credit check failed: ${err?.message || err}` }
    }
  }
  if (remaining !== null) {
    if (remaining > REFILL_LEAD_SECONDS) return { action: 'idle' }
  } else {
    let active: boolean
    try {
      active = await deps.hasActiveCredits(model)
    } catch (err: any) {
      return { action: 'skipped', reason: `credit check failed: ${err?.message || err}` }
    }
    if (active) return { action: 'idle' }
  }

  const fresh = read()
  if (!fresh || !fresh.enabled) return { action: 'idle' }
  if (fresh.lastRefillAt) {
    const last = Date.parse(fresh.lastRefillAt)
    if (
      Number.isFinite(last) &&
      now - last < REFILL_COOLDOWN_MS
    ) {
      return { action: 'skipped', reason: 'cooldown: last refill less than 5 minutes ago' }
    }
  }
  const freshModel = fresh.model
  const freshMinutes = fresh.minutes
  if (!freshModel || !freshMinutes || freshMinutes <= 0) {
    return disarmWithState(fresh, 'incomplete config')
  }
  const freshBudget = remainingBudget(fresh)
  if (freshBudget !== null && freshBudget < freshMinutes) {
    return disarmWithState(fresh, 'budget exhausted')
  }

  let result: RefillBuyResult
  try {
    result = await deps.buy({
      model: freshModel,
      minutes: freshMinutes,
      paymentMethod: fresh.paymentMethod || 'bch',
    })
  } catch (err: any) {
    return { action: 'skipped', reason: `purchase failed: ${err?.message || err}` }
  }
  if (!result.success || !result.paid) {
    return disarmWithState(fresh, result.error || 'purchase failed', {
      priceSats: result.priceSats ?? null,
      status: 'failed',
    })
  }

  const at = new Date(now).toISOString()
  const txid = result.txid ?? null
  const next: AutoRefillState = {
    ...fresh,
    spentMinutes: (fresh.spentMinutes ?? 0) + freshMinutes,
    refillCount: (fresh.refillCount ?? 0) + 1,
    lastRefillAt: at,
    lastRefillTxid: txid,
    lastEvent: {
      action: 'refilled',
      reason: null,
      at,
      txid,
      status: 'completed',
    },
  }
  const nextBudget = remainingBudget(next)
  let exhausted = false
  if (nextBudget !== null && nextBudget < freshMinutes) {
    exhausted = true
    next.enabled = false
    next.lastEvent = {
      action: 'disarmed',
      reason: 'budget exhausted',
      at,
      txid,
      status: 'completed',
    }
  }
  write(next)
  append({
    action: 'refilled',
    reason: null,
    at,
    model: freshModel,
    minutes: freshMinutes,
    txid,
    priceSats: result.priceSats ?? null,
    paymentMethod: fresh.paymentMethod ?? null,
    status: 'completed',
  })
  if (exhausted) {
    append({
      action: 'disarmed',
      reason: 'budget exhausted',
      at,
      model: freshModel,
      minutes: freshMinutes,
      txid,
      priceSats: result.priceSats ?? null,
      paymentMethod: fresh.paymentMethod ?? null,
      status: 'completed',
    })
  }
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
