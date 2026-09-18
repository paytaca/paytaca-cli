import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listImageModels,
  getImageHistory,
  createImageOrder,
  fulfillImageOrder,
  generateImage,
  type ImageOrderQuote,
} from './images.js'

const mocks = vi.hoisted(() => ({
  requireWallet: vi.fn(),
  isValidBchAddress: vi.fn(),
  createAuthMaterial: vi.fn(),
  registerOAuthUser: vi.fn(),
  createAccessToken: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('../core/context.js', () => ({ requireWallet: mocks.requireWallet }))
vi.mock('../core/wallet.js', () => ({ isValidBchAddress: mocks.isValidBchAddress }))
vi.mock('./oauth.js', () => ({
  createAuthMaterial: mocks.createAuthMaterial,
  registerOAuthUser: mocks.registerOAuthUser,
  createAccessToken: mocks.createAccessToken,
}))
vi.mock('node:fs', () => ({
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
  chmodSync: mocks.chmodSync,
}))

const fetchMock = vi.fn()

type SendResult = { success: boolean; txid?: string; error?: string }

function ctxFixture(overrides: Record<string, unknown> = {}) {
  return {
    mnemonic: 'test mnemonic',
    walletHash: 'wh',
    network: 'mainnet',
    isChipnet: false,
    bch: {
      getAddressSetAt: vi.fn(() => ({
        receiving: 'bitcoincash:qreceive00000000000000000000000000000',
        change: 'bitcoincash:qchange000000000000000000000000000000',
      })),
      getBalance: vi.fn(async () => ({ spendable: 1 })),
      sendBch: vi.fn(async (): Promise<SendResult> => ({ success: true, txid: 'txid-1' })),
    },
    ...overrides,
  }
}

function route(
  handler: (
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> }
  ) => { status?: number; body?: unknown } | undefined
): void {
  fetchMock.mockImplementation(async (url: any, init?: any) => {
    const result = handler(String(url), init)
    if (!result) {
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`)
    }
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
    })
  })
}

const ORDER_RESPONSE = {
  id: 'order-1',
  status: 'pending_payment',
  contract_address: 'bitcoincash:qcontract00000000000000000000000000',
  amount_sats: 1500,
  amount_usd: 0.01,
  model: 'nano-banana',
  pricing_unit: 'image',
  estimated_cost_usd: 0.008,
  prompt: 'a cat',
}

const QUOTE: ImageOrderQuote = {
  orderId: 'order-1',
  prompt: 'a cat',
  model: 'nano-banana',
  pricingUnit: 'image',
  contractAddress: 'bitcoincash:qcontract00000000000000000000000000',
  amountSats: 1500,
  amountUsd: 0.01,
  estimatedCostUsd: 0.008,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  mocks.requireWallet.mockReturnValue(ctxFixture())
  mocks.isValidBchAddress.mockReturnValue(true)
  mocks.createAuthMaterial.mockReturnValue({ userId: 'wh' })
  mocks.registerOAuthUser.mockResolvedValue(undefined)
  mocks.createAccessToken.mockResolvedValue('tok')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listImageModels', () => {
  it('fetches the public model list with filters', async () => {
    route((url) => {
      if (url.includes('/v1/image-models')) {
        expect(url).toContain('pricing_unit=image')
        expect(url).toContain('search=banana')
        expect(url).toContain('ordering=display_name')
        return { body: { object: 'list', data: [{ id: 'nano-banana' }] } }
      }
    })
    const models = await listImageModels({
      pricingUnit: 'image',
      search: 'banana',
      ordering: 'display_name',
    })
    expect(models).toEqual([{ id: 'nano-banana' }])
  })

  it('throws on a backend error', async () => {
    route((url) => {
      if (url.includes('/v1/image-models')) return { status: 500, body: { error: 'down' } }
    })
    await expect(listImageModels()).rejects.toThrow(/down/)
  })
})

describe('getImageHistory', () => {
  it('sends the bearer token and pagination params', async () => {
    route((url, init) => {
      if (url.includes('/v1/images/history')) {
        expect(url).toContain('page=2')
        expect(url).toContain('page_size=5')
        expect(init?.headers?.Authorization).toBe('Bearer tok')
        return { body: { count: 1, data: [{ id: 'order-1' }] } }
      }
    })
    const history = await getImageHistory({ page: 2, pageSize: 5 })
    expect(history.data).toEqual([{ id: 'order-1' }])
  })
})

describe('createImageOrder', () => {
  it('creates an order and returns a quote', async () => {
    route((url, init) => {
      if (url.endsWith('/v1/images') && init?.method === 'POST') {
        const body = JSON.parse(init?.body ?? '{}')
        expect(body.prompt).toBe('a cat')
        expect(body.refund_address).toBe(
          'bitcoincash:qreceive00000000000000000000000000000'
        )
        expect(body.model).toBe('nano-banana')
        expect(body.aspect_ratio).toBe('16:9')
        expect(body.quality).toBe('high')
        expect(body.resolution).toBe('2K')
        return { status: 201, body: ORDER_RESPONSE }
      }
    })
    const quote = await createImageOrder({
      prompt: 'a cat',
      model: 'nano-banana',
      aspectRatio: '16:9',
      quality: 'high',
      resolution: '2K',
    })
    expect(quote).toEqual(QUOTE)
  })

  it('rejects an empty prompt before any request', async () => {
    const ctx = ctxFixture()
    mocks.requireWallet.mockReturnValue(ctx)
    await expect(createImageOrder({ prompt: '   ' })).rejects.toThrow(
      'Missing prompt.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed order response', async () => {
    route((url) => {
      if (url.endsWith('/v1/images')) {
        return { status: 201, body: { id: 'order-1', amount_sats: 0 } }
      }
    })
    await expect(createImageOrder({ prompt: 'a cat' })).rejects.toThrow(
      /Malformed image order/
    )
  })
})

describe('fulfillImageOrder', () => {
  const timing = { confirmSpacingMs: 1, pollIntervalMs: 1, pollTimeoutMs: 200 }

  function happyRoute(opts: { confirmResponses?: number[]; statusBodies?: any[] } = {}) {
    const confirmResponses = opts.confirmResponses ?? [200]
    const statusBodies = opts.statusBodies ?? [
      { status: 'processing' },
      { status: 'generation_complete', image: 'aGk=', media_type: 'image/png' },
    ]
    let confirmIndex = 0
    let statusIndex = 0
    route((url, init) => {
      if (url.includes('/confirm-payment')) {
        const status = confirmResponses[confirmIndex++] ?? 200
        return { status, body: { id: 'order-1', status: 'processing' } }
      }
      if (url.includes('/status')) {
        return { body: statusBodies[statusIndex++] ?? statusBodies.at(-1) }
      }
      if (url.endsWith('/confirm')) {
        return { body: { ok: true } }
      }
    })
  }

  it('pays, confirms, polls, saves, and returns the image', async () => {
    const ctx = ctxFixture()
    mocks.requireWallet.mockReturnValue(ctx)
    happyRoute()

    const result = await fulfillImageOrder(QUOTE, timing)

    expect(result.success).toBe(true)
    expect(result.paid).toBe(true)
    expect(result.txid).toBe('txid-1')
    expect(result.path).toContain('order-1.png')
    expect(result.base64).toBe('aGk=')
    expect(ctx.bch.sendBch).toHaveBeenCalledWith(
      1500 / 1e8,
      QUOTE.contractAddress,
      'bitcoincash:qchange000000000000000000000000000000'
    )
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('order-1.png'),
      Buffer.from('aGk=', 'base64')
    )
    expect(mocks.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining('order-1.png'),
      0o600
    )
  })

  it('retries confirm-payment on 502 while the tx is being indexed', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    happyRoute({ confirmResponses: [502, 502, 200] })

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(true)
    const confirmCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes('/confirm-payment')
    )
    expect(confirmCalls).toHaveLength(3)
  })

  it('treats a 400 "already" confirm response as success', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    happyRoute({
      confirmResponses: [
        400,
      ],
    })
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      const u = String(url)
      if (u.includes('/confirm-payment')) {
        return new Response(
          JSON.stringify({ error: 'Order is already processing' }),
          { status: 400 }
        )
      }
      if (u.includes('/status')) {
        return new Response(
          JSON.stringify({
            status: 'generation_complete',
            image: 'aGk=',
            media_type: 'image/png',
          }),
          { status: 200 }
        )
      }
      if (u.endsWith('/confirm')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${u}`)
    })

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(true)
  })

  it('fails (with paid and txid) when the payment is provably invalid', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    route((url) => {
      if (url.includes('/confirm-payment')) {
        return {
          status: 400,
          body: { error: 'Payment not sent to expected address' },
        }
      }
    })

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(false)
    expect(result.paid).toBe(true)
    expect(result.txid).toBe('txid-1')
    expect(result.error).toMatch(/could not confirm/)
    expect(result.error).toMatch(/txid-1/)
  })

  it('reports generation failure with the paid txid', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    happyRoute({
      statusBodies: [{ status: 'processing' }, { status: 'failed', error: 'boom' }],
    })

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(false)
    expect(result.paid).toBe(true)
    expect(result.error).toMatch(/failed: boom/)
    expect(result.error).toMatch(/txid-1/)
  })

  it('times out polling without losing the txid', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    happyRoute({
      statusBodies: [{ status: 'processing' }],
    })

    const result = await fulfillImageOrder(QUOTE, {
      ...timing,
      pollTimeoutMs: 10,
    })
    expect(result.success).toBe(false)
    expect(result.paid).toBe(true)
    expect(result.error).toMatch(/Timed out/)
    expect(result.error).toMatch(/txid-1/)
  })

  it('blocks the payment when the balance is insufficient', async () => {
    const ctx = ctxFixture()
    ctx.bch.getBalance = vi.fn(async () => ({ spendable: 0.000005 }))
    mocks.requireWallet.mockReturnValue(ctx)
    route(() => undefined)

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(false)
    expect(result.paid).toBe(false)
    expect(result.error).toMatch(/Insufficient balance/)
    expect(ctx.bch.sendBch).not.toHaveBeenCalled()
  })

  it('refuses an invalid payment address', async () => {
    mocks.isValidBchAddress.mockReturnValue(false)
    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid payment address/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a broadcast failure without paying', async () => {
    const ctx = ctxFixture()
    ctx.bch.sendBch = vi.fn(async (): Promise<SendResult> => ({
      success: false,
      error: 'mempool full',
    }))
    mocks.requireWallet.mockReturnValue(ctx)

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.paid).toBe(false)
    expect(result.error).toBe('mempool full')
  })

  it('rejects an unsupported media type but still returns the image', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    happyRoute({
      statusBodies: [
        { status: 'generation_complete', image: 'aGk=', media_type: 'image/tiff' },
      ],
    })

    const result = await fulfillImageOrder(QUOTE, timing)
    expect(result.success).toBe(false)
    expect(result.paid).toBe(true)
    expect(result.base64).toBe('aGk=')
    expect(result.error).toMatch(/unsupported media type/)
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('generateImage', () => {
  it('chains create and fulfill end-to-end', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    route((url, init) => {
      if (url.endsWith('/v1/images') && init?.method === 'POST') {
        return { status: 201, body: ORDER_RESPONSE }
      }
      if (url.includes('/confirm-payment')) {
        return { body: { id: 'order-1', status: 'processing' } }
      }
      if (url.includes('/status')) {
        return {
          body: {
            status: 'generation_complete',
            image: 'aGk=',
            media_type: 'image/png',
          },
        }
      }
      if (url.endsWith('/confirm')) {
        return { body: { ok: true } }
      }
    })

    const result = await generateImage({
      prompt: 'a cat',
      confirmSpacingMs: 1,
      pollIntervalMs: 1,
      pollTimeoutMs: 200,
    })

    expect(result.success).toBe(true)
    expect(result.orderId).toBe('order-1')
    expect(result.path).toContain('order-1.png')
  })

  it('returns a result object when the order cannot be created', async () => {
    mocks.requireWallet.mockReturnValue(ctxFixture())
    route((url) => {
      if (url.endsWith('/v1/images')) {
        return { status: 500, body: { error: 'nope' } }
      }
    })

    const result = await generateImage({ prompt: 'a cat' })
    expect(result.success).toBe(false)
    expect(result.paid).toBe(false)
    expect(result.error).toMatch(/nope/)
  })
})
