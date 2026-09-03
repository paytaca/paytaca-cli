import { describe, it, expect } from 'vitest'
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common'
import { binToHex, hexToBin } from '@cashlab/common/libauth.js'
import {
  apiPoolToMicroPool,
  microPoolToPoolV0,
  poolTradeToOutput,
  parseRate,
  type MicroPool,
} from './pools.js'
import { attemptTrade, getEntriesSize } from './transact.js'

// Real active LIFT pool from the riften indexer
const LIFT_TOKEN_ID = '5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc'

const apiPools = [
  {
    owner_p2pkh_addr: 'bitcoincash:zqytt7jjxds269xxm60lprpd8ea786xw3cjfh7pwpk',
    owner_pkh: '08b5fa523360ad14c6de9ff08c2d3e7be3e8ce8e',
    pool_id: '5a6a8da19aecf4198537ac006bcc32bb6c3be514338db813a5610a11ff8c9500',
    sats: 7746405,
    token_id: LIFT_TOKEN_ID,
    tokens: 95698,
    tx_pos: 5,
    txid: 'd49d46592026c574e877c3d6cbad0bbd3302262ae08e318669eaa39d19b94ed5',
  },
  {
    owner_p2pkh_addr: 'bitcoincash:zqwap58dm58cdvz9hgpg83lghd8rjjycn59gkys6cc',
    owner_pkh: '1dd0d0eddd0f86b045ba0283c7e8bb4e3948989d',
    pool_id: '6ac2944e341080772c4ed274033687fd4441d6e6ee976560dae9c83581b9f809',
    sats: 10848211,
    token_id: LIFT_TOKEN_ID,
    tokens: 133950,
    tx_pos: 1,
    txid: '09b048f14763e4a4bba08e236c653e678b79991ec500f8d0a457874de62e3980',
  },
]

function pools() {
  return apiPools.map(apiPoolToMicroPool).map(microPoolToPoolV0)
}

describe('apiPoolToMicroPool', () => {
  it('maps indexer pool fields onto a MicroPool', () => {
    const micro = apiPoolToMicroPool(apiPools[0]!)
    expect(micro.pkh).toBe(apiPools[0]!.owner_pkh)
    expect(micro.new_utxo_txid).toBe(apiPools[0]!.txid)
    expect(micro.new_utxo_n).toBe(apiPools[0]!.tx_pos)
    expect(micro.token_id).toBe(LIFT_TOKEN_ID)
    expect(micro.sats).toBe(apiPools[0]!.sats)
    expect(micro.token_amount).toBe(apiPools[0]!.tokens)
    expect(micro.is_withdrawn).toBe(false)
  })
})

describe('microPoolToPoolV0', () => {
  it('produces a valid PoolV0 with generated locking bytecode', () => {
    const micro = apiPoolToMicroPool(apiPools[0]!)
    const poolV0 = microPoolToPoolV0(micro)

    expect(poolV0.version).toBe('0')
    expect(binToHex(poolV0.parameters.withdraw_pubkey_hash)).toBe(apiPools[0]!.owner_pkh)
    expect(poolV0.outpoint.index).toBe(apiPools[0]!.tx_pos)
    expect(binToHex(poolV0.outpoint.txhash)).toBe(apiPools[0]!.txid)
    expect(poolV0.output.token.token_id).toBe(LIFT_TOKEN_ID)
    expect(poolV0.output.token.amount).toBe(BigInt(apiPools[0]!.tokens))
    expect(poolV0.output.amount).toBe(BigInt(apiPools[0]!.sats))
    // Locking bytecode must be non-empty and start with a valid pool script
    expect(poolV0.output.locking_bytecode.length).toBeGreaterThan(0)
  })
})

describe('attemptTrade', () => {
  it('computes a best-rate sell trade across pools', () => {
    const result = attemptTrade({
      pools: pools(),
      isBuyingToken: false,
      supply: 1000n, // 10.00 LIFT
    })

    expect(result.entries.length).toBeGreaterThan(0)
    expect(result.summary.supply).toBe(1000n)
    expect(result.summary.demand).toBeGreaterThan(0n)
    expect(result.entries[0]!.supply_token_id).toBe(LIFT_TOKEN_ID)
    expect(result.entries[0]!.demand_token_id).toBe(NATIVE_BCH_TOKEN_ID)
    expect(result.summary.trade_fee).toBeGreaterThan(0n)
  })

  it('computes a best-rate buy trade across pools', () => {
    const result = attemptTrade({
      pools: pools(),
      isBuyingToken: true,
      demand: 1000n,
    })

    expect(result.entries[0]!.supply_token_id).toBe(NATIVE_BCH_TOKEN_ID)
    expect(result.entries[0]!.demand_token_id).toBe(LIFT_TOKEN_ID)
    expect(result.summary.supply).toBeGreaterThan(0n)
    expect(result.summary.demand).toBe(1000n)
  })
})

describe('getEntriesSize', () => {
  it('returns positive input and output sizes', () => {
    const tradeResult = attemptTrade({
      pools: pools(),
      isBuyingToken: false,
      supply: 1000n,
    })
    const sizes = getEntriesSize(tradeResult)
    expect(sizes.inputFees).toBeGreaterThan(0)
    expect(sizes.outputFees).toBeGreaterThan(0)
  })
})

describe('poolTradeToOutput', () => {
  it('computes the post-trade pool output', () => {
    const tradeResult = attemptTrade({
      pools: pools(),
      isBuyingToken: false,
      supply: 1000n,
    })
    const entry = tradeResult.entries[0]!
    const output = poolTradeToOutput(entry)
    expect(output.amount).toBe(entry.pool.output.amount - entry.demand)
    expect(output.token.amount).toBe(entry.pool.output.token.amount + entry.supply)
    expect(output.token.category).toBe(entry.pool.output.token.token_id)
  })
})

describe('parseRate', () => {
  it('formats a sell price (token→BCH)', () => {
    // rate = supply/demand scaled to denominator 1e13.
    // For a sell: price = (num*10^8/den) / 10^tokenDecimals
    // num=3, den=1, decimals=2 → (3*10^8/1)/100 = 3000000
    const rate = { numerator: 3n, denominator: 1n }
    expect(parseRate(rate, 2, false)).toBe('3000000.00')
  })

  it('formats a buy price (BCH→token)', () => {
    // For a buy: price = (num*10^tokenDecimals/den) / 10^8
    // num=1, den=3, decimals=2 → (1*100/3)/10^8 = 0.00000033
    const rate = { numerator: 1n, denominator: 3n }
    expect(parseRate(rate, 2, true)).toBe('0.00000033')
  })

  it('matches the app formula on a real LIFT trade', () => {
    // SELL: supply=1000 token base units → demand=80378 sats across 2 pools
    const sellTrade = attemptTrade({
      pools: pools(),
      isBuyingToken: false,
      supply: 1000n,
    })
    // rate = supply*1e13/demand
    const sellRate = sellTrade.summary.rate
    expect(sellRate.denominator).toBe(10000000000000n)
    expect(sellRate.numerator).toBe(124412152579n)
    expect(parseRate(sellRate, 2, false)).toBe('12441.21')

    // BUY: demand=1000 token base units → supply=81569 sats across 2 pools
    const buyTrade = attemptTrade({
      pools: pools(),
      isBuyingToken: true,
      demand: 1000n,
    })
    const buyRate = buyTrade.summary.rate
    expect(buyRate.numerator).toBe(815690000000000n)
    expect(parseRate(buyRate, 2, true)).toBe('0.00008156')
  })
})

// keep a reference to MicroPool for type checks
export type { MicroPool }