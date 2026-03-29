/**
 * x402 utility functions for BCH payments
 * Parses PAYMENT-REQUIRED headers, builds payment payloads, handles signatures
 */

import { binToHex, hexToBin } from '@bitauth/libauth'
import {
  PaymentRequired,
  PaymentRequirements,
  BchPaymentRequirements,
  PaymentPayload,
  Authorization,
  ResourceInfo,
  SettlementResponse,
} from '../types/x402.js'

export const BCH_MAINNET_NETWORK = 'bip122:000000000000000000651ef99cb9fcbe'
export const BCH_CHIPNET_NETWORK = 'bip122:000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

export function isBchNetwork(network: string): boolean {
  return network === BCH_MAINNET_NETWORK || network === BCH_CHIPNET_NETWORK
}

export function isChipnetNetwork(network: string): boolean {
  return network === BCH_CHIPNET_NETWORK
}

function getHeaderValue(header: PaymentRequired[string]): string | undefined {
  if (Array.isArray(header)) return header[0]
  return header
}

export function parsePaymentRequired(headers: PaymentRequired): PaymentRequirements | null {
  const scheme = getHeaderValue(headers['x-scheme'])
  if (!scheme) return null

  const acceptCurrenciesStr = getHeaderValue(headers['accept-currencies']) || ''
  const acceptCurrencies = acceptCurrenciesStr.split(',').map(s => s.trim()).filter(Boolean)

  const maxTimeoutMsStr = getHeaderValue(headers['max-timeout-ms'])
  const maxTimeoutMs = maxTimeoutMsStr ? parseInt(maxTimeoutMsStr, 10) : 60000

  const maxAmountStr = getHeaderValue(headers['max-amount'])
  const maxAmount = maxAmountStr ? BigInt(maxAmountStr) : BigInt(0)

  const resourceId = getHeaderValue(headers['resource-id']) || ''
  const resourceMeta = getHeaderValue(headers['resource-meta'])
  const paymentUrl = getHeaderValue(headers['payment-url']) || ''
  const mimeType = getHeaderValue(headers['mime-type'])
  const wwwAuthenticate = getHeaderValue(headers['www-authenticate'])

  const walledGardenStr = getHeaderValue(headers['walled-garden'])
  const walledGarden = walledGardenStr === 'true'

  const walledGardenNetwork = getHeaderValue(headers['walled-garden-network'])

  return {
    scheme,
    network: getHeaderValue(headers['x-network']) || '',
    paymentUrl,
    maxTimeoutMs,
    maxAmount,
    resourceId,
    resourceMeta,
    walledGarden,
    walledGardenNetwork,
    acceptCurrencies,
    mimeType,
    wwwAuthenticate,
  }
}

export function selectBchPaymentRequirements(
  requirements: PaymentRequirements
): BchPaymentRequirements | null {
  if (requirements.scheme !== 'utxo') return null
  if (!isBchNetwork(requirements.network)) return null

  const acceptedCurrencies = ['BCH', 'bch', 'BCHn', 'bitcoincash']
  const hasAcceptedCurrency = requirements.acceptCurrencies.some(c =>
    acceptedCurrencies.includes(c)
  )
  if (!hasAcceptedCurrency && requirements.acceptCurrencies.length > 0) return null

  return requirements as BchPaymentRequirements
}

export function buildPaymentPayload(
  requirements: BchPaymentRequirements,
  payer: string,
  recipients: { address: string; amount: bigint; currency: string }[],
  opts?: {
    resourceMeta?: string
    nonce?: string
    attestation?: string
    broadcaster?: string
  }
): PaymentPayload {
  return {
    scheme: 'utxo',
    network: requirements.network,
    max_timeout_ms: requirements.maxTimeoutMs,
    resource_id: requirements.resourceId,
    resource_meta: opts?.resourceMeta || requirements.resourceMeta,
    broadcaster: opts?.broadcaster,
    payment: {
      scheme: 'utxo',
      network: requirements.network,
      recipients: recipients.map(r => ({
        address: r.address,
        amount: r.amount.toString(),
        currency: r.currency,
      })),
    },
    nonce: opts?.nonce,
    attestation: opts?.attestation,
    payer,
  }
}

export function encodePaymentSignature(auth: Authorization): string {
  const data = JSON.stringify({
    scheme: auth.scheme,
    network: auth.network,
    resource_id: auth.resource_id,
    payload: auth.payload,
    payload_signature: auth.payload_signature,
    nonce: auth.nonce,
    attestation: auth.attestation,
  })
  return Buffer.from(data).toString('base64')
}

export function decodePaymentSignature(encoded: string): Authorization | null {
  try {
    const data = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = JSON.parse(data)
    if (!parsed.scheme || !parsed.network || !parsed.payload || !parsed.payload_signature) {
      return null
    }
    return parsed as Authorization
  } catch {
    return null
  }
}

export function parsePaymentResponse(data: any): SettlementResponse {
  if (!data) return { success: false, error: 'No response data' }

  if (data.error) {
    return { success: false, error: data.error }
  }

  if (data.txid) {
    return {
      success: true,
      txid: data.txid,
      vout: data.vout,
      settle_address: data.settle_address,
      preimage: data.preimage,
      signature: data.signature,
    }
  }

  return { success: false, error: 'Unknown settlement response format' }
}

export function createResourceInfo(
  url: string,
  method: string,
  headers: Record<string, string> = {},
  body?: string
): ResourceInfo {
  return { url, method, headers, body }
}

export async function buildAuthorizationHeader(
  payload: PaymentPayload,
  payloadSignature: string,
  nonce: string,
  attestation?: string
): Promise<string> {
  const auth: Authorization = {
    scheme: payload.scheme,
    network: payload.network,
    resource_id: payload.resource_id,
    payload: payloadSignature,
    payload_signature: payloadSignature,
    nonce,
    attestation,
  }
  return encodePaymentSignature(auth)
}

export async function signMessageBCH(
  message: string,
  privateKeyHex: string,
  compressed: boolean = true
): Promise<string> {
  const { sign } = await import('bitcoinjs-message')
  const privateKey = Buffer.from(privateKeyHex, 'hex')
  const signatureBuffer = sign(message, privateKey, compressed)
  return signatureBuffer.toString('base64')
}

export function getDefaultSigner(hdWallet: any, index: number = 0): {
  address: string
  signMessage: (message: string) => Promise<string>
} {
  const addressSet = hdWallet.getAddressSetAt(index)
  return {
    address: addressSet.receiving,
    signMessage: async (message: string) => {
      const node = hdWallet.getNodeAt(`0/${index}`)
      const privKeyHex = Buffer.from(node.privateKey).toString('hex')
      return signMessageBCH(message, privKeyHex, true)
    },
  }
}
