/**
 * Core wallet operations returning typed, render-agnostic results.
 *
 * Both the CLI commands and the MCP tools call these functions.
 * No chalk, no process.exit(), no console output.
 */

import { Address } from 'watchtower-cash-js'
import { requireWallet, resolveNetwork, type Network } from './context.js'
import type { FungibleToken, NftUtxo, SendResult } from '../wallet/bch.js'
import { bchToSats, explorerTxUrl, formatTokenAmount } from '../utils/format.js'
import {
  fetchAssetPrices,
  getBchUsdPrice,
  getUsdPerToken,
  tokenAmountToUsd,
} from '../utils/prices.js'

export interface BalanceView {
  network: Network
  walletHash: string
  balanceBch: number
  balanceSats: number
  spendableBch: number
  spendableSats: number
  usdPerBch: number | null
  usd: number | null
}

export interface TokenBalanceView {
  category: string
  name: string
  symbol: string
  decimals: number
  rawBalance: number
  displayBalance: string
  usdPerToken: number | null
  usd: number | null
}

export interface TokenListResult {
  network: Network
  walletHash: string
  tokens: TokenBalanceView[]
}

export interface TokenDetailResult {
  network: Network
  walletHash: string
  category: string
  name: string
  symbol: string
  decimals: number
  rawBalance: number
  displayBalance: string
  usdPerToken: number | null
  usd: number | null
  nfts: NftUtxo[]
}

export interface HistoryRecord {
  record_type: 'outgoing' | 'incoming'
  txid: string
  amount: number
  tx_fee: number
  senders: any[][]
  recipients: any[][]
  date_created: string
  tx_timestamp: string
  usd_price: number
  market_prices: Record<string, number>
  attributes: any
}

export interface HistoryView {
  network: Network
  tokenId: string
  headerLabel: string
  records: HistoryRecord[]
  page: number
  numPages: number
  hasNext: boolean
}

export interface ReceiveAddressView {
  network: Network
  address: string
  index: number
  token: boolean
  category: string
  tokenName: string
  decimals: number
  amount: number | undefined
  paymentUri: string
  qrContent: string
  subscribed: boolean
}

export interface WalletInfoView {
  network: Network
  walletHash: string
  address: string
  balance: BalanceView
}

export interface SendOutcome {
  network: Network
  success: boolean
  txid?: string
  explorerUrl?: string
  error?: string
  lackingSats?: string
}

async function fetchTokenPriceMap(
  categories: string[],
  isChipnet: boolean
): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (categories.length === 0) return prices
  try {
    const priceData = await fetchAssetPrices(
      categories.map((c) => `ct/${c}`),
      ['USD'],
      isChipnet
    )
    for (const p of priceData) {
      if (String(p.currency || '').toLowerCase() !== 'usd') continue
      const catMatch = String(p.asset || '').match(/^ct\/([a-fA-F0-9]+)$/)
      if (!catMatch) continue
      const raw = parseFloat(p.price_value)
      if (!isFinite(raw) || raw === 0) continue
      prices.set(catMatch[1], 1 / raw)
    }
  } catch {
    // Pricing unavailable — proceed without USD values
  }
  return prices
}

export async function getBalanceView(
  isChipnet: boolean = false
): Promise<BalanceView> {
  const ctx = requireWallet(isChipnet)
  const result = await ctx.bch.getBalance()

  let usdPerBch: number | null = null
  try {
    usdPerBch = await getBchUsdPrice(isChipnet)
  } catch {
    // USD price unavailable
  }

  return {
    network: ctx.network,
    walletHash: ctx.walletHash,
    balanceBch: result.balance,
    balanceSats: bchToSats(result.balance),
    spendableBch: result.spendable,
    spendableSats: bchToSats(result.spendable),
    usdPerBch,
    usd: usdPerBch !== null ? result.balance * usdPerBch : null,
  }
}

export async function getTokenBalances(
  isChipnet: boolean = false,
  opts: { includeZero?: boolean } = {}
): Promise<TokenListResult> {
  const ctx = requireWallet(isChipnet)
  const all = await ctx.bch.getFungibleTokens()
  const tokens = opts.includeZero ? all : all.filter((t) => t.balance > 0)

  const priceMap = await fetchTokenPriceMap(
    tokens.map((t) => t.category),
    isChipnet
  )

  return {
    network: ctx.network,
    walletHash: ctx.walletHash,
    tokens: tokens.map((t) => {
      const usdPerToken = priceMap.get(t.category) ?? null
      return {
        category: t.category,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
        rawBalance: t.balance,
        displayBalance: formatTokenAmount(t.balance, t.decimals),
        usdPerToken,
        usd:
          usdPerToken !== null
            ? tokenAmountToUsd(t.balance, t.decimals, usdPerToken)
            : null,
      }
    }),
  }
}

export async function getTokenDetail(
  category: string,
  isChipnet: boolean = false
): Promise<TokenDetailResult> {
  const ctx = requireWallet(isChipnet)

  let info: FungibleToken | null = null
  try {
    info = await ctx.bch.getTokenInfo(category)
  } catch {
    // metadata unavailable
  }

  let usdPerToken: number | null = null
  try {
    usdPerToken = await getUsdPerToken(category, isChipnet)
  } catch {
    // pricing unavailable
  }

  let rawBalance = 0
  try {
    const bal = await ctx.bch.getTokenBalance(category)
    rawBalance = bal.balance
  } catch {
    // balance unavailable
  }

  let nfts: NftUtxo[] = []
  try {
    nfts = await ctx.bch.getNftUtxos(category)
  } catch {
    // NFT fetch non-critical
  }

  const decimals = info?.decimals ?? 0

  return {
    network: ctx.network,
    walletHash: ctx.walletHash,
    category,
    name: info?.name ?? 'Unknown Token',
    symbol: info?.symbol ?? '',
    decimals,
    rawBalance,
    displayBalance: formatTokenAmount(rawBalance, decimals),
    usdPerToken,
    usd:
      usdPerToken !== null
        ? tokenAmountToUsd(rawBalance, decimals, usdPerToken)
        : null,
    nfts,
  }
}

export async function getHistoryView(
  opts: {
    page?: number
    recordType?: string
    tokenId?: string
  } = {},
  isChipnet: boolean = false
): Promise<HistoryView> {
  const ctx = requireWallet(isChipnet)
  const tokenId = opts.tokenId ?? ''
  const page = opts.page ?? 1

  let headerLabel = 'Transaction History'
  if (tokenId) {
    headerLabel = 'Token Transaction History'
    try {
      const info = await ctx.bch.getTokenInfo(tokenId)
      if (info?.symbol) headerLabel = `${info.symbol} Transaction History`
      else if (info?.name && info.name !== 'Unknown Token')
        headerLabel = `${info.name} Transaction History`
    } catch {
      // keep generic label
    }
  }

  const result = await ctx.bch.getHistory({
    page,
    recordType: opts.recordType,
    tokenId,
  })

  return {
    network: ctx.network,
    tokenId,
    headerLabel,
    records: result.history ?? [],
    page: parseInt(result.page, 10) || page,
    numPages: result.num_pages,
    hasNext: result.has_next,
  }
}

export function buildBchPaymentUri(address: string, amount?: number): string {
  const bare = address.replace(/^(bitcoincash|bchtest):/, '')
  let uri = `bitcoincash:${bare}`
  if (amount !== undefined && amount > 0) uri += `?amount=${amount}`
  return uri
}

export function buildTokenPaymentUri(
  address: string,
  category: string,
  baseUnitAmount?: number
): string {
  const bare = address.replace(/^(bitcoincash|bchtest):/, '')
  let uri = `bitcoincash:${bare}?c=${category}`
  if (baseUnitAmount !== undefined && baseUnitAmount > 0) {
    uri += `&f=${Math.round(baseUnitAmount)}`
  }
  return uri
}

export async function getReceiveAddressView(
  opts: {
    index?: number
    token?: boolean
    category?: string
    amount?: number
    subscribe?: boolean
  } = {},
  isChipnet: boolean = false
): Promise<ReceiveAddressView> {
  const ctx = requireWallet(isChipnet)
  const index = opts.index ?? 0
  const isToken = Boolean(opts.token)
  const category = opts.category ?? ''

  const address = isToken
    ? ctx.bch.getTokenAddressSetAt(index).receiving
    : ctx.bch.getAddressSetAt(index).receiving

  let subscribed = false
  if (opts.subscribe !== false) {
    try {
      subscribed = Boolean(await ctx.bch.getNewAddressSet(index))
    } catch {
      // non-critical
    }
  }

  let tokenName = ''
  let decimals = 0
  if (category) {
    try {
      const info = await ctx.bch.getTokenInfo(category)
      if (info?.symbol) tokenName = info.symbol
      else if (info?.name && info.name !== 'Unknown Token') tokenName = info.name
      decimals = info?.decimals ?? 0
    } catch {
      // token metadata unavailable
    }
  }

  let paymentUri = ''
  if (category) {
    const baseUnitAmount =
      opts.amount !== undefined ? opts.amount * 10 ** decimals : undefined
    paymentUri = buildTokenPaymentUri(address, category, baseUnitAmount)
  } else if (opts.amount !== undefined) {
    paymentUri = buildBchPaymentUri(address, opts.amount)
  }

  return {
    network: ctx.network,
    address,
    index,
    token: isToken,
    category,
    tokenName,
    decimals,
    amount: opts.amount,
    paymentUri,
    qrContent: paymentUri || address,
    subscribed,
  }
}

export async function getWalletInfoView(
  isChipnet: boolean = false
): Promise<WalletInfoView> {
  const ctx = requireWallet(isChipnet)
  const address = ctx.bch.getAddressSetAt(0).receiving
  const balance = await getBalanceView(isChipnet)
  return {
    network: ctx.network,
    walletHash: ctx.walletHash,
    address,
    balance,
  }
}

export function isValidBchAddress(address: string, isChipnet: boolean): boolean {
  const validator = new Address(address)
  return Boolean(
    validator.isValidBCHAddress(isChipnet) ||
      (validator as any).isP2SH?.() ||
      (validator as any).isTokenAddress?.()
  )
}

export function isTokenAddress(address: string): boolean {
  return Boolean((new Address(address) as any).isTokenAddress?.())
}

export async function sendBch(
  opts: { address: string; amountBch: number; changeAddress?: string },
  isChipnet: boolean = false
): Promise<SendOutcome> {
  const ctx = requireWallet(isChipnet)
  const changeAddress =
    opts.changeAddress ?? ctx.bch.getAddressSetAt(0).change

  const result = await ctx.bch.sendBch(
    opts.amountBch,
    opts.address,
    changeAddress
  )

  return toSendOutcome(result, ctx.network, isChipnet)
}

export async function sendToken(
  opts: { category: string; amount: bigint; address: string; changeAddress?: string },
  isChipnet: boolean = false
): Promise<SendOutcome> {
  const ctx = requireWallet(isChipnet)
  const changeAddress =
    opts.changeAddress ?? ctx.bch.getTokenAddressSetAt(0).change

  const result = await ctx.bch.sendToken(
    opts.category,
    opts.amount,
    opts.address,
    changeAddress
  )

  return toSendOutcome(result, ctx.network, isChipnet)
}

function toSendOutcome(
  result: SendResult,
  network: Network,
  isChipnet: boolean
): SendOutcome {
  const outcome: SendOutcome = {
    network,
    success: result.success,
    error: result.error,
    lackingSats: result.lackingSats?.toString(),
  }
  if (result.txid) {
    outcome.txid = result.txid
    outcome.explorerUrl = explorerTxUrl(result.txid, isChipnet)
  }
  return outcome
}

export { resolveNetwork }
