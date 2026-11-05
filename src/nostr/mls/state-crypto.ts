import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

export function isEncryptedMlsGroupState(value: string): boolean {
  return value.startsWith(`${PREFIX}:`)
}

export function encryptMlsGroupState(plainHex: string, key: Uint8Array, aad: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf-8'))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plainHex, 'utf-8')), cipher.final()])
  const payload = Buffer.concat([ciphertext, cipher.getAuthTag()])
  return `${PREFIX}:${iv.toString('hex')}:${payload.toString('hex')}`
}

export function decryptMlsGroupState(value: string, key: Uint8Array, aad: string): string | null {
  const parts = value.split(':')
  if (parts.length !== 3 || parts[0] !== PREFIX) return null
  try {
    const iv = Buffer.from(parts[1], 'hex')
    const payload = Buffer.from(parts[2], 'hex')
    if (iv.length !== IV_LENGTH || payload.length <= 16) return null
    const ciphertext = payload.subarray(0, payload.length - 16)
    const tag = payload.subarray(payload.length - 16)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf-8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
  } catch {
    return null
  }
}
