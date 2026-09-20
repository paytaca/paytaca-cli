import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { startWebServer, type WebDeps, type WebServer } from './server.js'

function req(url: string, token: string, method = 'GET', body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers: Record<string, string> = { 'X-Paytaca-Token': token, Host: u.host }
    const opts: http.RequestOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers,
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    const r = http.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        let json: any
        try { json = JSON.parse(raw) } catch { json = raw }
        resolve({ status: res.statusCode || 0, json })
      })
    })
    r.on('error', reject)
    if (body !== undefined) r.write(JSON.stringify(body))
    r.end()
  })
}

const okSend = { network: 'mainnet', success: true, txid: 'abc123' } as any
const okRefill = { enabled: true, model: 'test', minutes: 30, maxMinutes: 100, paymentMethod: 'bch' } as any
const okImageModels = [{ id: 'model-a', display_name: 'Model A' }] as any
const okImageQuote = { orderId: 'order-1', prompt: 'a cat', contractAddress: 'bitcoincash:qq...', amountSats: 1000 } as any
const okImageResult = { success: true, paid: true, orderId: 'order-1', status: 'completed', path: '/tmp/img.png', mediaType: 'image/png' } as any

function fakeDeps(): WebDeps {
  return {
    getWalletState: async () => ({
      network: 'mainnet',
      balance: { spendableSats: 100000, spendableBch: 0.001, usd: 0.5 },
      lift: null,
      usage: [],
      plans: [{ modelId: 'm1', displayName: 'Test Model', tiers: [{ minutes: 30, priceUsd: 1.5, durationDisplay: '30m' }] }],
      liftDiscountPercent: 0,
      autoRefill: null,
      imageModels: [],
      imageHistory: [],
    }),
    getWalletHistory: async () => ({ records: [], page: 1, numPages: 1, hasNext: false }),
    getReceiveView: async (opts) => ({
      network: 'mainnet', address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6', index: 0,
      token: opts.token, category: opts.category, amount: opts.amount,
      tokenName: null, decimals: null, paymentUri: null, qrContent: null, subscribed: false,
    }),
    sendBchPayment: async () => okSend,
    sendTokenPayment: async () => okSend,
    swapQuote: async () => ({
      tokenId: 'a'.repeat(64), symbol: 'TST', decimals: 8, direction: 'sell',
      rate: '1.5', tokenAmount: '1000', bchAmountSats: '1500', tradeFeeSats: '50', platformFeeSats: null, formatted: 'Sell 1000 TST for 0.000015 BCH',
    }),
    swapExecute: async () => ({ success: true, txid: 'swap123' }),
    purchasePlan: async () => ({ success: true, paid: true, txid: 'pay123' }),
    quoteLiftNeeded: async (opts) => ({
      sats: opts.sats, rawAmount: '6409000', display: '6.409', symbol: 'LIFT', decimals: 6,
    }),
    setAutoRefill: async (opts) => ({
      ...okRefill,
      ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
    }),
    getImageModels: async () => okImageModels,
    getImageHistory: async () => ({ data: [] }),
    createImageQuote: async () => okImageQuote,
    fulfillImage: async () => okImageResult,
    serveImageFile: async (id) => {
      if (id === 'exist') return { filePath: '/dev/null', mediaType: 'image/png' }
      return null
    },
    deleteImageFile: async (id) => id === 'exist',
  }
}

let srv: WebServer

beforeAll(async () => {
  srv = await startWebServer({ port: 0, deps: fakeDeps() })
})

afterAll(async () => {
  await srv.close()
})

describe('web server auth', () => {
  it('rejects requests without token', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/state`, '')
    expect(res.status).toBe(401)
  })

  it('rejects wrong token', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/state`, 'wrong-token')
    expect(res.status).toBe(401)
  })

  it('serves HTML page on /', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/`, srv.token)
    expect(res.status).toBe(200)
    expect(typeof res.json).toBe('string')
    expect(res.json).toContain('Paytaca')
  })
})

describe('web server wallet routes', () => {
  it('GET /api/wallet/state returns state', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/state`, srv.token)
    expect(res.status).toBe(200)
    expect(res.json.network).toBe('mainnet')
    expect(res.json.balance).toBeDefined()
  })

  it('GET /api/wallet/history returns records', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/history?page=1&type=all`, srv.token)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.json.records)).toBe(true)
  })

  it('GET /api/wallet/receive returns address', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/receive`, srv.token)
    expect(res.status).toBe(200)
    expect(res.json.address).toContain('bitcoincash:')
  })

  it('POST /api/wallet/send succeeds with valid body', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/send`, srv.token, 'POST', {
      address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6', amount: 0.001, currency: 'bch',
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
  })

  it('POST /api/wallet/send rejects invalid address', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/send`, srv.token, 'POST', {
      address: 'invalid', amount: 0.001, currency: 'bch',
    })
    expect(res.status).toBe(400)
    expect(res.json.error).toContain('Invalid')
  })

  it('POST /api/wallet/send rejects non-JSON content type', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/send`, srv.token, 'POST')
    expect(res.status).toBe(400)
  })

  it('POST /api/wallet/send-token succeeds with valid body', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/send-token`, srv.token, 'POST', {
      category: 'a'.repeat(64), amount: '1000', address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
  })

  it('POST /api/wallet/send-token rejects invalid category', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/send-token`, srv.token, 'POST', {
      category: 'short', amount: '1000', address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
    })
    expect(res.status).toBe(400)
    expect(res.json.error).toContain('category')
  })
})

describe('web server swap routes', () => {
  it('POST /api/swap/quote succeeds', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/swap/quote`, srv.token, 'POST', {
      tokenId: 'a'.repeat(64), direction: 'sell', amount: '1000',
    })
    expect(res.status).toBe(200)
    expect(res.json.formatted).toContain('Sell')
  })

  it('POST /api/swap/quote rejects invalid direction', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/swap/quote`, srv.token, 'POST', {
      tokenId: 'a'.repeat(64), direction: 'invalid', amount: '1000',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/swap/execute succeeds', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/swap/execute`, srv.token, 'POST', {
      tokenId: 'a'.repeat(64), direction: 'sell', amount: '1000',
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
  })
})

describe('web server AI routes', () => {
  it('POST /api/ai/purchase succeeds', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/purchase`, srv.token, 'POST', {
      model: 'test', minutes: 30, method: 'bch',
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
  })

  it('POST /api/ai/purchase rejects invalid method', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/purchase`, srv.token, 'POST', {
      model: 'test', minutes: 30, method: 'btc',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/ai/auto-refill with enabled', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/auto-refill`, srv.token, 'POST', {
      enabled: true,
    })
    expect(res.status).toBe(200)
    expect(res.json.model).toBe('test')
  })

  it('POST /api/ai/auto-refill with disabled', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/auto-refill`, srv.token, 'POST', {
      enabled: false,
    })
    expect(res.status).toBe(200)
  })

  it('POST /api/ai/auto-refill with delete', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/auto-refill`, srv.token, 'POST', {
      delete: true,
    })
    expect(res.status).toBe(200)
    expect(res.json.delete).toBe(true)
  })

  it('GET /api/ai/image-models returns models', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/image-models`, srv.token)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.json.models)).toBe(true)
  })

  it('POST /api/ai/images/quote succeeds', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/quote`, srv.token, 'POST', {
      prompt: 'a cat',
    })
    expect(res.status).toBe(200)
    expect(res.json.orderId).toBe('order-1')
  })

  it('POST /api/ai/images/quote rejects empty prompt', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/quote`, srv.token, 'POST', {
      prompt: '',
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/ai/images/fulfill succeeds', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/fulfill`, srv.token, 'POST', {
      orderId: 'order-1',
    })
    expect(res.status).toBe(200)
    expect(res.json.status).toBe('completed')
  })

  it('GET /api/ai/images/history returns data', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/history`, srv.token)
    expect(res.status).toBe(200)
  })

  it('GET /api/ai/images/exist/file returns image', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/exist/file`, srv.token)
    expect(res.status).toBe(200)
  })

  it('GET /api/ai/images/missing/file returns 404', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/ai/images/missing/file`, srv.token)
    expect(res.status).toBe(404)
  })
})

describe('web server misc', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/nonexistent`, srv.token)
    expect(res.status).toBe(404)
  })

  it('rejects token passed as query parameter', async () => {
    const res = await req(`http://127.0.0.1:${srv.port}/api/wallet/state?token=${srv.token}`, '')
    expect(res.status).toBe(401)
  })
})
