import {
  getWalletStatus,
  type AiModelConfig,
  type WalletStatus,
  type WalletSession,
} from './client.js'

export interface PurchaseHint {
  model: string
  minutes: number
  command: string
}

export function buildPurchaseHint(
  model: Pick<AiModelConfig, 'id' | 'price_tiers'> | null | undefined
): PurchaseHint | null {
  if (!model || !model.id) return null
  const tiers = Array.isArray(model.price_tiers) ? model.price_tiers : []
  const sorted = tiers
    .filter((t) => Number(t.minutes) > 0)
    .sort((a, b) => Number(a.minutes) - Number(b.minutes))
  if (sorted.length === 0) return null
  const minutes = Number(sorted[0].minutes)
  return {
    model: model.id,
    minutes,
    command: `paytaca ai purchase --model ${model.id} --minutes ${minutes}`,
  }
}

export interface CreditsSummary {
  modelId: string | null
  displayName: string | null
  active: boolean
  timeRemainingSeconds: number
  timeCreditsSeconds: number
  timeUsedSeconds: number
  tokenLimit: number | null
}

export function getSessions(status: WalletStatus): WalletSession[] {
  if (Array.isArray(status.sessions)) return status.sessions
  return [status]
}

function sessionMatches(session: WalletSession, modelId: string): boolean {
  const q = modelId.toLowerCase()
  const id = String(session.model_id || session.ai_model || '').toLowerCase()
  const name = String(session.display_name || '').toLowerCase()
  return id === q || id.includes(q) || name.includes(q)
}

export function findSession(
  status: WalletStatus,
  modelId?: string
): WalletSession | null {
  const sessions = getSessions(status).filter(Boolean)
  if (sessions.length === 0) return null

  if (modelId) {
    const match = sessions.find((s) => sessionMatches(s, modelId))
    if (match) return match
  }

  return (
    sessions.find(
      (s) =>
        s.model_active === true ||
        s.session_active === true ||
        (s.time_remaining_seconds ?? 0) > 0
    ) ||
    sessions[0] ||
    null
  )
}

function sessionActive(session: WalletSession): boolean {
  return (
    session.model_active === true ||
    session.session_active === true ||
    (session.time_remaining_seconds ?? 0) > 0
  )
}

export function hasActiveCredits(
  status: WalletStatus | null,
  modelId?: string
): boolean {
  if (!status) return false
  const sessions = getSessions(status).filter(Boolean)
  const candidates = modelId
    ? sessions.filter((s) => sessionMatches(s, modelId))
    : sessions
  return candidates.some(sessionActive)
}

export function formatRemaining(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0s'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 && h === 0) parts.push(`${s}s`)
  return parts.join(' ') || '0s'
}

function summarizeSession(session: WalletSession): CreditsSummary {
  return {
    modelId: session.model_id || session.ai_model || null,
    displayName: session.display_name || null,
    active: sessionActive(session),
    timeRemainingSeconds: session.time_remaining_seconds ?? 0,
    timeCreditsSeconds: session.time_credits_seconds ?? 0,
    timeUsedSeconds: session.time_used_seconds ?? 0,
    tokenLimit: session.token_limit ?? null,
  }
}

export function summarizeCredits(
  status: WalletStatus,
  modelId?: string
): CreditsSummary {
  const session = findSession(status, modelId)
  return {
    ...summarizeSession(session ?? ({} as WalletSession)),
    active: hasActiveCredits(status, modelId),
  }
}

export function summarizeAllCredits(status: WalletStatus): CreditsSummary[] {
  return getSessions(status).filter(Boolean).map(summarizeSession)
}

export { getWalletStatus }