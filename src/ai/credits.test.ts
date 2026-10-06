import { describe, it, expect } from 'vitest'
import type { WalletStatus } from './client.js'
import {
  getSessions,
  findSession,
  hasActiveCredits,
  hasPaygBalance,
  hasUsableCredits,
  paygBalanceUsd,
  paygEnabled,
  summarizeCredits,
  summarizeAllCredits,
  buildPurchaseHint,
  PAYG_MIN_BALANCE_USD,
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

const modelEnabledNoCredits: WalletStatus = {
  model_id: 'z-ai/glm-5.3',
  display_name: 'GLM 5.3',
  model_active: true,
  session_active: false,
  time_remaining_seconds: 0,
} as unknown as WalletStatus

describe('getSessions', () => {
  it('returns the sessions array when present', () => {
    expect(getSessions(status([active, expired]))).toHaveLength(2)
  })

  it('wraps a bare status object', () => {
    expect(getSessions(active)).toEqual([active])
  })

  it('returns no sessions for a flat payg-only status', () => {
    const flat = {
      session_active: false,
      time_credits_seconds: 0,
      time_used_seconds: 0,
      time_remaining_seconds: 0,
      balance_usd: 2.56,
      payg_enabled: true,
    } as unknown as WalletStatus
    expect(getSessions(flat)).toEqual([])
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

  it('does not match sibling models by prefix', () => {
    expect(hasActiveCredits(status([active]), 'z-ai/glm-5.3')).toBe(false)
    expect(hasActiveCredits(status([active]), 'glm-5.3')).toBe(false)
    expect(hasActiveCredits(status([active]), 'GLM 5.3')).toBe(false)
  })

  it('ignores the model_active availability flag', () => {
    expect(hasActiveCredits(status([modelEnabledNoCredits]))).toBe(false)
    expect(hasActiveCredits(status([modelEnabledNoCredits]), 'z-ai/glm-5.3')).toBe(false)
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

describe('summarizeAllCredits', () => {
  it('summarizes every session with its own active state', () => {
    const summaries = summarizeAllCredits(status([active, expired]))
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({
      modelId: 'z-ai/glm-5.3-flash',
      active: true,
      timeRemainingSeconds: 900,
    })
    expect(summaries[1]).toMatchObject({
      modelId: 'deepseek/deepseek-v4-pro',
      active: false,
      timeRemainingSeconds: 0,
    })
  })

  it('returns an empty array when there are no sessions', () => {
    expect(summarizeAllCredits(status([]))).toEqual([])
  })

  it('returns an empty array for a flat payg-only status', () => {
    const flat = {
      session_active: false,
      time_remaining_seconds: 0,
      balance_usd: 2.56,
      payg_enabled: true,
    } as unknown as WalletStatus
    expect(summarizeAllCredits(flat)).toEqual([])
  })
})

describe('buildPurchaseHint', () => {
  const model = {
    id: 'deepseek/deepseek-v4.1-flash',
    price_tiers: [
      { minutes: 60, price_sats: 5000, price_usd: 5 },
      { minutes: 15, price_sats: 1200, price_usd: 1.2 },
      { minutes: 30, price_sats: 2500, price_usd: 2.5 },
    ],
  }

  it('picks the shortest plan and builds a copy-paste command', () => {
    const hint = buildPurchaseHint(model)
    expect(hint).toMatchObject({
      model: 'deepseek/deepseek-v4.1-flash',
      minutes: 15,
      command:
        'paytaca ai purchase --model deepseek/deepseek-v4.1-flash --minutes 15',
    })
    expect(hint?.message).toContain(
      'paytaca ai purchase --model deepseek/deepseek-v4.1-flash --minutes 15'
    )
  })

  it('uses the display name in the relay message', () => {
    const hint = buildPurchaseHint({ ...model, display_name: 'DeepSeek V4.1 Flash' })
    expect(hint?.message).toContain('DeepSeek V4.1 Flash')
  })

  it('returns null without a model', () => {
    expect(buildPurchaseHint(null)).toBeNull()
    expect(buildPurchaseHint(undefined)).toBeNull()
    expect(buildPurchaseHint({ id: '', price_tiers: [] })).toBeNull()
  })

  it('returns null when there are no usable tiers', () => {
    expect(buildPurchaseHint({ id: 'm', price_tiers: [] })).toBeNull()
    expect(buildPurchaseHint({ id: 'm', price_tiers: [{ minutes: 0, price_sats: 0 }] })).toBeNull()
  })
})

const payg = (over: Partial<WalletStatus> = {}): WalletStatus =>
  ({ sessions: [], payg_enabled: true, balance_usd: 5, ...over } as unknown as WalletStatus)

describe('paygEnabled', () => {
  it('is true only when the flag is set', () => {
    expect(paygEnabled(payg())).toBe(true)
    expect(paygEnabled(payg({ payg_enabled: false }))).toBe(false)
    expect(paygEnabled(null)).toBe(false)
  })
})

describe('paygBalanceUsd', () => {
  it('returns the numeric balance', () => {
    expect(paygBalanceUsd(payg({ balance_usd: 3.5 }))).toBe(3.5)
  })

  it('returns 0 for missing or non-positive balances', () => {
    expect(paygBalanceUsd(payg({ balance_usd: 0 }))).toBe(0)
    expect(paygBalanceUsd(payg({ balance_usd: -1 }))).toBe(0)
    expect(paygBalanceUsd(null)).toBe(0)
  })
})

describe('hasPaygBalance', () => {
  it('compares against the minimum threshold', () => {
    expect(hasPaygBalance(payg({ balance_usd: PAYG_MIN_BALANCE_USD }))).toBe(true)
    expect(hasPaygBalance(payg({ balance_usd: PAYG_MIN_BALANCE_USD * 0.5 }))).toBe(false)
  })
})

describe('hasUsableCredits', () => {
  it('is true with plan credits', () => {
    expect(hasUsableCredits(status([active]))).toBe(true)
  })

  it('is true with only a payg balance', () => {
    expect(hasUsableCredits(payg())).toBe(true)
  })

  it('is false with neither', () => {
    expect(hasUsableCredits(status([expired]))).toBe(false)
    expect(hasUsableCredits(payg({ balance_usd: 0 }))).toBe(false)
  })
})
