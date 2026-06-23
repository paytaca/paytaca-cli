import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getEventHash } from 'nostr-tools'
import { decode as nip19Decode } from 'nostr-tools/nip19'
import { deriveNostrKeys, type NostrKeys } from './keys.js'
import {
  createUnsignedKind14,
  createNip17GiftWraps,
  unwrapGiftWrap,
  computeRoomId,
  createKind10050,
  type NostrEvent,
  type Rumor,
  type UnsignedKind14,
} from './chat.js'
import { relayService } from './relay.js'

const DEFAULT_RELAYS = ['wss://relay.paytaca.com']
const DISCOVERY_RELAYS = ['wss://relay.paytaca.com']
const DATA_DIR = path.join(os.homedir(), '.paytaca')
const STATE_FILE = path.join(DATA_DIR, 'chat-state.json')

const MAX_MESSAGES_PER_ROOM = 1000

export interface Contact {
  name: string
  npub: string
  pubKeyHex: string
  addedAt: number
}

export interface Room {
  id: string
  type: 'private' | 'group'
  name: string
  members: string[]
  subject: string | null
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: string
  content: string
  sender: string
  created_at: number
  kind14Id?: string
  replyTo?: string | null
  editOf?: string | null
  localSentAt?: number
  localReceivedAt?: number
}

interface PersistedState {
  contacts: Contact[]
  displayNameCache: Record<string, string>
  bchAddressCache: Record<string, string>
  readMessageIds: Record<string, Record<string, boolean>>
  sentMessages: Record<string, Message[]>
}

export class ChatStore {
  keys: NostrKeys | null = null
  relays: string[] = [...DEFAULT_RELAYS]
  contacts: Contact[] = []
  rooms: Room[] = []
  messages: Record<string, Message[]> = {}
  sentMessages: Record<string, Message[]> = {}
  readMessageIds: Record<string, Record<string, boolean>> = {}
  initialized = false
  isSubscribed = false
  displayNameCache: Record<string, string> = {}
  bchAddressCache: Record<string, string> = {}

  private onNewMessageCallback: ((room: Room, message: Message) => void) | null = null
  private pendingEdits = new Map<string, Rumor[]>()

  constructor() {
    this.loadPersistedData()
  }

  setOnNewMessage(cb: ((room: Room, message: Message) => void) | null): void {
    this.onNewMessageCallback = cb
  }

  private stateFilePath(): string {
    return STATE_FILE
  }

  private loadPersistedData(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      if (fs.existsSync(this.stateFilePath())) {
        const data = JSON.parse(fs.readFileSync(this.stateFilePath(), 'utf-8')) as PersistedState
        this.contacts = data.contacts || []
        this.readMessageIds = data.readMessageIds || {}
        this.displayNameCache = data.displayNameCache || {}
        this.bchAddressCache = data.bchAddressCache || {}
        this.sentMessages = data.sentMessages || {}

        // Merge sent messages into messages in-memory
        for (const [roomId, msgs] of Object.entries(this.sentMessages)) {
          if (!this.messages[roomId]) this.messages[roomId] = []
          for (const msg of msgs) {
            const exists = this.messages[roomId].find(m => m.id === msg.id)
            if (!exists) {
              const arr = this.messages[roomId]
              let i = arr.length
              while (i > 0 && arr[i - 1].created_at > msg.created_at) i--
              arr.splice(i, 0, msg)
            }
          }
        }
      }
    } catch (err) {
      console.error('[store] loadPersistedData failed:', err)
    }
  }

  saveState(): void {
    try {
      const data: PersistedState = {
        contacts: this.contacts,
        displayNameCache: this.displayNameCache,
        bchAddressCache: this.bchAddressCache,
        readMessageIds: this.readMessageIds,
        sentMessages: this.sentMessages,
      }
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      fs.writeFileSync(this.stateFilePath(), JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
    } catch (err) {
      console.error('[store] saveState failed:', err)
    }
  }

  async initialize(mnemonic: string): Promise<void> {
    const keys = deriveNostrKeys(mnemonic)
    this.keys = keys

    relayService.setAuthKey(keys.privKeyHex)

    try {
      await relayService.publish(this.relays, createKind10050(this.relays, keys.privKeyHex))
    } catch (err) {
      console.error('[store] publish kind10050 failed:', err)
    }

    try {
      await relayService.fetchHistoricalGiftWraps(DISCOVERY_RELAYS, keys.pubKeyHex, {
        onEvent: (event) => {
          try {
            const { rumor } = unwrapGiftWrap(event, keys.privKeyHex)
            this.receiveMessage(rumor)
          } catch {
          }
        },
      })
    } catch (err) {
      console.error('[store] fetchHistoricalGiftWraps failed:', err)
    }

    this.initialized = true
  }

  subscribe(onEvent?: (event: NostrEvent) => void): void {
    if (!this.keys) return

    const sub = relayService.subscribeGiftWraps(
      this.relays,
      this.keys.pubKeyHex,
      {
        onEvent: onEvent || ((event: NostrEvent) => {
          try {
            const { rumor } = unwrapGiftWrap(event, this.keys!.privKeyHex)
            this.receiveMessage(rumor)
          } catch {
          }
        }),
      }
    )
    this.isSubscribed = relayService.isSubscribed()
  }

  unsubscribe(): void {
    relayService.disconnect()
    this.isSubscribed = false
  }

  cleanup(): void {
    relayService.cleanup()
    this.isSubscribed = false
  }

  async sendMessage(roomId: string, text: string): Promise<{ giftWraps: NostrEvent[]; message: Message }> {
    if (!this.keys) throw new Error('Not initialized')

    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')

    const senderPrivKey = this.keys.privKeyHex
    const senderPubKey = this.keys.pubKeyHex

    const memberHexes = room.members.map(m => {
      if (m.startsWith('npub1')) {
        const decoded = nip19Decode(m)
        return decoded.data as string
      }
      return m
    })

    const unsignedKind14 = createUnsignedKind14({
      content: text,
      senderPubKey,
      members: memberHexes,
    })

    const giftWraps = await createNip17GiftWraps(unsignedKind14, senderPrivKey, memberHexes, senderPubKey)

    const message: Message = {
      id: unsignedKind14.id,
      content: text,
      sender: senderPubKey,
      created_at: unsignedKind14.created_at,
      kind14Id: unsignedKind14.id,
      localSentAt: Date.now(),
    }

    if (!this.sentMessages[roomId]) this.sentMessages[roomId] = []
    this.sentMessages[roomId].push(message)

    return { giftWraps, message }
  }

  async publishGiftWraps(giftWraps: NostrEvent[]): Promise<{ accepted: string[]; errors: { relay: string; reason: string }[] }> {
    let targetRelays = new Set(this.relays)

    const recipients = giftWraps
      .map(gw => gw.tags.find(t => t[0] === 'p')?.[1])
      .filter(r => r && r !== this.keys?.pubKeyHex) as string[]
    const uniqueRecipients = [...new Set(recipients)]

    const relayResults = await Promise.allSettled(
      uniqueRecipients.map(recipient => relayService.fetchKind10050(this.relays, recipient))
    )
    for (const result of relayResults) {
      if (result.status === 'fulfilled' && result.value?.tags) {
        for (const tag of result.value.tags) {
          if (tag[0] === 'relay' && tag[1]) targetRelays.add(tag[1])
        }
      }
    }

    return relayService.publish(Array.from(targetRelays), giftWraps)
  }

  receiveMessage(rumor: Rumor): void {
    if (!this.keys) return
    if (!rumor.id) {
      rumor.id = getEventHash(rumor)
    }

    const myPubKey = this.keys.pubKeyHex

    if (rumor.kind !== 14) return

    const pTags = rumor.tags.filter(t => t[0] === 'p').map(t => t[1])
    const roomMembers = [...new Set([myPubKey, rumor.pubkey, ...pTags])]
    const roomId = computeRoomId(roomMembers)

    let room = this.rooms.find(r => r.id === roomId)
    if (!room) {
      const isGroup = roomMembers.length > 2
      const contact = this.contacts.find(c => c.pubKeyHex === rumor.pubkey)
      const cachedName = this.displayNameCache[rumor.pubkey]
      const roomName = contact?.name || cachedName || rumor.pubkey.slice(0, 12) + '...'
      room = {
        id: roomId,
        type: isGroup ? 'group' : 'private',
        name: roomName,
        members: roomMembers,
        subject: null,
        createdAt: rumor.created_at,
        updatedAt: rumor.created_at,
      }
      this.rooms.push(room)
    }

    const replyTo = rumor.tags.find(t => t[0] === 'e')?.[1] || null
    const editOf = rumor.tags.find(t => t[0] === 'edit')?.[1] || null

    if (editOf) {
      const msgs = this.messages[roomId] || []
      const target = msgs.find(m => m.id === editOf)
      if (target) {
        target.content = rumor.content
        target.editOf = rumor.id
        room.updatedAt = Math.max(room.updatedAt, rumor.created_at)
        if (this.onNewMessageCallback) {
          this.onNewMessageCallback(room, target)
        }
        return
      }
      const existing = this.pendingEdits.get(editOf) || []
      existing.push(rumor)
      if (existing.length > 10) existing.shift()
      this.pendingEdits.set(editOf, existing)
      if (this.pendingEdits.size > 100) {
        const first = this.pendingEdits.keys().next().value
        if (first) this.pendingEdits.delete(first)
      }
      return
    }

    const message: Message = {
      id: rumor.id,
      content: rumor.content,
      sender: rumor.pubkey,
      created_at: rumor.created_at,
      kind14Id: rumor.id,
      replyTo,
      editOf,
      localReceivedAt: Date.now(),
    }

    if (!this.messages[roomId]) {
      this.messages[roomId] = []
    }
    const exists = this.messages[roomId].find(m => m.id === message.id)
    if (!exists) {
      const arr = this.messages[roomId]
      let i = arr.length
      while (i > 0 && arr[i - 1].created_at > message.created_at) i--
      arr.splice(i, 0, message)
      if (arr.length > MAX_MESSAGES_PER_ROOM) {
        arr.splice(0, arr.length - MAX_MESSAGES_PER_ROOM)
      }
    }

    room.updatedAt = Math.max(room.updatedAt, message.created_at)

    const readIds = this.readMessageIds[roomId]
    if (readIds) {
      const keys = Object.keys(readIds)
      if (keys.length > MAX_MESSAGES_PER_ROOM) {
        const toRemove = keys.slice(0, keys.length - MAX_MESSAGES_PER_ROOM)
        for (const k of toRemove) delete readIds[k]
      }
    }

    const pending = this.pendingEdits.get(message.id)
    if (pending) {
      this.pendingEdits.delete(message.id)
      for (const editRumor of pending) {
        const editOf = editRumor.tags.find(t => t[0] === 'edit')?.[1]
        if (editOf === message.id) {
          message.content = editRumor.content
          message.editOf = editRumor.id
        }
      }
    }

    if (this.onNewMessageCallback) {
      this.onNewMessageCallback(room, message)
    }
  }

  getRooms(): Room[] {
    if (!this.keys) return []
    return this.rooms
      .filter(r => r.members?.includes(this.keys!.pubKeyHex))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  getMessages(roomId: string): Message[] {
    return this.messages[roomId] || []
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.find(r => r.id === roomId || r.id.startsWith(roomId))
  }

  addContact(npub: string, name?: string): Contact {
    const decoded = nip19Decode(npub)
    if (decoded.type !== 'npub') throw new Error('Invalid npub')
    const pubKeyHex = decoded.data as string

    const existing = this.contacts.find(c => c.npub === npub)
    if (existing) {
      if (name) {
        existing.name = name
        this.saveState()
      }
      return existing
    }

    const resolvedName = name?.trim() || pubKeyHex.slice(0, 12) + '...'
    const contact: Contact = {
      name: resolvedName,
      npub,
      pubKeyHex,
      addedAt: Date.now(),
    }
    this.contacts.push(contact)
    this.saveState()
    return contact
  }

  removeContact(npub: string): void {
    this.contacts = this.contacts.filter(c => c.npub !== npub)
    this.saveState()
  }

  getContactName(pubKeyHex: string): string {
    const contact = this.contacts.find(c => c.pubKeyHex === pubKeyHex)
    if (contact) return contact.name
    if (this.displayNameCache[pubKeyHex]) return this.displayNameCache[pubKeyHex]
    return pubKeyHex.slice(0, 12) + '...'
  }

  async resolveDisplayName(pubKeyHex: string): Promise<string | null> {
    if (this.displayNameCache[pubKeyHex]) return this.displayNameCache[pubKeyHex]
    const contact = this.contacts.find(c => c.pubKeyHex === pubKeyHex)
    if (contact?.name && !contact.name.includes('...')) {
      this.displayNameCache[pubKeyHex] = contact.name
      return contact.name
    }
    const name = await relayService.fetchDisplayName(this.relays, pubKeyHex)
    if (name) {
      this.displayNameCache[pubKeyHex] = name
      this.saveState()
      return name
    }
    return null
  }

  async resolveBchAddress(pubKeyHex: string): Promise<string | null> {
    if (this.bchAddressCache[pubKeyHex]) return this.bchAddressCache[pubKeyHex]
    const address = await relayService.fetchBchAddress(this.relays, pubKeyHex)
    if (address) {
      this.bchAddressCache[pubKeyHex] = address
      this.saveState()
      return address
    }
    return null
  }

  getOtherMember(room: Room): string | null {
    if (!this.keys) return null
    const other = room.members.find(m => m !== this.keys!.pubKeyHex)
    return other || null
  }

}
