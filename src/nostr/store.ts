import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getEventHash, finalizeEvent } from 'nostr-tools'
import { hexToBytes, bytesToHex } from 'nostr-tools/utils'
import { decode as nip19Decode } from 'nostr-tools/nip19'
import { nip59 } from 'nostr-tools'
import { decodeGroupState, encodeGroupState } from 'ts-mls'
import { defaultClientConfig } from 'ts-mls/clientConfig.js'
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
import {
  NIP_EE_KP_KIND,
  NIP_EE_WELCOME_KIND,
  NIP_EE_GROUP_EVENT_KIND,
  deriveMlsKeys,
  deriveMlsHpkeIkms,
  deriveMlsStateKey,
  isEncryptedMlsGroupState,
  encryptMlsGroupState,
  decryptMlsGroupState,
  generateMlsKeyPackage,
  encodeKeyPackageForPublish,
  createMlsGroup,
  addMlsMember,
  removeMlsMember,
  joinMlsGroup,
  getNostrExporterSecret,
  encodeMlsMsg,
  decodeMlsMsg,
  decodeWelcomeFromBytes,
  encryptMlsMessage,
  wrapPrivateMessage,
  processMlsMessage,
  getMlsGroupMembers,
  mlsMemberPubkeys,
  getOwnLeafIndex,
  nostrGroupIdFromState,
  groupDataFromState,
  buildNipEeKeyPackageEvent,
  buildNipEeRelayListEvent,
  buildNipEeWelcomeEvent,
  buildNipEeGroupEvent,
  makeKeyPackageRef,
  ensureMlsCrypto,
  type MlsPrivatePackage,
  type NipEeGroupData,
  type MlsHpkeIkms,
} from './mls/index.js'


const DEFAULT_RELAYS = ['wss://relay.paytaca.com']
const DISCOVERY_RELAYS = ['wss://relay.paytaca.com']
const DATA_DIR = path.join(os.homedir(), '.paytaca')
const STATE_FILE = path.join(DATA_DIR, 'chat-state.json')

const MAX_MESSAGES_PER_ROOM = 1000
const MAX_MLS_MEMBERS = 50
const MLS_META_PREFIX = '\u200bpaytaca:mls-meta:'
const MLS_REPLY_PREFIX = '\u200bpaytaca:mls-reply:'
const MLS_EDIT_PREFIX = '\u200bpaytaca:mls-edit:'
const MLS_JOIN_PREFIX = '\u200bpaytaca:mls-join:'

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function randomRoomId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function decodeNpub(value: string): string {
  const trimmed = value.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  const decoded = nip19Decode(trimmed)
  if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
    throw new Error(`Invalid npub: ${value}`)
  }
  return decoded.data
}

function decodeKeyPackageContent(content: string): any | null {
  try {
    const msg = decodeMlsMsg(hexToBytes(content))
    if (!msg || msg.wireformat !== 'mls_key_package') return null
    return msg.keyPackage
  } catch {
    return null
  }
}

function memberIdentityAt(state: any, leafIndex?: number): string | null {
  if (leafIndex === undefined || leafIndex < 0) return null
  try {
    return mlsMemberPubkeys(state)[leafIndex] || null
  } catch {
    return null
  }
}

export interface Contact {
  name: string
  npub: string
  pubKeyHex: string
  addedAt: number
}

export interface Room {
  id: string
  type: 'private' | 'mls-group'
  name: string
  members: string[]
  subject: string | null
  createdAt: number
  updatedAt: number
  owner?: string | null
  admins?: string[]
  nostrGroupId?: string | null
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

export interface MlsInvitation {
  roomId: string
  inviterPubKey: string
  name: string
  nostrGroupIdHex: string | null
  createdAt: number
  welcomeEvent: NostrEvent
  welcomeRumor: Rumor
}

export interface MlsGroupInfo {
  roomId: string
  name: string
  mlsGroupIdHex: string
  nostrGroupIdHex: string | null
  members: string[]
  pendingInvitees: string[]
  owner: string | null
  admins: string[]
}

interface PersistedMlsState {
  keyPackage?: { serialized: string; relays: string[]; publishedAt: number }
  groupStates: Record<string, string>
  roomMlsMap: Record<string, string>
  roomMlsNostrMap: Record<string, string>
  pendingInvitations: Record<string, MlsInvitation>
  declinedWelcomeIds: Record<string, number>
  handledWelcomeIds: Record<string, number>
  processedEventIds: Record<string, Record<string, number>>
  pendingInvitees: Record<string, Record<string, number>>
}

interface PersistedState {
  contacts: Contact[]
  rooms?: Room[]
  displayNameCache: Record<string, string>
  bchAddressCache: Record<string, string>
  readMessageIds: Record<string, Record<string, boolean>>
  sentMessages: Record<string, Message[]>
  mls?: Partial<PersistedMlsState>
}

function emptyMlsState(): PersistedMlsState {
  return {
    groupStates: {},
    roomMlsMap: {},
    roomMlsNostrMap: {},
    pendingInvitations: {},
    declinedWelcomeIds: {},
    handledWelcomeIds: {},
    processedEventIds: {},
    pendingInvitees: {},
  }
}


export class ChatStore {
  keys: NostrKeys | null = null
  relays: string[] = [...DEFAULT_RELAYS]
  contacts: Contact[] = []
  rooms: Room[] = []
  messages: Record<string, Message[]> = {}
  sentMessages: Record<string, Message[]> = {}
  readMessageIds: Record<string, Record<string, boolean>> = {}
  mls: PersistedMlsState = emptyMlsState()
  mlsReady = false
  initialized = false
  isSubscribed = false
  displayNameCache: Record<string, string> = {}
  bchAddressCache: Record<string, string> = {}

  private onNewMessageCallback: ((room: Room, message: Message) => void) | null = null
  private pendingWelcomeTasks: Promise<void>[] = []
  private mlsWelcomeInFlight = new Set<string>()
  private pendingEdits = new Map<string, Rumor[]>()
  private mnemonic: string | null = null
  private mlsKeyPackageCache: { publicPackage: any; privatePackage: MlsPrivatePackage } | null = null
  private mlsIkmsCache: MlsHpkeIkms | null = null
  private mlsStateKeyCache: Uint8Array | null = null

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
        this.rooms = data.rooms || []
        this.readMessageIds = data.readMessageIds || {}
        this.displayNameCache = data.displayNameCache || {}
        this.bchAddressCache = data.bchAddressCache || {}
        this.sentMessages = data.sentMessages || {}
        this.mls = { ...emptyMlsState(), ...(data.mls || {}) }

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
        rooms: this.rooms,
        displayNameCache: this.displayNameCache,
        bchAddressCache: this.bchAddressCache,
        readMessageIds: this.readMessageIds,
        sentMessages: this.sentMessages,
        mls: this.mls,
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
    this.mnemonic = mnemonic
    this.mlsStateKeyCache = deriveMlsStateKey(mnemonic)
    this.encryptLegacyGroupStates()

    relayService.setAuthKey(keys.privKeyHex)

    try {
      await relayService.publish(this.relays, createKind10050(this.relays, keys.privKeyHex))
    } catch (err) {
      console.error('[store] publish kind10050 failed:', err)
    }

    try {
      await relayService.fetchHistoricalGiftWraps(DISCOVERY_RELAYS, keys.pubKeyHex, {
        onEvent: (event) => this.handleGiftWrap(event),
      })
    } catch (err) {
      console.error('[store] fetchHistoricalGiftWraps failed:', err)
    }

    while (this.pendingWelcomeTasks.length > 0) {
      await Promise.allSettled([...this.pendingWelcomeTasks])
    }

    this.initialized = true
  }

  private handleGiftWrap(event: NostrEvent): void {
    if (!this.keys) return
    if (event.tags?.some((t: string[]) => t[0] === 'self')) return
    try {
      const { rumor } = unwrapGiftWrap(event, this.keys.privKeyHex)
      if (!rumor.id) rumor.id = getEventHash(rumor)
      if (rumor.kind === NIP_EE_WELCOME_KIND) {
        const task = this.handleMlsWelcome(event, rumor).catch(err => {
          console.error('[store] handleMlsWelcome failed:', err)
        })
        this.pendingWelcomeTasks.push(task)
        void task.finally(() => {
          const index = this.pendingWelcomeTasks.indexOf(task)
          if (index !== -1) this.pendingWelcomeTasks.splice(index, 1)
        })
        return
      }
      this.receiveMessage(rumor)
    } catch (err) {
      console.error('[store] unwrapGiftWrap failed:', err)
    }
  }

  subscribe(onEvent?: (event: NostrEvent) => void): void {
    if (!this.keys) return

    const sub = relayService.subscribeGiftWraps(
      this.relays,
      this.keys.pubKeyHex,
      {
        onEvent: onEvent || ((event: NostrEvent) => this.handleGiftWrap(event)),
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

  async sendMessage(roomId: string, text: string): Promise<{
    giftWraps: NostrEvent[]
    message: Message
    publish?: { accepted: string[]; errors: { relay: string; reason: string }[] }
  }> {
    if (!this.keys) throw new Error('Not initialized')

    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')

    if (room.type === 'mls-group') {
      const { message, publish } = await this.sendMlsText(roomId, text)
      return { giftWraps: [], message, publish }
    }

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
      const contact = this.contacts.find(c => c.pubKeyHex === rumor.pubkey)
      const cachedName = this.displayNameCache[rumor.pubkey]
      const roomName = contact?.name || cachedName || rumor.pubkey.slice(0, 12) + '...'
      const subject = rumor.tags.find(t => t[0] === 'subject')?.[1] || null
      room = {
        id: roomId,
        type: 'private',
        name: roomName,
        members: roomMembers,
        subject,
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

  startConversation(npub: string): Room {
    if (!this.keys) throw new Error('Not initialized')
    const contact = this.contacts.find(c => c.npub === npub)
    if (!contact) throw new Error('Contact not found. Use add-contact first.')
    const roomMembers = [this.keys.pubKeyHex, contact.pubKeyHex]
    const roomId = computeRoomId(roomMembers)
    let room = this.rooms.find(r => r.id === roomId)
    if (!room) {
      room = {
        id: roomId,
        type: 'private',
        name: contact.name,
        members: roomMembers,
        subject: null,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      }
      this.rooms.push(room)
      this.saveState()
    }
    return room
  }

  getContactName(pubKeyHex: string): string {
    const contact = this.contacts.find(c => c.pubKeyHex === pubKeyHex)
    if (contact) return contact.name
    if (this.displayNameCache[pubKeyHex]) return this.displayNameCache[pubKeyHex]
    return pubKeyHex.slice(0, 12) + '...'
  }

  async resolveDisplayName(pubKeyHex: string): Promise<string | null> {
    const contact = this.contacts.find(c => c.pubKeyHex === pubKeyHex)
    if (contact?.name && !contact.name.includes('...')) {
      if (this.displayNameCache[pubKeyHex] !== contact.name) {
        this.displayNameCache[pubKeyHex] = contact.name
        this.saveState()
      }
      return contact.name
    }
    if (this.displayNameCache[pubKeyHex]) return this.displayNameCache[pubKeyHex]
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
    if (room.type !== 'private') return null
    const other = room.members.find(m => m !== this.keys!.pubKeyHex)
    return other || null
  }

  private async ensureMlsKeys(): Promise<{ publicPackage: any; privatePackage: MlsPrivatePackage }> {
    if (!this.mnemonic) throw new Error('Not initialized')
    if (!this.mlsKeyPackageCache) {
      const mlsKeys = deriveMlsKeys(this.mnemonic)
      if (!this.mlsIkmsCache) this.mlsIkmsCache = deriveMlsHpkeIkms(this.mnemonic)
      this.mlsKeyPackageCache = await generateMlsKeyPackage(
        { publicKey: mlsKeys.publicKey, privateKey: mlsKeys.privateKey },
        this.keys!.pubKeyHex,
        this.mlsIkmsCache
      )
    }
    return this.mlsKeyPackageCache
  }

  private encryptLegacyGroupStates(): void {
    if (!this.mlsStateKeyCache) return
    let changed = false
    for (const [groupIdHex, serialized] of Object.entries(this.mls.groupStates)) {
      if (isEncryptedMlsGroupState(serialized)) continue
      this.mls.groupStates[groupIdHex] = encryptMlsGroupState(serialized, this.mlsStateKeyCache, groupIdHex)
      changed = true
    }
    if (changed) this.saveState()
  }

  private readGroupStateHex(mlsGroupIdHex: string): string | null {
    const stored = this.mls.groupStates[mlsGroupIdHex]
    if (!stored) return null
    if (!isEncryptedMlsGroupState(stored)) return stored
    if (!this.mlsStateKeyCache) return null
    const plain = decryptMlsGroupState(stored, this.mlsStateKeyCache, mlsGroupIdHex)
    if (plain === null) {
      console.error('[store] failed to decrypt MLS group state')
      return null
    }
    return plain
  }

  private async loadGroupState(mlsGroupIdHex: string): Promise<any | null> {
    const serialized = this.readGroupStateHex(mlsGroupIdHex)
    if (!serialized) return null
    const result = decodeGroupState(hexToBytes(serialized), 0)
    if (!result) return null
    return { ...(result as any)[0], clientConfig: defaultClientConfig }
  }

  private async saveGroupState(mlsGroupIdHex: string, clientState: any): Promise<void> {
    if (!this.mlsStateKeyCache) throw new Error('Not initialized')
    const serialized = bytesToHex(encodeGroupState(clientState))
    this.mls.groupStates[mlsGroupIdHex] = encryptMlsGroupState(serialized, this.mlsStateKeyCache, mlsGroupIdHex)
    this.saveState()
  }

  private async publishKeyPackage(): Promise<void> {
    if (!this.keys) return
    const { publicPackage } = await this.ensureMlsKeys()
    const serialized = bytesToHex(encodeKeyPackageForPublish(publicPackage))
    const cached = this.mls.keyPackage
    if (cached && cached.serialized === serialized && arraysEqual(cached.relays, this.relays)) {
      return
    }

    const unsigned = buildNipEeKeyPackageEvent({
      keyPackageHex: serialized,
      nostrPubkeyHex: this.keys.pubKeyHex,
      relays: this.relays,
    })
    const signed = finalizeEvent(unsigned as any, hexToBytes(this.keys.privKeyHex)) as unknown as NostrEvent
    const { accepted } = await relayService.publish(this.relays, signed)
    if (accepted.length > 0) {
      this.mls.keyPackage = {
        serialized,
        relays: [...this.relays],
        publishedAt: signed.created_at,
      }
      this.saveState()
    }

    const relayList = buildNipEeRelayListEvent(this.relays, this.keys.pubKeyHex)
    const signedRelayList = finalizeEvent(relayList as any, hexToBytes(this.keys.privKeyHex)) as unknown as NostrEvent
    await relayService.publish(this.relays, signedRelayList)
  }

  async initializeMls(): Promise<void> {
    if (!this.keys || !this.mnemonic) throw new Error('Not initialized')
    await ensureMlsCrypto().catch(() => null)

    try {
      await this.publishKeyPackage()
    } catch (err) {
      console.error('[store] publish MLS key package failed:', err)
    }

    try {
      const deleted = await relayService.fetchOwnDeletionEventIds(this.relays, this.keys.pubKeyHex)
      for (const id of deleted) {
        this.mls.declinedWelcomeIds[id] = this.mls.declinedWelcomeIds[id] || Date.now()
      }
    } catch (err) {
      console.error('[store] fetchOwnDeletionEventIds failed:', err)
    }

    this.mlsReady = true

    const nostrGroupIds = [...new Set(Object.values(this.mls.roomMlsNostrMap).filter(Boolean))]
    if (nostrGroupIds.length > 0) {
      this.subscribeMls(nostrGroupIds)
      try {
        await this.fetchMlsHistory(nostrGroupIds)
      } catch (err) {
        console.error('[store] fetchMlsHistory failed:', err)
      }
      for (const roomId of Object.keys(this.mls.roomMlsMap)) {
        const state = await this.loadGroupState(this.mls.roomMlsMap[roomId])
        if (state) this.reconcileMlsRoomMembers(roomId, state)
      }
    }
    this.saveState()
  }

  private subscribeMls(nostrGroupIds: string[]): void {
    if (!this.keys) return
    relayService.subscribeMlsEvents(this.relays, this.keys.pubKeyHex, nostrGroupIds, {
      onEvent: (event) => {
        void this.receiveMlsEvent(event).catch(err => {
          console.error('[store] receiveMlsEvent failed:', err)
        })
      },
    })
  }

  private async fetchMlsHistory(nostrGroupIds: string[]): Promise<void> {
    const seen = new Set<string>()
    const events: NostrEvent[] = []
    for (const groupId of nostrGroupIds) {
      const groupEvents = await relayService.fetchMlsGroupEvents(this.relays, groupId, 500)
      for (const event of groupEvents) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        events.push(event)
      }
    }
    events.sort((a, b) => a.created_at - b.created_at)
    for (const event of events) {
      await this.receiveMlsEvent(event)
    }
  }

  private reconcileMlsRoomMembers(roomId: string, clientState: any): void {
    const room = this.rooms.find(r => r.id === roomId)
    if (!room || room.type !== 'mls-group') return
    let treeMembers: string[]
    try {
      treeMembers = mlsMemberPubkeys(clientState)
    } catch {
      return
    }
    if (!treeMembers.length) return
    if (arraysEqual(treeMembers, room.members)) return
    room.members = treeMembers
    room.updatedAt = Math.max(room.updatedAt, Math.floor(Date.now() / 1000))
    this.saveState()
  }

  private invitationForGroup(nostrGroupIdHex: string | null): MlsInvitation | null {
    if (!nostrGroupIdHex) return null
    return Object.values(this.mls.pendingInvitations).find(i => i.nostrGroupIdHex === nostrGroupIdHex) || null
  }

  async handleMlsWelcome(giftWrap: NostrEvent, welcomeRumor: Rumor): Promise<void> {
    if (!this.keys || !this.mnemonic) return
    if (welcomeRumor.kind !== NIP_EE_WELCOME_KIND) return

    const inFlightKey = welcomeRumor.id || giftWrap?.id
    if (inFlightKey && this.mlsWelcomeInFlight.has(inFlightKey)) return
    if (inFlightKey) this.mlsWelcomeInFlight.add(inFlightKey)
    try {
      await this.handleMlsWelcomeInner(giftWrap, welcomeRumor)
    } finally {
      if (inFlightKey) this.mlsWelcomeInFlight.delete(inFlightKey)
    }
  }

  private async handleMlsWelcomeInner(giftWrap: NostrEvent, welcomeRumor: Rumor): Promise<void> {

    const wrapId = giftWrap?.id
    const rumorId = welcomeRumor?.id
    if (wrapId && this.mls.declinedWelcomeIds[wrapId]) return
    if (rumorId && this.mls.handledWelcomeIds[rumorId]) return
    if (rumorId && this.mls.declinedWelcomeIds[rumorId]) return

    for (const invite of Object.values(this.mls.pendingInvitations)) {
      if (invite.welcomeEvent?.id === wrapId) return
      if (rumorId && invite.welcomeRumor?.id === rumorId) return
    }

    let welcome: any
    try {
      welcome = decodeWelcomeFromBytes(hexToBytes(welcomeRumor.content))
    } catch {
      return
    }

    let peek: { name: string | null; nostrGroupIdHex: string | null; mlsGroupIdHex: string | null } | null = null
    try {
      peek = await this.peekWelcomeGroupData(welcome)
    } catch {
      peek = null
    }

    if (peek?.nostrGroupIdHex && this.resolveMlsGroupId(peek.nostrGroupIdHex)) {
      this.markWelcomeHandled(rumorId, wrapId)
      return
    }
    if (this.invitationForGroup(peek?.nostrGroupIdHex || null)) return

    const roomId = randomRoomId()
    this.mls.pendingInvitations[roomId] = {
      roomId,
      inviterPubKey: welcomeRumor.pubkey,
      name: peek?.name || 'MLS Group',
      nostrGroupIdHex: peek?.nostrGroupIdHex || null,
      createdAt: welcomeRumor.created_at || Math.floor(Date.now() / 1000),
      welcomeEvent: giftWrap,
      welcomeRumor,
    }
    this.saveState()
  }

  private async peekWelcomeGroupData(welcome: any): Promise<{
    name: string | null
    nostrGroupIdHex: string | null
    mlsGroupIdHex: string | null
  } | null> {
    if (!this.keys) return null
    const { publicPackage, privatePackage } = await this.ensureMlsKeys()
    const candidates = await this.collectMlsJoinCandidates(publicPackage)
    for (const candidate of candidates) {
      try {
        const clientState = await joinMlsGroup(welcome, candidate.keyPackage, privatePackage)
        const groupData = groupDataFromState(clientState)
        return {
          name: groupData?.name || null,
          nostrGroupIdHex: groupData?.nostrGroupIdHex || nostrGroupIdFromState(clientState),
          mlsGroupIdHex: clientState?.groupContext?.groupId
            ? bytesToHex(clientState.groupContext.groupId)
            : null,
        }
      } catch {
        // Next candidate.
      }
    }
    return null
  }

  private async collectMlsJoinCandidates(
    publicPackage: any
  ): Promise<{ keyPackage: any; ref: string }[]> {
    if (!this.keys) return []
    const { impl } = await ensureMlsCrypto()
    const candidates: { keyPackage: any; ref: string }[] = []
    const seen = new Set<string>()

    try {
      const events = await relayService.fetchNipEeKeyPackage(this.relays, this.keys.pubKeyHex)
      for (const event of events) {
        const keyPackage = decodeKeyPackageContent(event.content)
        if (!keyPackage) continue
        const ref = bytesToHex(await makeKeyPackageRef(keyPackage, impl.hash))
        if (seen.has(ref)) continue
        seen.add(ref)
        candidates.push({ keyPackage, ref })
      }
    } catch {
      // Relay unavailable — fall back to the deterministic local package.
    }

    const localRef = bytesToHex(await makeKeyPackageRef(publicPackage, impl.hash))
    if(!seen.has(localRef)) {
      candidates.push({ keyPackage: publicPackage, ref: localRef })
    }
    return candidates
  }

  private markWelcomeHandled(rumorId?: string, wrapId?: string): void {
    if (rumorId) this.mls.handledWelcomeIds[rumorId] = Date.now()
    if (wrapId) this.mls.handledWelcomeIds[wrapId] = Date.now()
  }

  resolveMlsGroupId(nostrGroupIdHex: string): string | null {
    for (const [roomId, nHex] of Object.entries(this.mls.roomMlsNostrMap)) {
      if (nHex === nostrGroupIdHex) return this.mls.roomMlsMap[roomId] || null
    }
    return null
  }

  private resolveRoomIdByMlsGroupId(mlsGroupIdHex: string): string | null {
    const roomIds = Object.entries(this.mls.roomMlsMap)
      .filter(([, gHex]) => gHex === mlsGroupIdHex)
      .map(([roomId]) => roomId)
    const live = roomIds.filter(roomId => this.rooms.some(r => r.id === roomId))
    return live[0] || roomIds[0] || null
  }

  getInvitations(): MlsInvitation[] {
    return Object.values(this.mls.pendingInvitations).sort((a, b) => b.createdAt - a.createdAt)
  }

  getInvitation(roomId: string): MlsInvitation | undefined {
    return this.mls.pendingInvitations[roomId] ||
      Object.values(this.mls.pendingInvitations).find(i => i.roomId.startsWith(roomId) || i.roomId === roomId)
  }

  async createMlsGroup(name: string, memberNpubs: string[] = []): Promise<Room> {
    if (!this.keys) throw new Error('Not initialized')
    if (memberNpubs.length + 1 > MAX_MLS_MEMBERS) {
      throw new Error(`MLS groups are limited to ${MAX_MLS_MEMBERS} members total`)
    }

    const { publicPackage, privatePackage } = await this.ensureMlsKeys()
    const myPubKey = this.keys.pubKeyHex

    const groupId = new Uint8Array(32)
    crypto.getRandomValues(groupId)
    const mlsGroupIdHex = bytesToHex(groupId)

    const nostrGroupId = new Uint8Array(32)
    crypto.getRandomValues(nostrGroupId)
    const nostrGroupIdHex = bytesToHex(nostrGroupId)

    const clientState = await createMlsGroup(groupId, publicPackage, privatePackage, nostrGroupIdHex, {
      name: name || 'MLS Group',
      adminPubkeys: [myPubKey],
      relays: this.relays,
    })

    const identities = mlsMemberPubkeys(clientState)
    const ownIndex = identities.indexOf(myPubKey)
    if (ownIndex !== -1 && clientState.privatePath?.leafIndex !== ownIndex) {
      throw new Error('MLS group creation produced an inconsistent local leaf index')
    }

    const roomId = randomRoomId()
    const now = Math.floor(Date.now() / 1000)
    const room: Room = {
      id: roomId,
      type: 'mls-group',
      name: name || 'MLS Group',
      members: [myPubKey],
      subject: null,
      createdAt: now,
      updatedAt: now,
      owner: myPubKey,
      admins: [],
      nostrGroupId: nostrGroupIdHex,
    }

    await this.saveGroupState(mlsGroupIdHex, clientState)
    this.rooms.push(room)
    this.mls.roomMlsMap[roomId] = mlsGroupIdHex
    this.mls.roomMlsNostrMap[roomId] = nostrGroupIdHex
    this.saveState()

    for (const npub of memberNpubs) {
      const pubKey = decodeNpub(npub)
      await this.addMlsGroupMember(roomId, pubKey)
    }

    this.subscribeMls([...new Set(Object.values(this.mls.roomMlsNostrMap).filter(Boolean))])
    return room
  }

  async acceptInvitation(roomIdInput: string): Promise<Room> {
    if (!this.keys) throw new Error('Not initialized')
    const invite = this.getInvitation(roomIdInput)
    if (!invite) throw new Error('Invitation not found')

    if (invite.nostrGroupIdHex) {
      const existing = Object.entries(this.mls.roomMlsNostrMap)
        .find(([, nHex]) => nHex === invite.nostrGroupIdHex)?.[0]
      if (existing) {
        delete this.mls.pendingInvitations[invite.roomId]
        this.markWelcomeHandled(invite.welcomeRumor?.id, invite.welcomeEvent?.id)
        this.saveState()
        const room = this.rooms.find(r => r.id === existing)
        if (!room) throw new Error('Room not found')
        return room
      }
    }

    const welcome = decodeWelcomeFromBytes(hexToBytes(invite.welcomeRumor.content))
    const { publicPackage, privatePackage } = await this.ensureMlsKeys()
    const candidates = await this.collectMlsJoinCandidates(publicPackage)

    let clientState: any = null
    let lastError: any = null
    for (const candidate of candidates) {
      try {
        clientState = await joinMlsGroup(welcome, candidate.keyPackage, privatePackage)
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!clientState) {
      throw new Error('Failed to join MLS group: ' + (lastError?.message || 'no key package matched the welcome'))
    }

    const myPubKey = this.keys.pubKeyHex
    const identities = mlsMemberPubkeys(clientState)
    if (!identities.includes(myPubKey)) {
      throw new Error('Your identity was not found in the joined group — ask the inviter to re-invite you.')
    }

    const mlsGroupIdHex = bytesToHex(clientState.groupContext.groupId)
    const nostrGroupIdHex = nostrGroupIdFromState(clientState)
    const groupData: NipEeGroupData | null = groupDataFromState(clientState)

    const existingRoomId = this.resolveRoomIdByMlsGroupId(mlsGroupIdHex)
    const roomId = existingRoomId || invite.roomId
    const now = Math.floor(Date.now() / 1000)
    const extensionAdmins = (groupData?.adminPubkeys || []).filter(pk => identities.includes(pk))
    const room: Room = {
      id: roomId,
      type: 'mls-group',
      name: groupData?.name || invite.name || 'MLS Group',
      members: identities,
      subject: null,
      createdAt: now,
      updatedAt: now,
      owner: extensionAdmins[0] || identities[0] || myPubKey,
      admins: extensionAdmins.slice(1),
      nostrGroupId: nostrGroupIdHex,
    }

    await this.saveGroupState(mlsGroupIdHex, clientState)
    this.mls.roomMlsMap[roomId] = mlsGroupIdHex
    this.mls.roomMlsNostrMap[roomId] = nostrGroupIdHex || ''

    const existingRoom = this.rooms.find(r => r.id === roomId)
    if (existingRoom) {
      Object.assign(existingRoom, room)
    } else {
      this.rooms.push(room)
    }

    delete this.mls.pendingInvitations[invite.roomId]
    this.markWelcomeHandled(invite.welcomeRumor?.id, invite.welcomeEvent?.id)
    this.saveState()

    if (nostrGroupIdHex) {
      try {
        const preJoin = await relayService.fetchMlsGroupEvents(this.relays, nostrGroupIdHex, 100)
        for (const event of preJoin) {
          await this.receiveMlsEvent(event)
        }
      } catch (err) {
        console.error('[store] fetch pre-join group events failed:', err)
      }
    }

    try {
      await this.sendMlsText(roomId, MLS_JOIN_PREFIX)
    } catch (err) {
      console.error('[store] announce MLS join failed:', err)
    }

    this.subscribeMls([...new Set(Object.values(this.mls.roomMlsNostrMap).filter(Boolean))])
    return room
  }

  async declineInvitation(roomIdInput: string): Promise<boolean> {
    if (!this.keys) throw new Error('Not initialized')
    const invite = this.getInvitation(roomIdInput)
    if (!invite) throw new Error('Invitation not found')

    delete this.mls.pendingInvitations[invite.roomId]
    this.markWelcomeHandled(invite.welcomeRumor?.id, invite.welcomeEvent?.id)
    this.saveState()

    if (!invite.welcomeEvent?.id) return false
    this.mls.declinedWelcomeIds[invite.welcomeEvent.id] = Date.now()
    this.saveState()

    const event = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['e', invite.welcomeEvent.id]],
        content: '',
      },
      hexToBytes(this.keys.privKeyHex)
    ) as unknown as NostrEvent
    const { accepted } = await relayService.publish(this.relays, event)
    return accepted.length > 0
  }

  async sendMlsText(
    roomId: string,
    text: string,
    opts: { replyTo?: string; editOf?: string } = {}
  ): Promise<{ message: Message; publish: { accepted: string[]; errors: { relay: string; reason: string }[] } }> {
    if (!this.keys) throw new Error('Not initialized')
    const mlsGroupIdHex = this.mls.roomMlsMap[roomId]
    if (!mlsGroupIdHex) throw new Error('Unknown MLS room')

    const clientState = await this.loadGroupState(mlsGroupIdHex)
    if (!clientState) throw new Error('MLS group state not found')

    let wireText = text
    if (opts.replyTo) wireText = `${MLS_REPLY_PREFIX}${opts.replyTo}\n${wireText}`
    if (opts.editOf) wireText = `${MLS_EDIT_PREFIX}${opts.editOf}\n${wireText}`

    const { privateMessage, newState } = await encryptMlsMessage(clientState, wireText)
    const signedEvent = await this.buildSignedMlsEvent(clientState, wrapPrivateMessage(privateMessage))

    await this.saveGroupState(mlsGroupIdHex, newState)

    const publish = await relayService.publish(this.relays, signedEvent)
    if (publish.accepted.length > 0) {
      this.mls.processedEventIds[mlsGroupIdHex] = this.mls.processedEventIds[mlsGroupIdHex] || {}
      this.mls.processedEventIds[mlsGroupIdHex][signedEvent.id] = Date.now()
    }

    const message: Message = {
      id: signedEvent.id,
      content: text,
      sender: this.keys.pubKeyHex,
      created_at: signedEvent.created_at,
      replyTo: opts.replyTo || null,
      editOf: opts.editOf || null,
      localSentAt: Date.now(),
    }

    if (!this.sentMessages[roomId]) this.sentMessages[roomId] = []
    this.sentMessages[roomId].push(message)
    if (!this.messages[roomId]) this.messages[roomId] = []
    if (!this.messages[roomId].some(m => m.id === message.id)) {
      this.messages[roomId].push(message)
    }

    const room = this.rooms.find(r => r.id === roomId)
    if (room) room.updatedAt = Math.max(room.updatedAt, message.created_at)
    this.saveState()

    return { message, publish }
  }

  private async buildSignedMlsEvent(clientState: any, mlsMessage: any): Promise<NostrEvent> {
    const nostrGroupIdHex = nostrGroupIdFromState(clientState)
    if (!nostrGroupIdHex) throw new Error('Group state is missing the nostr_group_data extension')
    const exporterSecret = await getNostrExporterSecret(clientState)
    const mlsMessageBytes = encodeMlsMsg(mlsMessage)
    try {
      return buildNipEeGroupEvent({ nostrGroupIdHex, mlsMessageBytes, exporterSecretBytes: exporterSecret })
    } finally {
      exporterSecret.fill(0)
      mlsMessageBytes.fill(0)
    }
  }

  async receiveMlsEvent(event: NostrEvent): Promise<void> {
    if (!this.keys) return
    if (!event || event.kind !== NIP_EE_GROUP_EVENT_KIND) return

    const hTag = event.tags?.find(t => t[0] === 'h')
    if (!hTag) return
    const nostrGroupIdHex = hTag[1]
    const mlsGroupIdHex = this.resolveMlsGroupId(nostrGroupIdHex)
    if (!mlsGroupIdHex) return

    const roomId = this.resolveRoomIdByMlsGroupId(mlsGroupIdHex)
    if (roomId && this.messages[roomId]?.some(m => m.id === event.id)) return
    if (this.mls.processedEventIds[mlsGroupIdHex]?.[event.id]) return

    const clientState = await this.loadGroupState(mlsGroupIdHex)
    if (!clientState) return

    try {
      const exporterSecret = await getNostrExporterSecret(clientState)
      let contentBytes: Uint8Array
      try {
        const { decryptMlsMessageWithExporter } = await import('./mls/transport.js')
        contentBytes = decryptMlsMessageWithExporter(event.content, exporterSecret)
      } finally {
        exporterSecret.fill(0)
      }

      const result = await processMlsMessage(clientState, contentBytes)
      await this.saveGroupState(mlsGroupIdHex, result.newState)

      this.mls.processedEventIds[mlsGroupIdHex] = this.mls.processedEventIds[mlsGroupIdHex] || {}
      this.mls.processedEventIds[mlsGroupIdHex][event.id] = Date.now()
      this.saveState()

      this.reconcileMlsRoomMembers(roomId || '', result.newState)

      if (!result.plaintext) return

      const senderIdentity = memberIdentityAt(result.newState, result.senderLeafIndex)
      const plaintext = result.plaintext

      if (plaintext.startsWith(MLS_META_PREFIX)) {
        this.applyMlsMeta(roomId, result.newState, senderIdentity, plaintext.slice(MLS_META_PREFIX.length))
        return
      }
      if (plaintext.startsWith(MLS_JOIN_PREFIX)) {
        if (senderIdentity && roomId) {
          delete this.mls.pendingInvitees[mlsGroupIdHex]?.[senderIdentity]
          this.saveState()
        }
        return
      }
      if (!roomId) return

      if (senderIdentity) {
        delete this.mls.pendingInvitees[mlsGroupIdHex]?.[senderIdentity]
      }

      let content = plaintext
      let replyTo: string | null = null
      let editOf: string | null = null
      for (;;) {
        const prefix = content.startsWith(MLS_REPLY_PREFIX)
          ? MLS_REPLY_PREFIX
          : content.startsWith(MLS_EDIT_PREFIX)
            ? MLS_EDIT_PREFIX
            : null
        if (!prefix) break
        const newlineIndex = content.indexOf('\n')
        if (newlineIndex === -1) {
          content = content.slice(prefix.length)
          break
        }
        const target = content.slice(prefix.length, newlineIndex) || null
        if (prefix === MLS_REPLY_PREFIX) replyTo = target
        else editOf = target
        content = content.slice(newlineIndex + 1)
      }

      const room = this.rooms.find(r => r.id === roomId)
      if (!room) return

      if (editOf) {
        const original = this.messages[roomId]?.find(m => m.id === editOf)
        if (original && original.sender === senderIdentity) {
          original.content = content
          original.editOf = event.id
          room.updatedAt = Math.max(room.updatedAt, event.created_at)
          this.saveState()
          if (this.onNewMessageCallback) this.onNewMessageCallback(room, original)
        }
        return
      }

      const message: Message = {
        id: event.id,
        content,
        sender: senderIdentity || event.pubkey,
        created_at: event.created_at,
        replyTo,
        editOf: null,
        localReceivedAt: Date.now(),
      }

      if (!this.messages[roomId]) this.messages[roomId] = []
      if (!this.messages[roomId].some(m => m.id === message.id)) {
        const arr = this.messages[roomId]
        let i = arr.length
        while (i > 0 && arr[i - 1].created_at > message.created_at) i--
        arr.splice(i, 0, message)
        if (arr.length > MAX_MESSAGES_PER_ROOM) {
          arr.splice(0, arr.length - MAX_MESSAGES_PER_ROOM)
        }
      }
      room.updatedAt = Math.max(room.updatedAt, message.created_at)
      this.saveState()

      if (this.onNewMessageCallback) this.onNewMessageCallback(room, message)
    } catch (err) {
      relayService.forgetMlsSeenEvent(event.id)
      console.error('[store] process MLS event failed:', err)
    }
  }

  private applyMlsMeta(roomId: string | null, clientState: any, senderIdentity: string | null, json: string): void {
    if (!roomId) return
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) return
    const currentOwner = room.owner || mlsMemberPubkeys(clientState)[0] || null
    if (!senderIdentity || senderIdentity !== currentOwner) return
    try {
      const meta = JSON.parse(json)
      if (meta.owner !== undefined) room.owner = meta.owner || null
      if (meta.admins !== undefined) room.admins = Array.isArray(meta.admins) ? meta.admins : []
      this.saveState()
    } catch {
      // Not a role payload.
    }
  }

  private async broadcastMlsRoles(roomId: string): Promise<void> {
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) return
    const meta = { owner: room.owner || null, admins: room.admins || [] }
    await this.sendMlsText(roomId, MLS_META_PREFIX + JSON.stringify(meta))
  }

  private requireMlsManager(room: Room): 'owner' | 'admin' {
    const me = this.keys!.pubKeyHex
    if (room.owner === me) return 'owner'
    if ((room.admins || []).includes(me)) return 'admin'
    throw new Error('Only the group owner or an admin can perform this action.')
  }

  async addMlsGroupMember(roomId: string, memberPubKey: string): Promise<void> {
    if (!this.keys) throw new Error('Not initialized')
    const mlsGroupIdHex = this.mls.roomMlsMap[roomId]
    if (!mlsGroupIdHex) throw new Error('Unknown MLS room')
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')

    const clientState = await this.loadGroupState(mlsGroupIdHex)
    if (!clientState) throw new Error('MLS group state not found')

    this.requireMlsManager(room)

    const currentMembers = getMlsGroupMembers(clientState)
    if (mlsMemberPubkeys(clientState).includes(memberPubKey)) return
    if (currentMembers.length >= MAX_MLS_MEMBERS) {
      throw new Error(`MLS groups are limited to ${MAX_MLS_MEMBERS} members total`)
    }

    let kpEvents = await relayService.fetchNipEeKeyPackage(this.relays, memberPubKey)
    if (!kpEvents.length) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      kpEvents = await relayService.fetchNipEeKeyPackage(this.relays, memberPubKey)
    }
    if (!kpEvents.length) throw new Error('KeyPackage not found for member')

    const inviteePackage = decodeKeyPackageContent(kpEvents[0].content)
    if (!inviteePackage) throw new Error('Invalid KeyPackage event')

    const { newState, commit: commitMsg, welcome } = await addMlsMember(clientState, inviteePackage)

    const identities = mlsMemberPubkeys(newState)
    const ownIndex = identities.indexOf(this.keys.pubKeyHex)
    if (ownIndex !== -1 && newState.privatePath?.leafIndex !== ownIndex) {
      throw new Error('MLS add-member produced an inconsistent local leaf index')
    }

    const signedCommit = await this.buildSignedMlsEvent(clientState, commitMsg)
    const commitPublish = await relayService.publish(this.relays, signedCommit)
    if (!commitPublish.accepted.length) {
      throw new Error(`MLS commit was rejected by the relay: ${commitPublish.errors[0]?.reason || 'unknown error'}`)
    }
    this.mls.processedEventIds[mlsGroupIdHex] = this.mls.processedEventIds[mlsGroupIdHex] || {}
    this.mls.processedEventIds[mlsGroupIdHex][signedCommit.id] = Date.now()

    await this.saveGroupState(mlsGroupIdHex, newState)
    if (!room.members.includes(memberPubKey)) room.members.push(memberPubKey)
    this.mls.pendingInvitees[mlsGroupIdHex] = this.mls.pendingInvitees[mlsGroupIdHex] || {}
    this.mls.pendingInvitees[mlsGroupIdHex][memberPubKey] = Date.now()
    this.saveState()

    let welcomeError: Error | null = null
    if (welcome) {
      try {
        const { impl } = await ensureMlsCrypto()
        const freshKpEvents = await relayService.fetchNipEeKeyPackage(this.relays, memberPubKey)
        if (freshKpEvents.length) {
          const freshKp = decodeKeyPackageContent(freshKpEvents[0].content)
          const freshRef = freshKp ? bytesToHex(await makeKeyPackageRef(freshKp, impl.hash)) : null
          const welcomeRefs = (welcome.secrets || []).map((s: any) => bytesToHex(s.newMember))
          if (freshRef && !welcomeRefs.includes(freshRef)) {
            throw new Error(
              "The invitee's KeyPackage changed while creating the invitation. " +
              'Ask them to open Paytaca again, then re-invite.'
            )
          }
        }

        const welcomeHex = bytesToHex(
          encodeMlsMsg({ version: 'mls10', wireformat: 'mls_welcome', welcome })
        )
        const welcomeUnsigned = buildNipEeWelcomeEvent({
          welcomeHex,
          keyPackageEventId: kpEvents[0].id,
          relays: this.relays,
          nostrPubkeyHex: this.keys.pubKeyHex,
        })
        const giftWrap = nip59.wrapEvent(
          welcomeUnsigned as any,
          hexToBytes(this.keys.privKeyHex),
          memberPubKey
        ) as unknown as NostrEvent

        let welcomePublished = false
        let lastReason = ''
        for (let attempt = 1; attempt <= 3 && !welcomePublished; attempt++) {
          const welcomePublish = await relayService.publish(this.relays, giftWrap)
          if (welcomePublish.accepted.length > 0) {
            welcomePublished = true
          } else {
            lastReason = welcomePublish.errors[0]?.reason || 'relay rejected the welcome'
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          }
        }
        if (!welcomePublished) {
          welcomeError = new Error(
            `The member was added but their invitation could not be published (${lastReason}). ` +
            'Ask them to open Paytaca again, then re-invite.'
          )
        }
      } catch (err: any) {
        welcomeError = err instanceof Error ? err : new Error(String(err))
      }
    }

    try {
      await this.broadcastMlsRoles(roomId)
    } catch (err) {
      console.error('[store] broadcast MLS roles failed:', err)
    }

    if (welcomeError) throw welcomeError
  }

  async removeMlsGroupMember(roomId: string, memberPubKey: string): Promise<void> {
    if (!this.keys) throw new Error('Not initialized')
    const mlsGroupIdHex = this.mls.roomMlsMap[roomId]
    if (!mlsGroupIdHex) throw new Error('Unknown MLS room')
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')

    const clientState = await this.loadGroupState(mlsGroupIdHex)
    if (!clientState) throw new Error('MLS group state not found')

    const myRole = this.requireMlsManager(room)
    if (room.owner && memberPubKey === room.owner) throw new Error('The group owner cannot be removed')
    if (myRole === 'admin' && (room.admins || []).includes(memberPubKey)) {
      throw new Error('Only the group owner can remove an admin')
    }

    const members = getMlsGroupMembers(clientState)
    const leafIndex = mlsMemberPubkeys(clientState).indexOf(memberPubKey)
    if (leafIndex === -1 || !members[leafIndex]) throw new Error('Member not found in MLS group')

    const { newState, commit: commitMsg } = await removeMlsMember(clientState, leafIndex)
    const signedCommit = await this.buildSignedMlsEvent(clientState, commitMsg)
    const publish = await relayService.publish(this.relays, signedCommit)
    if (!publish.accepted.length) {
      throw new Error(`MLS removal was rejected by the relay: ${publish.errors[0]?.reason || 'unknown error'}`)
    }
    this.mls.processedEventIds[mlsGroupIdHex] = this.mls.processedEventIds[mlsGroupIdHex] || {}
    this.mls.processedEventIds[mlsGroupIdHex][signedCommit.id] = Date.now()

    await this.saveGroupState(mlsGroupIdHex, newState)
    delete this.mls.pendingInvitees[mlsGroupIdHex]?.[memberPubKey]

    room.members = room.members.filter(m => m !== memberPubKey)
    room.admins = (room.admins || []).filter(a => a !== memberPubKey)
    this.saveState()
  }

  async setMlsAdmin(roomId: string, memberPubKey: string, isAdmin: boolean): Promise<void> {
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (this.requireMlsManager(room) !== 'owner') {
      throw new Error('Only the group owner can change admin roles')
    }
    if (!room.members.includes(memberPubKey)) throw new Error('Member not in group')

    let admins = room.admins || []
    if (isAdmin) {
      if (memberPubKey === room.owner) throw new Error('The group owner is already the owner')
      if (!admins.includes(memberPubKey)) admins = [...admins, memberPubKey]
    } else {
      admins = admins.filter(a => a !== memberPubKey)
    }
    room.admins = admins
    this.saveState()

    await this.broadcastMlsRoles(roomId)
  }

  async transferMlsOwnership(roomId: string, newOwnerPubKey: string): Promise<void> {
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (this.requireMlsManager(room) !== 'owner') {
      throw new Error('Only the group owner can transfer ownership')
    }
    if (!room.members.includes(newOwnerPubKey)) throw new Error('New owner must be a group member')
    if (room.owner === newOwnerPubKey) return

    const oldOwner = room.owner
    const admins = (room.admins || []).filter(a => a !== newOwnerPubKey)
    if (oldOwner && (room.admins || []).includes(oldOwner)) admins.push(oldOwner)

    room.owner = newOwnerPubKey
    room.admins = admins
    this.saveState()

    await this.broadcastMlsRoles(roomId)
  }

  async leaveMlsGroup(roomId: string, successorPubKey?: string): Promise<void> {
    if (!this.keys) throw new Error('Not initialized')
    const mlsGroupIdHex = this.mls.roomMlsMap[roomId]
    if (!mlsGroupIdHex) throw new Error('Unknown MLS room')
    const room = this.rooms.find(r => r.id === roomId)
    const me = this.keys.pubKeyHex
    const isSoleMember = !room?.members || room.members.length <= 1

    if (room?.owner === me && !isSoleMember) {
      if (!successorPubKey) throw new Error('The group owner must choose a successor before leaving')
      if (!room.members.includes(successorPubKey)) throw new Error('The new owner must be a group member')
      if (!(room.admins || []).includes(successorPubKey)) throw new Error('The new owner must be an admin')
      await this.transferMlsOwnership(roomId, successorPubKey)
    }

    const clientState = await this.loadGroupState(mlsGroupIdHex)
    if (clientState && !isSoleMember) {
      const ownLeaf = getOwnLeafIndex(clientState)
      if (ownLeaf !== -1) {
        const { newState, commit: commitMsg } = await removeMlsMember(clientState, ownLeaf)
        const signedCommit = await this.buildSignedMlsEvent(clientState, commitMsg)
        const publish = await relayService.publish(this.relays, signedCommit)
        if (!publish.accepted.length) {
          throw new Error(
            `Failed to notify the group that you left (${publish.errors[0]?.reason || 'publish failed'}). ` +
            'You are still a member — try leaving again.'
          )
        }
        await this.saveGroupState(mlsGroupIdHex, newState)
      }
    }

    delete this.mls.groupStates[mlsGroupIdHex]
    delete this.mls.roomMlsMap[roomId]
    delete this.mls.roomMlsNostrMap[roomId]
    delete this.mls.pendingInvitees[mlsGroupIdHex]
    delete this.mls.processedEventIds[mlsGroupIdHex]
    this.rooms = this.rooms.filter(r => r.id !== roomId)
    this.saveState()
  }

  async getMlsGroupInfo(roomId: string): Promise<MlsGroupInfo | null> {
    const mlsGroupIdHex = this.mls.roomMlsMap[roomId]
    if (!mlsGroupIdHex) return null
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) return null
    const clientState = await this.loadGroupState(mlsGroupIdHex)
    const members = clientState ? mlsMemberPubkeys(clientState) : room.members
    const pending = Object.keys(this.mls.pendingInvitees[mlsGroupIdHex] || {})
    return {
      roomId,
      name: room.name,
      mlsGroupIdHex,
      nostrGroupIdHex: this.mls.roomMlsNostrMap[roomId] || null,
      members,
      pendingInvitees: pending.filter(pk => !members.includes(pk)),
      owner: room.owner || members[0] || null,
      admins: room.admins || [],
    }
  }

  async renameMlsGroup(roomId: string, name: string): Promise<void> {
    const room = this.rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (room.type !== 'mls-group') throw new Error('Not a group chat')
    room.name = name
    this.saveState()
  }

}
