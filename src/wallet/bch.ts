/**
 * BCH wallet operations: balance, address derivation, sending.
 *
 * Adapted from: paytaca-app/src/wallet/bch.js (BchWallet class)
 *
 * Key differences from paytaca-app:
 *   - Uses LibauthHDWallet for address derivation instead of @psf/bch-js
 *   - Transaction building/signing/broadcasting delegated to watchtower-cash-js
 *     (identical to paytaca-app)
 *   - Stripped: SLP, POS, fiat tracking, WalletConnect
 */

import Watchtower from 'watchtower-cash-js'
import { LibauthHDWallet } from './keys.js'
import { getWatchtowerApiUrl } from '../utils/network.js'

export interface Recipient {
  address: string
  amount: number
  tokenAmount?: number
}

export interface SendResult {
  success: boolean
  txid?: string
  transaction?: string
  error?: string
  lackingSats?: bigint
}

export class BchWallet {
  isChipnet: boolean
  mnemonic: string
  derivationPath: string
  watchtower: InstanceType<typeof Watchtower>
  projectId: string
  walletHash: string
  baseUrl: string

  private hdWallet: LibauthHDWallet

  constructor(
    projectId: string,
    mnemonic: string,
    path: string,
    isChipnet: boolean = false
  ) {
    this.isChipnet = isChipnet
    this.mnemonic = mnemonic
    this.derivationPath = path
    this.watchtower = new Watchtower(isChipnet)
    this.projectId = projectId
    this.baseUrl = getWatchtowerApiUrl(isChipnet)

    // Use LibauthHDWallet for address derivation (replaces @psf/bch-js HDNode)
    this.hdWallet = new LibauthHDWallet(
      mnemonic,
      path,
      isChipnet ? 'chipnet' : 'mainnet'
    )
    this.walletHash = this.hdWallet.walletHash
  }

  /**
   * Derive receiving and change addresses at a given index.
   * Adapted from paytaca-app BchWallet.getAddressSetAt()
   */
  getAddressSetAt(index: number): { receiving: string; change: string } {
    return this.hdWallet.getAddressSetAt(index)
  }

  /**
   * Subscribe a new address set with Watchtower for monitoring.
   * Adapted from paytaca-app BchWallet.getNewAddressSet()
   */
  async getNewAddressSet(index: number) {
    const addresses = this.getAddressSetAt(index)
    const data = {
      address: undefined as any,
      addresses: { receiving: addresses.receiving, change: addresses.change },
      projectId: this.projectId,
      walletHash: this.walletHash,
      walletIndex: undefined as any,
      addressIndex: index,
      webhookUrl: undefined as any,
      chatIdentity: undefined as any,
    }
    const result = await this.watchtower.subscribe(data)
    if (result.success) {
      return { addresses }
    }
    return null
  }

  /**
   * Get the last used address index from Watchtower.
   */
  async getLastAddressIndex(opts?: {
    with_tx?: boolean
    exclude_pos?: boolean
  }): Promise<number | undefined> {
    const _params = {
      with_tx: opts?.with_tx || false,
      exclude_pos: opts?.exclude_pos || false,
    }
    const apiResponse = await (this.watchtower as any).BCH._api.get(
      `last-address-index/wallet/${this.walletHash}/`,
      { params: _params }
    )
    if (Number.isInteger(apiResponse?.data?.address?.address_index)) {
      return apiResponse.data.address.address_index
    }
    return undefined
  }

  /**
   * Get wallet balance from Watchtower.
   * Adapted from paytaca-app BchWallet.getBalance()
   */
  async getBalance(): Promise<{
    valid: boolean
    wallet: string
    spendable: number
    balance: number
  }> {
    const walletHash = this.walletHash
    return this.watchtower.Wallet.getBalance({ walletHash })
  }

  /**
   * Get transaction history from Watchtower.
   * Adapted from paytaca-app BchWallet.getTransactions()
   */
  async getHistory(opts?: {
    page?: number
    recordType?: string
  }): Promise<{
    history: {
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
    }[]
    page: string
    num_pages: number
    has_next: boolean
  }> {
    const walletHash = this.walletHash
    return this.watchtower.Wallet.getHistory({
      walletHash,
      tokenId: '',
      page: opts?.page ?? 1,
      recordType: opts?.recordType ?? 'all',
      txSearchReference: '',
    })
  }

  /**
   * Send BCH to one or more recipients.
   *
   * Adapted from paytaca-app BchWallet.sendBch() and _sendBch().
   * The actual transaction building, signing, and broadcasting is handled
   * entirely by watchtower-cash-js BCH.send() — identical to paytaca-app.
   *
   * @param amount - Amount in BCH (e.g. 0.001)
   * @param address - Recipient CashAddress
   * @param changeAddress - Change address (optional, derived if not provided)
   * @param recipients - Array of recipients for multi-send (overrides amount/address)
   */
  async sendBch(
    amount: number,
    address: string,
    changeAddress?: string,
    recipients: Recipient[] = []
  ): Promise<SendResult> {
    const finalRecipients: Recipient[] = []
    if (recipients.length > 0) {
      finalRecipients.push(...recipients)
    } else {
      finalRecipients.push({ address, amount })
    }

    return this._sendBch(changeAddress, finalRecipients)
  }

  /**
   * Internal send implementation.
   * Passes data to watchtower-cash-js BCH.send() which handles:
   *   1. UTXO fetching from Watchtower API
   *   2. Transaction building with libauth
   *   3. Signing with derived private keys
   *   4. Broadcasting to the network
   *
   * The data format is identical to what paytaca-app passes.
   */
  private async _sendBch(
    changeAddress: string | undefined,
    recipients: Recipient[],
    broadcast: boolean = true
  ): Promise<SendResult> {
    const data = {
      sender: {
        walletHash: this.walletHash,
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      recipients,
      changeAddress,
      wallet: {
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      broadcast,
    }

    const result = await this.watchtower.BCH.send(data)
    return result as SendResult
  }

  /**
   * Trigger a UTXO scan on the Watchtower backend.
   */
  async scanUtxos(opts?: { background?: boolean }) {
    const queryParams: Record<string, boolean> = {}
    if (opts?.background) queryParams.background = true
    return (this.watchtower as any).BCH._api.get(
      `utxo/wallet/${this.walletHash}/scan/`,
      { params: queryParams }
    )
  }

  /**
   * Bulk-subscribe a range of addresses to Watchtower.
   * Adapted from paytaca-app BchWallet.scanAddresses()
   */
  async scanAddresses(opts: { startIndex: number; count: number }) {
    const response: { success: boolean; error: string } = {
      success: false,
      error: '',
    }
    if (!Number.isSafeInteger(opts?.startIndex)) {
      response.error = 'Invalid start index'
      return response
    }
    if (!Number.isSafeInteger(opts?.count)) {
      response.error = 'Invalid count'
      return response
    }

    const endIndex = opts.startIndex + opts.count
    const addressSets = []
    for (let i = opts.startIndex; i < endIndex; i++) {
      const addresses = this.getAddressSetAt(i)
      addressSets.push({ address_index: i, addresses })
    }

    const data = {
      address_sets: addressSets,
      wallet_hash: this.walletHash,
      project_id: this.projectId,
    }

    try {
      await (this.watchtower as any).BCH._api.post(
        'wallet/address-scan/',
        data
      )
      response.success = true
    } catch (error: any) {
      response.error = error?.message || 'Address scan failed'
    }
    return response
  }
}
