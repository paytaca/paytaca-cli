/**
 * x402 payment handler for BCH
 * Implements x402-bch v2.2 specification
 * https://github.com/x402-bch/x402-bch/blob/master/specs/x402-bch-specification-v2.2.md
 */

import { LibauthHDWallet } from './keys.js'
import {
  parsePaymentRequiredJson,
  selectBchPaymentRequirements,
  buildPaymentPayload,
  buildAuthorization,
  signAuthorization,
  parsePaymentResponse,
  signMessageBCH,
} from '../utils/x402.js'
import {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  Authorization,
  X402PaymentResult,
} from '../types/x402.js'

export interface X402Signer {
  address: string
  signMessage: (message: string) => Promise<string>
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

  async createPaymentPayload(
    requirements: PaymentRequirements,
    resourceUrl: string,
    txid: string,
    vout: number | null,
    amount: string | null
  ): Promise<PaymentPayload> {
    const payload = buildPaymentPayload(
      requirements,
      resourceUrl,
      this.signer.address,
      txid,
      vout,
      amount
    )

    const signature = await signAuthorization(payload.payload.authorization, this.signer.signMessage.bind(this.signer))
    payload.payload.signature = signature

    return payload
  }

  async makePaymentRequest(
    requirements: PaymentRequirements,
    resourceUrl: string,
    txid: string,
    vout: number | null,
    amount: string | null
  ): Promise<{ paymentPayload: PaymentPayload; paymentUrl: string }> {
    const paymentPayload = await this.createPaymentPayload(requirements, resourceUrl, txid, vout, amount)

    return {
      paymentPayload,
      paymentUrl: requirements.payTo,
    }
  }
}

export function createX402Payer(hdWallet: LibauthHDWallet, addressIndex?: number): X402Payer {
  return new X402Payer({ hdWallet, addressIndex })
}
