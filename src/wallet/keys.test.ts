import { describe, it, expect } from 'vitest'
import { LibauthHDWallet } from './keys.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PATH = "m/44'/145'/0'"

const WALLET_HASH =
  '89005387c3e19649501ce8be1b2768ef9951922e77f4732775238c5d528a41a2'
const RECEIVE_0 = 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6'
const CHANGE_0 = 'bitcoincash:qr8aeharupyrmhfu0d4tdmsnc5y8cfk47y6qrsjsrx'
const TOKEN_0 = 'bitcoincash:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqnpwfwhlf'
const CHIPNET_RECEIVE_0 = 'bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x'
const CHIPNET_TOKEN_0 = 'bchtest:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqhn2wvqc4'
const WIF_0 = 'KxbEv3FeYig2afQp7QEA9R3gwqdTBFwAJJ6Ma7j1SkmZoxC9bAXZ'
const PUBKEY_0 =
  '02bbe7dbcdf8b2261530a867df7180b17a90b482f74f2736b8a30d3f756e42e217'

function wallet(network: 'mainnet' | 'chipnet' = 'mainnet') {
  return new LibauthHDWallet(MNEMONIC, PATH, network)
}

describe('LibauthHDWallet', () => {
  describe('wallet hash', () => {
    it('matches the golden wallet hash', () => {
      expect(wallet().walletHash).toBe(WALLET_HASH)
      expect(wallet().getWalletHash()).toBe(WALLET_HASH)
    })

    it('is stable across repeated derivation', () => {
      expect(wallet().getWalletHash()).toBe(wallet().getWalletHash())
    })

    it('changes when the derivation path changes', () => {
      const other = new LibauthHDWallet(MNEMONIC, "m/44'/0'/0'")
      expect(other.getWalletHash()).not.toBe(WALLET_HASH)
    })
  })

  describe('getMainNode / getNodeAt', () => {
    it('derives a valid private node', () => {
      const node = wallet().getMainNode()
      expect(node.privateKey).toBeInstanceOf(Uint8Array)
      expect(node.privateKey).toHaveLength(32)
    })

    it('accepts relative and absolute paths equivalently', () => {
      const w = wallet()
      expect(w.getPubkeyAt('0/0')).toBe(w.getPubkeyAt('m/0/0'))
      expect(w.getPubkeyAt('0/0')).toBe(w.getPubkeyAt('M/0/0'))
    })

    it('throws on an invalid derivation path', () => {
      expect(() => wallet().getNodeAt('not-a-path')).toThrow()
    })
  })

  describe('key material', () => {
    it('derives the golden WIF and pubkey', () => {
      const w = wallet()
      expect(w.getPrivateKeyWifAt('0/0')).toBe(WIF_0)
      expect(w.getPubkeyAt('0/0')).toBe(PUBKEY_0)
    })

    it('derives distinct receiving and change keys', () => {
      const w = wallet()
      expect(w.getPubkeyAt('0/0')).not.toBe(w.getPubkeyAt('1/0'))
      expect(w.getAddressAt({ path: '0/0' })).not.toBe(
        w.getAddressAt({ path: '1/0' })
      )
    })
  })

  describe('addresses', () => {
    it('derives golden mainnet addresses', () => {
      const w = wallet()
      expect(w.getAddressAt({ path: '0/0' })).toBe(RECEIVE_0)
      expect(w.getAddressAt({ path: '1/0' })).toBe(CHANGE_0)
    })

    it('derives token-aware (z-prefix) addresses', () => {
      const w = wallet()
      expect(w.getAddressAt({ path: '0/0', token: true })).toBe(TOKEN_0)
      expect(TOKEN_0).toMatch(/^bitcoincash:z/)
    })

    it('derives chipnet addresses when configured', () => {
      const w = wallet('chipnet')
      expect(w.isChipnet).toBe(true)
      expect(w.getAddressAt({ path: '0/0' })).toBe(CHIPNET_RECEIVE_0)
      expect(w.getAddressAt({ path: '0/0', token: true })).toBe(CHIPNET_TOKEN_0)
    })

    it('returns receiving and change sets at an index', () => {
      const w = wallet()
      expect(w.getAddressSetAt(0)).toEqual({
        receiving: RECEIVE_0,
        change: CHANGE_0,
      })
    })

    it('returns token-aware sets at an index', () => {
      const w = wallet()
      expect(w.getTokenAddressSetAt(0)).toEqual({
        receiving: TOKEN_0,
        change: expect.stringMatching(/^bitcoincash:z/),
      })
    })
  })

  describe('isChipnet', () => {
    it('defaults to mainnet', () => {
      expect(wallet().isChipnet).toBe(false)
    })

    it('switches network via the setter', () => {
      const w = wallet()
      w.isChipnet = true
      expect(w.isChipnet).toBe(true)
      expect(w.getAddressAt({ path: '0/0' })).toBe(CHIPNET_RECEIVE_0)
      w.isChipnet = false
      expect(w.getAddressAt({ path: '0/0' })).toBe(RECEIVE_0)
    })
  })
})