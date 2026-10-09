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
  resolveModelId,
} from '../ai/models.js'
import {
  formatRemaining,
  getSessions,
  paygBalanceUsd,
  paygEnabled,
} from '../ai/credits.js'
import {
  buyPlan,
  topUpBalance as executeTopupBalance,
  type PaymentMethod,
} from '../ai/purchase.js'
import {
  readAutoRefillStore,
  listAutoRefillEntries,
  normalizeModelKey,
  armAutoRefill,
  disarmAutoRefill,
  deleteAutoRefill,
  remainingBudget,
  remainingUsdBudget,
  autoRefillTickOne,
  type AutoRefillStore,
  type AutoRefillTarget,
  type RefillTickResult,
} from '../ai/autoRefill.js'
import { createRefillTickDeps } from '../mcp/tools.js'
import {
  listImageModels,
  createImageOrder,
  fulfillImageOrder,
  getImageHistory,
  fetchImageContent,
  IMAGE_DIR,
  MEDIA_TYPE_EXTENSIONS,
  type ImageModel,
  type ImageOrderQuote,
  type GenerateImageResult,
  type ImageHistoryEntry,
} from '../ai/images.js'
import {
  listVideoModels,
  createVideoOrder,
  fulfillVideoOrder,
  getVideoHistory,
  fetchVideoContent,
  VIDEO_DIR,
  VIDEO_MEDIA_TYPE_EXTENSIONS,
  type VideoModel,
  type VideoOrderQuote,
  type GenerateVideoResult,
  type VideoHistoryEntry,
} from '../ai/videos.js'
import {
  listAudioModels,
  createAudioOrder,
  fulfillAudioOrder,
  getAudioHistory,
  fetchAudioContent,
  AUDIO_DIR,
  AUDIO_MEDIA_TYPE_EXTENSIONS,
  type AudioModel,
  type AudioOrderQuote,
  type GenerateAudioResult,
  type AudioHistoryEntry,
} from '../ai/audio.js'
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
  topUpBalance(opts: {
    amountUsd?: number
    method: string
  }): Promise<object>
  quoteLiftNeeded(opts: { sats: number }): Promise<object>
  setAutoRefill(opts: {
    enabled: boolean
    delete?: boolean
    mode?: 'model' | 'payg'
    model?: string
    key?: string
    minutes?: number
    maxMinutes?: number
    amountUsd?: number
    thresholdUsd?: number
    maxUsd?: number
    paymentMethod?: string
  }): Promise<Record<string, unknown>>
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
  fetchImageContent(id: string): Promise<{ data: Buffer; mediaType: string } | null>
  deleteImageFile(id: string): Promise<boolean>
  getVideoModels(): Promise<VideoModel[]>
  getVideoHistory(page?: number): Promise<object>
  createVideoQuote(opts: {
    prompt: string
    model?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
  }): Promise<VideoOrderQuote>
  fulfillVideo(orderId: string): Promise<GenerateVideoResult>
  serveVideoFile(id: string): Promise<{ filePath: string; mediaType: string } | null>
  fetchVideoContent(id: string): Promise<{ data: Buffer; mediaType: string } | null>
  deleteVideoFile(id: string): Promise<boolean>
  getAudioModels(): Promise<AudioModel[]>
  getAudioHistory(page?: number): Promise<object>
  createAudioQuote(opts: {
    prompt: string
    model?: string
    voice?: string
    responseFormat?: string
    speed?: number
  }): Promise<AudioOrderQuote>
  fulfillAudio(orderId: string): Promise<GenerateAudioResult>
  serveAudioFile(id: string): Promise<{ filePath: string; mediaType: string } | null>
  fetchAudioContent(id: string): Promise<{ data: Buffer; mediaType: string } | null>
  deleteAudioFile(id: string): Promise<boolean>
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
      const sessions = getSessions(status)
        .filter((s) => s.model_id || s.ai_model || s.display_name)
        .map((s) => ({
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
      const autoRefills = listAutoRefillEntries(readAutoRefillStore()).map((entry) => ({
        key: entry.key,
        mode: entry.mode,
        armed: Boolean(entry.state.enabled),
        enabled: Boolean(entry.state.enabled),
        model: entry.state.model ?? null,
        minutes: entry.state.minutes ?? null,
        maxMinutes: entry.state.maxMinutes ?? null,
        amountUsd: entry.state.amountUsd ?? null,
        thresholdUsd: entry.state.thresholdUsd ?? null,
        maxUsd: entry.state.maxUsd ?? null,
        paymentMethod: entry.state.paymentMethod ?? 'bch',
        refillCount: entry.state.refillCount ?? 0,
        spentMinutes: entry.state.spentMinutes ?? 0,
        spentUsd: entry.state.spentUsd ?? 0,
        remainingMinutes: remainingBudget(entry.state),
        remainingUsd: remainingUsdBudget(entry.state),
        lastRefillAt: entry.state.lastRefillAt ?? null,
        lastRefillTxid: entry.state.lastRefillTxid ?? null,
        lastEvent: entry.state.lastEvent ?? null,
      }))
      const autoRefill =
        autoRefills.find((e) => e.mode === 'payg') ?? autoRefills[0] ?? null

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

      let videoModels: VideoModel[] = []
      try { videoModels = await listVideoModels({ backendUrl }) } catch {}

      let videoHistory: VideoHistoryEntry[] = []
      try {
        const hist = await getVideoHistory({ backendUrl, page: 1, pageSize: 20 })
        videoHistory = (hist.data || []).map((e) => ({
          ...e,
          filepath: localVideoFile(e.id) ?? undefined,
        }))
      } catch {}

      let audioModels: AudioModel[] = []
      try { audioModels = await listAudioModels({ backendUrl }) } catch {}

      let audioHistory: AudioHistoryEntry[] = []
      try {
        const hist = await getAudioHistory({ backendUrl, page: 1, pageSize: 20 })
        audioHistory = (hist.data || []).map((e) => ({
          ...e,
          filepath: localAudioFile(e.id) ?? undefined,
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
        aiBalanceUsd: paygBalanceUsd(status),
        paygEnabled: paygEnabled(status),
        liftDiscountPercent: config.lift_payment_discount_percent ?? 0,
        autoRefill,
        autoRefills,
        imageModels,
        imageHistory,
        videoModels,
        videoHistory,
        audioModels,
        audioHistory,
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

    async topUpBalance(opts) {
      return executeTopupBalance({
        amountUsd: opts.amountUsd,
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
      const targetFromOpts = (): AutoRefillTarget | undefined => {
        if (opts.key === 'payg' || opts.mode === 'payg') return { mode: 'payg' }
        const query = opts.key ?? opts.model
        if (!query) return undefined
        return { mode: 'model', model: normalizeModelKey(query) }
      }
      const resolveModelIdFor = async (query: string): Promise<string> => {
        try {
          const cfg = await getConfig({ backendUrl })
          return resolveModelId(cfg, query)
        } catch {
          return normalizeModelKey(query)
        }
      }
      const tickNow = async (
        target: AutoRefillTarget
      ): Promise<RefillTickResult | null> => {
        const wallet = loadWalletRef()
        if (!wallet?.canSign) return null
        try {
          return await autoRefillTickOne(
            createRefillTickDeps(isChipnet, backendUrl),
            target
          )
        } catch {
          return null
        }
      }
      if (opts.delete) {
        return { deleted: true, existed: deleteAutoRefill(targetFromOpts()) }
      }
      if (opts.enabled) {
        if (opts.mode === 'payg') {
          if (
            typeof opts.amountUsd !== 'number' ||
            !(opts.amountUsd > 0) ||
            typeof opts.thresholdUsd !== 'number'
          ) {
            throw new Error(
              'Pay-as-you-go auto-refill requires amountUsd and thresholdUsd.'
            )
          }
          if (
            typeof opts.maxUsd === 'number' &&
            opts.maxUsd < opts.amountUsd
          ) {
            throw new Error('maxUsd must be at least amountUsd.')
          }
          const state = armAutoRefill({
            mode: 'payg',
            amountUsd: opts.amountUsd,
            thresholdUsd: opts.thresholdUsd,
            maxUsd: opts.maxUsd,
            paymentMethod: (opts.paymentMethod as 'bch' | 'lift') || 'bch',
          })
          const initialTick = await tickNow({ mode: 'payg' })
          return initialTick ? { ...state, initialTick } : { ...state }
        }
        if (!opts.model || opts.minutes == null) {
          throw new Error('A plan auto-refill requires model and minutes.')
        }
        const modelId = await resolveModelIdFor(opts.model)
        const state = armAutoRefill({
          mode: 'model',
          model: modelId,
          minutes: opts.minutes,
          maxMinutes: opts.maxMinutes,
          paymentMethod: (opts.paymentMethod as 'bch' | 'lift') || 'bch',
        })
        const initialTick = await tickNow({ mode: 'model', model: modelId })
        return initialTick ? { ...state, initialTick } : { ...state }
      }
      disarmAutoRefill(targetFromOpts())
      return { store: readAutoRefillStore() }
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

    async fetchImageContent(id) {
      const content = await fetchImageContent(id, { isChipnet, backendUrl })
      return content ? { data: content.data, mediaType: content.mediaType } : null
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

    async getVideoModels() {
      return listVideoModels({ backendUrl })
    },

    async getVideoHistory(page?: number) {
      return getVideoHistory({ backendUrl, page, pageSize: 20 })
    },

    async createVideoQuote(opts) {
      return createVideoOrder({
        prompt: opts.prompt,
        model: opts.model,
        duration: opts.duration,
        resolution: opts.resolution,
        aspectRatio: opts.aspectRatio,
        generateAudio: opts.generateAudio,
        isChipnet,
        backendUrl,
      })
    },

    async fulfillVideo(orderId) {
      throw new Error('Fulfillment requires the original quote. Use POST /api/ai/videos/fulfill with stored quote.')
    },

    async serveVideoFile(id) {
      const filePath = localVideoFile(id)
      if (!filePath) return null
      const ext = filePath.split('.').pop() || ''
      return {
        filePath,
        mediaType: VIDEO_EXT_TO_MEDIA[ext] || 'application/octet-stream',
      }
    },

    async fetchVideoContent(id) {
      const content = await fetchVideoContent(id, { isChipnet, backendUrl })
      return content ? { data: content.data, mediaType: content.mediaType } : null
    },

    async deleteVideoFile(id) {
      const filePath = localVideoFile(id)
      if (!filePath) return false
      try {
        fs.unlinkSync(filePath)
        return true
      } catch {
        return false
      }
    },

    async getAudioModels() {
      return listAudioModels({ backendUrl })
    },

    async getAudioHistory(page?: number) {
      return getAudioHistory({ backendUrl, page, pageSize: 20 })
    },

    async createAudioQuote(opts) {
      return createAudioOrder({
        prompt: opts.prompt,
        model: opts.model,
        voice: opts.voice,
        responseFormat: opts.responseFormat,
        speed: opts.speed,
        isChipnet,
        backendUrl,
      })
    },

    async fulfillAudio(orderId) {
      throw new Error('Fulfillment requires the original quote. Use POST /api/ai/audios/fulfill with stored quote.')
    },

    async serveAudioFile(id) {
      const filePath = localAudioFile(id)
      if (!filePath) return null
      const ext = filePath.split('.').pop() || ''
      return {
        filePath,
        mediaType: AUDIO_EXT_TO_MEDIA[ext] || 'application/octet-stream',
      }
    },

    async fetchAudioContent(id) {
      const content = await fetchAudioContent(id, { isChipnet, backendUrl })
      return content ? { data: content.data, mediaType: content.mediaType } : null
    },

    async deleteAudioFile(id) {
      const filePath = localAudioFile(id)
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

function localVideoFile(id: string): string | null {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return null
  try {
    const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.startsWith(safeId + '.'))
    return files.length ? path.join(VIDEO_DIR, files[0]) : null
  } catch {
    return null
  }
}

function localAudioFile(id: string): string | null {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return null
  try {
    const files = fs.readdirSync(AUDIO_DIR).filter((f) => f.startsWith(safeId + '.'))
    return files.length ? path.join(AUDIO_DIR, files[0]) : null
  } catch {
    return null
  }
}

const IMAGE_EXT_TO_MEDIA: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_TYPE_EXTENSIONS).map(([mediaType, ext]) => [ext, mediaType])
)

const VIDEO_EXT_TO_MEDIA: Record<string, string> = Object.fromEntries(
  Object.entries(VIDEO_MEDIA_TYPE_EXTENSIONS).map(([mediaType, ext]) => [ext, mediaType])
)

const AUDIO_EXT_TO_MEDIA: Record<string, string> = Object.fromEntries(
  Object.entries(AUDIO_MEDIA_TYPE_EXTENSIONS).map(([mediaType, ext]) => [ext, mediaType])
)

function createDefaultDepsWithQuotes(isChipnet: boolean, backendUrl?: string): WebDeps {
  const base = defaultDeps(isChipnet, backendUrl)
  const quoteStore = new Map<string, ImageOrderQuote>()
  const videoQuoteStore = new Map<string, VideoOrderQuote>()
  const audioQuoteStore = new Map<string, AudioOrderQuote>()

  async function withAmountUsd<T extends { amountSats: number; amountUsd?: number }>(
    quote: T
  ): Promise<T> {
    let amountUsd: number | undefined = quote.amountUsd
    if (amountUsd === undefined) {
      try {
        const usdPerBch = await getBchUsdPrice(isChipnet)
        if (usdPerBch !== null) {
          amountUsd = Number(((quote.amountSats / 1e8) * usdPerBch).toFixed(2))
        }
      } catch {
        amountUsd = undefined
      }
    }
    return { ...quote, amountUsd }
  }

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
      if (quoteStore.size > 50) {
        const oldest = quoteStore.keys().next().value
        if (oldest) quoteStore.delete(oldest)
      }
      return withAmountUsd(quote)
    },

    async fulfillVideo(orderId) {
      const quote = videoQuoteStore.get(orderId)
      if (!quote) throw new Error('No quote found for order. Request a new quote first.')
      videoQuoteStore.delete(orderId)
      return fulfillVideoOrder(quote, { isChipnet, backendUrl })
    },

    async createVideoQuote(opts) {
      const quote = await createVideoOrder({
        prompt: opts.prompt,
        model: opts.model,
        duration: opts.duration,
        resolution: opts.resolution,
        aspectRatio: opts.aspectRatio,
        generateAudio: opts.generateAudio,
        isChipnet,
        backendUrl,
      })
      videoQuoteStore.set(quote.orderId, quote)
      if (videoQuoteStore.size > 50) {
        const oldest = videoQuoteStore.keys().next().value
        if (oldest) videoQuoteStore.delete(oldest)
      }
      return withAmountUsd(quote)
    },

    async fulfillAudio(orderId) {
      const quote = audioQuoteStore.get(orderId)
      if (!quote) throw new Error('No quote found for order. Request a new quote first.')
      audioQuoteStore.delete(orderId)
      return fulfillAudioOrder(quote, { isChipnet, backendUrl })
    },

    async createAudioQuote(opts) {
      const quote = await createAudioOrder({
        prompt: opts.prompt,
        model: opts.model,
        voice: opts.voice,
        responseFormat: opts.responseFormat,
        speed: opts.speed,
        isChipnet,
        backendUrl,
      })
      audioQuoteStore.set(quote.orderId, quote)
      if (audioQuoteStore.size > 50) {
        const oldest = audioQuoteStore.keys().next().value
        if (oldest) audioQuoteStore.delete(oldest)
      }
      return withAmountUsd(quote)
    },
  }
}

interface JsonBody {
  [key: string]: unknown
}

const MAX_BODY_BYTES = 1024 * 1024

async function readBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new Error('Request body too large')
    }
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function writeMediaResponse(
  res: http.ServerResponse,
  content: { data: Buffer; mediaType: string },
  download: boolean,
  filename = 'media'
): void {
  const disposition = download ? 'attachment' : 'inline'
  res.writeHead(200, {
    'Content-Type': content.mediaType,
    'Content-Length': content.data.length,
    'Cache-Control': 'no-store',
    'Content-Disposition': `${disposition}; filename="${filename}"`,
  })
  res.end(content.data)
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

  function checkAuth(req: http.IncomingMessage): boolean {
    return req.headers['x-paytaca-token'] === token
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

      if (pathname === '/api/ai/topup' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const method = String(body.method || 'bch')
        if (method !== 'bch' && method !== 'lift') {
          return json(res, 400, { error: 'Method must be "bch" or "lift"' })
        }
        let amountUsd: number | undefined
        if (body.amount != null && body.amount !== '') {
          amountUsd = Number(body.amount)
          if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
            return json(res, 400, { error: 'Invalid amount' })
          }
        }
        const result = await deps.topUpBalance({ amountUsd, method })
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/auto-refill' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const enabled = Boolean(body.enabled)
        const mode =
          body.mode === 'payg' || body.mode === 'model' ? body.mode : undefined
        const amountUsd =
          body.amountUsd != null ? Number(body.amountUsd) : undefined
        const thresholdUsd =
          body.thresholdUsd != null ? Number(body.thresholdUsd) : undefined
        const maxUsd = body.maxUsd != null ? Number(body.maxUsd) : undefined
        if (
          (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd <= 0)) ||
          (thresholdUsd != null && !Number.isFinite(thresholdUsd)) ||
          (maxUsd != null && (!Number.isFinite(maxUsd) || maxUsd <= 0))
        ) {
          return json(res, 400, { error: 'Invalid auto-refill amounts' })
        }
        if (mode === 'payg' && enabled && amountUsd == null) {
          return json(res, 400, { error: 'amountUsd is required' })
        }
        if (mode === 'payg' && enabled && thresholdUsd == null) {
          return json(res, 400, { error: 'thresholdUsd is required' })
        }
        const result = await deps.setAutoRefill({
          enabled,
          delete: Boolean(body.delete),
          mode,
          model: body.model != null ? String(body.model) : undefined,
          key: body.key != null ? String(body.key) : undefined,
          minutes: body.minutes != null ? Number(body.minutes) : undefined,
          maxMinutes: body.maxMinutes != null ? Number(body.maxMinutes) : undefined,
          amountUsd,
          thresholdUsd,
          maxUsd,
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
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
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

      const imageContentMatch = pathname.match(/^\/api\/ai\/images\/([^/]+)\/content$/)
      if (imageContentMatch && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(imageContentMatch[1])
        const content = await deps.fetchImageContent(id)
        if (!content) return json(res, 404, { error: 'Image content not available' })
        writeMediaResponse(res, content, url.searchParams.get('download') === '1')
        return
      }

      const imageDeleteMatch = pathname.match(/^\/api\/ai\/images\/([^/]+)$/)
      if (imageDeleteMatch && req.method === 'DELETE') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(imageDeleteMatch[1])
        const deleted = await deps.deleteImageFile(id)
        return json(res, 200, { deleted })
      }

      if (pathname === '/api/ai/video-models' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const models = await deps.getVideoModels()
        return json(res, 200, { models })
      }

      if (pathname === '/api/ai/videos/history' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
        const result = await deps.getVideoHistory(page)
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/videos/quote' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const prompt = String(body.prompt || '').trim()
        if (!prompt) return json(res, 400, { error: 'Missing prompt' })
        let duration: number | undefined
        if (body.duration != null && body.duration !== '') {
          duration = Number(body.duration)
          if (!Number.isFinite(duration) || duration <= 0) {
            return json(res, 400, { error: 'Duration must be a positive number' })
          }
        }
        const quote = await deps.createVideoQuote({
          prompt,
          model: body.model != null ? String(body.model) : undefined,
          duration,
          resolution: body.resolution != null ? String(body.resolution) : undefined,
          aspectRatio: body.aspectRatio != null ? String(body.aspectRatio) : undefined,
          generateAudio:
            body.generateAudio != null ? Boolean(body.generateAudio) : undefined,
        })
        return json(res, 200, quote)
      }

      if (pathname === '/api/ai/videos/fulfill' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const orderId = String(body.orderId || '')
        if (!orderId) return json(res, 400, { error: 'Missing orderId' })
        const result = await deps.fulfillVideo(orderId)
        return json(res, 200, result)
      }

      const videoFileMatch = pathname.match(/^\/api\/ai\/videos\/([^/]+)\/file$/)
      if (videoFileMatch && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(videoFileMatch[1])
        const file = await deps.serveVideoFile(id)
        if (!file) return json(res, 404, { error: 'Video not found' })
        const data = fs.readFileSync(file.filePath)
        res.writeHead(200, {
          'Content-Type': file.mediaType,
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(data)
        return
      }

      const videoContentMatch = pathname.match(/^\/api\/ai\/videos\/([^/]+)\/content$/)
      if (videoContentMatch && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(videoContentMatch[1])
        const content = await deps.fetchVideoContent(id)
        if (!content) return json(res, 404, { error: 'Video content not available' })
        writeMediaResponse(res, content, url.searchParams.get('download') === '1')
        return
      }

      const videoDeleteMatch = pathname.match(/^\/api\/ai\/videos\/([^/]+)$/)
      if (videoDeleteMatch && req.method === 'DELETE') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(videoDeleteMatch[1])
        const deleted = await deps.deleteVideoFile(id)
        return json(res, 200, { deleted })
      }

      if (pathname === '/api/ai/audio-models' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const models = await deps.getAudioModels()
        return json(res, 200, { models })
      }

      if (pathname === '/api/ai/audios/history' && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
        const result = await deps.getAudioHistory(page)
        return json(res, 200, result)
      }

      if (pathname === '/api/ai/audios/quote' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const prompt = String(body.prompt || '').trim()
        if (!prompt) return json(res, 400, { error: 'Missing prompt' })
        let speed: number | undefined
        if (body.speed != null && body.speed !== '') {
          speed = Number(body.speed)
          if (!Number.isFinite(speed) || speed <= 0) {
            return json(res, 400, { error: 'Speed must be a positive number' })
          }
        }
        const quote = await deps.createAudioQuote({
          prompt,
          model: body.model != null ? String(body.model) : undefined,
          voice: body.voice != null ? String(body.voice) : undefined,
          responseFormat: body.responseFormat != null ? String(body.responseFormat) : undefined,
          speed,
        })
        return json(res, 200, quote)
      }

      if (pathname === '/api/ai/audios/fulfill' && req.method === 'POST') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        if (req.headers['content-type'] !== 'application/json') {
          return json(res, 400, { error: 'Content-Type must be application/json' })
        }
        const body = await readBody(req)
        const orderId = String(body.orderId || '')
        if (!orderId) return json(res, 400, { error: 'Missing orderId' })
        const result = await deps.fulfillAudio(orderId)
        return json(res, 200, result)
      }

      const audioFileMatch = pathname.match(/^\/api\/ai\/audios\/([^/]+)\/file$/)
      if (audioFileMatch && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(audioFileMatch[1])
        const file = await deps.serveAudioFile(id)
        if (!file) return json(res, 404, { error: 'Audio not found' })
        const data = fs.readFileSync(file.filePath)
        res.writeHead(200, {
          'Content-Type': file.mediaType,
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(data)
        return
      }

      const audioContentMatch = pathname.match(/^\/api\/ai\/audios\/([^/]+)\/content$/)
      if (audioContentMatch && req.method === 'GET') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(audioContentMatch[1])
        const content = await deps.fetchAudioContent(id)
        if (!content) return json(res, 404, { error: 'Audio content not available' })
        writeMediaResponse(res, content, url.searchParams.get('download') === '1')
        return
      }

      const audioDeleteMatch = pathname.match(/^\/api\/ai\/audios\/([^/]+)$/)
      if (audioDeleteMatch && req.method === 'DELETE') {
        if (!checkAuth(req)) return json(res, 401, { error: 'Unauthorized' })
        const id = decodeURIComponent(audioDeleteMatch[1])
        const deleted = await deps.deleteAudioFile(id)
        return json(res, 200, { deleted })
      }

      json(res, 404, { error: 'Not found' })
    } catch (err: any) {
      console.error('[paytaca web]', err?.stack || err?.message || err)
      json(res, 500, { error: 'Internal server error' })
    }
  })

  const port = options.port ?? 7474

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
