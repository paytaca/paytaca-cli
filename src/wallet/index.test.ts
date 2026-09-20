import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../storage/keychain.js', () => ({
  storeMnemonic: vi.fn(),
  getMnemonic: vi.fn(),
  deleteMnemonic: vi.fn(),
  setActiveWallet: vi.fn(),
  getActiveWallet: vi.fn(),
}))

import {
  parseMnemonicWords,
  suggestWord,
  validateMnemonicWords,
  importMnemonic,
} from './index.js'
import { storeMnemonic, setActiveWallet } from '../storage/keychain.js'
import { computeWalletHash } from './index.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const WALLET_HASH =
  '89005387c3e19649501ce8be1b2768ef9951922e77f4732775238c5d528a41a2'

describe('parseMnemonicWords', () => {
  it('parses space-separated words', () => {
    expect(parseMnemonicWords('  abandon ability  absurd  ')).toEqual([
      'abandon',
      'ability',
      'absurd',
    ])
  })

  it('parses comma-space-separated words', () => {
    expect(parseMnemonicWords('abandon, ability, absurd')).toEqual([
      'abandon',
      'ability',
      'absurd',
    ])
  })

  it('parses comma-separated words without spaces', () => {
    expect(parseMnemonicWords('abandon,ability,absurd')).toEqual([
      'abandon',
      'ability',
      'absurd',
    ])
  })

  it('parses mixed separators and is case-insensitive', () => {
    expect(
      parseMnemonicWords('Abandon,ABILITY absurd\nabout , zebra')
    ).toEqual(['abandon', 'ability', 'absurd', 'about', 'zebra'])
  })

  it('returns an empty array for empty input', () => {
    expect(parseMnemonicWords('   ')).toEqual([])
    expect(parseMnemonicWords(',, ,')).toEqual([])
  })
})

describe('suggestWord', () => {
  it('finds the closest wordlist entry for a misspelling', () => {
    expect(suggestWord('abanbon')).toBe('abandon')
    expect(suggestWord('abilty')).toBe('ability')
  })

  it('returns the exact word when it is in the wordlist', () => {
    expect(suggestWord('abandon')).toBe('abandon')
  })
})

describe('validateMnemonicWords', () => {
  it('accepts each valid BIP39 word count', () => {
    for (const count of [12, 15, 18, 21, 24]) {
      expect(() =>
        validateMnemonicWords(Array(count).fill('abandon'))
      ).not.toThrow()
    }
  })

  it('rejects invalid word counts', () => {
    expect(() => validateMnemonicWords(Array(11).fill('abandon'))).toThrow(
      /11 words.*12, 15, 18, 21, or 24/
    )
    expect(() => validateMnemonicWords(Array(13).fill('abandon'))).toThrow(
      /13 words/
    )
    expect(() => validateMnemonicWords([])).toThrow(/0 words/)
  })

  it('rejects words not in the BIP39 wordlist with suggestions', () => {
    const words = MNEMONIC.split(' ').slice(0, 11)
    words.push('abanbon')
    expect(() => validateMnemonicWords(words)).toThrow(
      /not BIP39 words — "abanbon" \(did you mean "abandon"\?\)/
    )
  })

  it('lists every unknown word', () => {
    const words = MNEMONIC.split(' ').slice(0, 10)
    words.push('abanbon', 'abiltiy')
    expect(() => validateMnemonicWords(words)).toThrow(
      /"abanbon".*"abiltiy"/
    )
  })
})

describe('importMnemonic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores a space-separated phrase and returns its wallet hash', () => {
    const result = importMnemonic(MNEMONIC)
    expect(result.mnemonic).toBe(MNEMONIC)
    expect(result.walletHash).toBe(WALLET_HASH)
    expect(storeMnemonic).toHaveBeenCalledWith(MNEMONIC, WALLET_HASH)
    expect(setActiveWallet).toHaveBeenCalledWith(WALLET_HASH)
  })

  it('accepts comma-separated input and normalizes it', () => {
    const comma = MNEMONIC.split(' ').join(',')
    const result = importMnemonic(comma)
    expect(result.mnemonic).toBe(MNEMONIC)
    expect(result.walletHash).toBe(WALLET_HASH)
  })

  it('accepts comma-space-separated input', () => {
    const mixed = MNEMONIC.split(' ').join(', ')
    const result = importMnemonic(mixed)
    expect(result.mnemonic).toBe(MNEMONIC)
  })

  it('accepts uppercase input', () => {
    const result = importMnemonic(MNEMONIC.toUpperCase())
    expect(result.mnemonic).toBe(MNEMONIC)
  })

  it('rejects empty input', () => {
    expect(() => importMnemonic('   ')).toThrow(/No seed phrase provided/)
  })

  it('rejects the wrong word count', () => {
    expect(() => importMnemonic(MNEMONIC + ' abandon')).toThrow(/13 words/)
  })

  it('rejects misspelled words without touching the keychain', () => {
    const words = MNEMONIC.split(' ').slice(0, 11)
    words.push('abanbon')
    expect(() => importMnemonic(words.join(' '))).toThrow(
      /did you mean "abandon"\?/
    )
    expect(storeMnemonic).not.toHaveBeenCalled()
  })

  it('rejects a valid-wordlist phrase with a bad checksum', () => {
    const words = MNEMONIC.split(' ').slice(0, 11)
    words.push('abandon')
    expect(() => importMnemonic(words.join(' '))).toThrow(/checksum failed/)
    expect(storeMnemonic).not.toHaveBeenCalled()
  })
})
