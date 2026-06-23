import { describe, it, expect, beforeEach, vi } from 'vitest'

const memFs = new Map<string, string>()

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => memFs.has(p)),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((p: string) => memFs.get(p)),
  writeFileSync: vi.fn((p: string, data: string) => { memFs.set(p, data) }),
}))

import * as fs from 'fs'

const mockPubKey = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const mockPrivKey = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

const mockKeys = {
  privKeyHex: mockPrivKey,
  pubKeyHex: mockPubKey,
  npub: 'npub1test',
}

vi.mock('./keys.js', () => ({
  deriveNostrKeys: vi.fn(() => mockKeys),
}))

const mockPublish = vi.fn()
const mockFetchHistoricalGiftWraps = vi.fn()
const mockSubscribeGiftWraps = vi.fn()
const mockFetchDisplayName = vi.fn()
const mockFetchBchAddress = vi.fn()
const mockFetchKind10050 = vi.fn()
const mockSetAuthKey = vi.fn()
const mockIsSubscribed = vi.fn(() => false)
const mockDisconnect = vi.fn()
const mockCleanup = vi.fn()

vi.mock('./relay.js', () => ({
  relayService: {
    publish: mockPublish,
    fetchHistoricalGiftWraps: mockFetchHistoricalGiftWraps,
    subscribeGiftWraps: mockSubscribeGiftWraps,
    fetchDisplayName: mockFetchDisplayName,
    fetchBchAddress: mockFetchBchAddress,
    fetchKind10050: mockFetchKind10050,
    setAuthKey: mockSetAuthKey,
    isSubscribed: mockIsSubscribed,
    disconnect: mockDisconnect,
    cleanup: mockCleanup,
  },
}))

vi.mock('./chat.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createNip17GiftWraps: vi.fn(),
  }
})

const { ChatStore } = await import('./store.js')
const chatModule = await import('./chat.js')
import type { NostrEvent } from './chat.js'

const bobPub = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const alicePub = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('ChatStore', () => {
  let store: ChatStore

  beforeEach(() => {
    memFs.clear()
    vi.clearAllMocks()
    store = new ChatStore()
  })

  describe('constructor / loadPersistedData', () => {
    it('should start with empty state when no persisted file exists', () => {
      expect(store.contacts).toEqual([])
      expect(store.rooms).toEqual([])
      expect(store.messages).toEqual({})
      expect(store.sentMessages).toEqual({})
      expect(store.readMessageIds).toEqual({})
      expect(store.displayNameCache).toEqual({})
      expect(store.bchAddressCache).toEqual({})
    })

    it('should load persisted state from file', () => {
      memFs.set('/Users/joemartaganna/.paytaca', '')
      memFs.set(
        '/Users/joemartaganna/.paytaca/chat-state.json',
        JSON.stringify({
          contacts: [{ name: 'Alice', npub: 'npub1alice', pubKeyHex: bobPub, addedAt: 100 }],
          displayNameCache: { bb: 'Bob' },
          bchAddressCache: { cc: 'bitcoincash:abc' },
          readMessageIds: { room1: { msg1: true } },
          sentMessages: { room1: [{ id: 'm1', content: 'hi', sender: 'me', created_at: 200 }] },
        })
      )
      const s = new ChatStore()
      expect(s.contacts).toHaveLength(1)
      expect(s.contacts[0].name).toBe('Alice')
      expect(s.displayNameCache).toEqual({ bb: 'Bob' })
      expect(s.bchAddressCache).toEqual({ cc: 'bitcoincash:abc' })
      expect(s.readMessageIds).toEqual({ room1: { msg1: true } })
    })

    it('should merge sent messages into messages in-memory', () => {
      memFs.set('/Users/joemartaganna/.paytaca', '')
      memFs.set(
        '/Users/joemartaganna/.paytaca/chat-state.json',
        JSON.stringify({
          contacts: [],
          displayNameCache: {},
          bchAddressCache: {},
          readMessageIds: {},
          sentMessages: {
            room1: [{ id: 'm1', content: 'hello', sender: 'me', created_at: 100 }],
          },
        })
      )
      const s = new ChatStore()
      expect(s.messages.room1).toHaveLength(1)
      expect(s.messages.room1[0].content).toBe('hello')
    })
  })

  describe('saveState', () => {
    it('should persist current state to file', () => {
      store.contacts.push({ name: 'Test', npub: 'npub1test', pubKeyHex: bobPub, addedAt: 1 })
      store.saveState()
      expect(fs.writeFileSync).toHaveBeenCalled()
      const written = (fs.writeFileSync as any).mock.calls[0][1]
      const parsed = JSON.parse(written)
      expect(parsed.contacts).toHaveLength(1)
      expect(parsed.contacts[0].name).toBe('Test')
    })
  })

  describe('initialize', () => {
    it('should derive keys, set auth key, publish kind10050, fetch historical', async () => {
      mockPublish.mockResolvedValue({ accepted: [], errors: [] })
      mockFetchHistoricalGiftWraps.mockResolvedValue(undefined)

      await store.initialize('test mnemonic')

      expect(store.keys).toBe(mockKeys)
      expect(mockSetAuthKey).toHaveBeenCalledWith(mockKeys.privKeyHex)
      expect(mockPublish).toHaveBeenCalled()
      expect(mockFetchHistoricalGiftWraps).toHaveBeenCalledWith(
        ['wss://relay.paytaca.com'],
        mockKeys.pubKeyHex,
        expect.any(Object)
      )
      expect(store.initialized).toBe(true)
    })

    it('should handle errors gracefully', async () => {
      mockPublish.mockRejectedValue(new Error('publish fail'))
      mockFetchHistoricalGiftWraps.mockRejectedValue(new Error('fetch fail'))

      await store.initialize('test mnemonic')

      expect(store.initialized).toBe(true)
    })
  })

  describe('receiveMessage', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
      vi.clearAllMocks()
    })

    it('should create a new room for a kind 14 rumor', () => {
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'hello',
        tags: [['p', bobPub]],
        id: 'msg1',
      })

      expect(store.rooms).toHaveLength(1)
      expect(store.rooms[0].type).toBe('private')
    })

    it('should add message to existing room', () => {
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'first',
        tags: [['p', bobPub]],
        id: 'm1',
      })

      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 2000,
        content: 'second',
        tags: [['p', bobPub]],
        id: 'm2',
      })

      const roomId = store.rooms[0].id
      expect(store.messages[roomId]).toHaveLength(2)
      expect(store.messages[roomId][0].content).toBe('first')
      expect(store.messages[roomId][1].content).toBe('second')
    })

    it('should handle editOf by updating target message content', () => {
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'original',
        tags: [['p', bobPub]],
        id: 'orig',
      })

      const roomId = store.rooms[0].id
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 2000,
        content: 'edited',
        tags: [['p', bobPub], ['edit', 'orig']],
        id: 'edit1',
      })

      const msg = store.messages[roomId][0]
      expect(msg.content).toBe('edited')
      expect(msg.editOf).toBe('edit1')
    })

    it('should buffer edits when target message not yet received', () => {
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 2000,
        content: 'edited',
        tags: [['p', bobPub], ['edit', 'not-here-yet']],
        id: 'edit1',
      })

      expect(Object.keys(store.messages)).toHaveLength(0)

      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'original',
        tags: [['p', bobPub]],
        id: 'not-here-yet',
      })

      const roomId = store.rooms[0].id
      const msg = store.messages[roomId].find(m => m.id === 'not-here-yet')
      expect(msg?.content).toBe('edited')
    })

    it('should ignore non-14 kind rumors', () => {
      store.receiveMessage({
        kind: 1,
        pubkey: bobPub,
        created_at: 1000,
        content: 'hello',
        tags: [],
        id: 'note1',
      })

      expect(store.rooms).toHaveLength(0)
    })

    it('should ignore duplicate messages', () => {
      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'hello',
        tags: [['p', bobPub]],
        id: 'msg1',
      })

      store.receiveMessage({
        kind: 14,
        pubkey: bobPub,
        created_at: 1000,
        content: 'hello',
        tags: [['p', bobPub]],
        id: 'msg1',
      })

      const roomId = store.rooms[0].id
      expect(store.messages[roomId]).toHaveLength(1)
    })

    it('should skip self-wrapped gift wraps via subscribe filter', () => {
      const selfTaggedEvent: NostrEvent = {
        id: 'gw1',
        pubkey: 'alice',
        created_at: 1000,
        kind: 1059,
        tags: [['self']],
        content: 'encrypted',
        sig: 'sig',
      }

      store.subscribe((event) => {})
      expect(mockSubscribeGiftWraps).toHaveBeenCalled()
    })
  })

  describe('sendMessage', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
      vi.clearAllMocks()
      vi.mocked(chatModule.createNip17GiftWraps).mockResolvedValue([])
    })

    it('should throw when not initialized', async () => {
      const emptyStore = new ChatStore()
      await expect(emptyStore.sendMessage('room1', 'hi')).rejects.toThrow('Not initialized')
    })

    it('should throw when room not found', async () => {
      await expect(store.sendMessage('nonexistent', 'hi')).rejects.toThrow('Room not found')
    })

    it('should create message and save to sentMessages', async () => {
      store.rooms.push({ id: 'room1', type: 'private', name: 'Test', members: [mockPubKey, bobPub], subject: null, createdAt: 1, updatedAt: 1 })

      const result = await store.sendMessage('room1', 'hello world')

      expect(result.message.content).toBe('hello world')
      expect(result.message.sender).toBe(mockPubKey)
      expect(store.sentMessages.room1).toHaveLength(1)
      expect(store.sentMessages.room1[0].id).toBe(result.message.id)
    })
  })

  describe('publishGiftWraps', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
      vi.clearAllMocks()
    })

    it('should collect recipient relays and publish', async () => {
      mockFetchKind10050.mockResolvedValue({
        kind: 10050,
        tags: [['relay', 'wss://user-relay.com']],
        content: '',
        created_at: 1000,
        pubkey: bobPub,
        id: '10050id',
        sig: 'sig',
      })
      mockPublish.mockResolvedValue({ accepted: ['wss://relay.paytaca.com'], errors: [] })

      const giftWraps: NostrEvent[] = [{
        id: 'gw1',
        pubkey: 'alice',
        created_at: 1000,
        kind: 1059,
        tags: [['p', bobPub]],
        content: 'encrypted',
        sig: 'sig',
      }]

      const result = await store.publishGiftWraps(giftWraps)

      expect(mockFetchKind10050).toHaveBeenCalled()
      expect(mockPublish).toHaveBeenCalled()
      expect(result.accepted).toContain('wss://relay.paytaca.com')
    })
  })

  describe('getRooms', () => {
    it('should return rooms sorted by updatedAt descending', () => {
      store.keys = mockKeys
      store.rooms.push({ id: 'r1', type: 'private', name: 'A', members: [mockPubKey, 'a'], subject: null, createdAt: 1, updatedAt: 3 })
      store.rooms.push({ id: 'r2', type: 'private', name: 'B', members: [mockPubKey, 'b'], subject: null, createdAt: 2, updatedAt: 5 })

      const rooms = store.getRooms()
      expect(rooms).toHaveLength(2)
      expect(rooms[0].id).toBe('r2')
      expect(rooms[1].id).toBe('r1')
    })

    it('should return empty array when not initialized', () => {
      expect(new ChatStore().getRooms()).toEqual([])
    })
  })

  describe('getRoom', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should find room by exact ID', () => {
      store.rooms.push({ id: 'abc123', type: 'private', name: 'Test', members: [], subject: null, createdAt: 1, updatedAt: 1 })
      expect(store.getRoom('abc123')?.name).toBe('Test')
    })

    it('should find room by prefix', () => {
      store.rooms.push({ id: 'abcdef', type: 'private', name: 'Prefix', members: [], subject: null, createdAt: 1, updatedAt: 1 })
      expect(store.getRoom('abc')?.name).toBe('Prefix')
    })

    it('should return undefined for unknown room', () => {
      expect(store.getRoom('nonexistent')).toBeUndefined()
    })
  })

  describe('addContact / removeContact', () => {
    it('should add a new contact', () => {
      const contact = store.addContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4', 'Alice')
      expect(contact.name).toBe('Alice')
      expect(store.contacts).toHaveLength(1)
    })

    it('should return existing contact without duplicate', () => {
      store.addContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4', 'Alice')
      const contact = store.addContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4', 'Alice')
      expect(store.contacts).toHaveLength(1)
      expect(contact.name).toBe('Alice')
    })

    it('should throw for invalid npub', () => {
      expect(() => store.addContact('invalid')).toThrow()
    })

    it('should remove a contact', () => {
      store.addContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4', 'Alice')
      store.removeContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4')
      expect(store.contacts).toHaveLength(0)
    })
  })

  describe('startConversation', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should throw if contact not found', () => {
      expect(() => store.startConversation('npub1alice')).toThrow('Contact not found')
    })

    it('should create a new room for the contact', () => {
      store.addContact('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4', 'Alice')
      const room = store.startConversation('npub1j9hjjlhcsdu0nlmh6lpek6dahqxe6wlvh8lc2g7lm2vf3dq7tjksz9haa4')
      expect(room.type).toBe('private')
      expect(room.members).toContain(mockPubKey)
      expect(room.members).toContain(store.contacts[0].pubKeyHex)
    })
  })

  describe('resolveDisplayName', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should return contact name if available', async () => {
      store.contacts.push({ name: 'Alice', npub: 'npub1alice', pubKeyHex: bobPub, addedAt: 1 })
      const name = await store.resolveDisplayName(bobPub)
      expect(name).toBe('Alice')
    })

    it('should fetch from relay if not cached', async () => {
      mockFetchDisplayName.mockResolvedValue('RelayName')
      const name = await store.resolveDisplayName(bobPub)
      expect(name).toBe('RelayName')
      expect(store.displayNameCache[bobPub]).toBe('RelayName')
    })
  })

  describe('resolveBchAddress', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should return cached address', async () => {
      store.bchAddressCache[bobPub] = 'bitcoincash:abc'
      const addr = await store.resolveBchAddress(bobPub)
      expect(addr).toBe('bitcoincash:abc')
    })

    it('should fetch from relay if not cached', async () => {
      mockFetchBchAddress.mockResolvedValue('bitcoincash:xyz')
      const addr = await store.resolveBchAddress(bobPub)
      expect(addr).toBe('bitcoincash:xyz')
      expect(store.bchAddressCache[bobPub]).toBe('bitcoincash:xyz')
    })
  })

  describe('subscribe / unsubscribe / cleanup', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should subscribe to gift wraps', () => {
      store.subscribe()
      expect(mockSubscribeGiftWraps).toHaveBeenCalled()
    })

    it('should disconnect on unsubscribe', () => {
      store.unsubscribe()
      expect(mockDisconnect).toHaveBeenCalled()
      expect(store.isSubscribed).toBe(false)
    })

    it('should cleanup', () => {
      store.cleanup()
      expect(mockCleanup).toHaveBeenCalled()
      expect(store.isSubscribed).toBe(false)
    })
  })

  describe('getOtherMember', () => {
    beforeEach(async () => {
      await store.initialize('test mnemonic')
    })

    it('should return the other member in a room', () => {
      const other = store.getOtherMember({ id: 'r1', type: 'private', name: 'Test', members: [mockPubKey, bobPub], subject: null, createdAt: 1, updatedAt: 1 })
      expect(other).toBe(bobPub)
    })

    it('should return null when not initialized', () => {
      expect(new ChatStore().getOtherMember({ id: 'r1', type: 'private', name: 'Test', members: [], subject: null, createdAt: 1, updatedAt: 1 })).toBeNull()
    })
  })
})
