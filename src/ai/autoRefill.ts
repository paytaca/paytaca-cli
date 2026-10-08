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
  key?: string
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

export interface AutoRefillStore {
  version: 2
  payg: AutoRefillState | null
  models: Record<string, AutoRefillState>
}

export type AutoRefillTarget =
  | { mode: 'payg' }
  | { mode: 'model'; model: string }

export interface AutoRefillEntry {
  key: string
  mode: AutoRefillMode
  state: AutoRefillState
}

export function normalizeModelKey(model: string): string {
  const trimmed = String(model || '').trim().toLowerCase()
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function emptyStore(): AutoRefillStore {
  return { version: 2, payg: null, models: {} }
}

function migrateLegacy(parsed: any): AutoRefillStore {
  const store = emptyStore()
  const state = parsed as AutoRefillState
  if (state.mode === 'payg') {
    store.payg = state
  } else if (state.model) {
    store.models[normalizeModelKey(state.model)] = state
  }
  return store
}

export function readAutoRefillStore(
  file: string = AUTO_REFILL_FILE
): AutoRefillStore {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return emptyStore()
    if (parsed.version === 2) {
      return {
        version: 2,
        payg: parsed.payg ?? null,
        models:
          parsed.models && typeof parsed.models === 'object'
            ? parsed.models
            : {},
      }
    }
    if (typeof parsed.enabled === 'boolean') return migrateLegacy(parsed)
    return emptyStore()
  } catch {
    return emptyStore()
  }
}

export function writeAutoRefillStore(
  store: AutoRefillStore,
  file: string = AUTO_REFILL_FILE
): void {
  fs.mkdirSync(PAYTACA_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), {
    mode: 0o600,
  })
  fs.renameSync(tmp, file)
}

function targetKey(target: AutoRefillTarget): string {
  return target.mode === 'payg' ? 'payg' : normalizeModelKey(target.model)
}

function getSlot(store: AutoRefillStore, key: string): AutoRefillState | null {
  return key === 'payg' ? store.payg : store.models[key] ?? null
}

function setSlot(
  store: AutoRefillStore,
  key: string,
  state: AutoRefillState | null
): void {
  if (key === 'payg') store.payg = state
  else if (state) store.models[key] = state
  else delete store.models[key]
}

export function listAutoRefillEntries(
  store: AutoRefillStore
): AutoRefillEntry[] {
  const entries: AutoRefillEntry[] = []
  if (store.payg) entries.push({ key: 'payg', mode: 'payg', state: store.payg })
  for (const [key, state] of Object.entries(store.models)) {
    if (state) entries.push({ key, mode: 'model', state })
  }
  return entries
}

export function appendAutoRefillEvent(
  event: RefillEvent,
  file: string = AUTO_REFILL_EVENTS_FILE
): void {
  fs.mkdirSync(PAYTACA_DIR, { recursive: true, mode: 0o700 })
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 })
}

export function deleteAutoRefill(
  target?: AutoRefillTarget,
  file: string = AUTO_REFILL_FILE
): boolean {
  if (!target) {
    try {
      fs.unlinkSync(file)
      return true
    } catch (err: any) {
      if (err?.code === 'ENOENT') return false
      throw err
    }
  }
  const store = readAutoRefillStore(file)
  const key = targetKey(target)
  if (!getSlot(store, key)) return false
  setSlot(store, key, null)
  writeAutoRefillStore(store, file)
  return true
}

export type ArmAutoRefillOptions =
  | {
      mode: 'payg'
      amountUsd: number
      thresholdUsd: number
      maxUsd?: number
      paymentMethod?: PaymentMethod
    }
  | {
      mode: 'model'
      model: string
      minutes: number
      maxMinutes?: number
      paymentMethod?: PaymentMethod
    }

export function armAutoRefill(
  opts: ArmAutoRefillOptions,
  file: string = AUTO_REFILL_FILE
): AutoRefillState {
  const store = readAutoRefillStore(file)
  const key = opts.mode === 'payg' ? 'payg' : normalizeModelKey(opts.model)
  const existing = getSlot(store, key)
  const state: AutoRefillState = {
    enabled: true,
    mode: opts.mode,
    model: opts.mode === 'model' ? opts.model : undefined,
    minutes: opts.mode === 'model' ? opts.minutes : undefined,
    maxMinutes: opts.mode === 'model' ? opts.maxMinutes : undefined,
    spentMinutes: existing?.spentMinutes ?? 0,
    amountUsd: opts.mode === 'payg' ? opts.amountUsd : undefined,
    thresholdUsd: opts.mode === 'payg' ? opts.thresholdUsd : undefined,
    maxUsd: opts.mode === 'payg' ? opts.maxUsd : undefined,
    spentUsd: existing?.spentUsd ?? 0,
    refillCount: existing?.refillCount ?? 0,
    paymentMethod: opts.paymentMethod ?? existing?.paymentMethod ?? 'bch',
    startedAt: new Date().toISOString(),
    lastRefillAt: existing?.lastRefillAt,
    lastRefillTxid: existing?.lastRefillTxid ?? null,
    lastEvent: existing?.lastEvent,
  }
  setSlot(store, key, state)
  writeAutoRefillStore(store, file)
  return state
}

export function disarmAutoRefill(
  target?: AutoRefillTarget,
  file: string = AUTO_REFILL_FILE
): AutoRefillStore {
  const store = readAutoRefillStore(file)
  const keys = target
    ? [targetKey(target)]
    : listAutoRefillEntries(store).map((e) => e.key)
  for (const key of keys) {
    const state = getSlot(store, key)
    if (state) setSlot(store, key, { ...state, enabled: false })
  }
  writeAutoRefillStore(store, file)
  return store
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
  readStore?: () => AutoRefillStore
  writeStore?: (store: AutoRefillStore) => void
  appendEvent?: (event: RefillEvent) => void
  now?: () => number
}

export type RefillTickResult =
  | { action: 'idle' }
  | { action: 'skipped'; reason: string }
  | { action: 'refilled'; state: AutoRefillState }
  | { action: 'disarmed'; reason: string; state: AutoRefillState }

export interface RefillTickOutcome {
  key: string
  mode: AutoRefillMode
  result: RefillTickResult
}

async function tickSlotBody(
  deps: RefillTickDeps,
  key: string,
  mode: AutoRefillMode,
  read: () => AutoRefillState | null,
  write: (state: AutoRefillState | null) => void,
  append: (event: RefillEvent) => void,
  now: number
): Promise<RefillTickResult> {
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
      key,
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

  if (mode === 'payg') {
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
      key,
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
        key,
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
      key,
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

export async function autoRefillTick(
  deps: RefillTickDeps,
  target?: AutoRefillTarget
): Promise<RefillTickOutcome[]> {
  const readStore = deps.readStore ?? readAutoRefillStore
  const writeStore = deps.writeStore ?? writeAutoRefillStore
  const append = deps.appendEvent ?? appendAutoRefillEvent
  const now = deps.now ? deps.now() : Date.now()

  const store = readStore()
  let entries = listAutoRefillEntries(store)
  if (target) {
    const key = targetKey(target)
    entries = entries.filter((e) => e.key === key)
  }

  const outcomes: RefillTickOutcome[] = []
  for (const entry of entries) {
    const key = entry.key
    const read = () => getSlot(readStore(), key)
    const write = (next: AutoRefillState | null) => {
      const fresh = readStore()
      setSlot(fresh, key, next)
      writeStore(fresh)
    }
    const result = await tickSlotBody(deps, key, entry.mode, read, write, append, now)
    outcomes.push({ key, mode: entry.mode, result })
  }
  return outcomes
}

export async function autoRefillTickOne(
  deps: RefillTickDeps,
  target?: AutoRefillTarget
): Promise<RefillTickResult> {
  const outcomes = await autoRefillTick(deps, target)
  return outcomes[0]?.result ?? { action: 'idle' }
}

export interface RefillLoopOptions extends RefillTickDeps {
  intervalMs?: number
  onEvent?: (outcome: RefillTickOutcome) => void
}

export function startAutoRefillLoop(opts: RefillLoopOptions): () => void {
  const intervalMs = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : 60_000
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const outcomes = await autoRefillTick(opts)
      for (const outcome of outcomes) {
        if (outcome.result.action !== 'idle') opts.onEvent?.(outcome)
      }
    } catch (err: any) {
      opts.onEvent?.({
        key: '',
        mode: 'payg',
        result: { action: 'skipped', reason: err?.message || String(err) },
      })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  void tick()
  return () => clearInterval(timer)
}
