/**
 * Cauldron (riften indexer) REST client.
 *
 * Adapted from: paytaca-app/src/wallet/cauldron/api.js, tokens.js,
 * and pool-tracker.ts. Uses the global fetch API (Node 20+) instead of axios.
 */

import { getWatchtowerApiUrl } from '../../utils/network.js'

const CAULDRON_INDEXER_BASE_URL = 'https://indexer.riften.net'

/**
 * An active pool as returned by the cauldron indexer.
 * GET /cauldron/pool/active?token=<category>
 */
export interface ApiPool {
  owner_p2pkh_addr: string
  owner_pkh: string
  pool_id: string
  sats: number
  token_id: string
  tokens: number
  tx_pos: number
  txid: string
}

/**
 * A cauldron-listed token (market info + BCMR metadata).
 * GET /cauldron/tokens/list_cached_by_ids?ids=<category>
 */
export interface CauldronTokenData {
  token_id: string
  display_name: string
  display_symbol: string
  price_now: number
  price_now_usd: number
  tvl_sats: number
  bcmr: {
    name: string
    description: string
    token: {
      category: string
      decimals: number
      symbol: string
    }
    uris?: { icon?: string; web?: string }
  }
}

export class CauldronApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'CauldronApiError'
    this.status = status
  }
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(CAULDRON_INDEXER_BASE_URL + path)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url.toString())
  } catch (err: any) {
    throw new CauldronApiError(`Cauldron indexer unreachable: ${err?.message || err}`)
  }

  if (!response.ok) {
    throw new CauldronApiError(
      `Cauldron indexer request failed (${response.status} ${response.statusText})`,
      response.status
    )
  }

  return response.json() as Promise<T>
}

/**
 * Fetch the active cauldron pools for a token category.
 */
export async function fetchPoolsForToken(tokenId: string): Promise<ApiPool[]> {
  const data = await getJson<{ active?: unknown }>('/cauldron/pool/active', {
    token: tokenId,
  })
  if (!Array.isArray(data.active)) {
    throw new CauldronApiError('Unexpected response from cauldron pool endpoint')
  }
  return data.active as ApiPool[]
}

/**
 * Fetch market + BCMR data for a single token category.
 */
export async function fetchTokenData(
  tokenId: string
): Promise<CauldronTokenData | undefined> {
  const data = await getJson<CauldronTokenData[]>(
    '/cauldron/tokens/list_cached_by_ids',
    {
      ids: tokenId,
      limit: 1,
      offset: 0,
      by: 'score',
      order: 'desc',
    }
  )
  return Array.isArray(data) ? data[0] : undefined
}

/**
 * Platform fee config served by watchtower.cash
 * (GET /api/cauldron-fee/). A null address means the fee feature is
 * disabled — clients degrade silently (no fee charged).
 */
export interface PlatformFeeConfig {
  address: string | null
  /** Fee rate in basis points (30 = 0.3%). */
  feeRateBps: number
  /** Fee cap in USD, applied against the live BCH price. */
  maxUsd: number
}

/**
 * Fetch the cauldron fee config from watchtower.cash.
 */
export async function fetchCauldronFee(
  isChipnet: boolean = false
): Promise<PlatformFeeConfig> {
  const baseUrl = getWatchtowerApiUrl(isChipnet)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/cauldron-fee/`)
  } catch (err: any) {
    throw new CauldronApiError(`watchtower unreachable: ${err?.message || err}`)
  }
  if (!response.ok) {
    throw new CauldronApiError(
      `cauldron-fee request failed (${response.status} ${response.statusText})`,
      response.status
    )
  }
  const data = await response.json()
  const feeRateBps = Number(data?.fee_rate_bps ?? 30)
  const maxUsd = Number(data?.max_usd ?? 1)
  return {
    address:
      typeof data?.address === 'string' && data.address !== ''
        ? data.address
        : null,
    feeRateBps: Number.isFinite(feeRateBps) && feeRateBps >= 0 ? feeRateBps : 30,
    maxUsd: Number.isFinite(maxUsd) && maxUsd >= 0 ? maxUsd : 1,
  }
}
