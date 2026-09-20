/**
 * Wallet management: mnemonic generation, storage, wallet loading.
 *
 * Adapted from: paytaca-app/src/wallet/index.js
 *
 * Key differences:
 *   - Uses @napi-rs/keyring (OS keychain) instead of Capacitor SecureStoragePlugin
 *   - Uses bip39 directly for mnemonic generation instead of @psf/bch-js
 *   - No SLP wallet
 *   - No migration logic (fresh CLI, no legacy key schemes)
 *   - computeWalletHash() is identical to paytaca-app
 */

import {
  generateMnemonic as bip39Generate,
  validateMnemonic,
  wordlists,
} from 'bip39'
import sha256 from 'js-sha256'
import {
  storeMnemonic as keychainStoreMnemonic,
  getMnemonic as keychainGetMnemonic,
  deleteMnemonic as keychainDeleteMnemonic,
  setActiveWallet,
  getActiveWallet,
} from '../storage/keychain.js'
import { BchWallet } from './bch.js'
import { BCH_DERIVATION_PATH, projectId } from '../utils/network.js'

/**
 * Compute wallet hash from mnemonic and derivation path.
 * walletHash = sha256(sha256(mnemonic) + sha256(derivationPath))
 *
 * Identical to paytaca-app's computeWalletHash() in src/wallet/index.js
 * and BchWallet.getWalletHash() in src/wallet/bch.js
 */
export function computeWalletHash(
  mnemonic: string,
  derivationPath: string = BCH_DERIVATION_PATH
): string {
  if (typeof mnemonic !== 'string' || mnemonic.length === 0) {
    throw new TypeError('mnemonic must be a non-empty string')
  }
  if (typeof derivationPath !== 'string' || derivationPath.length === 0) {
    throw new TypeError('derivationPath must be a non-empty string')
  }
  const mnemonicHash = sha256.sha256(mnemonic)
  const derivationPathHash = sha256.sha256(derivationPath)
  const walletHash = sha256.sha256(mnemonicHash + derivationPathHash)
  return walletHash
}

/**
 * Generate a new 12-word BIP39 mnemonic, store it in the OS keychain,
 * and set it as the active wallet.
 *
 * Adapted from paytaca-app generateMnemonic() — stripped of
 * Capacitor SecureStoragePlugin and old key-scheme migration.
 */
export function generateMnemonic(): { mnemonic: string; walletHash: string } {
  const mnemonic = bip39Generate(128) // 128 bits = 12 words
  const walletHash = computeWalletHash(mnemonic)

  keychainStoreMnemonic(mnemonic, walletHash)
  setActiveWallet(walletHash)

  return { mnemonic, walletHash }
}

const BIP39_WORDLIST = new Set(wordlists.english)
const VALID_WORD_COUNTS = new Set([12, 15, 18, 21, 24])

/**
 * Parse a seed phrase entered with spaces, commas, or a mix of both
 * into a lowercase word array.
 */
export function parseMnemonicWords(input: string): string[] {
  return input
    .trim()
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = curr
  }
  return prev[n]
}

/**
 * Closest BIP39 word to a misspelled word (smallest edit distance;
 * ties resolve to the earliest word in the wordlist).
 */
export function suggestWord(word: string): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const candidate of BIP39_WORDLIST) {
    const dist = levenshtein(word, candidate)
    if (dist < bestDist) {
      best = candidate
      bestDist = dist
    }
  }
  return best
}

/**
 * Validate seed phrase word count and BIP39 wordlist membership.
 * Throws errors with misspelling suggestions for unknown words.
 */
export function validateMnemonicWords(words: string[]): void {
  if (!VALID_WORD_COUNTS.has(words.length)) {
    throw new Error(
      `Invalid seed phrase: ${words.length} words. A BIP39 seed phrase must have 12, 15, 18, 21, or 24 words.`
    )
  }
  const unknown = words.filter((w) => !BIP39_WORDLIST.has(w))
  if (unknown.length > 0) {
    const listed = unknown
      .map((w) => {
        const suggestion = suggestWord(w)
        return suggestion ? `"${w}" (did you mean "${suggestion}"?)` : `"${w}"`
      })
      .join(', ')
    throw new Error(`Invalid seed phrase: not BIP39 words — ${listed}`)
  }
}

/**
 * Import an existing mnemonic, validate it, store in keychain,
 * and set as active wallet. Accepts space- and/or comma-separated input.
 */
export function importMnemonic(mnemonic: string): {
  mnemonic: string
  walletHash: string
} {
  const words = parseMnemonicWords(mnemonic)
  if (words.length === 0) {
    throw new Error('No seed phrase provided')
  }
  validateMnemonicWords(words)
  const normalized = words.join(' ')
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid BIP39 mnemonic phrase (checksum failed)')
  }
  const walletHash = computeWalletHash(normalized)

  keychainStoreMnemonic(normalized, walletHash)
  setActiveWallet(walletHash)

  return { mnemonic: normalized, walletHash }
}

/**
 * Load the active wallet's mnemonic from keychain.
 * Returns null if no active wallet is set or mnemonic is missing.
 */
export function loadMnemonic(): {
  mnemonic: string
  walletHash: string
} | null {
  const walletHash = getActiveWallet()
  if (!walletHash) return null

  const mnemonic = keychainGetMnemonic(walletHash)
  if (!mnemonic) return null

  return { mnemonic, walletHash }
}

export interface WalletRef {
  walletHash: string
  mnemonic?: string
  canSign: boolean
}

/**
 * Load a reference to the active wallet without requiring a signing mnemonic.
 *
 * Full wallets have both a wallet hash and a mnemonic; read-only wallets only
 * have the wallet hash. Callers that must sign should reject `canSign === false`,
 * while read-only flows can still use the hash.
 */
export function loadWalletRef(): WalletRef | null {
  const walletHash = getActiveWallet()
  if (!walletHash) return null

  const mnemonic = keychainGetMnemonic(walletHash)
  return {
    walletHash,
    mnemonic: mnemonic ?? undefined,
    canSign: Boolean(mnemonic),
  }
}

/**
 * High-level wallet class that provides access to BCH sub-wallets.
 *
 * Adapted from paytaca-app's Wallet class in src/wallet/index.js.
 * Stripped of SLP — only BCH mainnet and chipnet.
 */
export class Wallet {
  mnemonic: string
  private _BCH: BchWallet | null = null
  private _BCH_CHIP: BchWallet | null = null

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic
  }

  /** Main BCH wallet (mainnet) */
  get BCH(): BchWallet {
    if (!this._BCH) {
      this._BCH = new BchWallet(
        projectId.mainnet,
        this.mnemonic,
        BCH_DERIVATION_PATH,
        false
      )
    }
    return this._BCH
  }

  /** Chipnet BCH wallet (testnet) */
  get BCH_CHIP(): BchWallet {
    if (!this._BCH_CHIP) {
      this._BCH_CHIP = new BchWallet(
        projectId.chipnet,
        this.mnemonic,
        BCH_DERIVATION_PATH,
        true
      )
    }
    return this._BCH_CHIP
  }

  /** Get the appropriate sub-wallet for the given network */
  forNetwork(isChipnet: boolean): BchWallet {
    return isChipnet ? this.BCH_CHIP : this.BCH
  }
}

/**
 * Load a Wallet instance from the keychain.
 * Returns null if no active wallet exists.
 */
export function loadWallet(): Wallet | null {
  const data = loadMnemonic()
  if (!data) return null
  return new Wallet(data.mnemonic)
}
