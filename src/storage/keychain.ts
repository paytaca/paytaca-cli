/**
 * Secure storage layer using OS keychain.
 *
 * Replaces `capacitor-secure-storage-plugin` (SecureStoragePlugin) from
 * paytaca-app.  The underlying store is the platform's native credential
 * manager (macOS Keychain, GNOME Keyring / Secret Service on Linux,
 * Windows Credential Manager) accessed via @napi-rs/keyring.
 *
 * Key naming convention is identical to paytaca-app so the mental model
 * carries over:
 *   - Mnemonic:      mn_{walletHash}
 *   - Active wallet:  active_wallet
 *
 * Adapted from: paytaca-app/src/wallet/index.js (SecureStoragePlugin calls)
 */

import { Entry } from '@napi-rs/keyring'

const SERVICE = 'paytaca-cli'

/**
 * Store a value in the OS keychain.
 */
export function setSecret(key: string, value: string): void {
  const entry = new Entry(SERVICE, key)
  entry.setPassword(value)
}

/**
 * Retrieve a value from the OS keychain.
 * Returns null if the key does not exist.
 */
export function getSecret(key: string): string | null {
  const entry = new Entry(SERVICE, key)
  try {
    return entry.getPassword()
  } catch {
    return null
  }
}

/**
 * Delete a value from the OS keychain.
 */
export function deleteSecret(key: string): void {
  const entry = new Entry(SERVICE, key)
  try {
    entry.deletePassword()
  } catch {
    // Key might not exist — ignore
  }
}

// ---------------------------------------------------------------------------
// Wallet-specific helpers (mirror paytaca-app's SecureStoragePlugin usage)
// ---------------------------------------------------------------------------

/**
 * Store a mnemonic keyed by wallet hash.
 * Equivalent to paytaca-app's storeMnemonicByHash().
 */
export function storeMnemonic(mnemonic: string, walletHash: string): void {
  setSecret(`mn_${walletHash}`, mnemonic)
}

/**
 * Retrieve a mnemonic by wallet hash.
 * Equivalent to paytaca-app's getMnemonicByHash().
 */
export function getMnemonic(walletHash: string): string | null {
  return getSecret(`mn_${walletHash}`)
}

/**
 * Delete a mnemonic by wallet hash.
 * Equivalent to paytaca-app's deleteMnemonicByHash().
 */
export function deleteMnemonic(walletHash: string): void {
  deleteSecret(`mn_${walletHash}`)
}

/**
 * Set the active wallet hash.
 */
export function setActiveWallet(walletHash: string): void {
  setSecret('active_wallet', walletHash)
}

/**
 * Get the active wallet hash, or null if none is set.
 */
export function getActiveWallet(): string | null {
  return getSecret('active_wallet')
}

/**
 * Clear the active wallet selection.
 */
export function clearActiveWallet(): void {
  deleteSecret('active_wallet')
}
