import { describe, it, expect } from 'vitest'
import type { WalletStatus } from './client.js'
import {
  getSessions,
  findSession,
  hasActiveCredits,
  summarizeCredits,
} from './credits.js'

function status(sessions: WalletStatus[]): WalletStatus {
  return { sessions } as unknown as WalletStatus
}

const active: WalletStatus = {
  model_id: 'z-ai/glm-5.3-flash',
  display_name: 'GLM 5.3 Flash',
  model_active: true,
  time_remaining_seconds: 900,
  time_credits_seconds: 1800,
  time_used_seconds: 900,
  token_limit: 50000,
} as unknown as WalletStatus

const expired: WalletStatus = {
  model_id: 'deepseek/deepseek-v4-pro',
  display_name: 'DeepSeek V4 Pro',
  model_active: false,
  time_remaining_seconds: 0,
} as unknown as WalletStatus

describe('getSessions', () => {
  it('returns the sessions array when present', () => {
    expect(getSessions(status([active, expired]))).toHaveLength(2)
  })

  it('wraps a bare status object', () => {
    expect(getSessions(active)).toEqual([active])
  })
})

describe('findSession', () => {
  it('finds a matching model', () => {
    expect(findSession(status([active, expired]), 'deepseek-v4-pro')).toBe(expired)
  })

  it('falls back to an active session', () => {
    expect(findSession(status([expired, active]))).toBe(active)
  })

  it('returns null for no sessions', () => {
    expect(findSession(status([]))).toBeNull()
  })
})

describe('hasActiveCredits', () => {
  it('is true when a session has remaining time', () => {
    expect(hasActiveCredits(status([active]))).toBe(true)
  })

  it('is false when all sessions are expired', () => {
    expect(hasActiveCredits(status([expired]))).toBe(false)
  })

  it('scopes the check to the requested model', () => {
    expect(hasActiveCredits(status([active]), 'deepseek-v4-pro')).toBe(false)
    expect(hasActiveCredits(status([active]), 'glm-5.3-flash')).toBe(true)
  })

  it('is false for null status', () => {
    expect(hasActiveCredits(null)).toBe(false)
  })
})

describe('summarizeCredits', () => {
  it('summarizes the matching session', () => {
    const summary = summarizeCredits(status([active]), 'glm-5.3-flash')
    expect(summary).toMatchObject({
      modelId: 'z-ai/glm-5.3-flash',
      displayName: 'GLM 5.3 Flash',
      active: true,
      timeRemainingSeconds: 900,
      tokenLimit: 50000,
    })
  })
})