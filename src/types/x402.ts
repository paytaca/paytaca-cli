/**
 * x402 BCH type definitions
 * Implements x402-bch v2.2 specification
 * https://github.com/x402-bch/x402-bch/blob/master/specs/x402-bch-specification-v2.2.md
 */

export const BCH_ASSET_ID = '0x0000000000000000000000000000000000000001'
export const BCH_MAINNET_NETWORK = 'bip122:000000000000000000651ef99cb9fcbe'
export const BCH_CHIPNET_NETWORK = 'bip122:000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

export interface ResourceInfo {
  url: string
  description?: string
  mimeType?: string
}

export interface PaymentRequirements {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra: object
}

export interface PaymentRequired {
  x402Version: number
  error?: string
  resource: ResourceInfo
  accepts: PaymentRequirements[]
  extensions: object
}

export interface Authorization {
  from: string
  to: string
  value: string
  txid: string
  vout: number | null
  amount: string | null
}

export interface Payload {
  signature: string
  authorization: Authorization
}

export interface PaymentPayload {
  x402Version: number
  resource?: ResourceInfo
  accepted: PaymentRequirements
  payload: Payload
  extensions: object
}

export interface VerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  remainingBalanceSat?: string
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
  settlement?: {
    success: boolean
    txid?: string
    error?: string
  }
}

export type ErrorCode =
  | 'missing_authorization'
  | 'invalid_payload'
  | 'invalid_scheme'
  | 'invalid_network'
  | 'invalid_receiver_address'
  | 'invalid_exact_bch_payload_signature'
  | 'insufficient_utxo_balance'
  | 'utxo_not_found'
  | 'no_utxo_found_for_address'
  | 'unexpected_utxo_validation_error'
  | 'unexpected_verify_error'
  | 'unexpected_settle_error'
  | 'invalid_x402_version'
