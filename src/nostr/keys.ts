import { mnemonicToSeedSync } from 'bip39'
import {
  binToHex,
  deriveHdPath,
  deriveHdPrivateNodeFromSeed,
  type HdPrivateNodeValid,
} from '@bitauth/libauth'
import { getPublicKey } from 'nostr-tools'
import { nsecEncode, npubEncode } from 'nostr-tools/nip19'

const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0"

export interface NostrKeys {
  privKeyHex: string
  pubKeyHex: string
  nsec: string
  npub: string
}

export function deriveNostrKeys(mnemonic: string): NostrKeys {
  const seed = new Uint8Array(mnemonicToSeedSync(mnemonic))
  const masterNode = deriveHdPrivateNodeFromSeed(seed)
  if (!('valid' in masterNode) || !(masterNode as any).valid) {
    throw new Error('Failed to derive valid HD node from seed')
  }
  const nostrNode = deriveHdPath(masterNode as HdPrivateNodeValid, NOSTR_DERIVATION_PATH)
  if (typeof nostrNode === 'string') throw new Error(nostrNode)

  const privKeyBytes = (nostrNode as HdPrivateNodeValid).privateKey
  const privKeyHex = binToHex(privKeyBytes)
  const pubKeyHex = getPublicKey(privKeyBytes)
  const nsec = nsecEncode(privKeyBytes)
  const npub = npubEncode(pubKeyHex)

  return { privKeyHex, pubKeyHex, nsec, npub }
}
