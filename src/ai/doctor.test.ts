import { describe, it, expect } from 'vitest'
import type { WalletStatus } from './client.js'
import { buildDoctorChecks, summarizeDoctor, type DoctorContext } from './doctor.js'

function status(sessions: Partial<WalletStatus>[]): WalletStatus {
  return { sessions } as unknown as WalletStatus
}

const activePlan = status([
  {
    model_id: 'deepseek/deepseek-v4-flash',
    display_name: 'DeepSeek V4 Flash',
    session_active: true,
    time_remaining_seconds: 900,
  },
])

function context(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    walletConfigured: true,
    walletCanSign: true,
    harness: 'opencode',
    walletStatus: activePlan,
    apiKey: 'sk-pytc-0123456789abcdef',
    apiKeyPrefix: 'sk-pytc-0123',
    keyIdentity: 'match',
    staleCredentials: 0,
    ...overrides,
  }
}

function find(checks: ReturnType<typeof buildDoctorChecks>, id: string) {
  return checks.find((c) => c.id === id)
}

describe('buildDoctorChecks', () => {
  it('passes a healthy configuration', () => {
    const checks = buildDoctorChecks(context())
    expect(checks.every((c) => c.status === 'ok')).toBe(true)
    expect(summarizeDoctor(checks)).toBe('ok')
    expect(checks.map((c) => c.id)).toEqual([
      'wallet',
      'credits',
      'api-key',
      'api-key-identity',
      'stale-credentials',
    ])
  })

  it('fails when no wallet is configured', () => {
    const checks = buildDoctorChecks(
      context({ walletConfigured: false, walletStatus: null })
    )
    expect(find(checks, 'wallet')?.status).toBe('fail')
    expect(summarizeDoctor(checks)).toBe('fail')
  })

  it('fails when the harness has no API key', () => {
    const checks = buildDoctorChecks(context({ apiKey: null, apiKeyPrefix: null }))
    expect(find(checks, 'api-key')?.status).toBe('fail')
    expect(find(checks, 'api-key-identity')).toBeUndefined()
  })

  it('fails when the API key is rejected', () => {
    const checks = buildDoctorChecks(context({ keyIdentity: 'invalid' }))
    expect(find(checks, 'api-key-identity')?.status).toBe('fail')
    expect(find(checks, 'api-key-identity')?.detail).toMatch(/Invalid API key/)
  })

  it('fails when the API key belongs to another wallet', () => {
    const checks = buildDoctorChecks(context({ keyIdentity: 'mismatch' }))
    expect(find(checks, 'api-key-identity')?.status).toBe('fail')
    expect(find(checks, 'api-key-identity')?.fix).toContain('ai configure opencode')
  })

  it('warns about stale opencode credentials only for opencode', () => {
    const opencode = buildDoctorChecks(context({ staleCredentials: 2 }))
    expect(find(opencode, 'stale-credentials')?.status).toBe('warn')
    expect(summarizeDoctor(opencode)).toBe('warn')

    const pi = buildDoctorChecks(context({ harness: 'pi', staleCredentials: 2 }))
    expect(find(pi, 'stale-credentials')).toBeUndefined()
  })

  it('reports no credits as a warning and points at purchase', () => {
    const checks = buildDoctorChecks(context({ walletStatus: status([]) }))
    expect(find(checks, 'credits')?.status).toBe('warn')
    expect(find(checks, 'credits')?.fix).toContain('ai purchase')
  })

  it('treats pay-as-you-go as usable credits', () => {
    const payg = status([])
    ;(payg as Record<string, unknown>).payg_enabled = true
    ;(payg as Record<string, unknown>).balance_usd = 3
    const checks = buildDoctorChecks(context({ walletStatus: payg }))
    expect(find(checks, 'credits')?.status).toBe('ok')
    expect(find(checks, 'credits')?.detail).toContain('pay-as-you-go')
  })

  it('checks a specific model against plans and pay-as-you-go', () => {
    const covered = buildDoctorChecks(
      context({ modelId: 'deepseek/deepseek-v4-flash' })
    )
    expect(find(covered, 'model')?.status).toBe('ok')

    const missing = buildDoctorChecks(context({ modelId: 'z-ai/glm-5.3-flash' }))
    expect(find(missing, 'model')?.status).toBe('fail')
    expect(find(missing, 'model')?.fix).toContain('z-ai/glm-5.3-flash')
  })

  it('surfaces a backend read failure as a warning', () => {
    const checks = buildDoctorChecks(
      context({ walletStatus: null, walletStatusError: 'Backend unreachable' })
    )
    expect(find(checks, 'credits')?.status).toBe('warn')
  })
})

describe('summarizeDoctor', () => {
  it('prioritises failures over warnings', () => {
    expect(
      summarizeDoctor([
        { id: 'a', label: 'a', status: 'ok', detail: '' },
        { id: 'b', label: 'b', status: 'info', detail: '' },
      ])
    ).toBe('ok')
    expect(
      summarizeDoctor([
        { id: 'a', label: 'a', status: 'warn', detail: '' },
        { id: 'b', label: 'b', status: 'fail', detail: '' },
      ])
    ).toBe('fail')
  })
})
