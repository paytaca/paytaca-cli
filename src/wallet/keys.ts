/**
 * HD key derivation for Bitcoin Cash using libauth.
 *
 * Adapted from: paytaca-app/src/wallet/bch-libauth.js (LibauthHDWallet class)
 *
 * This is the modern derivation implementation that uses @bitauth/libauth
 * and bip39 directly, without @psf/bch-js.
 *
 * Derivation path: m/44'/145'/0'  (BIP44, coin type 145 = BCH)
 *   - Receiving addresses: m/44'/145'/0'/0/{index}
 *   - Change addresses:    m/44'/145'/0'/1/{index}
 */

import { mnemonicToSeedSync } from 'bip39'
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  deriveHdPublicNode,
  encodePrivateKeyWif,
  sha256,
  type HdPrivateNodeValid,
} from '@bitauth/libauth'
import { pubkeyToAddress, toTokenAddress } from '../utils/crypto.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'

export class LibauthHDWallet {
  mnemonic: string
  derivationPath: string
  network: 'mainnet' | 'chipnet'
  walletHash: string

  /**
   * @param mnemonic - BIP39 mnemonic phrase
   * @param derivationPath - HD derivation path (default: m/44'/145'/0')
   * @param network - 'mainnet' or 'chipnet'
   */
  constructor(
    mnemonic: string = '',
    derivationPath: string = BCH_DERIVATION_PATH,
    network: 'mainnet' | 'chipnet' = 'mainnet'
  ) {
    this.mnemonic = mnemonic
    this.derivationPath = derivationPath
    this.network = network
    this.walletHash = this.getWalletHash()
  }

  get isChipnet(): boolean {
    return this.network === 'chipnet'
  }

  set isChipnet(value: boolean) {
    this.network = value ? 'chipnet' : 'mainnet'
  }

  /**
   * Compute wallet hash: sha256(sha256(mnemonic) + sha256(derivationPath))
   * Identical to paytaca-app's computeWalletHash() and BchWallet.getWalletHash()
   */
  getWalletHash(): string {
    const customSha256 = (value: string) =>
      binToHex(sha256.hash(Buffer.from(value, 'utf8')))
    const mnemonicHash = customSha256(this.mnemonic)
    const derivationPathHash = customSha256(this.derivationPath)
    const walletHash = customSha256(mnemonicHash + derivationPathHash)
    return walletHash
  }

  /**
   * Derive the main HD node at the derivation path.
   * mnemonic → seed → master node → derive(path)
   */
  getMainNode(): HdPrivateNodeValid {
    const mnemonicBin = new Uint8Array(mnemonicToSeedSync(this.mnemonic))
    const node = deriveHdPrivateNodeFromSeed(mnemonicBin)
    if (!('valid' in node) || !node.valid) {
      throw new Error('Failed to derive valid HD node from seed')
    }
    const mainNode = deriveHdPath(node, this.derivationPath)
    if (typeof mainNode === 'string') throw new Error(mainNode)
    if (!('privateKey' in mainNode)) {
      throw new Error('Derivation produced a public node instead of private node')
    }
    return mainNode as HdPrivateNodeValid
  }

  /**
   * Derive an HD node at a relative sub-path from the main node.
   * @param path - Relative path like '0/0' for receiving index 0
   */
  getNodeAt(path: string = ''): HdPrivateNodeValid {
    if (!path?.startsWith('m/') && !path.startsWith('M/')) path = 'm/' + path
    if (!path?.startsWith('m') && !path.startsWith('M')) path = 'm' + path
    const mainNode = this.getMainNode()
    const node = deriveHdPath(mainNode, path)
    if (typeof node === 'string') throw new Error(node)
    if (!('privateKey' in node)) {
      throw new Error('Derivation produced a public node instead of private node')
    }
    return node as HdPrivateNodeValid
  }

  /**
   * Get the WIF-encoded private key at a sub-path.
   */
  getPrivateKeyWifAt(path: string = ''): string {
    const node = this.getNodeAt(path)
    return encodePrivateKeyWif(node.privateKey, 'mainnet')
  }

  /**
   * Get the compressed public key (hex) at a sub-path.
   */
  getPubkeyAt(path: string = ''): string {
    const node = this.getNodeAt(path)
    const publicNode = deriveHdPublicNode(node)
    return binToHex(publicNode.publicKey)
  }

  /**
   * Derive a CashAddress at a sub-path.
   *
   * @param opts.path - Sub-path like '0/0' (receiving) or '1/0' (change)
   * @param opts.token - If true, return token-aware address (z-prefix)
   */
  getAddressAt(opts: { path?: string; token?: boolean } = {}): string {
    const pubkeyHex = this.getPubkeyAt(opts?.path)
    const address = pubkeyToAddress(pubkeyHex, this.isChipnet)
    if (opts?.token) return toTokenAddress(address)
    return address
  }

  /**
   * Derive receiving and change addresses at a given index.
   * Convenience method matching BchWallet.getAddressSetAt() from paytaca-app.
   */
  getAddressSetAt(index: number): { receiving: string; change: string } {
    return {
      receiving: this.getAddressAt({ path: `0/${index}` }),
      change: this.getAddressAt({ path: `1/${index}` }),
    }
  }
}
