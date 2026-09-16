import { describe, it, expect } from 'vitest'
import { getPublicKey } from 'nostr-tools'
import { hexToBin } from '@bitauth/libauth'
import { deriveNostrKeys } from './keys.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const PRIV_HEX =
  '5f29af3b9676180290e77a4efad265c4c2ff28a5302461f73597fda26bb25731'
const PUB_HEX =
  'e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f'
const NSEC =
  'nsec1tu567wukwcvq9y880f8045n9cnp07299xqjxrae4jl76y6aj2ucs2mkupq'
const NPUB =
  'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7'

describe('deriveNostrKeys', () => {
  it('derives the golden keys for a known mnemonic', () => {
    const keys = deriveNostrKeys(MNEMONIC)
    expect(keys.privKeyHex).toBe(PRIV_HEX)
    expect(keys.pubKeyHex).toBe(PUB_HEX)
    expect(keys.nsec).toBe(NSEC)
    expect(keys.npub).toBe(NPUB)
  })

  it('is deterministic', () => {
    expect(deriveNostrKeys(MNEMONIC)).toEqual(deriveNostrKeys(MNEMONIC))
  })

  it('derives the public key from the private key', () => {
    const keys = deriveNostrKeys(MNEMONIC)
    expect(keys.pubKeyHex).toBe(getPublicKey(hexToBin(keys.privKeyHex)))
  })

  it('produces a 32-byte private key and 64-char hex keys', () => {
    const keys = deriveNostrKeys(MNEMONIC)
    expect(hexToBin(keys.privKeyHex)).toHaveLength(32)
    expect(keys.pubKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(keys.nsec).toMatch(/^nsec1/)
    expect(keys.npub).toMatch(/^npub1/)
  })

  it('derives different identities for different mnemonics', () => {
    const other = deriveNostrKeys(
      'legal winner thank year wave sausage worth useful legal winner thank yellow'
    )
    expect(other.pubKeyHex).not.toBe(PUB_HEX)
  })

  it('is a pure function of the mnemonic string', () => {
    expect(deriveNostrKeys('not a real mnemonic').pubKeyHex).toBe(
      deriveNostrKeys('not a real mnemonic').pubKeyHex
    )
  })
})