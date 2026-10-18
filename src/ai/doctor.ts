/**
 * `paytaca ai doctor`: explain why a Paytaca AI model fails inside a harness.
 *
 * The gateway falls back to x402 whenever a request carries no usable
 * credential, answering `402 PAYMENT-SIGNATURE header is required`. That can
 * mean the harness sent no key, the key is invalid, or the key belongs to a
 * wallet different from the one holding the plan. These checks make those
 * cases explicit instead of leaving the user with a raw 402.
 */

import { formatUsd } from '../utils/prices.js'
import type { WalletStatus } from './client.js'
import {
  formatRemaining,
  hasActiveCredits,
  hasPaygBalance,
  paygBalanceUsd,
  summarizeAllCredits,
} from './credits.js'
import type { KeyIdentity } from './identity.js'

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'info'

export interface DoctorCheck {
  id: string
  label: string
  status: DoctorStatus
  detail: string
  fix?: string
}

export interface DoctorContext {
  walletConfigured: boolean
  walletCanSign: boolean
  harness: string
  modelId?: string
  walletStatus: WalletStatus | null
  walletStatusError?: string
  apiKey: string | null
  apiKeyPrefix: string | null
  keyIdentity: KeyIdentity
  staleCredentials: number
}

export function activePlanSummary(status: WalletStatus | null): string[] {
  return summarizeAllCredits((status ?? {}) as WalletStatus)
    .filter((s) => s.active && s.timeRemainingSeconds > 0)
    .map((s) => `${s.displayName || s.modelId || 'unknown'} (${formatRemaining(s.timeRemainingSeconds)})`)
}

export function buildDoctorChecks(ctx: DoctorContext): DoctorCheck[] {
  const checks: DoctorCheck[] = []

  checks.push(
    ctx.walletConfigured
      ? {
          id: 'wallet',
          label: 'Wallet',
          status: 'ok',
          detail: ctx.walletCanSign
            ? 'Full wallet — can buy plans.'
            : 'Read-only wallet — fund plans from your full wallet.',
        }
      : {
          id: 'wallet',
          label: 'Wallet',
          status: 'fail',
          detail: 'No active wallet.',
          fix: 'paytaca wallet create   (or paytaca wallet import)',
        }
  )

  if (ctx.walletStatusError) {
    checks.push({
      id: 'credits',
      label: 'AI credits',
      status: 'warn',
      detail: `Could not read credits from the backend: ${ctx.walletStatusError}`,
    })
  } else {
    const plans = activePlanSummary(ctx.walletStatus)
    const payg = hasPaygBalance(ctx.walletStatus)
    if (plans.length === 0 && !payg) {
      checks.push({
        id: 'credits',
        label: 'AI credits',
        status: 'warn',
        detail: 'No active plan and no pay-as-you-go balance for this wallet.',
        fix: ctx.walletCanSign
          ? 'paytaca ai purchase --model <id> --minutes <n>   (or paytaca ai topup)'
          : undefined,
      })
    } else {
      const parts = [...plans]
      if (payg) parts.push(`pay-as-you-go ${formatUsd(paygBalanceUsd(ctx.walletStatus))}`)
      checks.push({
        id: 'credits',
        label: 'AI credits',
        status: 'ok',
        detail: parts.join(', '),
      })
    }
  }

  if (!ctx.apiKey) {
    checks.push({
      id: 'api-key',
      label: 'API key',
      status: 'fail',
      detail: `No Paytaca API key in the ${ctx.harness} config.`,
      fix: `paytaca ai configure ${ctx.harness}`,
    })
  } else {
    checks.push({
      id: 'api-key',
      label: 'API key',
      status: 'ok',
      detail: `Configured${ctx.apiKeyPrefix ? ` (${ctx.apiKeyPrefix}…)` : ''}.`,
    })
    if (ctx.keyIdentity === 'invalid') {
      checks.push({
        id: 'api-key-identity',
        label: 'API key identity',
        status: 'fail',
        detail: 'The backend rejected the key with "401 Invalid API key".',
        fix: `paytaca ai configure ${ctx.harness}`,
      })
    } else if (ctx.keyIdentity === 'mismatch') {
      checks.push({
        id: 'api-key-identity',
        label: 'API key identity',
        status: 'fail',
        detail:
          'The key belongs to a different wallet than the one holding your credits — the harness sees no plan and falls back to x402.',
        fix: `paytaca ai configure ${ctx.harness}`,
      })
    } else if (ctx.keyIdentity === 'match') {
      checks.push({
        id: 'api-key-identity',
        label: 'API key identity',
        status: 'ok',
        detail: 'The key resolves to the same wallet shown by `ai credits`.',
      })
    } else {
      checks.push({
        id: 'api-key-identity',
        label: 'API key identity',
        status: 'info',
        detail: 'Could not confirm the key\u2019s wallet — no distinguishing credits yet.',
      })
    }
  }

  if (ctx.harness === 'opencode') {
    checks.push(
      ctx.staleCredentials > 0
        ? {
            id: 'stale-credentials',
            label: 'OpenCode credentials',
            status: 'warn',
            detail: `${ctx.staleCredentials} stored OpenCode credential(s) differ from the configured key and can shadow it.`,
            fix: `paytaca ai configure ${ctx.harness}`,
          }
        : {
            id: 'stale-credentials',
            label: 'OpenCode credentials',
            status: 'ok',
            detail: 'No stale stored credentials.',
          }
    )
  }

  if (ctx.modelId && ctx.walletStatus) {
    if (hasActiveCredits(ctx.walletStatus, ctx.modelId)) {
      checks.push({
        id: 'model',
        label: `Model ${ctx.modelId}`,
        status: 'ok',
        detail: 'Active plan.',
      })
    } else if (hasPaygBalance(ctx.walletStatus)) {
      checks.push({
        id: 'model',
        label: `Model ${ctx.modelId}`,
        status: 'ok',
        detail: 'No plan, but the pay-as-you-go balance will cover it.',
      })
    } else {
      checks.push({
        id: 'model',
        label: `Model ${ctx.modelId}`,
        status: 'fail',
        detail: 'No active plan and no pay-as-you-go balance for this model.',
        fix: `paytaca ai purchase --model ${ctx.modelId} --minutes <n>`,
      })
    }
  }

  return checks
}

export function summarizeDoctor(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
}
