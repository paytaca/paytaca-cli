import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { hexToBin, secp256k1 } from '@bitauth/libauth'
import { LibauthHDWallet } from './keys.js'
import { X402Payer, createX402Payer } from './x402.js'
import { BCH_ASSET_ID, BCH_MAINNET_NETWORK } from '../utils/x402.js'
import type { PaymentRequirements } from '../types/x402.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const RECEIVE_0 = 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6'
const CHIPNET_RECEIVE_0 = 'bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x'

const requirements: PaymentRequirements = {
  scheme: 'utxo',
  network: BCH_MAINNET_NETWORK,
  amount: '1000',
  asset: BCH_ASSET_ID,
  payTo: 'bitcoincash:qp2f5j6q3fj5gjwgk8rkq8xrk8q8q8q8q8q8q8q8q',
  maxTimeoutSeconds: 300,
  extra: {},
}

function hdWallet(network: 'mainnet' | 'chipnet' = 'mainnet') {
  return new LibauthHDWallet(MNEMONIC, "m/44'/145'/0'", network)
}

function verifyBchSignature(
  message: string,
  signatureBase64: string,
  pubkeyHex: string
): boolean {
  const prefix = '\x18Bitcoin Signed Message:\n'
  const messageBytes = Buffer.from(message, 'utf8')
  const prefixed = Buffer.concat([
    Buffer.from(prefix, 'utf8'),
    Buffer.from([messageBytes.length]),
    messageBytes,
  ])
  const digest = createHash('sha256')
    .update(createHash('sha256').update(prefixed).digest())
    .digest()
  return secp256k1.verifySignatureDER(
    Buffer.from(signatureBase64, 'base64'),
    hexToBin(pubkeyHex),
    digest
  )
}

describe('X402Payer', () => {
  it('exposes the receiving address of the signing index', () => {
    const wallet = hdWallet()
    const payer = createX402Payer(wallet)
    expect(payer.getPayerAddress()).toBe(RECEIVE_0)
  })

  it('uses the requested address index', () => {
    const wallet = hdWallet()
    const payer = createX402Payer(wallet, 1)
    expect(payer.getPayerAddress()).toBe(
      wallet.getAddressSetAt(1).receiving
    )
  })

  it('uses a chipnet receiving address for a chipnet wallet', () => {
    const payer = new X402Payer({ hdWallet: hdWallet('chipnet') })
    expect(payer.getPayerAddress()).toBe(CHIPNET_RECEIVE_0)
  })

  describe('createPaymentPayload', () => {
    it('builds an authorization matching the payer and requirements', async () => {
      const wallet = hdWallet()
      const payer = createX402Payer(wallet)

      const payload = await payer.createPaymentPayload(
        requirements,
        'https://api.example.com/data',
        'abc123txid',
        0,
        '1000'
      )

      expect(payload.x402Version).toBe(2)
      expect(payload.resource!.url).toBe('https://api.example.com/data')
      expect(payload.accepted).toBe(requirements)
      expect(payload.payload.authorization).toEqual({
        from: RECEIVE_0,
        to: requirements.payTo,
        value: requirements.amount,
        txid: 'abc123txid',
        vout: 0,
        amount: '1000',
      })
    })

    it('signs the authorization with a verifiable BCH signature', async () => {
      const wallet = hdWallet()
      const payer = createX402Payer(wallet)

      const payload = await payer.createPaymentPayload(
        requirements,
        'https://api.example.com/data',
        'abc123txid',
        0,
        '1000'
      )

      const signature = payload.payload.signature
      expect(signature).toBeTruthy()
      expect(Buffer.from(signature, 'base64').toString('base64')).toBe(signature)

      const message = JSON.stringify(payload.payload.authorization)
      expect(
        verifyBchSignature(message, signature, wallet.getPubkeyAt('0/0'))
      ).toBe(true)
    })

    it('produces different signatures for different transactions', async () => {
      const payer = createX402Payer(hdWallet())
      const a = await payer.createPaymentPayload(
        requirements,
        'https://api.example.com/data',
        'txid-a',
        0,
        '1000'
      )
      const b = await payer.createPaymentPayload(
        requirements,
        'https://api.example.com/data',
        'txid-b',
        0,
        '1000'
      )
      expect(a.payload.signature).not.toBe(b.payload.signature)
    })

    it('accepts null vout and amount', async () => {
      const payer = createX402Payer(hdWallet())
      const payload = await payer.createPaymentPayload(
        requirements,
        'https://api.example.com/data',
        'txid',
        null,
        null
      )
      expect(payload.payload.authorization.vout).toBeNull()
      expect(payload.payload.authorization.amount).toBeNull()
    })
  })

  it('makePaymentRequest returns the payload and the payTo URL', async () => {
    const payer = createX402Payer(hdWallet())
    const { paymentPayload, paymentUrl } = await payer.makePaymentRequest(
      requirements,
      'https://api.example.com/data',
      'txid',
      0,
      '1000'
    )
    expect(paymentUrl).toBe(requirements.payTo)
    expect(paymentPayload.payload.authorization.txid).toBe('txid')
    expect(paymentPayload.payload.signature).toBeTruthy()
  })
})