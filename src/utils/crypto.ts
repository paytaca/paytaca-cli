/**
 * Cryptographic utility functions for address derivation.
 *
 * Adapted from: paytaca-app/src/utils/crypto.js
 *
 * Provides the pubkey → CashAddress pipeline used by LibauthHDWallet:
 *   pubkey → SHA256 → RIPEMD160 (pkhash) → legacy address → CashAddress
 */

import crypto from 'crypto'
import {
  binToBase58,
  CashAddressType,
  decodeBase58Address,
  decodeCashAddress,
  encodeCashAddress,
  ripemd160,
  binToHex,
  hexToBin,
} from '@bitauth/libauth'

export function sha256(data: string = '', encoding: BufferEncoding = 'utf8'): string {
  const _sha256 = crypto.createHash('sha256')
  _sha256.update(Buffer.from(data, encoding))
  return _sha256.digest().toString('hex')
}

export function pubkeyToPkHash(pubkey: string = ''): string {
  return binToHex(ripemd160.hash(hexToBin(sha256(pubkey, 'hex'))))
}

export function pkHashToLegacyAddress(pkhash: string = ''): string {
  const pkHashBin = Buffer.from(pkhash, 'hex')
  const versionByte = Buffer.from([0x00])

  const data = Buffer.concat([versionByte, pkHashBin])

  const hash1 = sha256(data.toString('hex'), 'hex')
  const hash = sha256(hash1, 'hex')
  const checksum = Buffer.from(hash, 'hex').slice(0, 4)
  const dataWithChecksum = Buffer.concat([data, checksum])

  const legacyAddress = binToBase58(dataWithChecksum)
  return legacyAddress
}

export function pkhashToCashAddress(pkhash: string, chipnet: boolean = false): string {
  const legacyAddress = pkHashToLegacyAddress(pkhash)
  const decodedLegacyAddress = decodeBase58Address(legacyAddress)
  if (typeof decodedLegacyAddress === 'string') throw new Error(decodedLegacyAddress)
  const prefix = chipnet ? 'bchtest' : 'bitcoincash'
  return encodeCashAddress(prefix, 'p2pkh', decodedLegacyAddress.payload)
}

/**
 * Convert a compressed public key (hex) to a CashAddress.
 * This is the core function used by LibauthHDWallet.getAddressAt().
 */
export function pubkeyToAddress(pubkey: string, chipnet: boolean = false): string {
  const pkhash = pubkeyToPkHash(pubkey)
  return pkhashToCashAddress(pkhash, chipnet)
}

/**
 * Convert a regular CashAddress to a token-aware CashAddress (p2pkhWithTokens).
 * e.g. bitcoincash:q... → bitcoincash:z...
 */
export function toTokenAddress(address: string = ''): string {
  const decodedAddress = decodeCashAddress(address)
  if (typeof decodedAddress === 'string') throw new Error(decodedAddress)
  const addrType = decodedAddress.type
  const payload = decodedAddress.payload
  switch (addrType) {
    case CashAddressType.p2pkhWithTokens:
    case CashAddressType.p2shWithTokens:
      return address
    case CashAddressType.p2pkh:
      return encodeCashAddress(decodedAddress.prefix as 'bitcoincash' | 'bchtest' | 'bchreg', CashAddressType.p2pkhWithTokens, payload)
    case CashAddressType.p2sh:
      return encodeCashAddress(decodedAddress.prefix as 'bitcoincash' | 'bchtest' | 'bchreg', CashAddressType.p2shWithTokens, payload)
    default:
      return address
  }
}
