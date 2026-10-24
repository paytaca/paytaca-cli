import {
  createApplicationMessage,
  processMessage,
  decodeMlsMessage,
  emptyPskIndex,
  acceptAll,
} from 'ts-mls'
import { decryptSenderData } from 'ts-mls/privateMessage.js'
import { ensureMlsCrypto } from './context.js'

export async function encryptMlsMessage(
  state: any,
  text: string
): Promise<{ privateMessage: any; newState: any }> {
  const { impl } = await ensureMlsCrypto()
  const encoded = new TextEncoder().encode(text)
  return createApplicationMessage(state, encoded, impl)
}

export function wrapPrivateMessage(privateMessage: any, version = 'mls10'): any {
  return {
    version,
    wireformat: 'mls_private_message',
    privateMessage,
  }
}

export interface ProcessedMlsMessage {
  plaintext?: string
  newState: any
  actionTaken?: string
  senderLeafIndex?: number
}

export async function processMlsMessage(state: any, bytes: Uint8Array): Promise<ProcessedMlsMessage> {
  const { impl } = await ensureMlsCrypto()

  const decoded = decodeMlsMessage(bytes, 0)
  if (!decoded) return { newState: state, actionTaken: 'message_not_recognized' }
  const mlsMsg = decoded[0]

  let senderLeafIndex: number | undefined
  if (mlsMsg.wireformat === 'mls_private_message') {
    try {
      const senderData = await decryptSenderData(
        mlsMsg.privateMessage,
        state.keySchedule.senderDataSecret,
        impl
      )
      senderLeafIndex = senderData?.leafIndex
    } catch {
      senderLeafIndex = undefined
    }
  }

  if (mlsMsg.wireformat !== 'mls_private_message' && mlsMsg.wireformat !== 'mls_public_message') {
    return { newState: state, actionTaken: 'message_not_recognized' }
  }

  const processed = await processMessage(mlsMsg, state, emptyPskIndex, acceptAll, impl)

  if (processed.kind === 'applicationMessage') {
    return {
      plaintext: new TextDecoder().decode(processed.message),
      newState: processed.newState,
      senderLeafIndex,
    }
  }

  return {
    newState: processed.newState,
    actionTaken: (processed as any).actionTaken,
    senderLeafIndex,
  }
}

export function decodeWelcomeFromBytes(bytes: Uint8Array): any {
  const decoded = decodeMlsMessage(bytes, 0)
  if (!decoded) throw new Error('Expected a Welcome message')
  const mlsMsg = decoded[0]
  if (mlsMsg.wireformat !== 'mls_welcome') throw new Error('Expected a Welcome message')
  return mlsMsg.welcome
}
