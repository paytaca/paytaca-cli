/**
 * x402 utility functions for BCH payments
 * Implements x402-bch v2.2 specification
 * https://github.com/x402-bch/x402-bch/blob/master/specs/x402-bch-specification-v2.2.md
 */

import crypto from 'crypto'
import {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  Authorization,
  ResourceInfo,
  VerifyResponse,
  BCH_ASSET_ID,
  BCH_MAINNET_NETWORK,
  BCH_CHIPNET_NETWORK,
} from '../types/x402.js'
import { secp256k1 } from '@bitauth/libauth'

export { BCH_MAINNET_NETWORK, BCH_CHIPNET_NETWORK, BCH_ASSET_ID }

export function isBchNetwork(network: string): boolean {
  return network === BCH_MAINNET_NETWORK || network === BCH_CHIPNET_NETWORK
}

export function isChipnetNetwork(network: string): boolean {
  return network === BCH_CHIPNET_NETWORK
}

export function parsePaymentRequiredJson(body: any): PaymentRequired | null {
  if (!body || typeof body !== 'object') return null
  if (body.x402Version !== 2) return null

  const pr: PaymentRequired = {
    x402Version: body.x402Version,
    error: body.error,
    resource: body.resource || { url: '' },
    accepts: [],
    extensions: body.extensions || {},
  }

  if (Array.isArray(body.accepts)) {
    for (const accept of body.accepts) {
      if (accept.scheme && accept.network && accept.payTo) {
        pr.accepts.push({
          scheme: accept.scheme,
          network: accept.network,
          amount: accept.amount,
          asset: accept.asset || BCH_ASSET_ID,
          payTo: accept.payTo,
          maxTimeoutSeconds: accept.maxTimeoutSeconds || 60,
          extra: accept.extra || {},
        })
      }
    }
  }

  return pr
}

export function selectBchPaymentRequirements(
  requirements: PaymentRequired,
  clientNetwork: 'mainnet' | 'chipnet'
): PaymentRequirements | null {
  const clientNetworkId = clientNetwork === 'chipnet' ? BCH_CHIPNET_NETWORK : BCH_MAINNET_NETWORK
  for (const accept of requirements.accepts) {
    if (accept.scheme === 'utxo' && accept.network === clientNetworkId) {
      return accept
    }
  }
  return null
}

export function buildPaymentPayload(
  accepted: PaymentRequirements,
  resourceUrl: string,
  payer: string,
  txid: string,
  vout: number | null,
  amount: string | null
): PaymentPayload {
  const resource: ResourceInfo = {
    url: resourceUrl,
    description: '',
    mimeType: 'application/json',
  }

  return {
    x402Version: 2,
    resource,
    accepted,
    payload: {
      signature: '',
      authorization: {
        from: payer,
        to: accepted.payTo,
        value: accepted.amount,
        txid,
        vout,
        amount,
      },
    },
    extensions: {},
  }
}

export function buildAuthorization(
  accepted: PaymentRequirements,
  resourceUrl: string,
  payer: string,
  txid: string,
  vout: number | null,
  amount: string | null
): Authorization {
  return {
    from: payer,
    to: accepted.payTo,
    value: accepted.amount,
    txid,
    vout,
    amount,
  }
}

export function signMessageBCH(
  message: string,
  privateKeyHex: string,
  compressed: boolean = true
): string {
  const prefix = '\x18Bitcoin Signed Message:\n'
  const messageBytes = Buffer.from(message, 'utf8')
  const prefixBytes = Buffer.from(prefix, 'utf8')
  const lengthByte = Buffer.from([messageBytes.length])
  const prefixedMessage = Buffer.concat([prefixBytes, lengthByte, messageBytes])
  const hash = crypto.createHash('sha256').update(crypto.createHash('sha256').update(prefixedMessage).digest()).digest()
  const privateKey = Buffer.from(privateKeyHex, 'hex')
  const signature = secp256k1.signMessageHashDER(hash, privateKey)
  return Buffer.from(signature).toString('base64')
}

export async function signAuthorization(
  authorization: Authorization,
  signMessage: (message: string) => Promise<string>
): Promise<string> {
  const message = JSON.stringify(authorization)
  return signMessage(message)
}

export function parsePaymentResponse(data: any): VerifyResponse {
  if (!data) return { isValid: false, invalidReason: 'no_response_data' }

  if (typeof data.isValid === 'boolean') {
    return {
      isValid: data.isValid,
      payer: data.payer,
      invalidReason: data.invalidReason,
      remainingBalanceSat: data.remainingBalanceSat,
    }
  }

  if (data.error) {
    return { isValid: false, invalidReason: data.error }
  }

  return { isValid: false, invalidReason: 'unknown_response_format' }
}
