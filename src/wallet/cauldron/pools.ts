/**
 * Cauldron pool conversions and helpers.
 *
 * Adapted from: paytaca-app/src/wallet/cauldron/utils.js and pool-tracker.ts.
 * Converts indexer ApiPool entries into @cashlab/cauldron PoolV0 objects.
 */

import { ExchangeLab, type PoolV0 } from '@cashlab/cauldron'
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common'
import { hexToBin } from '@cashlab/common/libauth.js'
import { fetchPoolsForToken, type ApiPool } from './api.js'

export interface MicroPool {
  pool_id: string
  pkh: string
  is_withdrawn: boolean
  spent_utxo_hash: string
  new_utxo_hash: string
  new_utxo_txid: string
  new_utxo_n: number
  token_id: string
  sats: number
  token_amount: number
}

/**
 * Convert an indexer ApiPool to a MicroPool.
 */
export function apiPoolToMicroPool(pool: ApiPool): MicroPool {
  return {
    pool_id: pool.pool_id,
    pkh: pool.owner_pkh,
    is_withdrawn: false,
    spent_utxo_hash: '',
    new_utxo_hash: pool.txid,
    new_utxo_txid: pool.txid,
    new_utxo_n: pool.tx_pos,
    token_id: pool.token_id,
    sats: pool.sats,
    token_amount: pool.tokens,
  }
}

/**
 * Convert a MicroPool to a @cashlab/cauldron PoolV0.
 */
export function microPoolToPoolV0(pool: MicroPool): PoolV0 {
  const pool0Params = { withdraw_pubkey_hash: hexToBin(pool.pkh) }
  const exlab = new ExchangeLab()
  const pool0LockingBytecode = exlab.generatePoolV0LockingBytecode(pool0Params)
  return {
    version: '0',
    parameters: pool0Params,
    outpoint: {
      index: pool.new_utxo_n,
      txhash: hexToBin(pool.new_utxo_txid),
    },
    output: {
      locking_bytecode: pool0LockingBytecode,
      token: {
        amount: BigInt(pool.token_amount),
        token_id: pool.token_id,
      },
      amount: BigInt(pool.sats),
    },
  }
}

/**
 * Fetch + convert active pools for a token category into PoolV0 objects.
 */
export async function fetchPoolV0ForToken(tokenId: string): Promise<PoolV0[]> {
  const pools = await fetchPoolsForToken(tokenId)
  return pools.map(apiPoolToMicroPool).map(microPoolToPoolV0)
}

/**
 * Compute the post-trade state of a pool output (used for fee estimation).
 * Mirrors paytaca-app poolTradeToCashscriptOutput().
 */
export interface PoolTradeOutput {
  to: Uint8Array
  amount: bigint
  token: {
    amount: bigint
    category: string
  }
}

/**
 * @param poolTrade A @cashlab/cauldron PoolTrade
 * @returns The pool's resulting output after the trade
 */
export function poolTradeToOutput(poolTrade: {
  supply_token_id: string
  demand_token_id: string
  supply: bigint
  demand: bigint
  pool: PoolV0
}): PoolTradeOutput {
  const isSupplyingBch = poolTrade.supply_token_id === NATIVE_BCH_TOKEN_ID
  const satoshisDelta = isSupplyingBch ? poolTrade.supply : poolTrade.demand * -1n
  const tokenDelta = isSupplyingBch ? poolTrade.demand * -1n : poolTrade.supply

  const poolOutput = poolTrade.pool.output
  return {
    to: poolOutput.locking_bytecode,
    amount: poolOutput.amount + satoshisDelta,
    token: {
      amount: poolOutput.token.amount + tokenDelta,
      category: poolOutput.token.token_id,
    },
  }
}

/**
 * Parse a trade rate (price) into a human-readable string.
 * Mirrors paytaca-app parseRate().
 *
 * @param isBuyingToken true when BCH is spent to buy tokens (price in BCH per token)
 */
export function parseRate(
  rate: { numerator: bigint; denominator: bigint },
  tokenDecimals: number,
  isBuyingToken: boolean
): string {
  let multiplierDecimals = 8
  let divisorDecimals = tokenDecimals
  if (isBuyingToken) {
    multiplierDecimals = tokenDecimals
    divisorDecimals = 8
  }

  const multiplier = 10n ** BigInt(multiplierDecimals)
  const _price = (rate.numerator * multiplier) / rate.denominator

  const divisor = 10 ** divisorDecimals
  const price = Number(_price) / divisor
  return price.toFixed(divisorDecimals)
}