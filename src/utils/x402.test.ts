import { describe, it, expect } from 'vitest'
import {
  parsePaymentRequiredJson,
  selectBchPaymentRequirements,
  buildPaymentPayload,
  buildAuthorization,
  parsePaymentResponse,
  isBchNetwork,
  isChipnetNetwork,
  BCH_MAINNET_NETWORK,
  BCH_CHIPNET_NETWORK,
  BCH_ASSET_ID,
} from './x402.js'

describe('x402 parsing', () => {
  describe('parsePaymentRequiredJson', () => {
    it('should parse valid PaymentRequired JSON', () => {
      const input = {
        x402Version: 2,
        error: 'Payment required',
        resource: { url: 'https://api.example.com/data' },
        accepts: [
          {
            scheme: 'utxo',
            network: BCH_MAINNET_NETWORK,
            amount: '1000',
            asset: BCH_ASSET_ID,
            payTo: 'bitcoincash:qp2f5j6q3fj5gjwgk8rkq8xrk8q8q8q8q8q8q8q8q',
            maxTimeoutSeconds: 300,
            extra: {},
          },
        ],
        extensions: {},
      }

      const result = parsePaymentRequiredJson(input)

      expect(result).not.toBeNull()
      expect(result!.x402Version).toBe(2)
      expect(result!.error).toBe('Payment required')
      expect(result!.resource.url).toBe('https://api.example.com/data')
      expect(result!.accepts).toHaveLength(1)
      expect(result!.accepts[0].scheme).toBe('utxo')
      expect(result!.accepts[0].amount).toBe('1000')
    })

    it('should return null for null input', () => {
      expect(parsePaymentRequiredJson(null)).toBeNull()
    })

    it('should return null for non-object input', () => {
      expect(parsePaymentRequiredJson('string')).toBeNull()
      expect(parsePaymentRequiredJson(123)).toBeNull()
    })

    it('should return null for wrong x402Version', () => {
      const input = { x402Version: 1, accepts: [] }
      expect(parsePaymentRequiredJson(input)).toBeNull()
    })

    it('should use default values for missing optional fields', () => {
      const input = {
        x402Version: 2,
        resource: {},
        accepts: [
          {
            scheme: 'utxo',
            network: BCH_MAINNET_NETWORK,
            payTo: 'bitcoincash:qp2f5j6q3fj5gjwgk8rkq8xrk8q8q8q8q8q8q8q8',
          },
        ],
      }

      const result = parsePaymentRequiredJson(input)

      expect(result).not.toBeNull()
      expect(result!.accepts[0].asset).toBe(BCH_ASSET_ID)
      expect(result!.accepts[0].maxTimeoutSeconds).toBe(60)
    })

    it('should filter out invalid accepts entries', () => {
      const input = {
        x402Version: 2,
        resource: { url: 'https://api.example.com' },
        accepts: [
          { scheme: 'utxo', network: BCH_MAINNET_NETWORK, payTo: 'valid1' },
          { scheme: 'invalid' },
          { network: BCH_MAINNET_NETWORK, payTo: 'missing-scheme' },
          { scheme: 'utxo', payTo: 'missing-network' },
          { scheme: 'utxo', network: BCH_MAINNET_NETWORK },
        ],
      }

      const result = parsePaymentRequiredJson(input)

      expect(result!.accepts).toHaveLength(1)
      expect(result!.accepts[0].payTo).toBe('valid1')
    })
  })

  describe('selectBchPaymentRequirements', () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: 'https://api.example.com' },
      accepts: [
        {
          scheme: 'utxo',
          network: BCH_MAINNET_NETWORK,
          amount: '1000',
          asset: BCH_ASSET_ID,
          payTo: 'bitcoincash:mainnet-address',
          maxTimeoutSeconds: 300,
          extra: {},
        },
        {
          scheme: 'utxo',
          network: BCH_CHIPNET_NETWORK,
          amount: '1000',
          asset: BCH_ASSET_ID,
          payTo: 'bitcoincash:chipnet-address',
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
      extensions: {},
    }

    it('should select mainnet requirements for mainnet client', () => {
      const result = selectBchPaymentRequirements(paymentRequired, 'mainnet')
      expect(result).not.toBeNull()
      expect(result!.network).toBe(BCH_MAINNET_NETWORK)
      expect(result!.payTo).toBe('bitcoincash:mainnet-address')
    })

    it('should select chipnet requirements for chipnet client', () => {
      const result = selectBchPaymentRequirements(paymentRequired, 'chipnet')
      expect(result).not.toBeNull()
      expect(result!.network).toBe(BCH_CHIPNET_NETWORK)
      expect(result!.payTo).toBe('bitcoincash:chipnet-address')
    })

    it('should return null when no matching network', () => {
      const emptyAccepts = { ...paymentRequired, accepts: [paymentRequired.accepts[0]] }
      const result = selectBchPaymentRequirements(emptyAccepts, 'chipnet')
      expect(result).toBeNull()
    })
  })
})

describe('x402 building', () => {
  describe('buildPaymentPayload', () => {
    it('should build a valid PaymentPayload', () => {
      const accepted = {
        scheme: 'utxo',
        network: BCH_MAINNET_NETWORK,
        amount: '1000',
        asset: BCH_ASSET_ID,
        payTo: 'bitcoincash:qp2f5j6q3fj5gjwgk8rkq8xrk8q8q8q8q8q8q8q8',
        maxTimeoutSeconds: 300,
        extra: {},
      }

      const result = buildPaymentPayload(
        accepted,
        'https://api.example.com/data',
        'bitcoincash:payer-address',
        'abc123txid',
        0,
        '1000'
      )

      expect(result.x402Version).toBe(2)
      expect(result.resource!.url).toBe('https://api.example.com/data')
      expect(result.accepted).toBe(accepted)
      expect(result.payload.authorization.from).toBe('bitcoincash:payer-address')
      expect(result.payload.authorization.to).toBe(accepted.payTo)
      expect(result.payload.authorization.txid).toBe('abc123txid')
      expect(result.payload.signature).toBe('')
    })
  })

  describe('buildAuthorization', () => {
    it('should build a valid Authorization', () => {
      const accepted = {
        scheme: 'utxo',
        network: BCH_MAINNET_NETWORK,
        amount: '1000',
        asset: BCH_ASSET_ID,
        payTo: 'bitcoincash:qp2f5j6q3fj5gjwgk8rkq8xrk8q8q8q8q8q8q8q8',
        maxTimeoutSeconds: 300,
        extra: {},
      }

      const result = buildAuthorization(
        accepted,
        'https://api.example.com/data',
        'bitcoincash:payer-address',
        'abc123txid',
        0,
        '1000'
      )

      expect(result.from).toBe('bitcoincash:payer-address')
      expect(result.to).toBe(accepted.payTo)
      expect(result.txid).toBe('abc123txid')
      expect(result.vout).toBe(0)
      expect(result.amount).toBe('1000')
    })
  })
})

describe('parsePaymentResponse', () => {
  it('should parse valid isValid response', () => {
    const data = {
      isValid: true,
      payer: 'bitcoincash:abc123',
      remainingBalanceSat: '1000000',
    }

    const result = parsePaymentResponse(data)

    expect(result.isValid).toBe(true)
    expect(result.payer).toBe('bitcoincash:abc123')
    expect(result.remainingBalanceSat).toBe('1000000')
  })

  it('should parse error response', () => {
    const data = { error: 'Invalid signature' }

    const result = parsePaymentResponse(data)

    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('Invalid signature')
  })

  it('should return no_response_data for null input', () => {
    const result = parsePaymentResponse(null)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('no_response_data')
  })

  it('should return unknown_response_format for unrecognized data', () => {
    const data = { some: 'unknown', format: true }
    const result = parsePaymentResponse(data)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('unknown_response_format')
  })
})

describe('network helpers', () => {
  describe('isBchNetwork', () => {
    it('should return true for mainnet', () => {
      expect(isBchNetwork(BCH_MAINNET_NETWORK)).toBe(true)
    })

    it('should return true for chipnet', () => {
      expect(isBchNetwork(BCH_CHIPNET_NETWORK)).toBe(true)
    })

    it('should return false for other networks', () => {
      expect(isBchNetwork('bitcoin')).toBe(false)
      expect(isBchNetwork('litecoin')).toBe(false)
    })
  })

  describe('isChipnetNetwork', () => {
    it('should return true for chipnet', () => {
      expect(isChipnetNetwork(BCH_CHIPNET_NETWORK)).toBe(true)
    })

    it('should return false for mainnet', () => {
      expect(isChipnetNetwork(BCH_MAINNET_NETWORK)).toBe(false)
    })
  })
})
