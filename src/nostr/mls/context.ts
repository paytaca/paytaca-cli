import {
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  defaultLifetime,
} from 'ts-mls'
import { defaultClientConfig } from 'ts-mls/clientConfig.js'
import { ciphersuites } from 'ts-mls/crypto/ciphersuite.js'
import { ed25519 } from '@noble/curves/ed25519.js'

export const MLS_CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'
export const NOSTR_GROUP_DATA_EXTENSION_TYPE = 0xf2ee

const NODE_X25519_WARNING = 'The X25519 Web Crypto API algorithm is an experimental feature'

function suppressNodeX25519Warning(): void {
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...args: any[]) => {
    const name = typeof warning === 'string' ? args[0] : warning?.name
    const message = typeof warning === 'string' ? warning : warning?.message
    if (name === 'ExperimentalWarning' && typeof message === 'string' && message.includes(NODE_X25519_WARNING)) return
    return (emitWarning as any).call(process, warning, ...args)
  }) as typeof process.emitWarning
}

suppressNodeX25519Warning()

const NOBLE_ED25519 = {
  async sign(signKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(message, signKey)
  },
  async verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return ed25519.verify(signature, message, publicKey)
  },
  async keygen(): Promise<{ signKey: Uint8Array; publicKey: Uint8Array }> {
    const signKey = ed25519.utils.randomSecretKey()
    return { signKey, publicKey: ed25519.getPublicKey(signKey) }
  },
}

const FIXED_CAPABILITIES = {
  versions: ['mls10'] as const,
  ciphersuites: Object.keys(ciphersuites),
  extensions: [NOSTR_GROUP_DATA_EXTENSION_TYPE],
  proposals: [2],
  credentials: ['basic', 'x509'],
}

export interface MlsCrypto {
  impl: any
  capabilities: typeof FIXED_CAPABILITIES
  clientConfig: any
  ciphersuiteName: string
}

let cached: MlsCrypto | null = null

export async function ensureMlsCrypto(): Promise<MlsCrypto> {
  if (!cached) {
    const ciphersuite = getCiphersuiteFromName(MLS_CIPHERSUITE)
    const impl = (await getCiphersuiteImpl(ciphersuite)) as any
    impl.signature = NOBLE_ED25519
    cached = {
      impl,
      capabilities: FIXED_CAPABILITIES,
      clientConfig: defaultClientConfig,
      ciphersuiteName: MLS_CIPHERSUITE,
    }
  }
  return cached
}

export function getMlsCrypto(): MlsCrypto {
  if (!cached) throw new Error('MLS crypto not initialized')
  return cached
}

export { defaultLifetime, defaultClientConfig }
