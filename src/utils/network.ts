/**
 * Network configuration and address conversion helpers.
 *
 * Adapted from: paytaca-app/src/wallet/chipnet.js
 *
 * Stripped of Vuex store dependency — uses explicit `isChipnet` parameter.
 */

import {
  CashAddressNetworkPrefix,
  CashAddressType,
  encodeCashAddress,
  decodeCashAddress,
} from '@bitauth/libauth'

/** BCH derivation path (BIP44 coin type 145) */
export const BCH_DERIVATION_PATH = "m/44'/145'/0'"

/** Watchtower project IDs (from environment or defaults) */
export const projectId = {
  mainnet: process.env.WATCHTOWER_PROJECT_ID || '',
  chipnet: process.env.WATCHTOWER_CHIP_PROJECT_ID || '',
}

export function getWatchtowerApiUrl(isChipnet: boolean): string {
  if (isChipnet) return 'https://chipnet.watchtower.cash/api'
  return 'https://watchtower.cash/api'
}

export function getWatchtowerWebsocketUrl(isChipnet: boolean): string {
  if (isChipnet) return 'wss://chipnet.watchtower.cash/ws'
  return 'wss://watchtower.cash/ws'
}

/**
 * Convert a CashAddress between mainnet/testnet and regular/token types.
 *
 * Adapted from paytaca-app/src/wallet/chipnet.js convertCashAddress().
 */
export function convertCashAddress(
  address: string,
  toTestNet: boolean = true,
  toTokenAddress: boolean = true
): string {
  const decodedAddress = decodeCashAddress(address)
  if (typeof decodedAddress === 'string') throw new Error(decodedAddress)
  const prefix = toTestNet ? CashAddressNetworkPrefix.testnet : CashAddressNetworkPrefix.mainnet
  const addressType = toTokenAddress ? CashAddressType.p2pkhWithTokens : CashAddressType.p2pkh
  return encodeCashAddress(prefix, addressType, decodedAddress.payload)
}

/**
 * Get the CashAddress prefix for the given network.
 */
export function getAddressPrefix(isChipnet: boolean): string {
  return isChipnet ? 'bchtest' : 'bitcoincash'
}
