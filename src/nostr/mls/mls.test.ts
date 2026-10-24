import { describe, it, expect } from 'vitest'
import { bytesToHex } from 'nostr-tools/utils'
import { deriveMlsKeys, deriveMlsHpkeIkms, deriveMlsStateKey } from './keys.js'
import {
  isEncryptedMlsGroupState,
  encryptMlsGroupState,
  decryptMlsGroupState,
} from './state-crypto.js'
import { generateMlsKeyPackage } from './key-package.js'
import { serializeNipEeGroupData, parseNipEeGroupData } from './transport.js'
import { createMlsGroup, addMlsMember, joinMlsGroup, getNostrExporterSecret } from './group.js'
import {
  encryptMlsMessage,
  wrapPrivateMessage,
  processMlsMessage,
  decodeWelcomeFromBytes,
} from './message.js'
import { encodeMlsMsg } from './group.js'

const ALICE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const BOB_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

async function makePackage(mnemonic: string, pubkeyHex: string) {
  const keys = deriveMlsKeys(mnemonic)
  const ikms = deriveMlsHpkeIkms(mnemonic)
  const bundle = await generateMlsKeyPackage(
    { publicKey: keys.publicKey, privateKey: keys.privateKey },
    pubkeyHex,
    ikms
  )
  return { keys, bundle }
}

describe('deriveMlsKeys', () => {
  it('derives the same keys for the same mnemonic', () => {
    const first = deriveMlsKeys(ALICE_MNEMONIC)
    const second = deriveMlsKeys(ALICE_MNEMONIC)
    expect(first.publicKeyHex).toBe(second.publicKeyHex)
    expect(first.privateKeyHex).toBe(second.privateKeyHex)
  })

  it('derives different keys for different mnemonics', () => {
    const alice = deriveMlsKeys(ALICE_MNEMONIC)
    const bob = deriveMlsKeys(BOB_MNEMONIC)
    expect(alice.publicKeyHex).not.toBe(bob.publicKeyHex)
  })

  it('derives deterministic HPKE IKMs', () => {
    const first = deriveMlsHpkeIkms(ALICE_MNEMONIC)
    const second = deriveMlsHpkeIkms(ALICE_MNEMONIC)
    expect(bytesToHex(first.initIkm)).toBe(bytesToHex(second.initIkm))
    expect(bytesToHex(first.hpkeIkm)).toBe(bytesToHex(second.hpkeIkm))
  })
})

describe('MLS group state at rest', () => {
  const groupIdHex = 'ab'.repeat(32)
  const plainHex = bytesToHex(new TextEncoder().encode('group-state-bytes'))

  it('round-trips a group state', () => {
    const key = deriveMlsStateKey(ALICE_MNEMONIC)
    const encrypted = encryptMlsGroupState(plainHex, key, groupIdHex)
    expect(isEncryptedMlsGroupState(encrypted)).toBe(true)
    expect(encrypted).not.toContain(plainHex)
    expect(decryptMlsGroupState(encrypted, key, groupIdHex)).toBe(plainHex)
  })

  it('produces different ciphertexts for the same input', () => {
    const key = deriveMlsStateKey(ALICE_MNEMONIC)
    expect(encryptMlsGroupState(plainHex, key, groupIdHex)).not.toBe(
      encryptMlsGroupState(plainHex, key, groupIdHex)
    )
  })

  it('rejects a state encrypted with another wallet key', () => {
    const encrypted = encryptMlsGroupState(plainHex, deriveMlsStateKey(ALICE_MNEMONIC), groupIdHex)
    expect(decryptMlsGroupState(encrypted, deriveMlsStateKey(BOB_MNEMONIC), groupIdHex)).toBeNull()
  })

  it('rejects a state bound to another group', () => {
    const key = deriveMlsStateKey(ALICE_MNEMONIC)
    const encrypted = encryptMlsGroupState(plainHex, key, groupIdHex)
    expect(decryptMlsGroupState(encrypted, key, 'cd'.repeat(32))).toBeNull()
  })

  it('rejects tampered ciphertext', () => {
    const key = deriveMlsStateKey(ALICE_MNEMONIC)
    const encrypted = encryptMlsGroupState(plainHex, key, groupIdHex)
    const parts = encrypted.split(':')
    const payload = Buffer.from(parts[2], 'hex')
    payload[0] ^= 0xff
    const tampered = `${parts[0]}:${parts[1]}:${payload.toString('hex')}`
    expect(decryptMlsGroupState(tampered, key, groupIdHex)).toBeNull()
  })

  it('reports unencrypted legacy values', () => {
    expect(isEncryptedMlsGroupState(plainHex)).toBe(false)
    expect(decryptMlsGroupState(plainHex, deriveMlsStateKey(ALICE_MNEMONIC), groupIdHex)).toBeNull()
  })
})

describe('nostr group data extension', () => {
  it('round-trips group metadata', () => {
    const data = {
      nostrGroupIdHex: 'ab'.repeat(32),
      name: 'Team café',
      description: 'A group with unicode',
      adminPubkeys: ['11'.repeat(32), '22'.repeat(32)],
      relays: ['wss://relay.example.com'],
    }
    const parsed = parseNipEeGroupData(serializeNipEeGroupData(data))
    expect(parsed).toEqual({
      ...data,
      adminPubkeys: data.adminPubkeys.map(pk => bytesToHex(new TextEncoder().encode(pk))),
    })
  })

  it('round-trips empty optional fields', () => {
    const data = {
      nostrGroupIdHex: 'cd'.repeat(32),
      name: '',
      description: '',
      adminPubkeys: [],
      relays: [],
    }
    expect(parseNipEeGroupData(serializeNipEeGroupData(data))).toEqual(data)
  })

  it('rejects truncated data', () => {
    expect(parseNipEeGroupData(new Uint8Array([0, 1]))).toBeNull()
  })
})

describe('MLS group create and join', () => {
  it('adds a member and exchanges an application message', async () => {
    const alice = await makePackage(ALICE_MNEMONIC, 'a1'.repeat(32))
    const bob = await makePackage(BOB_MNEMONIC, 'b2'.repeat(32))

    const groupId = new Uint8Array(32).fill(7)
    const nostrGroupIdHex = 'ff'.repeat(32)

    const aliceState = await createMlsGroup(
      groupId,
      alice.bundle.publicPackage,
      alice.bundle.privatePackage,
      nostrGroupIdHex,
      { name: 'Test Group', adminPubkeys: ['a1'.repeat(32)], relays: ['wss://relay.example.com'] }
    )

    const { newState, commit, welcome } = await addMlsMember(
      aliceState,
      bob.bundle.publicPackage
    )
    expect(commit).toBeTruthy()
    expect(welcome).toBeTruthy()

    const welcomeBytes = encodeMlsMsg({ version: 'mls10', wireformat: 'mls_welcome', welcome })
    const decodedWelcome = decodeWelcomeFromBytes(welcomeBytes)
    const bobState = await joinMlsGroup(
      decodedWelcome,
      bob.bundle.publicPackage,
      bob.bundle.privatePackage
    )

    const aliceSecret = await getNostrExporterSecret(newState)
    const bobSecret = await getNostrExporterSecret(bobState)
    expect(bytesToHex(aliceSecret)).toBe(bytesToHex(bobSecret))

    const { privateMessage } = await encryptMlsMessage(newState, 'hello bob')
    const wire = encodeMlsMsg(wrapPrivateMessage(privateMessage))
    const received = await processMlsMessage(bobState, wire)
    expect(received.plaintext).toBe('hello bob')
  })
})
