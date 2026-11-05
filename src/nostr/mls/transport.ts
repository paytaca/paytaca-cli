import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { encodeMlsMessage } from 'ts-mls'
import { NOSTR_GROUP_DATA_EXTENSION_TYPE } from './context.js'
import type { NostrEvent } from '../chat.js'

export const NIP_EE_KP_KIND = 443
export const NIP_EE_WELCOME_KIND = 444
export const NIP_EE_GROUP_EVENT_KIND = 445
export const NIP_EE_RELAY_LIST_KIND = 10051

export const NIP_EE_MLS_PROTOCOL_VERSION = '1.0'
export const NIP_EE_CIPHERSUITE = '0x0001'

const NOSTR_GROUP_DATA_VERSION = 2
const NOSTR_GROUP_ID_LENGTH = 32

export interface NipEeGroupData {
  nostrGroupIdHex: string
  name: string
  description: string
  adminPubkeys: string[]
  relays: string[]
}

export function nip44ConversationKeyFromExporter(exporterSecretBytes: Uint8Array): Uint8Array {
  const receiverPubkey = getPublicKey(exporterSecretBytes)
  return nip44.v2.utils.getConversationKey(exporterSecretBytes, receiverPubkey)
}

export function encryptMlsMessageWithExporter(
  mlsMessageBytes: Uint8Array,
  exporterSecretBytes: Uint8Array
): string {
  const conversationKey = nip44ConversationKeyFromExporter(exporterSecretBytes)
  const ciphertext = nip44.v2.encrypt(bytesToHex(mlsMessageBytes), conversationKey)
  conversationKey.fill(0)
  return ciphertext
}

export function decryptMlsMessageWithExporter(
  ciphertext: string,
  exporterSecretBytes: Uint8Array
): Uint8Array {
  const conversationKey = nip44ConversationKeyFromExporter(exporterSecretBytes)
  const plaintext = nip44.v2.decrypt(ciphertext, conversationKey)
  conversationKey.fill(0)
  return hexToBytes(plaintext)
}

export function buildNipEeKeyPackageEvent(opts: {
  keyPackageHex: string
  nostrPubkeyHex: string
  relays?: string[]
}): NostrEvent {
  const tags: string[][] = [
    ['mls_protocol_version', NIP_EE_MLS_PROTOCOL_VERSION],
    ['ciphersuite', NIP_EE_CIPHERSUITE],
    ['mls_extensions', '0xf2ee'],
  ]
  if (opts.relays && opts.relays.length > 0) {
    tags.push(['relays', ...opts.relays])
  }
  tags.push(['-', ''])

  return {
    kind: NIP_EE_KP_KIND,
    pubkey: opts.nostrPubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    content: opts.keyPackageHex,
    tags,
  } as NostrEvent
}

export function buildNipEeRelayListEvent(relays: string[], nostrPubkeyHex: string): NostrEvent {
  return {
    kind: NIP_EE_RELAY_LIST_KIND,
    pubkey: nostrPubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [...relays.map(relay => ['relays', relay]), ['-', '']],
  } as NostrEvent
}

export function buildNipEeWelcomeEvent(opts: {
  welcomeHex: string
  keyPackageEventId: string
  relays?: string[]
  nostrPubkeyHex: string
}): NostrEvent {
  const tags: string[][] = [['e', opts.keyPackageEventId]]
  if (opts.relays && opts.relays.length > 0) {
    tags.push(['relays', ...opts.relays])
  }

  return {
    kind: NIP_EE_WELCOME_KIND,
    pubkey: opts.nostrPubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    content: opts.welcomeHex,
    tags,
  } as NostrEvent
}

export function buildNipEeGroupEvent(opts: {
  nostrGroupIdHex: string
  mlsMessageBytes: Uint8Array
  exporterSecretBytes: Uint8Array
}): NostrEvent {
  const ephemeralKey = generateSecretKey()
  const event = finalizeEvent(
    {
      kind: NIP_EE_GROUP_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: encryptMlsMessageWithExporter(opts.mlsMessageBytes, opts.exporterSecretBytes),
      tags: [['h', opts.nostrGroupIdHex]],
    },
    ephemeralKey
  )
  ephemeralKey.fill(0)
  return event as unknown as NostrEvent
}

export function serializeNipEeGroupData(opts: {
  nostrGroupIdHex: string
  name?: string
  description?: string
  adminPubkeys?: string[]
  relays?: string[]
}): Uint8Array {
  const nostrGroupId = hexToBytes(opts.nostrGroupIdHex)
  const chunks = [
    encodeU16(NOSTR_GROUP_DATA_VERSION),
    nostrGroupId,
    encodeOpaque16(opts.name || ''),
    encodeOpaque16(opts.description || ''),
    encodeVec16((opts.adminPubkeys || []).map(pk => encodeOpaque16(pk))),
    encodeVec16((opts.relays || []).map(relay => encodeOpaque16(relay))),
  ]

  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export function parseNipEeGroupData(extensionData: Uint8Array): NipEeGroupData | null {
  try {
    let offset = 0
    const version = decodeU16(extensionData, offset)
    offset += 2
    if (version < 1 || version > 3) return null

    const nostrGroupId = extensionData.slice(offset, offset + NOSTR_GROUP_ID_LENGTH)
    if (nostrGroupId.length !== NOSTR_GROUP_ID_LENGTH) return null
    offset += NOSTR_GROUP_ID_LENGTH

    const name = decodeOpaque16Raw(extensionData, offset)
    offset += 2 + name.length

    const descriptionBytes = decodeOpaque16Raw(extensionData, offset)
    offset += 2 + descriptionBytes.length

    const adminCount = decodeU16(extensionData, offset)
    offset += 2
    const adminPubkeys: string[] = []
    for (let i = 0; i < adminCount; i++) {
      const adminBytes = decodeOpaque16Raw(extensionData, offset)
      offset += 2 + adminBytes.length
      adminPubkeys.push(bytesToHex(adminBytes))
    }

    const relayCount = decodeU16(extensionData, offset)
    offset += 2
    const relays: string[] = []
    for (let i = 0; i < relayCount; i++) {
      const relayBytes = decodeOpaque16Raw(extensionData, offset)
      offset += 2 + relayBytes.length
      relays.push(new TextDecoder().decode(relayBytes))
    }

    return {
      nostrGroupIdHex: bytesToHex(nostrGroupId),
      name: new TextDecoder().decode(name),
      description: new TextDecoder().decode(descriptionBytes),
      adminPubkeys,
      relays,
    }
  } catch {
    return null
  }
}

export { NOSTR_GROUP_DATA_EXTENSION_TYPE }

function encodeU16(value: number): Uint8Array {
  const out = new Uint8Array(2)
  out[0] = (value >> 8) & 0xff
  out[1] = value & 0xff
  return out
}

function decodeU16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new Error('nostr_group_data: truncated u16')
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function encodeOpaque16(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const out = new Uint8Array(2 + bytes.length)
  out[0] = (bytes.length >> 8) & 0xff
  out[1] = bytes.length & 0xff
  out.set(bytes, 2)
  return out
}

function decodeOpaque16Raw(bytes: Uint8Array, offset: number): Uint8Array {
  const length = decodeU16(bytes, offset)
  if (offset + 2 + length > bytes.length) throw new Error('nostr_group_data: truncated opaque16')
  return bytes.slice(offset + 2, offset + 2 + length)
}

function encodeVec16(items: Uint8Array[]): Uint8Array {
  const header = encodeU16(items.length)
  let total = header.length
  for (const item of items) total += item.length
  const out = new Uint8Array(total)
  out.set(header, 0)
  let offset = header.length
  for (const item of items) {
    out.set(item, offset)
    offset += item.length
  }
  return out
}

export function encodeMlsMessageForPublish(message: any): Uint8Array {
  return encodeMlsMessage(message)
}
