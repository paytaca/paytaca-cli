/**
 * Asset pricing via the watchtower.cash /api/asset-prices/ endpoint.
 *
 * Mirrors paytaca-app's market price handling in
 * src/store/market/actions.js (updateAssetPrices).
 *
 * Unit conventions from watchtower.cash:
 *   - Coins (e.g. BCH): price_value is fiat per unit (USD per BCH).
 *   - CashTokens:       price_value is units per fiat (tokens per USD),
 *                       so fiat per token = 1 / price_value.
 */

import { getWatchtowerApiUrl } from './network.js'

export interface AssetPrice {
  id: number
  asset: string
  asset_type: string
  asset_name: string
  asset_symbol: string
  currency: string
  price_value: string
  timestamp: string
  source: string
}

/** Max asset IDs per request — paytaca-app batches at 10. */
const BATCH_SIZE = 10

/**
 * Fetch prices from watchtower.cash /api/asset-prices/.
 *
 * @param assetIds - Asset IDs, e.g. ['BCH'] or ['ct/<category>']
 * @param vsCurrencies - Quote currencies, e.g. ['USD']
 */
export async function fetchAssetPrices(
  assetIds: string[],
  vsCurrencies: string[] = ['USD'],
  isChipnet: boolean = false
): Promise<AssetPrice[]> {
  const baseUrl = getWatchtowerApiUrl(isChipnet)
  const uniqueIds = [...new Set(assetIds.filter(Boolean))]
  if (uniqueIds.length === 0) return []

  const batches: string[][] = []
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    batches.push(uniqueIds.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams()
      params.set('assets', batch.join(','))
      params.set('vs_currencies', vsCurrencies.join(','))
      const res = await fetch(`${baseUrl}/asset-prices/?${params.toString()}`)
      if (!res.ok) throw new Error(`asset-prices request failed (${res.status})`)
      const data = await res.json()
      return Array.isArray(data?.prices) ? data.prices : []
    })
  )

  return results.flat() as AssetPrice[]
}

/**
 * USD price per display unit of a CashToken.
 * Returns null when the token has no market price.
 */
export async function getUsdPerToken(
  category: string,
  isChipnet: boolean = false
): Promise<number | null> {
  const prices = await fetchAssetPrices([`ct/${category}`], ['USD'], isChipnet)
  return priceInUsd(prices)
}

/**
 * USD price per BCH.
 * Returns null when unavailable.
 */
export async function getBchUsdPrice(
  isChipnet: boolean = false
): Promise<number | null> {
  const prices = await fetchAssetPrices(['BCH'], ['USD'], isChipnet)
  return priceInUsd(prices)
}

/**
 * Convert a raw token amount (base units) to USD given USD per display token.
 */
export function tokenAmountToUsd(
  rawAmount: number,
  decimals: number,
  usdPerToken: number
): number {
  const displayAmount = rawAmount / Math.pow(10, decimals)
  return displayAmount * usdPerToken
}

/**
 * Extract the USD quote from an asset-prices response, applying the
 * token reciprocal rule used by paytaca-app.
 */
function priceInUsd(prices: AssetPrice[]): number | null {
  for (const p of prices) {
    if (String(p.currency || '').toLowerCase() !== 'usd') continue
    const raw = parseFloat(p.price_value)
    if (!isFinite(raw) || raw <= 0) continue
    const asset = String(p.asset || '').toLowerCase()
    // Tokens are quoted as tokens-per-USD; take the reciprocal for USD-per-token.
    return asset.startsWith('ct/') ? 1 / raw : raw
  }
  return null
}

/** Format a USD amount for display. */
export function formatUsd(usd: number): string {
  if (!isFinite(usd)) return '—'
  const formatted = usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${formatted} USD`
}

/** Human-readable BCH amount derived from a sat price. */
export function formatBch(sats: number): string {
  return `${(sats / 1e8).toFixed(8)} BCH`
}

/** Format a USD cost, keeping precision for sub-cent amounts. */
export function formatCostUsd(usd: number): string {
  if (!isFinite(usd)) return '—'
  return `$${usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })}`
}

export interface SpendCost {
  amountSats: number
  usd: number | null
  bch: string
}

/**
 * Resolve the cost of a sat-priced spend, preferring the backend's USD quote
 * and falling back to the live BCH/USD rate so both USD and BCH are available
 * before the user confirms.
 */
export async function resolveSpendCost(
  amountSats: number,
  amountUsd: number | undefined,
  isChipnet: boolean = false
): Promise<SpendCost> {
  let usd: number | null =
    typeof amountUsd === 'number' && isFinite(amountUsd) ? amountUsd : null
  if (usd === null) {
    try {
      const price = await getBchUsdPrice(isChipnet)
      if (price !== null) usd = (amountSats / 1e8) * price
    } catch {
      usd = null
    }
  }
  return { amountSats, usd, bch: formatBch(amountSats) }
}

/** Format a resolved spend as "$0.50 (0.00012345 BCH)". */
export function formatSpendCost(cost: SpendCost): string {
  return cost.usd !== null ? `${formatCostUsd(cost.usd)} (${cost.bch})` : cost.bch
}

