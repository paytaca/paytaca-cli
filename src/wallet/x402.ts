/**
 * x402 payment handler for BCH
 * Integrates with LibauthHDWallet for signing x402 payment authorization
 */

import { LibauthHDWallet } from './keys.js'
import {
  parsePaymentRequired,
  selectBchPaymentRequirements,
  buildPaymentPayload,
  encodePaymentSignature,
  parsePaymentResponse,
  signMessageBCH,
  BCH_MAINNET_NETWORK,
  BCH_CHIPNET_NETWORK,
  isChipnetNetwork,
} from '../utils/x402.js'
import {
  PaymentRequired,
  BchPaymentRequirements,
  PaymentPayload,
  Authorization,
  X402PaymentResult,
  SettlementResponse,
} from '../types/x402.js'

export interface X402Signer {
  address: string
  signMessage: (message: string) => Promise<string>
}

export interface X402PaymentRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface X402PayerConfig {
  hdWallet: LibauthHDWallet
  addressIndex?: number
}

export class X402Payer {
  private signer: X402Signer
  private isChipnet: boolean

  constructor(config: X402PayerConfig) {
    this.isChipnet = config.hdWallet.isChipnet
    this.signer = this.createSigner(config.hdWallet, config.addressIndex || 0)
  }

  private createSigner(hdWallet: LibauthHDWallet, index: number): X402Signer {
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

  getPayerAddress(): string {
    return this.signer.address
  }

  async handlePaymentRequired(
    response: {
      status: number
      headers: Record<string, string>
      data?: any
    },
    paymentRequest: X402PaymentRequest
  ): Promise<{ requirements: BchPaymentRequirements; headers: PaymentRequired } | null> {
    const headers: PaymentRequired = {}
    for (const [key, value] of Object.entries(response.headers)) {
      headers[key.toLowerCase()] = value
    }

    const requirements = parsePaymentRequired(headers)
    if (!requirements) return null

    const bchRequirements = selectBchPaymentRequirements(requirements)
    if (!bchRequirements) return null

    bchRequirements.payer = this.signer.address

    return { requirements: bchRequirements, headers }
  }

  async createAuthorization(
    requirements: BchPaymentRequirements,
    payload: PaymentPayload
  ): Promise<string> {
    const payloadJson = JSON.stringify(payload)
    const payloadSignature = await this.signer.signMessage(payloadJson)

    const nonce = Date.now().toString(36) + Math.random().toString(36).substring(2, 10)

    const auth: Authorization = {
      scheme: 'utxo',
      network: requirements.network,
      resource_id: requirements.resourceId,
      payload: payloadJson,
      payload_signature: payloadSignature,
      nonce,
      payer: this.signer.address,
    }

    return encodePaymentSignature(auth)
  }

  async makePaymentRequest(
    requirements: BchPaymentRequirements,
    recipients: { address: string; amount: bigint; currency: string }[],
    paymentRequest: X402PaymentRequest
  ): Promise<{ authHeader: string; paymentUrl: string }> {
    const payload = buildPaymentPayload(requirements, this.signer.address, recipients)
    const authHeader = await this.createAuthorization(requirements, payload)

    return {
      authHeader: `x402 ${authHeader}`,
      paymentUrl: requirements.paymentUrl,
    }
  }

  async retryWithPayment(
    requirements: BchPaymentRequirements,
    paymentUrl: string,
    recipients: { address: string; amount: bigint; currency: string }[],
    originalRequest: X402PaymentRequest
  ): Promise<X402PaymentResult> {
    try {
      const { authHeader } = await this.makePaymentRequest(
        requirements,
        recipients,
        originalRequest
      )

      const response = await fetch(paymentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          resource_id: requirements.resourceId,
          payment: {
            scheme: 'utxo',
            network: requirements.network,
            recipients: recipients.map(r => ({
              address: r.address,
              amount: r.amount.toString(),
              currency: r.currency,
            })),
          },
          payer: this.signer.address,
        }),
      })

      const responseData = await response.json()
      const settlement = parsePaymentResponse(responseData)

      if (settlement.success) {
        return {
          success: true,
          txid: settlement.txid,
          settlement,
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            data: responseData,
          },
        }
      } else {
        return {
          success: false,
          error: settlement.error || 'Payment failed',
          settlement,
        }
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Payment request failed',
      }
    }
  }
}

export function createX402Payer(hdWallet: LibauthHDWallet, addressIndex?: number): X402Payer {
  return new X402Payer({ hdWallet, addressIndex })
}
