import { describe, it, expect, beforeEach, vi } from 'vitest'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('@napi-rs/keyring', () => {
  class Entry {
    service: string
    key: string

    constructor(service: string, key: string) {
      this.service = service
      this.key = key
    }

    private id(): string {
      return `${this.service}\u0000${this.key}`
    }

    setPassword(value: string): void {
      store.set(this.id(), value)
    }

    getPassword(): string {
      const value = store.get(this.id())
      if (value === undefined) throw new Error('No matching entry')
      return value
    }

    deletePassword(): void {
      if (!store.delete(this.id())) throw new Error('No matching entry')
    }
  }

  return { Entry }
})

import {
  setSecret,
  getSecret,
  deleteSecret,
  storeMnemonic,
  getMnemonic,
  deleteMnemonic,
  setActiveWallet,
  getActiveWallet,
  clearActiveWallet,
} from './keychain.js'

const KEY = 'mn_abc123'
const VALUE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('keychain', () => {
  beforeEach(() => {
    store.clear()
  })

  describe('secret primitives', () => {
    it('stores and retrieves a value under the paytaca-cli service', () => {
      setSecret(KEY, VALUE)
      expect(store.get(`paytaca-cli\u0000${KEY}`)).toBe(VALUE)
      expect(getSecret(KEY)).toBe(VALUE)
    })

    it('returns null when the key does not exist', () => {
      expect(getSecret('missing')).toBeNull()
    })

    it('deletes a stored value', () => {
      setSecret(KEY, VALUE)
      deleteSecret(KEY)
      expect(getSecret(KEY)).toBeNull()
    })

    it('does not throw when deleting a missing key', () => {
      expect(() => deleteSecret('missing')).not.toThrow()
    })
  })

  describe('wallet helpers', () => {
    it('stores a mnemonic keyed by wallet hash', () => {
      storeMnemonic(VALUE, 'hash1')
      expect(store.get('paytaca-cli\u0000mn_hash1')).toBe(VALUE)
      expect(getMnemonic('hash1')).toBe(VALUE)
    })

    it('returns null for an unknown wallet hash', () => {
      expect(getMnemonic('nope')).toBeNull()
    })

    it('deletes a mnemonic by wallet hash', () => {
      storeMnemonic(VALUE, 'hash1')
      deleteMnemonic('hash1')
      expect(getMnemonic('hash1')).toBeNull()
    })

    it('sets, gets, and clears the active wallet', () => {
      setActiveWallet('hash1')
      expect(getActiveWallet()).toBe('hash1')
      expect(store.get('paytaca-cli\u0000active_wallet')).toBe('hash1')

      clearActiveWallet()
      expect(getActiveWallet()).toBeNull()
    })

    it('returns null when no active wallet is set', () => {
      expect(getActiveWallet()).toBeNull()
    })
  })
})