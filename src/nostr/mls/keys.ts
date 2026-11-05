import { mnemonicToSeedSync } from 'bip39'
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  type HdPrivateNodeValid,
} from '@bitauth/libauth'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'

const MLS_DERIVATION_PATH = "m/44'/1237'/0'/0/1"

export interface MlsKeys {
  publicKey: Uint8Array
  privateKey: Uint8Array
  publicKeyHex: string
  privateKeyHex: string
}

export interface MlsHpkeIkms {
  initIkm: Uint8Array
  hpkeIkm: Uint8Array
}

export function deriveMlsKeys(mnemonic: string): MlsKeys {
  const seed = new Uint8Array(mnemonicToSeedSync(mnemonic))
  const masterNode = deriveHdPrivateNodeFromSeed(seed)
  if (!('valid' in masterNode) || !(masterNode as any).valid) {
    throw new Error('Failed to derive valid HD node from seed')
  }
  const mlsNode = deriveHdPath(masterNode as HdPrivateNodeValid, MLS_DERIVATION_PATH)
  if (typeof mlsNode === 'string') throw new Error(mlsNode)

  const privateKey = new Uint8Array((mlsNode as HdPrivateNodeValid).privateKey)
  const publicKey = ed25519.getPublicKey(privateKey)

  return {
    publicKey,
    privateKey,
    publicKeyHex: binToHex(publicKey),
    privateKeyHex: binToHex(privateKey),
  }
}

export function deriveMlsHpkeIkms(mnemonic: string): MlsHpkeIkms {
  const seed = new Uint8Array(mnemonicToSeedSync(mnemonic))
  const initIkm = hkdf(sha256, seed, undefined, new TextEncoder().encode('paytaca-mls-init-key'), 32)
  const hpkeIkm = hkdf(sha256, seed, undefined, new TextEncoder().encode('paytaca-mls-hpke-key'), 32)
  return { initIkm, hpkeIkm }
}

export function deriveMlsStateKey(mnemonic: string): Uint8Array {
  const seed = new Uint8Array(mnemonicToSeedSync(mnemonic))
  return hkdf(sha256, seed, undefined, new TextEncoder().encode('paytaca-mls-state-key'), 32)
}
