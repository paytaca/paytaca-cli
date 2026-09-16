import { describe, it, expect } from 'vitest'
import {
  sha256,
  pubkeyToPkHash,
  pkHashToLegacyAddress,
  pkhashToCashAddress,
  pubkeyToAddress,
  toTokenAddress,
} from './crypto.js'

const PUBKEY =
  '02bbe7dbcdf8b2261530a867df7180b17a90b482f74f2736b8a30d3f756e42e217'
const PKHASH = '086a977c7dad32a56996af2ce90a727238d48998'
const LEGACY = '1mW6fDEMjKrDHvLvoEsaeLxSCzZBf3Bfg'
const CASHADDRESS = 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6'
const CHIPADDRESS = 'bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x'
const TOKENADDRESS = 'bitcoincash:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqnpwfwhlf'

describe('sha256', () => {
  it('hashes utf8 strings', () => {
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('hashes hex input as bytes, not characters', () => {
    expect(sha256('00', 'hex')).toBe(sha256('\u0000', 'binary'))
  })
})

describe('pubkeyToPkHash', () => {
  it('derives the golden pkHash', () => {
    expect(pubkeyToPkHash(PUBKEY)).toBe(PKHASH)
  })

  it('produces a 20-byte hash', () => {
    expect(pubkeyToPkHash(PUBKEY)).toHaveLength(40)
  })
})

describe('pkHashToLegacyAddress', () => {
  it('derives the golden legacy address', () => {
    expect(pkHashToLegacyAddress(PKHASH)).toBe(LEGACY)
  })
})

describe('pkhashToCashAddress', () => {
  it('derives a mainnet cash address by default', () => {
    expect(pkhashToCashAddress(PKHASH)).toBe(CASHADDRESS)
    expect(pkhashToCashAddress(PKHASH, false)).toBe(CASHADDRESS)
  })

  it('derives a chipnet cash address when requested', () => {
    expect(pkhashToCashAddress(PKHASH, true)).toBe(CHIPADDRESS)
  })
})

describe('pubkeyToAddress', () => {
  it('converts a compressed pubkey to a mainnet cash address', () => {
    expect(pubkeyToAddress(PUBKEY)).toBe(CASHADDRESS)
  })

  it('converts a compressed pubkey to a chipnet cash address', () => {
    expect(pubkeyToAddress(PUBKEY, true)).toBe(CHIPADDRESS)
  })
})

describe('toTokenAddress', () => {
  it('upgrades a p2pkh address to a token-aware address', () => {
    expect(toTokenAddress(CASHADDRESS)).toBe(TOKENADDRESS)
    expect(toTokenAddress(CHIPADDRESS)).toBe(
      'bchtest:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqhn2wvqc4'
    )
  })

  it('is idempotent for an already token-aware address', () => {
    expect(toTokenAddress(TOKENADDRESS)).toBe(TOKENADDRESS)
  })

  it('throws for an undecodable address', () => {
    expect(() => toTokenAddress('not-an-address')).toThrow()
  })
})