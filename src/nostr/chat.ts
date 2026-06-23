import {
  getEventHash,
  finalizeEvent,
} from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { nip44 } from 'nostr-tools'
import { nip59 } from 'nostr-tools'
import { sha256 } from 'js-sha256'

export interface UnsignedKind14 {
  kind: 14
  pubkey: string
  created_at: number
  content: string
  tags: string[][]
  id: string
}

export interface Rumor {
  kind: number
  pubkey: string
  created_at: number
  content: string
  tags: string[][]
  id?: string
}

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export function createUnsignedKind14(opts: {
  content: string
  senderPubKey: string
  members: string[]
  subject?: string | null
  replyTo?: string
  editOf?: string
}): UnsignedKind14 {
  const tags: string[][] = []
  for (const member of opts.members) {
    if (member !== opts.senderPubKey) {
      tags.push(['p', member])
    }
  }
  if (opts.subject !== undefined && opts.subject !== null) tags.push(['subject', opts.subject])
  if (opts.replyTo) tags.push(['e', opts.replyTo])
  if (opts.editOf) tags.push(['edit', opts.editOf])

  const event = {
    kind: 14 as const,
    pubkey: opts.senderPubKey,
    created_at: Math.floor(Date.now() / 1000),
    content: opts.content,
    tags,
  }
  ;(event as any).id = getEventHash(event)
  return event as UnsignedKind14
}

function tagSelfGiftWraps(
  giftWraps: NostrEvent[],
  recipientPubKeys: string[],
  senderPubKey: string
): NostrEvent[] {
  return giftWraps.map((gw, i) => {
    if (i === 0 || recipientPubKeys[i - 1] === senderPubKey) {
      return { ...gw, tags: [...gw.tags, ['self']] }
    }
    return gw
  })
}

export async function createNip17GiftWraps(
  unsignedKind14: UnsignedKind14,
  senderPrivKey: string,
  receiverPubKeys: string[],
  senderPubKey?: string
): Promise<NostrEvent[]> {
  const senderPrivKeyBytes = hexToBytes(senderPrivKey)
  const giftWraps = nip59.wrapManyEvents(unsignedKind14 as any, senderPrivKeyBytes, receiverPubKeys) as unknown as NostrEvent[]
  if (senderPubKey) {
    return tagSelfGiftWraps(giftWraps, receiverPubKeys, senderPubKey)
  }
  return giftWraps
}

export function unwrapGiftWrap(
  giftWrap: NostrEvent,
  receiverPrivKey: string
): { rumor: Rumor; sealPubkey: string } {
  const receiverPrivKeyBytes = hexToBytes(receiverPrivKey)
  const rumor = nip59.unwrapEvent(giftWrap as any, receiverPrivKeyBytes) as unknown as Rumor

  try {
    const conversationKey = nip44.getConversationKey(receiverPrivKeyBytes, giftWrap.pubkey)
    const sealJson = nip44.decrypt(giftWrap.content, conversationKey)
    const seal = JSON.parse(sealJson)
    if (seal.pubkey !== rumor.pubkey) {
      throw new Error('Seal pubkey does not match rumor pubkey')
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Seal pubkey does not match rumor pubkey') throw err
  }

  return { rumor, sealPubkey: rumor.pubkey }
}

export function computeRoomId(pubkeys: string[]): string {
  const sorted = pubkeys.slice().sort()
  const hashInput = sorted.join(',')
  return sha256(hashInput)
}

export function createKind10050(relays: string[], privKey: string): NostrEvent {
  const tags = relays.map(url => ['relay', url])
  const event = {
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }
  const privKeyBytes = hexToBytes(privKey)
  return finalizeEvent(event, privKeyBytes) as unknown as NostrEvent
}


