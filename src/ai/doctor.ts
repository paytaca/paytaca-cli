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
import type { AiConfig, WalletStatus } from './client.js'
import {
  reasoningEfforts,
  type HarnessReasoningConfig,
} from './configure.js'
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
  /**
   * Machine-applicable remedy, used by `ai doctor --fix`. `configure` re-runs
   * `paytaca ai configure`, which installs or replaces the harness credential
   * (missing / invalid / mismatched key) and clears stale OpenCode credentials.
   * Checks that spend money or need a human carry no `autoFix`.
   */
  autoFix?: 'configure'
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
  /** Whether the local Paytaca gateway answers (Claude Code and Codex). */
  gatewayRunning?: boolean
  gatewayUrl?: string
  /** Backend URL used for the checks, shown when the catalogue is unreachable. */
  backendUrl?: string
  /** Full model catalogue, or null when it could not be fetched. */
  catalogue?: AiConfig | null
  catalogueError?: string
  /** A parse error in the harness config file, if any. */
  configError?: string
  /** Reasoning capability stored in the harness config (null for Claude). */
  harnessReasoning?: HarnessReasoningConfig | null
}

function sameEfforts(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((level) => set.has(level))
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

  if (ctx.catalogue !== undefined) {
    checks.push(
      ctx.catalogue
        ? {
            id: 'backend',
            label: 'Backend',
            status: 'ok',
            detail: `Reachable at ${ctx.backendUrl ?? 'the configured URL'}.`,
          }
        : {
            id: 'backend',
            label: 'Backend',
            status: 'fail',
            detail: `Cannot reach ${ctx.backendUrl ?? 'the backend'}: ${
              ctx.catalogueError || 'no response'
            }`,
            fix: 'Check your network and the backend URL, then run `paytaca ai models`.',
          }
    )
  }

  if (ctx.walletStatusError) {
    checks.push({
      id: 'credits',
      label: 'AI credits',
      status: 'warn',
      detail: `Could not read credits${ctx.backendUrl ? ` from ${ctx.backendUrl}` : ''}: ${
        ctx.walletStatusError
      }`,
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

  if (ctx.configError) {
    checks.push({
      id: 'config',
      label: 'Harness config',
      status: 'fail',
      detail: ctx.configError,
      fix: `Fix or remove the file, then re-run \`paytaca ai configure ${ctx.harness}\`.`,
    })
  }

  if (!ctx.apiKey) {
    checks.push({
      id: 'api-key',
      label: 'API key',
      status: 'fail',
      detail: `No Paytaca API key in the ${ctx.harness} config.`,
      fix: `paytaca ai configure ${ctx.harness}`,
      autoFix: 'configure',
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
        autoFix: 'configure',
      })
    } else if (ctx.keyIdentity === 'mismatch') {
      checks.push({
        id: 'api-key-identity',
        label: 'API key identity',
        status: 'fail',
        detail:
          'The key belongs to a different wallet than the one holding your credits — the harness sees no plan and falls back to x402.',
        fix: `paytaca ai configure ${ctx.harness}`,
        autoFix: 'configure',
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
            autoFix: 'configure',
          }
        : {
            id: 'stale-credentials',
            label: 'OpenCode credentials',
            status: 'ok',
            detail: 'No stale stored credentials.',
          }
    )
  }

  if (ctx.harness === 'claude' || ctx.harness === 'codex') {
    checks.push(
      ctx.gatewayRunning
        ? {
            id: 'gateway',
            label: 'Paytaca gateway',
            status: 'ok',
            detail: `Running at ${ctx.gatewayUrl ?? 'http://127.0.0.1:7475'}.`,
          }
        : {
            id: 'gateway',
            label: 'Paytaca gateway',
            status: 'fail',
            detail: `${ctx.harness === 'codex' ? 'Codex' : 'Claude Code'} cannot reach the Paytaca AI backend without the local gateway.`,
            fix: 'paytaca mcp --proxy',
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

  if (ctx.modelId && ctx.catalogue) {
    const known = (ctx.catalogue.models || []).some((model) => model?.id === ctx.modelId)
    if (!known) {
      checks.push({
        id: 'catalogue-model',
        label: `Model ${ctx.modelId}`,
        status: 'fail',
        detail: 'This model is not in the backend catalogue — the id may have been renamed or retired.',
        fix: 'paytaca ai models',
      })
    }
  }

  if (ctx.harness !== 'claude' && ctx.apiKey && ctx.catalogue && ctx.harnessReasoning !== undefined) {
    const capable = (ctx.catalogue.models || []).filter(
      (model) => reasoningEfforts(model).length > 0
    )
    if (capable.length > 0) {
      const state = ctx.harnessReasoning
      if (!state) {
        checks.push({
          id: 'reasoning',
          label: 'Reasoning effort',
          status: 'info',
          detail: `Could not read the ${ctx.harness} config, so the effort menu is unknown.`,
        })
      } else if (state.coarse) {
        checks.push(
          state.supportedAll
            ? {
                id: 'reasoning',
                label: 'Reasoning effort',
                status: 'ok',
                detail: 'Effort settings are present in the harness config.',
              }
            : {
                id: 'reasoning',
                label: 'Reasoning effort',
                status: 'warn',
                detail:
                  'The config predates reasoning support, so the harness hides the effort menu. Re-run configure to add it.',
                fix: `paytaca ai configure ${ctx.harness}`,
                autoFix: 'configure',
              }
        )
      } else {
        const missing = capable.filter((model) => !state.models[model.id]?.supported)
        const stale = capable.filter((model) => {
          const declared = state.models[model.id]?.efforts
          return declared ? !sameEfforts(declared, reasoningEfforts(model)) : false
        })
        if (missing.length === 0 && stale.length === 0) {
          checks.push({
            id: 'reasoning',
            label: 'Reasoning effort',
            status: 'ok',
            detail: `Effort menu matches the catalogue for ${capable.length} model(s).`,
          })
        } else {
          const affected = [...new Set([...missing, ...stale].map((model) => model.id))]
          const preview = affected.slice(0, 3).join(', ')
          const more = affected.length > 3 ? ` and ${affected.length - 3} more` : ''
          const reason = missing.length > 0 ? 'missing' : 'out of date'
          checks.push({
            id: 'reasoning',
            label: 'Reasoning effort',
            status: 'warn',
            detail: `Effort settings are ${reason} for ${preview}${more}. Re-run configure to refresh the menu.`,
            fix: `paytaca ai configure ${ctx.harness}`,
            autoFix: 'configure',
          })
        }
      }
    }
  }

  return checks
}

export function summarizeDoctor(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
}

/**
 * Checks that `ai doctor --fix` can repair by itself. Everything else either
 * spends money (`ai purchase` / `ai topup`) or needs a human (create or import
 * a wallet), so it is only ever suggested.
 */
export function fixableChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((c) => c.autoFix === 'configure')
}
