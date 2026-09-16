import { describe, it, expect } from 'vitest'
import { hexToBin, secp256k1, sha256 } from '@bitauth/libauth'
import { pubkeyToAddress } from '../utils/crypto.js'
import {
  buildAuthMessage,
  createAuthMaterial,
  signAuthMessage,
} from './oauth.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('oauth', () => {
  it('builds the bitcoincash-oauth challenge message', () => {
    expect(buildAuthMessage('abc123', 1700000000)).toBe(
      'bitcoincash-oauth|oauth|abc123|1700000000'
    )
    expect(buildAuthMessage('abc123', 1700000000, 'custom')).toBe(
      'bitcoincash-oauth|custom|abc123|1700000000'
    )
  })

  it('signs sha256(message) as raw DER (no Bitcoin magic prefix)', () => {
    const privateKey = new Uint8Array(32).fill(7)
    const message = buildAuthMessage('abc123', 1700000000)
    const signature = signAuthMessage(message, privateKey)

    expect(signature).toMatch(/^[0-9a-f]+$/)
    const digest = sha256.hash(new TextEncoder().encode(message))
    const publicKey = secp256k1.derivePublicKeyCompressed(privateKey)
    expect(typeof publicKey).not.toBe('string')
    expect(
      secp256k1.verifySignatureDER(
        hexToBin(signature),
        publicKey as Uint8Array,
        digest
      )
    ).toBe(true)
  })

  it('binds the auth user id to the wallet hash', () => {
    const material = createAuthMaterial(MNEMONIC, 'wallet-hash-xyz', 1700000000)
    expect(material.userId).toBe('wallet-hash-xyz')
    expect(material.timestamp).toBe(1700000000)
    expect(material.domain).toBe('oauth')
    expect(material.address).toBe(pubkeyToAddress(material.publicKey, false))

    const digest = sha256.hash(
      new TextEncoder().encode(buildAuthMessage(material.userId, material.timestamp))
    )
    expect(
      secp256k1.verifySignatureDER(
        hexToBin(material.signature),
        hexToBin(material.publicKey),
        digest
      )
    ).toBe(true)
  })

  it('derives a stable address from the same mnemonic', () => {
    const first = createAuthMaterial(MNEMONIC, 'wallet-hash-xyz', 1700000000)
    const second = createAuthMaterial(MNEMONIC, 'wallet-hash-xyz', 1700000001)
    expect(second.address).toBe(first.address)
    expect(second.publicKey).toBe(first.publicKey)
  })
})
