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

vi.mock('../ai/autoRefill.js', () => ({
  armAutoRefill: mocks.armAutoRefill,
  disarmAutoRefill: mocks.disarmAutoRefill,
  readAutoRefillState: mocks.readAutoRefillState,
  remainingBudget: mocks.remainingBudget,
}))

import { createServer } from './server.js'

let server: McpServer | undefined
let client: Client | undefined

async function connect(defaultChipnet = false): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  server = createServer({ defaultChipnet })
  client = new Client({ name: 'paytaca-test', version: '1.0.0' })
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
      expect(text(result)).toMatch(/SPENDS REAL FUNDS|spend real funds/i)
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