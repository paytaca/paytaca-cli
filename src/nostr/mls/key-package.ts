import { encodeMlsMessage } from 'ts-mls'
import { signKeyPackage } from 'ts-mls/keyPackage.js'
import { signLeafNodeKeyPackage } from 'ts-mls/leafNode.js'
import { ensureMlsCrypto, defaultLifetime } from './context.js'
import type { MlsHpkeIkms } from './keys.js'

export interface MlsPrivatePackage {
  initPrivateKey: Uint8Array
  hpkePrivateKey: Uint8Array
  signaturePrivateKey: Uint8Array
}

export interface MlsKeyPackageBundle {
  publicPackage: any
  privatePackage: MlsPrivatePackage
}

export async function generateMlsKeyPackage(
  signatureKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
  nostrPubkeyHex: string,
  ikms?: MlsHpkeIkms
): Promise<MlsKeyPackageBundle> {
  const { impl, capabilities } = await ensureMlsCrypto()

  const credential = {
    credentialType: 'basic' as const,
    identity: new TextEncoder().encode(nostrPubkeyHex),
  }

  const initKeys = ikms
    ? await impl.hpke.deriveKeyPair(ikms.initIkm)
    : await impl.hpke.generateKeyPair()
  const hpkeKeys = ikms
    ? await impl.hpke.deriveKeyPair(ikms.hpkeIkm)
    : await impl.hpke.generateKeyPair()

  const privatePackage: MlsPrivatePackage = {
    initPrivateKey: await impl.hpke.exportPrivateKey(initKeys.privateKey),
    hpkePrivateKey: await impl.hpke.exportPrivateKey(hpkeKeys.privateKey),
    signaturePrivateKey: signatureKeyPair.privateKey,
  }

  const leafNodeTbs = {
    leafNodeSource: 'key_package' as const,
    hpkePublicKey: await impl.hpke.exportPublicKey(hpkeKeys.publicKey),
    signaturePublicKey: signatureKeyPair.publicKey,
    extensions: [],
    credential,
    capabilities,
    lifetime: defaultLifetime,
  }

  const tbs = {
    version: 'mls10' as const,
    cipherSuite: impl.name,
    initKey: await impl.hpke.exportPublicKey(initKeys.publicKey),
    leafNode: await signLeafNodeKeyPackage(leafNodeTbs as any, signatureKeyPair.privateKey, impl.signature),
    extensions: [],
  }

  const publicPackage = await signKeyPackage(tbs as any, signatureKeyPair.privateKey, impl.signature)

  return { publicPackage, privatePackage }
}

export function encodeKeyPackageForPublish(keyPackage: any): Uint8Array {
  return encodeMlsMessage({
    version: 'mls10',
    wireformat: 'mls_key_package',
    keyPackage,
  })
}
