import { describe, it, expect } from 'vitest'
import { computeRoomId, createUnsignedKind14, createKind10050, tagSelfGiftWraps, type NostrEvent } from './chat.js'

const sender = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

describe('computeRoomId', () => {
  it('should produce a deterministic 64-char hex string', () => {
    const id = computeRoomId(['a', 'b'])
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should produce the same ID regardless of input order', () => {
    const id1 = computeRoomId(['abc', 'def'])
    const id2 = computeRoomId(['def', 'abc'])
    expect(id1).toBe(id2)
  })

  it('should produce different IDs for different member sets', () => {
    const id1 = computeRoomId(['abc', 'def'])
    const id2 = computeRoomId(['abc', 'xyz'])
    expect(id1).not.toBe(id2)
  })

  it('should handle a single member', () => {
    const id = computeRoomId(['only'])
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('createUnsignedKind14', () => {
  it('should create a kind 14 event with correct fields', () => {
    const event = createUnsignedKind14({
      content: 'hello',
      senderPubKey: sender,
      members: ['alice', 'bob', sender],
    })
    expect(event.kind).toBe(14)
    expect(event.content).toBe('hello')
    expect(event.pubkey).toBe(sender)
    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should include p tags for non-self members only', () => {
    const event = createUnsignedKind14({
      content: 'test',
      senderPubKey: sender,
      members: ['alice', 'bob', sender],
    })
    const pTags = event.tags.filter(t => t[0] === 'p')
    expect(pTags).toHaveLength(2)
    expect(pTags[0][1]).toBe('alice')
    expect(pTags[1][1]).toBe('bob')
  })

  it('should include subject tag when provided', () => {
    const event = createUnsignedKind14({
      content: 'hi',
      senderPubKey: sender,
      members: [sender, 'alice'],
      subject: 'greeting',
    })
    const subject = event.tags.find(t => t[0] === 'subject')
    expect(subject?.[1]).toBe('greeting')
  })

  it('should include e tag for replyTo', () => {
    const event = createUnsignedKind14({
      content: 'reply',
      senderPubKey: sender,
      members: [sender, 'alice'],
      replyTo: 'abc123',
    })
    const eTag = event.tags.find(t => t[0] === 'e')
    expect(eTag?.[1]).toBe('abc123')
  })

  it('should include edit tag for editOf', () => {
    const event = createUnsignedKind14({
      content: 'edit',
      senderPubKey: sender,
      members: [sender, 'alice'],
      editOf: 'orig123',
    })
    const edit = event.tags.find(t => t[0] === 'edit')
    expect(edit?.[1]).toBe('orig123')
  })
})

describe('tagSelfGiftWraps', () => {
  const makeGw = (overrides = {}): NostrEvent => ({
    id: 'abc',
    pubkey: 'sender',
    created_at: 1000,
    kind: 1059,
    tags: [],
    content: 'encrypted',
    sig: 'sig',
    ...overrides,
  })

  it('should add self tag to the first gift-wrap', () => {
    const wraps = [makeGw()]
    const result = tagSelfGiftWraps(wraps, ['bob'], 'sender')
    expect(result[0].tags).toContainEqual(['self'])
  })

  it('should add self tag when previous recipient is the sender', () => {
    const wraps = [makeGw(), makeGw({ id: 'def' })]
    const result = tagSelfGiftWraps(wraps, ['sender', 'bob'], 'sender')
    expect(result[0].tags).toContainEqual(['self'])
    expect(result[1].tags).toContainEqual(['self'])
  })

  it('should not modify other gift-wraps', () => {
    const wraps = [makeGw({ id: '1' }), makeGw({ id: '2' })]
    const result = tagSelfGiftWraps(wraps, ['alice', 'bob'], 'sender')
    expect(result[0].tags).toContainEqual(['self'])
    expect(result[1].tags).toHaveLength(0)
  })
})

describe('createKind10050', () => {
  const testRelays = ['wss://relay1.com', 'wss://relay2.com']
  const privKeyHex = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

  it('should create a kind 10050 event with relay tags', () => {
    const event = createKind10050(testRelays, privKeyHex)
    expect(event.kind).toBe(10050)
    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    const relayTags = event.tags.filter(t => t[0] === 'relay')
    expect(relayTags).toHaveLength(2)
    expect(relayTags[0][1]).toBe('wss://relay1.com')
    expect(relayTags[1][1]).toBe('wss://relay2.com')
  })
})
