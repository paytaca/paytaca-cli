import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const mocks = vi.hoisted(() => ({
  getBalanceView: vi.fn(),
  getHistoryView: vi.fn(),
  getReceiveAddressView: vi.fn(),
  getTokenBalances: vi.fn(),
  getTokenDetail: vi.fn(),
  sendBch: vi.fn(),
  sendToken: vi.fn(),
  isValidBchAddress: vi.fn(),
  loadWalletRef: vi.fn(),
  getConfig: vi.fn(),
  listModels: vi.fn(),
  listPlans: vi.fn(),
  getWalletStatus: vi.fn(),
  summarizeCredits: vi.fn(),
  summarizeAllCredits: vi.fn(),
  buyPlan: vi.fn(),
  generateImage: vi.fn(),
  getImageHistory: vi.fn(),
  listImageModels: vi.fn(),
  armAutoRefill: vi.fn(),
  disarmAutoRefill: vi.fn(),
  readAutoRefillState: vi.fn(),
  remainingBudget: vi.fn(),
}))

vi.mock('../core/wallet.js', () => ({
  getBalanceView: mocks.getBalanceView,
  getHistoryView: mocks.getHistoryView,
  getReceiveAddressView: mocks.getReceiveAddressView,
  getTokenBalances: mocks.getTokenBalances,
  getTokenDetail: mocks.getTokenDetail,
  sendBch: mocks.sendBch,
  sendToken: mocks.sendToken,
  isValidBchAddress: mocks.isValidBchAddress,
}))

vi.mock('../wallet/index.js', () => ({
  loadWalletRef: mocks.loadWalletRef,
}))

vi.mock('../ai/client.js', () => ({
  getConfig: mocks.getConfig,
}))

vi.mock('../ai/models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/models.js')>()
  return {
    ...actual,
    listModels: mocks.listModels,
    listPlans: mocks.listPlans,
  }
})

vi.mock('../ai/credits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/credits.js')>()
  return {
    ...actual,
    getWalletStatus: mocks.getWalletStatus,
    summarizeCredits: mocks.summarizeCredits,
    summarizeAllCredits: mocks.summarizeAllCredits,
  }
})

vi.mock('../ai/purchase.js', () => ({
  buyPlan: mocks.buyPlan,
}))

vi.mock('../ai/images.js', () => ({
  generateImage: mocks.generateImage,
  getImageHistory: mocks.getImageHistory,
  listImageModels: mocks.listImageModels,
}))

vi.mock('../ai/autoRefill.js', () => ({
  armAutoRefill: mocks.armAutoRefill,
  disarmAutoRefill: mocks.disarmAutoRefill,
  readAutoRefillState: mocks.readAutoRefillState,
  remainingBudget: mocks.remainingBudget,
}))

import { createServer } from './server.js'

let server: McpServer | undefined
let client: Client | undefined

async function connect(defaultChipnet = false, clientName = 'paytaca-test'): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  server = createServer({ defaultChipnet })
  client = new Client({ name: clientName, version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

function text(result: any): string {
  return (result.content[0] as { type: string; text: string }).text
}

function goodAddress(address: string): boolean {
  return address.startsWith('bitcoincash:') || address.startsWith('bchtest:')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isValidBchAddress.mockImplementation(goodAddress)
})

afterEach(async () => {
  await client?.close()
  await server?.close()
  client = undefined
  server = undefined
})

describe('MCP tools', () => {
  describe('get_help', () => {
    it('lists tools and spending notes', async () => {
      const c = await connect()
      const result = await c.callTool({ name: 'get_help', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(text(result)).toMatch(/get_balance/)
      expect(text(result)).toMatch(/generate_image/)
      expect(text(result)).toMatch(/SPENDS REAL FUNDS|spend real funds/i)
    })
  })

  describe('image tools', () => {
    it('lists image models', async () => {
      mocks.listImageModels.mockResolvedValue([
        { id: 'nano-banana', display_name: 'Nano Banana' },
      ])
      const c = await connect()
      const result = await c.callTool({ name: 'get_image_models', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(mocks.listImageModels).toHaveBeenCalledWith({ backendUrl: undefined })
      expect(JSON.parse(text(result))).toEqual([
        { id: 'nano-banana', display_name: 'Nano Banana' },
      ])
    })

    it('passes pagination to get_image_history', async () => {
      mocks.getImageHistory.mockResolvedValue({ count: 0, data: [] })
      const c = await connect()
      await c.callTool({
        name: 'get_image_history',
        arguments: { page: 2, page_size: 5 },
      })
      expect(mocks.getImageHistory).toHaveBeenCalledWith({
        page: 2,
        pageSize: 5,
        backendUrl: undefined,
      })
    })

    it('returns an inline image with a saved path on success', async () => {
      mocks.generateImage.mockResolvedValue({
        success: true,
        paid: true,
        orderId: 'order-1',
        model: 'nano-banana',
        amountSats: 1500,
        amountUsd: 0.01,
        txid: 'txid-1',
        status: 'generation_complete',
        path: '/tmp/order-1.png',
        mediaType: 'image/png',
        base64: 'aGk=',
      })
      const c = await connect()
      const result = await c.callTool({
        name: 'generate_image',
        arguments: { prompt: 'a cat', model: 'nano-banana', chipnet: false },
      })
      expect(result.isError).toBeFalsy()
      expect(mocks.generateImage).toHaveBeenCalledWith({
        prompt: 'a cat',
        model: 'nano-banana',
        aspectRatio: undefined,
        quality: undefined,
        resolution: undefined,
        isChipnet: false,
        backendUrl: undefined,
      })
      const image = (result.content as any[]).find(
        (block) => block.type === 'image'
      ) as { type: string; data: string; mimeType: string }
      expect(image).toEqual({ type: 'image', data: 'aGk=', mimeType: 'image/png' })
      expect(result.structuredContent).toMatchObject({
        orderId: 'order-1',
        path: '/tmp/order-1.png',
        txid: 'txid-1',
      })
    })

    it('returns an error result when generation fails', async () => {
      mocks.generateImage.mockResolvedValue({
        success: false,
        paid: true,
        orderId: 'order-1',
        txid: 'txid-1',
        error: 'Payment was broadcast (txid txid-1) but the backend could not confirm it yet.',
      })
      const c = await connect()
      const result = await c.callTool({
        name: 'generate_image',
        arguments: { prompt: 'a cat' },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/could not confirm/)
      expect(text(result)).toMatch(/txid-1/)
    })

    it('returns an error result when the flow throws', async () => {
      mocks.generateImage.mockRejectedValue(new Error('backend down'))
      const c = await connect()
      const result = await c.callTool({
        name: 'generate_image',
        arguments: { prompt: 'a cat' },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('backend down')
    })
  })

  describe('get_balance', () => {
    it('uses the server default network', async () => {
      mocks.getBalanceView.mockResolvedValue({ balanceBch: 1 })
      const c = await connect(true)
      await c.callTool({ name: 'get_balance', arguments: {} })
      expect(mocks.getBalanceView).toHaveBeenCalledWith(true)
    })

    it('lets an explicit chipnet flag override the default', async () => {
      mocks.getBalanceView.mockResolvedValue({ balanceBch: 1 })
      const c = await connect(true)
      await c.callTool({ name: 'get_balance', arguments: { chipnet: false } })
      expect(mocks.getBalanceView).toHaveBeenCalledWith(false)
    })

    it('returns an error result when the wallet is unavailable', async () => {
      mocks.getBalanceView.mockRejectedValue(new Error('no wallet'))
      const c = await connect()
      const result = await c.callTool({ name: 'get_balance', arguments: {} })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('no wallet')
    })
  })

  describe('get_tokens', () => {
    it('lists token balances', async () => {
      mocks.getTokenBalances.mockResolvedValue({ tokens: [] })
      const c = await connect()
      await c.callTool({
        name: 'get_tokens',
        arguments: { include_zero: true },
      })
      expect(mocks.getTokenBalances).toHaveBeenCalledWith(false, {
        includeZero: true,
      })
      expect(mocks.getTokenDetail).not.toHaveBeenCalled()
    })

    it('returns a single token detail when a category is given', async () => {
      mocks.getTokenDetail.mockResolvedValue({ category: 'abc' })
      const c = await connect()
      await c.callTool({
        name: 'get_tokens',
        arguments: { token_category: 'abc' },
      })
      expect(mocks.getTokenDetail).toHaveBeenCalledWith('abc', false)
    })
  })

  describe('get_receiving_address', () => {
    it('requests a token-aware address for a token category', async () => {
      mocks.getReceiveAddressView.mockResolvedValue({ address: 'x' })
      const c = await connect()
      await c.callTool({
        name: 'get_receiving_address',
        arguments: { index: 2, token_category: 'abc' },
      })
      expect(mocks.getReceiveAddressView).toHaveBeenCalledWith(
        { index: 2, token: true, category: 'abc', amount: undefined },
        false
      )
    })

    it('defaults the index to zero', async () => {
      mocks.getReceiveAddressView.mockResolvedValue({ address: 'x' })
      const c = await connect()
      await c.callTool({ name: 'get_receiving_address', arguments: {} })
      expect(mocks.getReceiveAddressView).toHaveBeenCalledWith(
        { index: 0, token: false, category: undefined, amount: undefined },
        false
      )
    })
  })

  describe('send', () => {
    const tokenAddress = 'bitcoincash:zqyx49mu0kkn9ftfj6hje6g2wfer34yfnqnpwfwhlf'

    it('rejects an invalid BCH address', async () => {
      const c = await connect()
      const result = await c.callTool({
        name: 'send',
        arguments: { address: 'not-an-address', amount: '1' },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('Invalid BCH address.')
      expect(mocks.sendBch).not.toHaveBeenCalled()
    })

    it('rejects a non-integer token amount', async () => {
      const c = await connect()
      const result = await c.callTool({
        name: 'send',
        arguments: {
          address: tokenAddress,
          amount: '1.5',
          token_category: 'abc',
        },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('Token amount must be an integer.')
      expect(mocks.sendToken).not.toHaveBeenCalled()
    })

    it('rejects a non-positive token amount', async () => {
      const c = await connect()
      const result = await c.callTool({
        name: 'send',
        arguments: {
          address: tokenAddress,
          amount: '0',
          token_category: 'abc',
        },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('Token amount must be positive.')
    })

    it('sends a token in base units', async () => {
      mocks.sendToken.mockResolvedValue({ success: true, txid: 'tx1' })
      const c = await connect()
      const result = await c.callTool({
        name: 'send',
        arguments: {
          address: tokenAddress,
          amount: '5',
          token_category: 'abc',
        },
      })
      expect(result.isError).toBeFalsy()
      expect(mocks.sendToken).toHaveBeenCalledWith(
        { category: 'abc', amount: 5n, address: tokenAddress },
        false
      )
    })

    it('converts a satoshi amount before sending BCH', async () => {
      mocks.sendBch.mockResolvedValue({ success: true, txid: 'tx1' })
      const c = await connect()
      await c.callTool({
        name: 'send',
        arguments: {
          address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
          amount: '100000',
          unit: 'sats',
        },
      })
      expect(mocks.sendBch).toHaveBeenCalledWith(
        {
          address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
          amountBch: 0.001,
        },
        false
      )
    })

    it('rejects a non-numeric BCH amount', async () => {
      const c = await connect()
      const result = await c.callTool({
        name: 'send',
        arguments: {
          address: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
          amount: 'abc',
        },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('Amount must be a positive number.')
    })
  })

  describe('get_credits', () => {
    const model = {
      id: 'm',
      display_name: 'Model M',
      price_tiers: [
        { minutes: 60, price_sats: 1000, price_usd: 1 },
        { minutes: 15, price_sats: 300, price_usd: 0.3 },
      ],
    }

    it('fails with a wallet-not-configured message when no wallet exists', async () => {
      mocks.loadWalletRef.mockReturnValue(null)
      const c = await connect()
      const result = await c.callTool({ name: 'get_credits', arguments: {} })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/No wallet found/)
      expect(mocks.getWalletStatus).not.toHaveBeenCalled()
    })

    it('summarizes all sessions when no model is given', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeAllCredits.mockReturnValue([{ modelId: 'm', active: true }])
      const c = await connect()
      const result = await c.callTool({ name: 'get_credits', arguments: {} })
      expect(mocks.getWalletStatus).toHaveBeenCalledWith('h', {
        modelId: undefined,
        backendUrl: undefined,
      })
      expect(JSON.parse(text(result))).toEqual({
        sessions: [{ modelId: 'm', active: true }],
      })
      expect(result.structuredContent).toBeUndefined()
    })

    it('returns an aligned plain-text table for the pi MCP client', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeAllCredits.mockReturnValue([
        {
          modelId: 'm',
          displayName: 'Model M',
          active: true,
          timeRemainingSeconds: 60,
          timeUsedSeconds: 5,
          tokenLimit: 500000,
        },
      ])
      const c = await connect(false, 'pi-mcp-paytaca')
      const result = await c.callTool({ name: 'get_credits', arguments: {} })
      expect(text(result)).toContain('Paytaca AI credits')
      expect(text(result)).toContain('Model')
      expect(text(result)).not.toContain('"sessions"')
      expect(result.structuredContent).toEqual({
        sessions: [
          {
            modelId: 'm',
            displayName: 'Model M',
            active: true,
            timeRemainingSeconds: 60,
            timeUsedSeconds: 5,
            tokenLimit: 500000,
          },
        ],
      })
    })

    it('returns a markdown table for the opencode MCP client', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeAllCredits.mockReturnValue([
        { modelId: 'm', displayName: 'Model M', active: true, timeRemainingSeconds: 60 },
      ])
      const c = await connect(false, 'opencode')
      const result = await c.callTool({ name: 'get_credits', arguments: {} })
      expect(text(result)).toContain('## Paytaca AI credits')
      expect(text(result)).toContain('| Model | Status | Remaining | Used | Token limit |')
      expect(text(result)).toContain('| Model M | active |')
      expect(result.structuredContent).toEqual({
        sessions: [{ modelId: 'm', displayName: 'Model M', active: true, timeRemainingSeconds: 60 }],
      })
    })

    it('adds a purchase hint when every session is inactive', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeAllCredits.mockReturnValue([{ modelId: 'm', active: false }])
      mocks.getConfig.mockResolvedValue({ models: [model] })
      mocks.listModels.mockReturnValue([model])
      const c = await connect()
      const result = await c.callTool({ name: 'get_credits', arguments: {} })
      const body = JSON.parse(text(result))
      expect(body.sessions).toHaveLength(1)
      expect(body.purchaseHint).toEqual({
        model: 'm',
        minutes: 15,
        command: 'paytaca ai purchase --model m --minutes 15',
        message:
          'To keep using Model M, top up by running this in a terminal:\n\n    paytaca ai purchase --model m --minutes 15\n\n(Switch models with `paytaca ai plans`.)',
      })
    })

    it('summarizes a single active model without a hint', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeCredits.mockReturnValue({ modelId: 'm', active: true })
      const c = await connect()
      const result = await c.callTool({
        name: 'get_credits',
        arguments: { model: 'm' },
      })
      expect(mocks.summarizeCredits).toHaveBeenCalledWith({}, 'm')
      expect(JSON.parse(text(result))).toEqual({ modelId: 'm', active: true })
    })

    it('includes the copy-paste purchase command for an inactive model', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeCredits.mockReturnValue({
        modelId: 'm',
        displayName: 'Model M',
        active: false,
      })
      mocks.getConfig.mockResolvedValue({ models: [model] })
      mocks.listModels.mockReturnValue([model])
      const c = await connect()
      const result = await c.callTool({
        name: 'get_credits',
        arguments: { model: 'm' },
      })
      const body = JSON.parse(text(result))
      expect(body.modelId).toBe('m')
      expect(body.active).toBe(false)
      expect(body.purchaseHint.command).toBe(
        'paytaca ai purchase --model m --minutes 15'
      )
    })

    it('omits the hint when the model has no plans', async () => {
      mocks.loadWalletRef.mockReturnValue({ walletHash: 'h', canSign: true })
      mocks.getWalletStatus.mockResolvedValue({})
      mocks.summarizeCredits.mockReturnValue({ modelId: 'm', active: false })
      mocks.getConfig.mockResolvedValue({ models: [] })
      mocks.listModels.mockReturnValue([])
      const c = await connect()
      const result = await c.callTool({
        name: 'get_credits',
        arguments: { model: 'm' },
      })
      expect(JSON.parse(text(result))).toEqual({ modelId: 'm', active: false })
    })
  })

  describe('get_plans', () => {
    const plans = [
      {
        id: 'z-ai/glm-5.3-flash',
        displayName: 'GLM 5.3 Flash',
        plans: [
          { minutes: 15, price_usd: 0.4, price_sats: 180711 },
          { minutes: 30, price_usd: 0.65, price_sats: 291231 },
          { minutes: 60, price_usd: 1.23, price_sats: 553275 },
        ],
      },
    ]

    it('returns a markdown table for the opencode MCP client', async () => {
      mocks.getConfig.mockResolvedValue({ models: [] })
      mocks.listPlans.mockReturnValue(plans)
      const c = await connect(false, 'opencode')
      const result = await c.callTool({ name: 'get_plans', arguments: {} })
      expect(text(result)).toContain('## Paytaca AI plans')
      expect(text(result)).toContain('| Model | 15 min | 30 min | 1 hr |')
      expect(text(result)).toContain(
        '| GLM 5.3 Flash (`z-ai/glm-5.3-flash`) | $0.40 | $0.65 | $1.23 |'
      )
      expect(result.structuredContent).toEqual({ models: plans })
    })

    it('returns an aligned plain-text table for the pi MCP client', async () => {
      mocks.getConfig.mockResolvedValue({ models: [] })
      mocks.listPlans.mockReturnValue(plans)
      const c = await connect(false, 'pi-mcp-paytaca')
      const result = await c.callTool({ name: 'get_plans', arguments: {} })
      expect(text(result)).toContain('Paytaca AI plans')
      expect(text(result)).toContain('GLM 5.3 Flash (z-ai/glm-5.3-flash)')
      expect(text(result)).toContain('15 min')
      expect(text(result)).not.toContain('##')
      expect(result.structuredContent).toEqual({ models: plans })
    })

    it('returns JSON for other MCP clients', async () => {
      mocks.getConfig.mockResolvedValue({ models: [] })
      mocks.listPlans.mockReturnValue(plans)
      const c = await connect()
      const result = await c.callTool({ name: 'get_plans', arguments: {} })
      expect(JSON.parse(text(result))).toEqual(plans)
      expect(result.structuredContent).toBeUndefined()
    })
  })

  describe('buy_plan', () => {
    it('purchases with confirmation and defaults to BCH', async () => {
      mocks.buyPlan.mockResolvedValue({ success: true, paid: true })
      const c = await connect()
      await c.callTool({
        name: 'buy_plan',
        arguments: { model: 'deepseek/deepseek-v4-pro', minutes: 60 },
      })
      expect(mocks.buyPlan).toHaveBeenCalledWith({
        model: 'deepseek/deepseek-v4-pro',
        minutes: 60,
        paymentMethod: 'bch',
        isChipnet: false,
        backendUrl: undefined,
        confirmed: true,
      })
    })
  })

  describe('auto_refill', () => {
    it('requires model, minutes and max_minutes to arm', async () => {
      const c = await connect()
      const result = await c.callTool({
        name: 'auto_refill',
        arguments: { enabled: true, model: 'm' },
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/requires model, minutes, and max_minutes/)
      expect(mocks.armAutoRefill).not.toHaveBeenCalled()
    })

    it('arms auto-refill when fully specified', async () => {
      mocks.armAutoRefill.mockReturnValue({ enabled: true })
      const c = await connect()
      await c.callTool({
        name: 'auto_refill',
        arguments: {
          enabled: true,
          model: 'm',
          minutes: 60,
          max_minutes: 300,
          payment_method: 'lift',
        },
      })
      expect(mocks.armAutoRefill).toHaveBeenCalledWith({
        model: 'm',
        minutes: 60,
        maxMinutes: 300,
        paymentMethod: 'lift',
      })
    })

    it('disarms auto-refill', async () => {
      mocks.disarmAutoRefill.mockReturnValue({ enabled: false })
      const c = await connect()
      await c.callTool({
        name: 'auto_refill',
        arguments: { enabled: false },
      })
      expect(mocks.disarmAutoRefill).toHaveBeenCalled()
    })

    it('reports auto-refill state when no flag is given', async () => {
      mocks.readAutoRefillState.mockReturnValue({
        enabled: true,
        maxMinutes: 10,
        spentMinutes: 3,
      })
      mocks.remainingBudget.mockReturnValue(7)
      const c = await connect()
      const result = await c.callTool({
        name: 'auto_refill',
        arguments: {},
      })
      expect(JSON.parse(text(result))).toEqual({
        armed: true,
        remainingMinutes: 7,
        state: { enabled: true, maxMinutes: 10, spentMinutes: 3 },
      })
    })
  })
})