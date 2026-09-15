/**
 * Wallet context resolution shared by the CLI and the MCP server.
 *
 * Fuses keychain access and network selection into a single
 * {@link WalletContext}, and throws typed errors instead of
 * calling process.exit(), so it is safe to embed.
 */

import { loadMnemonic, Wallet } from '../wallet/index.js'
import type { BchWallet } from '../wallet/bch.js'

export type Network = 'mainnet' | 'chipnet'

export interface WalletContext {
  mnemonic: string
  walletHash: string
  network: Network
  isChipnet: boolean
  wallet: Wallet
  bch: BchWallet
}

export class WalletNotConfiguredError extends Error {
  constructor() {
    super(
      'No wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.'
    )
    this.name = 'WalletNotConfiguredError'
  }
}

export function resolveNetwork(isChipnet: boolean = false): {
  network: Network
  isChipnet: boolean
} {
  return { network: isChipnet ? 'chipnet' : 'mainnet', isChipnet }
}

/** Resolve the active wallet for the given network, or throw. */
export function requireWallet(isChipnet: boolean = false): WalletContext {
  const data = loadMnemonic()
  if (!data) throw new WalletNotConfiguredError()

  const wallet = new Wallet(data.mnemonic)
  const { network } = resolveNetwork(isChipnet)

  return {
    mnemonic: data.mnemonic,
    walletHash: data.walletHash,
    network,
    isChipnet,
    wallet,
    bch: wallet.forNetwork(isChipnet),
  }
}

/** Resolve the active wallet, or return null when none is configured. */
export function tryWallet(isChipnet: boolean = false): WalletContext | null {
  try {
    return requireWallet(isChipnet)
  } catch (err) {
    if (err instanceof WalletNotConfiguredError) return null
    throw err
  }
}
