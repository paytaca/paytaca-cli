/**
 * Cauldron trade transaction building.
 *
 * Adapted from: paytaca-app/src/wallet/cauldron/transact.js.
 *
 * Uses @cashlab/cauldron's ExchangeLab to construct a best-rate trade across
 * the active pools, then createInputAndOutput() selects the wallet coins and
 * payout rules needed to fund and settle it. The final signed transaction is
 * produced by ExchangeLab.createTradeTx() (libauth templates).
 */

import {
  ExchangeLab,
  buildPoolV0UnlockingBytecode,
  type PoolV0,
  type TradeResult,
} from '@cashlab/cauldron'
import {
  NATIVE_BCH_TOKEN_ID,
  PayoutAmountRuleType,
  SpendableCoinType,
  type Output,
  type PayoutRule,
  type SpendableCoin,
  type SpendableCoinP2PKH,
} from '@cashlab/common'
import {
  bigIntToCompactUint,
  cashAddressToLockingBytecode,
  compactUintPrefixToLength,
  decodePrivateKeyWif,
  hexToBin,
  privateKeyToP2pkhLockingBytecode,
} from '@cashlab/common/libauth.js'
import { poolTradeToOutput } from './pools.js'
import type { LibauthHDWallet } from '../keys.js'

const PLACEHOLDER_TOKEN_ID_FOR_SIZE_CALC = Array.from({ length: 64 })
  .fill('0')
  .join('')

/** Estimated on-chain size of a P2PKH input (Schnorr signature). */
const P2PKH_INPUT_SIZE = 141n

export interface AttemptTradeOpts {
  exlab?: ExchangeLab
  pools: PoolV0[]
  isBuyingToken: boolean
  supply?: bigint
  demand?: bigint
  txFeePerByte?: bigint
}

/**
 * Attempt a best-rate trade across the given pools.
 *
 * - Selling token → BCH: pass `supply` (token amount in base units).
 * - Buying token with BCH: pass `demand` (token amount in base units to receive).
 */
export function attemptTrade(opts: AttemptTradeOpts): TradeResult {
  const exlab = opts.exlab ?? new ExchangeLab()
  const { pools, isBuyingToken, supply, demand } = opts
  const txFeePerByte = opts.txFeePerByte || 1n

  if (pools.length === 0) throw new Error('No pools provided')

  let supplyTokenId = pools[0]!.output.token.token_id
  let demandTokenId = NATIVE_BCH_TOKEN_ID
  if (isBuyingToken) {
    supplyTokenId = NATIVE_BCH_TOKEN_ID
    demandTokenId = pools[0]!.output.token.token_id
  }

  if (demand) {
    return exlab.constructTradeBestRateForTargetDemand(
      supplyTokenId,
      demandTokenId,
      demand,
      pools,
      txFeePerByte
    )
  }
  return exlab.constructTradeBestRateForTargetSupply(
    supplyTokenId,
    demandTokenId,
    supply!,
    pools,
    txFeePerByte
  )
}

export interface PlatformFee {
  to: string
  amount: bigint
}

/**
 * Select the wallet coins and payout rules needed to fund + settle a trade.
 * Mirrors paytaca-app createInputAndOutput().
 */
export function createInputAndOutput(opts: {
  tradeResult: TradeResult
  spendableCoins: SpendableCoin[]
  platformFee?: PlatformFee
  tokenOutputSats?: bigint
}): { inputCoins: SpendableCoin[]; payouts: PayoutRule[] } {
  const { tradeResult, spendableCoins, platformFee } = opts
  const tokenOutputSats = opts.tokenOutputSats ?? 1000n

  if (spendableCoins.length === 0) {
    throw new Error('No UTXOs available to fund the trade')
  }

  const privateKey = (spendableCoins[0] as SpendableCoinP2PKH<Output>).key
  const lockingBytecode = privateKeyToP2pkhLockingBytecode({
    privateKey,
    throwErrors: true,
  })
  const tokenCoins = spendableCoins.filter((coin) => coin.output?.token)
  const bchCoins = spendableCoins.filter((coin) => !coin.output.token)

  const isBuyingToken = tradeResult.entries[0]!.supply_token_id === NATIVE_BCH_TOKEN_ID

  const entriesSizes = getEntriesSize(tradeResult)
  const totalPoolTxFee = BigInt(entriesSizes.inputFees + entriesSizes.outputFees)

  let tokensToSupply = !isBuyingToken ? tradeResult.summary.supply : 0n
  let satoshisToSupply = isBuyingToken ? tradeResult.summary.supply : 0n

  satoshisToSupply += totalPoolTxFee
  if (platformFee) {
    satoshisToSupply += platformFee.amount
    satoshisToSupply += BigInt(getOutputSize(platformFee))
  }

  const inputCoins: SpendableCoin[] = []
  const payouts: PayoutRule[] = []

  let remainingTokens = 0n
  if (!isBuyingToken) {
    // Selling tokens: consume token UTXOs until we've covered the supply
    remainingTokens = tokensToSupply
    for (const spendableCoin of tokenCoins) {
      if (remainingTokens <= 0n) break
      inputCoins.push(spendableCoin)
      remainingTokens -= spendableCoin.output.token!.amount
      satoshisToSupply += P2PKH_INPUT_SIZE
      satoshisToSupply -= spendableCoin.output.amount
    }

    // Excess tokens supplied → a token change output (counted in size calc)
    if (remainingTokens < 0n) {
      const changeTokenOutput = {
        to: lockingBytecode,
        amount: tokenOutputSats,
        token: {
          category: PLACEHOLDER_TOKEN_ID_FOR_SIZE_CALC,
          amount: remainingTokens * -1n,
        },
      }
      satoshisToSupply += changeTokenOutput.amount
      satoshisToSupply += BigInt(getOutputSize(changeTokenOutput))
    }
  } else {
    // Buying tokens: fixed payout for the received token amount
    payouts.push({
      type: PayoutAmountRuleType.FIXED,
      locking_bytecode: lockingBytecode,
      amount: tokenOutputSats,
      token: {
        token_id: tradeResult.entries[0]!.demand_token_id,
        amount: tradeResult.summary.demand,
      },
    })

    const outputSize = getOutputSize({
      to: lockingBytecode,
      amount: tokenOutputSats,
      token: {
        category: tradeResult.entries[0]!.demand_token_id,
        amount: tradeResult.summary.demand,
      },
    })
    satoshisToSupply += tokenOutputSats + BigInt(outputSize)
  }

  if (platformFee) {
    const decoded = cashAddressToLockingBytecode(platformFee.to)
    if (!decoded || typeof decoded === 'string' || !decoded.bytecode) {
      throw new Error(`Invalid platform fee address: ${platformFee.to}`)
    }
    payouts.push({
      type: PayoutAmountRuleType.FIXED,
      locking_bytecode: decoded.bytecode,
      amount: platformFee.amount,
    })
    satoshisToSupply += platformFee.amount + BigInt(getOutputSize(platformFee))
  }

  // Base tx overhead (version + locktime) and varint prefixes for inputs/outputs
  satoshisToSupply += 8n
  const inputSizePrefixLength = compactUintPrefixToLength(
    bigIntToCompactUint(BigInt(tradeResult.entries.length + inputCoins.length))[0]!
  )
  const outputSizePrefixLength = compactUintPrefixToLength(
    bigIntToCompactUint(BigInt(tradeResult.entries.length + payouts.length))[0]!
  )
  satoshisToSupply += BigInt(inputSizePrefixLength) + BigInt(outputSizePrefixLength)

  // Cover the remainder with BCH inputs
  let remainingSats = satoshisToSupply
  for (const spendableCoin of bchCoins) {
    if (remainingSats <= 0n) break
    inputCoins.push(spendableCoin)
    remainingSats -= spendableCoin.output.amount
    remainingSats += P2PKH_INPUT_SIZE
  }

  payouts.push({
    type: PayoutAmountRuleType.CHANGE,
    locking_bytecode: lockingBytecode,
    allow_mixing_native_and_token: false,
    allow_mixing_native_and_token_when_bch_change_is_dust: false,
    add_change_to_txfee_when_bch_change_is_dust: true,
  })

  return { inputCoins, payouts }
}

/**
 * Sum the on-chain byte sizes of the pool inputs and outputs for a trade.
 */
export function getEntriesSize(tradeResult: TradeResult): {
  inputFees: number
  outputFees: number
} {
  const inputFees = tradeResult.entries
    .map((entry) => buildPoolV0UnlockingBytecode(entry.pool.parameters))
    .map((unlockingBytecode) => getInputSize(unlockingBytecode))
    .reduce((subtotal, size) => subtotal + size, 0)

  const outputFees = tradeResult.entries
    .map((entry) => {
      const output = poolTradeToOutput(entry)
      return getOutputSize(output)
    })
    .reduce((subtotal, size) => subtotal + size, 0)

  return { inputFees, outputFees }
}

/**
 * Build a signed transaction for a trade using test coins, then optionally
 * verify it. Used to validate a trade before broadcasting.
 */
export function testTradeResult(opts: {
  exlab?: ExchangeLab
  tradeResult: TradeResult
  verify?: boolean
}) {
  const exlab = opts.exlab ?? new ExchangeLab()
  const { tradeResult } = opts

  const firstEntry = tradeResult.entries[0]!
  const isSupplyBch = firstEntry.supply_token_id === NATIVE_BCH_TOKEN_ID
  const tokenId = isSupplyBch ? firstEntry.demand_token_id : firstEntry.supply_token_id

  const key = new Uint8Array(32).fill(0x11)
  const locking_bytecode = privateKeyToP2pkhLockingBytecode({
    privateKey: key,
    throwErrors: true,
  })

  const tokenAmount = isSupplyBch ? 0n : (tradeResult.summary.supply * 3n) / 2n
  const satsAmount =
    (isSupplyBch ? tradeResult.summary.supply : 0n) +
    tradeResult.summary.trade_fee +
    100_000n

  const coins: SpendableCoin[] = [
    {
      type: SpendableCoinType.P2PKH,
      key,
      outpoint: { txhash: new Uint8Array(32).fill(0x22), index: 1 },
      output: { locking_bytecode, amount: satsAmount },
    },
  ]
  if (tokenAmount) {
    coins.push({
      type: SpendableCoinType.P2PKH,
      key,
      outpoint: { txhash: new Uint8Array(32).fill(0x33), index: 1 },
      output: {
        locking_bytecode,
        amount: 1000n,
        token: { token_id: tokenId, amount: tokenAmount },
      },
    })
  }

  const payoutRules: PayoutRule[] = []
  if (isSupplyBch) {
    payoutRules.push({
      type: PayoutAmountRuleType.FIXED,
      locking_bytecode,
      amount: 1000n,
      token: { token_id: tokenId, amount: tradeResult.summary.demand },
    })
  }
  payoutRules.push({
    type: PayoutAmountRuleType.CHANGE,
    locking_bytecode,
    allow_mixing_native_and_token: false,
    allow_mixing_native_and_token_when_bch_change_is_dust: false,
    add_change_to_txfee_when_bch_change_is_dust: true,
  })

  const tradeTx = exlab.createTradeTx(
    tradeResult.entries,
    coins,
    payoutRules,
    null,
    1n
  )
  if (opts.verify) exlab.verifyTradeTx(tradeTx)
  return tradeTx
}

/**
 * Convert watchtower UTXOs into @cashlab/common SpendableCoins.
 * Mirrors paytaca-app watchtowerUtxosToSpendableCoins().
 */
export interface WatchtowerUtxo {
  txid: string
  vout: number
  value: number
  tokenid?: string
  amount?: number
  address_path: string
  is_cashtoken?: boolean
}

export function watchtowerUtxosToSpendableCoins(opts: {
  utxos: WatchtowerUtxo[]
  wallet: LibauthHDWallet
}): SpendableCoin[] {
  const { utxos, wallet } = opts

  const addressPathPrivkeyMap = new Map<string, Uint8Array>()
  return utxos.map((utxo) => {
    let privateKey: Uint8Array | undefined = addressPathPrivkeyMap.get(
      utxo.address_path
    )
    if (!privateKey) {
      const wif = wallet.getPrivateKeyWifAt(utxo.address_path)
      const decodedWif = decodePrivateKeyWif(wif)
      if (typeof decodedWif === 'string') throw new Error(decodedWif)
      privateKey = decodedWif.privateKey
      addressPathPrivkeyMap.set(utxo.address_path, privateKey)
    }

    return {
      type: SpendableCoinType.P2PKH,
      key: privateKey,
      outpoint: { txhash: hexToBin(utxo.txid), index: utxo.vout },
      output: {
        locking_bytecode: privateKeyToP2pkhLockingBytecode({
          privateKey,
          throwErrors: true,
        }),
        amount: BigInt(utxo.value),
        token: !utxo.is_cashtoken
          ? undefined
          : {
              token_id: utxo.tokenid!,
              amount: BigInt(utxo.amount ?? 0),
            },
      },
    }
  })
}

/**
 * On-chain byte size of a transaction input for a given unlocking script.
 * Mirrors cashscript getInputSize().
 */
export function getInputSize(inputScript: Uint8Array): number {
  const scriptSize = inputScript.length
  const prefixSize = scriptSize > 252 ? 3 : 1
  return 32 + 4 + prefixSize + scriptSize + 4
}

interface SizedOutput {
  to: Uint8Array | string
  amount: bigint
  token?: { category?: string; amount: bigint }
}

/**
 * On-chain byte size of a transaction output.
 * Mirrors cashscript getOutputSize() (string `to` is treated as a CashAddress).
 */
export function getOutputSize(output: SizedOutput): number {
  let lockingBytecode: Uint8Array | undefined
  if (typeof output.to === 'string') {
    const decoded = cashAddressToLockingBytecode(output.to)
    if (typeof decoded === 'string') {
      throw new Error(`Invalid CashAddress: ${decoded}`)
    }
    lockingBytecode = decoded?.bytecode
  } else {
    lockingBytecode = output.to
  }
  if (!lockingBytecode) {
    throw new Error('Invalid locking bytecode for output size calculation')
  }

  let size =
    8 +
    compactUintPrefixToLength(
      bigIntToCompactUint(BigInt(lockingBytecode.length))[0]!
    ) +
    lockingBytecode.length

  if (output.token) {
    size +=
      34 +
      compactUintPrefixToLength(
        bigIntToCompactUint(BigInt(output.token.amount))[0]!
      )
  }

  return size
}