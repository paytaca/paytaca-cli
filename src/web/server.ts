import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { renderPage } from './page.js'
import {
  getBalanceView,
  getTokenBalances,
  getHistoryView,
  getReceiveAddressView,
  sendBch,
  sendToken,
  isValidBchAddress,
  isTokenAddress,
  type SendOutcome,
} from '../core/wallet.js'
import { loadWalletRef, loadWallet, loadMnemonic } from '../wallet/index.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import { getBchUsdPrice } from '../utils/prices.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { LIFT_TOKEN_ID } from '../ai/config.js'
import {
  getConfig,
  getWalletStatus,
} from '../ai/client.js'
import {
  listPlans,
  selectModel,
  selectTier,
  formatDuration,
} from '../ai/models.js'
import {
  formatRemaining,
  getSessions,
} from '../ai/credits.js'
import {
  buyPlan,
  type PaymentMethod,
} from '../ai/purchase.js'
import {
  readAutoRefillState,
  armAutoRefill,
  disarmAutoRefill,
  remainingBudget,
  type AutoRefillState,
} from '../ai/autoRefill.js'
import {
  listImageModels,
  createImageOrder,
  fulfillImageOrder,
  getImageHistory,
  IMAGE_DIR,
  MEDIA_TYPE_EXTENSIONS,
  type ImageModel,
  type ImageOrderQuote,
  type GenerateImageResult,
  type ImageHistoryEntry,
} from '../ai/images.js'
import {
  estimateSwap,
  executeSwap,
  formatQuote,
  estimateTokenNeededForBch,
  type SwapDirection,
} from '../wallet/cauldron/swap.js'
import { fetchTokenData } from '../wallet/cauldron/api.js'
import { formatTokenAmount } from '../utils/format.js'

export interface WebDeps {
  getWalletState(): Promise<object>
  getWalletHistory(page: number, type: string, tokenId?: string): Promise<object>
  getReceiveView(opts: {
    index?: number
    token?: boolean
    category?: string
    amount?: number
  }): Promise<object>
  sendBchPayment(opts: {
    address: string
    amount: number
    currency: string
  }): Promise<SendOutcome>
  sendTokenPayment(opts: {
    category: string
    amount: string
    address: string
  }): Promise<SendOutcome>
  swapQuote(opts: {
    tokenId: string
    direction: string
    amount: string
  }): Promise<object>
  swapExecute(opts: {
    tokenId: string
    direction: string
    amount: string
  }): Promise<object>
  purchasePlan(opts: {
    model: string
    minutes: number
    method: string
  }): Promise<object>
  quoteLiftNeeded(opts: { sats: number }): Promise<object>
  setAutoRefill(opts: {
    enabled: boolean
    model?: string
    minutes?: number
    maxMinutes?: number
    paymentMethod?: string
  }): Promise<AutoRefillState>
  getImageModels(): Promise<ImageModel[]>
  getImageHistory(page?: number): Promise<object>
  createImageQuote(opts: {
    prompt: string
    model?: string
    aspectRatio?: string
    quality?: string
    resolution?: string
  }): Promise<ImageOrderQuote>
  fulfillImage(orderId: string): Promise<GenerateImageResult>
  serveImageFile(id: string): Promise<{ filePath: string; mediaType: string } | null>
  deleteImageFile(id: string): Promise<boolean>
}

function defaultDeps(isChipnet: boolean, backendUrl?: string): WebDeps {
  return {
    async getWalletState() {
      const wallet = loadWalletRef()
      if (!wallet) throw new WalletNotConfiguredError()
      const walletHash = wallet.walletHash

      const [balance, tokens, config, status] = await Promise.all([
        getBalanceView(isChipnet),
        getTokenBalances(isChipnet),
        getConfig({ backendUrl }),
        getWalletStatus(walletHash, { backendUrl }),
      ])

      let bchPriceUsd: number | null = null
      try { bchPriceUsd = await getBchUsdPrice(isChipnet) } catch {}

      const lift = tokens.tokens.find((t: { category: string }) => t.category === LIFT_TOKEN_ID)
      const sessions = getSessions(status).map((s) => ({
        model: s.model_id || s.ai_model || null,
        displayName: s.display_name || null,
        active: s.model_active === true || s.session_active === true,
        remainingSeconds: s.time_remaining_seconds ?? 0,
        usedSeconds: s.time_used_seconds ?? 0,
        creditsSeconds: s.time_credits_seconds ?? 0,
      }))

      const plans = listPlans(config).map((p) => ({
        modelId: p.id,
        displayName: p.displayName,
        tiers: (p.plans || []).map((t) => ({
          minutes: t.minutes,
          durationDisplay: formatDuration(t.minutes),
          priceUsd: t.price_usd,
          priceSats: t.price_sats,
        })),
      }))
      const autoRefill = readAutoRefillState()

      let imageModels: ImageModel[] = []
      try { imageModels = await listImageModels({ backendUrl }) } catch {}

      let imageHistory: ImageHistoryEntry[] = []
      try {
        const hist = await getImageHistory({ backendUrl, page: 1, pageSize: 20 })
        imageHistory = (hist.data || []).map((e) => ({
          ...e,
          filepath: localImageFile(e.id) ?? undefined,
        }))
      } catch {}

      return {
        walletHash,
        bchPriceUsd,
        network: balance.network,
        balance: {
          spendableSats: balance.spendableSats,
          spendableBch: balance.spendableBch,
          usd: balance.usd,
        },
        tokens: tokens.tokens,
        lift: lift
          ? { category: lift.category, symbol: lift.symbol, displayBalance: lift.displayBalance, rawBalance: lift.rawBalance }
          : null,
        usage: sessions,
        plans,
        liftDiscountPercent: config.lift_payment_discount_percent ?? 0,
        autoRefill: autoRefill
          ? { ...autoRefill, remainingMinutes: remainingBudget(autoRefill) }
          : null,
        imageModels,
        imageHistory,
      }
    },

    async getWalletHistory(page, type, tokenId) {
      return getHistoryView(
        { page, recordType: type, tokenId },
        isChipnet
      )
    },

    async getReceiveView(opts) {
      return getReceiveAddressView(
        { index: opts.index, token: opts.token, category: opts.category, amount: opts.amount },
        isChipnet
      )
    },

    async sendBchPayment(opts) {
      let amountBch = opts.amount
      if (opts.currency === 'sats' || opts.currency === 'satoshis') {
        amountBch = amountBch / 1e8
      } else if (opts.currency === 'usd') {
        const usdPrice = await getBchUsdPrice(isChipnet)
        if (usdPrice === null) throw new Error('Unable to fetch BCH-USD price')
        amountBch = amountBch / usdPrice
      }
      return sendBch({ address: opts.address, amountBch }, isChipnet)
    },

    async sendTokenPayment(opts) {
      const amount = BigInt(opts.amount)
      if (amount <= 0n) throw new Error('Amount must be positive')
      return sendToken(
        { category: opts.category, amount, address: opts.address },
        isChipnet
      )
    },

    async swapQuote(opts) {
      if (isChipnet) throw new Error('Cauldron swaps are not supported on chipnet')
      const parsedAmount = parseFloat(opts.amount)
      if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error('Invalid amount')
      const tokenData = await fetchTokenData(opts.tokenId)
      if (!tokenData) throw new Error('No token data found')
      const decimals = tokenData.bcmr.token.decimals
      const symbol = tokenData.bcmr.token.symbol || tokenData.display_symbol
      const amount = BigInt(Math.round(parsedAmount * 10 ** decimals))
      const direction: SwapDirection = opts.direction === 'buy' ? 'buy' : 'sell'
      const quote = await estimateSwap({ tokenId: opts.tokenId, direction, amount })
      const platformFeeSats = quote.platformFee ? Number(quote.platformFee.amount).toString() : null
      return {
        tokenId: opts.tokenId,
        symbol,
        decimals,
        direction: opts.direction,
        rate: quote.rate,
        tokenAmount: Number(quote.tokenAmount).toString(),
        bchAmountSats: Number(quote.bchAmount).toString(),
        tradeFeeSats: Number(quote.tradeFee).toString(),
        platformFeeSats,
        formatted: formatQuote(quote),
      }
    },

    async swapExecute(opts) {
      if (isChipnet) throw new Error('Cauldron swaps are not supported on chipnet')
      const parsedAmount = parseFloat(opts.amount)
      if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error('Invalid amount')
      const mnemonicData = loadMnemonic()
      if (!mnemonicData) throw new WalletNotConfiguredError()
      const wallet = loadWallet()
      if (!wallet) throw new WalletNotConfiguredError()
      const bchWallet = wallet.forNetwork(false)
      const tokenData = await fetchTokenData(opts.tokenId)
      if (!tokenData) throw new Error('No token data found')
      const decimals = tokenData.bcmr.token.decimals
      const amount = BigInt(Math.round(parsedAmount * 10 ** decimals))
      const direction: SwapDirection = opts.direction === 'buy' ? 'buy' : 'sell'
      const result = await executeSwap({
        tokenId: opts.tokenId,
        direction,
        amount,
        bchWallet,
        mnemonic: mnemonicData.mnemonic,
        derivationPath: BCH_DERIVATION_PATH,
      })
      return {
        success: result.success,
        txid: result.txid || null,
        error: result.error || null,
      }
    },

    async purchasePlan(opts) {
      return buyPlan({
        model: opts.model,
        minutes: opts.minutes,
        paymentMethod: (opts.method as PaymentMethod) || 'bch',
        isChipnet,
        backendUrl,
        confirmed: true,
      })
    },

    async quoteLiftNeeded(opts) {
      if (isChipnet) throw new Error('LIFT swaps are not supported on chipnet')
      const sats = Number(opts.sats)
      if (!Number.isFinite(sats) || !Number.isInteger(sats) || sats <= 0) {
        throw new Error('Invalid sats amount')
      }
      const est = await estimateTokenNeededForBch({
        tokenId: LIFT_TOKEN_ID,
        bchDemandSats: BigInt(sats),
        isChipnet,
      })
      return {
        sats,
        rawAmount: Number(est.tokenAmount).toString(),
        display: formatTokenAmount(Number(est.tokenAmount), est.decimals),
        symbol: est.symbol,
        decimals: est.decimals,
      }
    },

    async setAutoRefill(opts) {
      if (opts.enabled) {
        return armAutoRefill({
          model: opts.model,
          minutes: opts.minutes,
          maxMinutes: opts.maxMinutes,
          paymentMethod: (opts.paymentMethod as 'bch' | 'lift') || 'bch',
        })
      }
      return disarmAutoRefill()
    },

    async getImageModels() {
      return listImageModels({ backendUrl })
    },

    async getImageHistory(page?: number) {
      return getImageHistory({ backendUrl, page, pageSize: 20 })
    },

    async createImageQuote(opts) {
      return createImageOrder({
        prompt: opts.prompt,
        model: opts.model,
        aspectRatio: opts.aspectRatio,
        quality: opts.quality,
        resolution: opts.resolution,
        isChipnet,
        backendUrl,
      })
    },

    async fulfillImage(orderId) {
      throw new Error('Fulfillment requires the original quote. Use POST /api/ai/images/fulfill with stored quote.')
    },

    async serveImageFile(id) {
      const filePath = localImageFile(id)
      if (!filePath) return null
      const ext = filePath.split('.').pop() || ''
      return {
        filePath,
        mediaType: IMAGE_EXT_TO_MEDIA[ext] || 'application/octet-stream',
      }
    },

    async deleteImageFile(id) {
      const filePath = localImageFile(id)
      if (!filePath) return false
      try {
        fs.unlinkSync(filePath)
        return true
      } catch {
        return false
      }
    },
  }
}

function localImageFile(id: string): string | null {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return null
  try {
    const files = fs.readdirSync(IMAGE_DIR).filter((f) => f.startsWith(safeId + '.'))
    return files.length ? path.join(IMAGE_DIR, files[0]) : null
  } catch {
    return null
  }
}

const IMAGE_EXT_TO_MEDIA: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_TYPE_EXTENSIONS).map(([mediaType, ext]) => [ext, mediaType])
)

function createDefaultDepsWithQuotes(isChipnet: boolean, backendUrl?: string): WebDeps {
  const base = defaultDeps(isChipnet, backendUrl)
  const quoteStore = new Map<string, ImageOrderQuote>()

  return {
    ...base,
    async fulfillImage(orderId) {
      const quote = quoteStore.get(orderId)
      if (!quote) throw new Error('No quote found for order. Request a new quote first.')
      quoteStore.delete(orderId)
      return fulfillImageOrder(quote, { isChipnet, backendUrl })
    },

    async createImageQuote(opts) {
      const quote = await createImageOrder({
        prompt: opts.prompt,
        model: opts.model,
        aspectRatio: opts.aspectRatio,
        quality: opts.quality,
        resolution: opts.resolution,
        isChipnet,
        backendUrl,
      })
      quoteStore.set(quote.orderId, quote)
      let amountUsd: number | undefined
      try {
        const usdPerBch = await getBchUsdPrice(isChipnet)
        if (usdPerBch !== null) {
          amountUsd = Number(((quote.amountSats / 1e8) * usdPerBch).toFixed(2))
        }
      } catch {
        amountUsd = undefined
      }
      return { ...quote, amountUsd }
    },
  }
}

interface JsonBody {
  [key: string]: unknown
}

async function readBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function getClientHost(req: http.IncomingMessage): string {
  return (req.headers.host || '').toLowerCase().split(':')[0]
}

export interface WebServer {
  server: http.Server
  port: number
  token: string
  url: string
  close(): Promise<void>
}

export interface StartWebServerOptions {
  port?: number
  isChipnet?: boolean
  backendUrl?: string
  deps?: WebDeps
}

export async function startWebServer(
  options: StartWebServerOptions = {}
): Promise<WebServer> {
  const token = crypto.randomBytes(16).toString('hex')
  const isChipnet = Boolean(options.isChipnet)
  const backendUrl = options.backendUrl
  const deps = options.deps || createDefaultDepsWithQuotes(isChipnet, backendUrl)
  const pageHtml = renderPage()

  function checkAuth(req: http.IncomingMessage, url?: URL): boolean {
    if (req.headers['x-paytaca-token'] === token) return true
    return url != null && url.searchParams.get('token') === token
  }

  function checkHost(req: http.IncomingMessage): boolean {
    const host = getClientHost(req)
    return host === '127.0.0.1' || host === 'localhost'
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
      const pathname = url.pathname

      if (!checkHost(req)) {
        return json(res, 403, { error: 'Forbidden: invalid host' })
      }

      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(pageHtml)
        return
      }

      // ── wallet routes ──────────────────────────────────────────────────

      if (pathname === '/api/wallet/state' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const state = await deps.getWalletState()
        return json(res, 200, state)
      }

      if (pathname === '/api/wallet/history' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const page = Number(url.searchParams.get('page')) || 1
        const type = String(url.searchParams.get('type') || 'all')
        const tokenId = url.searchParams.get('tokenId') || undefined
        const result = await deps.getWalletHistory(page, type, tokenId)
        return json(res, 200, result)
      }

      if (pathname === '/api/wallet/receive' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const index = url.searchParams.has('index') ? Number(url.searchParams.get('index')) : undefined
        const token = url.searchParams.has('token') ? url.searchParams.get('token') === '1' || url.searchParams.get('token') === 'true' : undefined
        const category = url.searchParams.get('category') || undefined
        const amount = url.searchParams.has('amount') ? Number(url.searchParams.get('amount')) : undefined
        const view = await deps.getReceiveView({ index, token, category, amount })
        return json(res, 200, view)
      }

      if (pathname === '/api/wallet/send' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const address = String(body.address || '')
        const amount = Number(body.amount)
        const currency = String(body.currency || 'bch')
        if (!address) return json(res, 400, { error: 'Missing address' })
        if (!isValidBchAddress(address, isChipnet)) return json(res, 400, { error: 'Invalid BCH address' })
        if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Invalid amount' })
        if (!['bch', 'sats', 'satoshis', 'usd'].includes(currency)) {
          return json(res, 400, { error: 'Currency must be "bch", "sats", "satoshis", or "usd"' })
        }
        const result = await deps.sendBchPayment({ address, amount, currency })
        return json(res, 200, result)
      }

      if (pathname === '/api/wallet/send-token' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const category = String(body.category || '')
        const amount = String(body.amount || '')
        const address = String(body.address || '')
        if (!category || !/^[a-fA-F0-9]{64}$/.test(category)) return json(res, 400, { error: 'Invalid category (64-char hex)' })
        if (!amount) return json(res, 400, { error: 'Missing amount' })
        if (!address) return json(res, 400, { error: 'Missing address' })
        if (!isValidBchAddress(address, isChipnet)) return json(res, 400, { error: 'Invalid BCH address' })
        let bigAmount: bigint
        try { bigAmount = BigInt(amount) } catch { return json(res, 400, { error: 'Amount must be a valid integer' }) }
        if (bigAmount <= 0n) return json(res, 400, { error: 'Amount must be positive' })
        const tokenWarning = !isTokenAddress(address)
        const result = await deps.sendTokenPayment({ category, amount, address })
        return json(res, 200, { ...result, tokenWarning })
      }

      // ── swap routes ────────────────────────────────────────────────────

      if (pathname === '/api/swap/quote' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const tokenId = String(body.tokenId || '')
        const direction = String(body.direction || 'sell')
        const amount = String(body.amount || '')
        if (!tokenId || !/^[a-fA-F0-9]{64}$/.test(tokenId)) return json(res, 400, { error: 'Invalid tokenId' })
        if (!['buy', 'sell'].includes(direction)) return json(res, 400, { error: 'Direction must be "buy" or "sell"' })
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return json(res, 400, { error: 'Invalid amount' })
        const quote = await deps.swapQuote({ tokenId, direction, amount })
        return json(res, 200, quote)
      }

      if (pathname === '/api/swap/execute' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const tokenId = String(body.tokenId || '')
        const direction = String(body.direction || 'sell')
        const amount = String(body.amount || '')
        if (!tokenId || !/^[a-fA-F0-9]{64}$/.test(tokenId)) return json(res, 400, { error: 'Invalid tokenId' })
        if (!['buy', 'sell'].includes(direction)) return json(res, 400, { error: 'Direction must be "buy" or "sell"' })
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return json(res, 400, { error: 'Invalid amount' })
        const result = await deps.swapExecute({ tokenId, direction, amount })
        return json(res, 200, result)
      }

      // ── ai routes ──────────────────────────────────────────────────────

      if (pathname === '/api/ai/state' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const state = await deps.getWalletState()
        return json(res, 200, state)
      }

      if (pathname === '/api/ai/lift-quote' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const sats = Number(url.searchParams.get('sats'))
        if (!Number.isFinite(sats) || !Number.isInteger(sats) || sats <= 0) {
          return json(res, 400, { error: 'Invalid sats amount' })
        }
        const quote = await deps.quoteLiftNeeded({ sats })
        return json(res, 200, quote)
      }

      if (pathname === '/api/ai/purchase' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const model = String(body.model || '')
        const minutes = Number(body.minutes)
        const method = String(body.method || 'bch')
        if (!model) return json(res, 400, { error: 'Missing model' })
        if (!Number.isFinite(minutes) || minutes <= 0) return json(res, 400, { error: 'Invalid minutes' })
        if (method !== 'bch' && method !== 'lift') return json(res, 400, { error: 'Method must be "bch" or "lift"' })
        const result = await deps.purchasePlan({ model, minutes, method })
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/auto-refill' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const enabled = Boolean(body.enabled)
        const result = await deps.setAutoRefill({
          enabled,
          model: body.model != null ? String(body.model) : undefined,
          minutes: body.minutes != null ? Number(body.minutes) : undefined,
          maxMinutes: body.maxMinutes != null ? Number(body.maxMinutes) : undefined,
          paymentMethod: body.paymentMethod != null ? String(body.paymentMethod) : undefined,
        })
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/image-models' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const models = await deps.getImageModels()
        return json(res, 200, { models })
      }

      if (pathname === '/api/ai/images/history' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
        const result = await deps.getImageHistory(page)
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/images/quote' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const prompt = String(body.prompt || '').trim()
        if (!prompt) return json(res, 400, { error: 'Missing prompt' })
        const quote = await deps.createImageQuote({
          prompt,
          model: body.model != null ? String(body.model) : undefined,
          aspectRatio: body.aspectRatio != null ? String(body.aspectRatio) : undefined,
          quality: body.quality != null ? String(body.quality) : undefined,
          resolution: body.resolution != null ? String(body.resolution) : undefined,
        })
        return json(res, 200, quote)
      }

      if (pathname === '/api/ai/images/fulfill' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const orderId = String(body.orderId || '')
        if (!orderId) return json(res, 400, { error: 'Missing orderId' })
        const result = await deps.fulfillImage(orderId)
        return json(res, 200, result)
      }

      const imageFileMatch = pathname.match(/^\/api\/ai\/images\/([^/]+)\/file$/)
      if (imageFileMatch && req.method === 'GET') {
        if (!checkAuth(req, url)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(imageFileMatch[1])
        const file = await deps.serveImageFile(id)
        if (!file) return json(res, 404, { error: 'Image not found' })
        const data = fs.readFileSync(file.filePath)
        res.writeHead(200, {
          'Content-Type': file.mediaType,
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(data)
        return
      }

      const imageDeleteMatch = pathname.match(/^\/api\/ai\/images\/([^/]+)$/)
      if (imageDeleteMatch && req.method === 'DELETE') {
        if (!checkAuth(req, url)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(imageDeleteMatch[1])
        const deleted = await deps.deleteImageFile(id)
        return json(res, 200, { deleted })
      }

      json(res, 404, { error: 'Not found' })
    } catch (err: any) {
      const message = err?.message || String(err)
      json(res, 500, { error: message })
    }
  })

  const port = options.port || 7474

  return new Promise<WebServer>((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const url = `http://127.0.0.1:${actualPort}/?token=${token}`
      resolve({
        server,
        port: actualPort,
        token,
        url,
        close() {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          })
        },
      })
    })
  })
}
