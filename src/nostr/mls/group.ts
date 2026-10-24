import {
  createGroup,
  joinGroup,
  createCommit,
  encodeMlsMessage,
  decodeMlsMessage,
  emptyPskIndex,
  encodeRequiredCapabilities,
  mlsExporter,
} from 'ts-mls'
import { getGroupMembers, getOwnLeafNode } from 'ts-mls/clientState.js'
import { ensureMlsCrypto, NOSTR_GROUP_DATA_EXTENSION_TYPE } from './context.js'
import { serializeNipEeGroupData, parseNipEeGroupData, type NipEeGroupData } from './transport.js'
import type { MlsPrivatePackage } from './key-package.js'

const REQUIRED_PROPOSAL_TYPES = [2]

export function buildNipEeGroupExtensions(
  nostrGroupIdHex: string,
  meta: { name?: string; description?: string; adminPubkeys?: string[]; relays?: string[] } = {}
): any[] {
  return [
    {
      extensionType: NOSTR_GROUP_DATA_EXTENSION_TYPE,
      extensionData: serializeNipEeGroupData({ nostrGroupIdHex, ...meta }),
    },
    {
      extensionType: 'required_capabilities',
      extensionData: encodeRequiredCapabilities({
        extensionTypes: [NOSTR_GROUP_DATA_EXTENSION_TYPE],
        proposalTypes: REQUIRED_PROPOSAL_TYPES,
        credentialTypes: [],
      }),
    },
  ]
}

export async function createMlsGroup(
  groupId: Uint8Array,
  keyPackage: any,
  privatePackage: MlsPrivatePackage,
  nostrGroupIdHex: string,
  groupMeta: { name?: string; description?: string; adminPubkeys?: string[]; relays?: string[] } = {}
): Promise<any> {
  const { impl, clientConfig } = await ensureMlsCrypto()
  const extensions = buildNipEeGroupExtensions(nostrGroupIdHex, groupMeta)
  return createGroup(groupId, keyPackage, privatePackage as any, extensions as any, impl, clientConfig)
}

export async function addMlsMember(
  state: any,
  inviteeKeyPackage: any
): Promise<{ newState: any; commit: any; welcome: any }> {
  const { impl } = await ensureMlsCrypto()
  const addProposal = {
    proposalType: 'add',
    add: { keyPackage: inviteeKeyPackage },
  }
  return createCommit(
    { state, cipherSuite: impl, pskIndex: emptyPskIndex },
    { extraProposals: [addProposal], ratchetTreeExtension: true } as any
  )
}

export async function removeMlsMember(
  state: any,
  leafIndex: number
): Promise<{ newState: any; commit: any }> {
  const { impl } = await ensureMlsCrypto()
  const removeProposal = {
    proposalType: 'remove',
    remove: { removed: leafIndex },
  }
  return createCommit(
    { state, cipherSuite: impl, pskIndex: emptyPskIndex },
    { extraProposals: [removeProposal] } as any
  )
}

export async function joinMlsGroup(
  welcome: any,
  keyPackage: any,
  privatePackage: MlsPrivatePackage
): Promise<any> {
  const { impl, clientConfig } = await ensureMlsCrypto()
  return joinGroup(welcome, keyPackage, privatePackage as any, emptyPskIndex, impl, undefined, undefined, clientConfig)
}

export async function getNostrExporterSecret(state: any): Promise<Uint8Array> {
  const { impl } = await ensureMlsCrypto()
  return mlsExporter(state.keySchedule.exporterSecret, 'nostr', new Uint8Array(0), 32, impl)
}

export function encodeMlsMsg(msg: any): Uint8Array {
  return encodeMlsMessage(msg)
}

export function decodeMlsMsg(bytes: Uint8Array): any {
  const result = decodeMlsMessage(bytes, 0)
  if (!result) return undefined
  return result[0]
}

export function getMlsGroupMembers(state: any): any[] {
  return getGroupMembers(state)
}

function memberIdentity(member: any): Uint8Array | null {
  if (member?.credential?.credentialType === 'basic') return member.credential.identity
  if (member?.identityBytes instanceof Uint8Array) return member.identityBytes
  return null
}

export function mlsMemberPubkeys(state: any): string[] {
  return getMlsGroupMembers(state).map((member: any) => {
    const identity = memberIdentity(member)
    return identity instanceof Uint8Array ? new TextDecoder().decode(identity) : ''
  })
}

export function getOwnLeafIndex(state: any): number {
  const leaf = getOwnLeafNode(state)
  const leafIdentityBytes = memberIdentity(leaf)
  const leafIdentity = leafIdentityBytes ? new TextDecoder().decode(leafIdentityBytes) : null
  if (!leafIdentity) return -1
  const members = getGroupMembers(state)
  for (let i = 0; i < members.length; i++) {
    const identityBytes = memberIdentity(members[i])
    const identity = identityBytes ? new TextDecoder().decode(identityBytes) : null
    if (identity && identity === leafIdentity) return i
  }
  return -1
}

export function nostrGroupIdFromState(state: any): string | null {
  try {
    const ext = state?.groupContext?.extensions?.find(
      (e: any) => e.extensionType === NOSTR_GROUP_DATA_EXTENSION_TYPE
    )
    if (!ext) return null
    return parseNipEeGroupData(ext.extensionData)?.nostrGroupIdHex || null
  } catch {
    return null
  }
}

export function groupDataFromState(state: any): NipEeGroupData | null {
  try {
    const ext = state?.groupContext?.extensions?.find(
      (e: any) => e.extensionType === NOSTR_GROUP_DATA_EXTENSION_TYPE
    )
    return ext ? parseNipEeGroupData(ext.extensionData) : null
  } catch {
    return null
  }
}
