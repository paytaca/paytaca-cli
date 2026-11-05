/**
 * Compare the wallet behind an API key with the locally active wallet.
 *
 * The backend resolves an API key to the wallet that minted it, so a key left
 * over from a different wallet makes the harness see no credits even though
 * `paytaca ai credits` (wallet-hash based) reports a plan. There is no
 * "whoami" endpoint, so identity is inferred from the credits each side sees.
 */

import {
  AiApiError,
  getApiKeyWalletStatus,
  getWalletStatus,
  type WalletSession,
  type WalletStatus,
} from './client.js'
import { getSessions, hasPaygBalance } from './credits.js'

export type KeyIdentity = 'match' | 'mismatch' | 'invalid' | 'unknown'

function modelKey(session: WalletSession): string {
  return String(session.model_id || session.ai_model || session.display_name || '')
    .trim()
    .toLowerCase()
    .replace(/^paytaca-ai\//, '')
}

function activeSessionSignature(status: WalletStatus | null): string {
  return getSessions((status ?? {}) as WalletStatus)
    .filter((s) => s.session_active === true || (s.time_remaining_seconds ?? 0) > 0)
    .map(modelKey)
    .filter(Boolean)
    .sort()
    .join('|')
}

/**
 * Infer whether two status snapshots describe the same wallet.
 *
 * Active plan sessions are the strongest signal; pay-as-you-go availability is
 * the fallback. When neither side has any distinguishing credits the result is
 * `unknown` rather than a guess, so callers don't churn otherwise-fine keys.
 */
export function compareKeyWalletIdentity(
  walletStatus: WalletStatus | null,
  keyStatus: WalletStatus | null
): KeyIdentity {
  if (!walletStatus || !keyStatus) return 'unknown'

  const walletSig = activeSessionSignature(walletStatus)
  const keySig = activeSessionSignature(keyStatus)
  if (walletSig || keySig) return walletSig === keySig ? 'match' : 'mismatch'

  return hasPaygBalance(walletStatus) === hasPaygBalance(keyStatus)
    ? 'unknown'
    : 'mismatch'
}

export async function checkApiKeyWalletIdentity(
  apiKey: string,
  walletHash: string,
  opts: { backendUrl?: string; modelId?: string } = {}
): Promise<KeyIdentity> {
  let walletStatus: WalletStatus
  let keyStatus: WalletStatus
  try {
    ;[walletStatus, keyStatus] = await Promise.all([
      getWalletStatus(walletHash, opts),
      getApiKeyWalletStatus(apiKey, opts),
    ])
  } catch (err) {
    if (err instanceof AiApiError && err.status === 401) return 'invalid'
    return 'unknown'
  }
  return compareKeyWalletIdentity(walletStatus, keyStatus)
}
