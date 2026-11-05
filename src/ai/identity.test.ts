import { describe, it, expect } from 'vitest'
import type { WalletStatus } from './client.js'
import { compareKeyWalletIdentity } from './identity.js'

function withSessions(sessions: Partial<WalletStatus>[]): WalletStatus {
  return { sessions } as unknown as WalletStatus
}

const activeDeepseek = {
  model_id: 'deepseek/deepseek-v4-flash',
  display_name: 'DeepSeek V4 Flash',
  model_active: true,
  time_remaining_seconds: 900,
}

const activeGlm = {
  model_id: 'z-ai/glm-5.3-flash',
  display_name: 'GLM 5.3 Flash',
  model_active: true,
  time_remaining_seconds: 600,
}

describe('compareKeyWalletIdentity', () => {
  it('matches when both sides expose the same active plan', () => {
    expect(
      compareKeyWalletIdentity(withSessions([activeDeepseek]), withSessions([activeDeepseek]))
    ).toBe('match')
  })

  it('treats a paytaca-ai-prefixed model id as the same model', () => {
    const prefixed = { ...activeDeepseek, model_id: 'paytaca-ai/deepseek/deepseek-v4-flash' }
    expect(compareKeyWalletIdentity(withSessions([prefixed]), withSessions([activeDeepseek]))).toBe(
      'match'
    )
  })

  it('flags a mismatch when only one side has an active plan', () => {
    expect(compareKeyWalletIdentity(withSessions([activeDeepseek]), withSessions([]))).toBe(
      'mismatch'
    )
    expect(compareKeyWalletIdentity(withSessions([]), withSessions([activeGlm]))).toBe('mismatch')
  })

  it('flags a mismatch when the plans differ', () => {
    expect(
      compareKeyWalletIdentity(withSessions([activeDeepseek]), withSessions([activeGlm]))
    ).toBe('mismatch')
  })

  it('uses the pay-as-you-go balance to distinguish empty wallets', () => {
    const wallet: WalletStatus = { sessions: [], payg_enabled: true, balance_usd: 2.5 }
    const other: WalletStatus = { sessions: [], payg_enabled: false, balance_usd: 0 }
    expect(compareKeyWalletIdentity(wallet, other)).toBe('mismatch')
  })

  it('returns unknown when neither side has distinguishing credits', () => {
    expect(compareKeyWalletIdentity(withSessions([]), withSessions([]))).toBe('unknown')
    const payg: WalletStatus = { sessions: [], payg_enabled: true, balance_usd: 1 }
    expect(compareKeyWalletIdentity(payg, { ...payg })).toBe('unknown')
  })

  it('returns unknown when a status is missing', () => {
    expect(compareKeyWalletIdentity(null, withSessions([activeDeepseek]))).toBe('unknown')
    expect(compareKeyWalletIdentity(withSessions([activeDeepseek]), null)).toBe('unknown')
  })
})
