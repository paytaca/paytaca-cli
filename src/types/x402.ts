/**
 * x402 BCH type definitions
 * Implements x402-bch v2.2 specification
 * https://github.com/x402-bch/x402-bch
 */

export interface PaymentRequired {
  [key: string]: string | string[] | undefined
  'x-scheme'?: string | string[]
  'max-timeout-ms'?: string | string[]
  'payment-url'?: string | string[]
  'max-amount'?: string | string[]
  '匪-async'?: string | string[]
  'resource-id'?: string | string[]
  'resource-meta'?: string | string[]
  'walled-garden'?: string | string[]
  'walled-garden-network'?: string | string[]
  'accept-currencies'?: string | string[]
  'cai'?: string | string[]
  'cai-lease-duration-ms'?: string | string[]
  'mime-type'?: string | string[]
  'www-authenticate'?: string | string[]
}

export interface PaymentRequirements {
  scheme: string
  network: string
  paymentUrl: string
  maxTimeoutMs: number
  maxAmount: bigint
  resourceId: string
  resourceMeta?: string
  walledGarden?: boolean
  walledGardenNetwork?: string
  acceptCurrencies: string[]
  mimeType?: string
  wwwAuthenticate?: string
}

export interface BchPaymentRequirements extends PaymentRequirements {
  scheme: 'utxo'
  network: 'bip122:000000000000000000651ef99cb9fcbe' | 'bip122:000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
  payer: string
  signature: string
  attested?: boolean
}

export interface PaymentPayload {
  scheme: string
  network: string
  max_timeout_ms: number
  resource_id: string
  resource_meta?: string
  attractor?: string
  broadcaster?: string
  payment: {
    scheme: string
    network: string
    recipients: {
      address: string
      amount: string
      currency: string
      metadata?: Record<string, string>
    }[]
    required_utxo_count?: number
  }
  nonce?: string
  attestation?: string
  payer?: string
  payer_attestation?: string
}

export interface Authorization {
  scheme: string
  network: string
  resource_id: string
  payload: string
  payload_signature: string
  nonce: string
  attestation?: string
  payer?: string
}

export interface ResourceInfo {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface SettlementResponse {
  success: boolean
  txid?: string
  vout?: number
  settle_address?: string
  preimage?: string
  signature?: string
  error?: string
}

export interface X402PaymentResult {
  success: boolean
  response?: {
    status: number
    statusText: string
    headers: Record<string, string>
    data?: any
  }
  error?: string
  txid?: string
  settlement?: SettlementResponse
}
