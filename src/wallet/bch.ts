/**
 * BCH wallet operations: balance, address derivation, sending, CashTokens.
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
  amount?: number
  tokenAmount?: bigint
}

export interface SendResult {
  success: boolean
  txid?: string
  transaction?: string
  error?: string
  lackingSats?: bigint
}

/**
 * Token parameter for CashToken sends.
 * Matches watchtower-cash-js Token interface.
 */
export interface TokenParam {
  tokenId: string
  commitment?: string
  capability?: string
  amount?: bigint
  txid?: string
  vout?: number
}

/**
 * A fungible CashToken in the wallet, as returned by the Watchtower API.
 */
export interface FungibleToken {
  id: string          // "ct/<category>"
  category: string    // 64-char hex token category
  name: string
  symbol: string
  decimals: number
  imageUrl: string
  balance: number     // raw balance in base units
}

/**
 * An NFT CashToken UTXO in the wallet.
 */
export interface NftUtxo {
  txid: string
  vout: number
  category: string
  commitment: string
  capability: 'none' | 'minting' | 'mutable'
  amount: number      // fungible amount on the same UTXO (usually 0)
  value: number       // BCH satoshi value
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
   * Derive token-aware (z-prefix) addresses at a given index.
   * Used for CashToken receives — tokens can only be sent to token-aware addresses.
   */
  getTokenAddressSetAt(index: number): { receiving: string; change: string } {
    return this.hdWallet.getTokenAddressSetAt(index)
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
   *
   * @param opts.tokenId - Filter by CashToken category ID (empty string for BCH-only)
   */
  async getHistory(opts?: {
    page?: number
    recordType?: string
    tokenId?: string
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
      tokenId: opts?.tokenId ?? '',
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

  // ── CashTokens ─────────────────────────────────────────────────────

  /**
   * List fungible CashTokens in the wallet.
   *
   * Calls Watchtower REST API directly (same as paytaca-app),
   * because watchtower-cash-js Wallet.getTokens() is only used for SLP.
   *
   * Endpoint: GET /cashtokens/fungible/?wallet_hash={walletHash}&has_balance=true
   */
  async getFungibleTokens(): Promise<FungibleToken[]> {
    const api = (this.watchtower as any).BCH._api
    const allTokens: FungibleToken[] = []
    let nextUrl: string | null = `cashtokens/fungible/`
    let params: Record<string, any> | undefined = {
      wallet_hash: this.walletHash,
      has_balance: true,
      limit: 100,
    }

    while (nextUrl) {
      const response: any = await api.get(nextUrl, { params })
      const data: any = response?.data

      if (!data?.results || !Array.isArray(data.results)) break

      for (const result of data.results) {
        const categoryMatch = String(result.id || '').match(/^ct\/([a-fA-F0-9]+)$/)
        allTokens.push({
          id: result.id || '',
          category: categoryMatch ? categoryMatch[1] : result.id || '',
          name: result.name || 'Unknown Token',
          symbol: result.symbol || '',
          decimals: result.decimals || 0,
          imageUrl: result.image_url || '',
          balance: result.balance !== undefined ? result.balance : 0,
        })
      }

      if (data.next) {
        // The `next` field is an absolute URL; extract relative path
        const nextFullUrl: URL = new URL(data.next)
        nextUrl = nextFullUrl.pathname.replace(/^\/api\//, '') + nextFullUrl.search
        params = undefined // params are already in the URL
      } else {
        nextUrl = null
      }
    }

    return allTokens
  }

  /**
   * Get metadata for a single fungible CashToken by category ID.
   *
   * Endpoint: GET /cashtokens/fungible/{category}/
   */
  async getTokenInfo(category: string): Promise<FungibleToken | null> {
    try {
      const api = (this.watchtower as any).BCH._api
      const response = await api.get(`cashtokens/fungible/${category}/`)
      const data = response?.data
      if (!data) return null

      const categoryMatch = String(data.id || '').match(/^ct\/([a-fA-F0-9]+)$/)
      return {
        id: data.id || `ct/${category}`,
        category: categoryMatch ? categoryMatch[1] : category,
        name: data.name || 'Unknown Token',
        symbol: data.symbol || '',
        decimals: data.decimals || 0,
        imageUrl: data.image_url || '',
        balance: data.balance !== undefined ? data.balance : 0,
      }
    } catch (err: any) {
      if (err?.response?.status === 404) return null
      throw err
    }
  }

  /**
   * Get token balance for a specific token category.
   *
   * Endpoint: GET /balance/wallet/{walletHash}/{tokenId}/
   */
  async getTokenBalance(
    tokenId: string
  ): Promise<{ balance: number; spendable: number }> {
    const result = await this.watchtower.Wallet.getBalance({
      walletHash: this.walletHash,
      tokenId,
    })
    return { balance: result.balance, spendable: result.spendable }
  }

  /**
   * Get NFT UTXOs for a specific token category (or all NFTs).
   *
   * Uses watchtower-cash-js BCH.getCashtokensUtxos() to fetch token UTXOs,
   * then filters for those that have NFT data (capability is set).
   *
   * Endpoint: GET /utxo/wallet/{walletHash}/?is_cashtoken=true
   */
  async getNftUtxos(category?: string): Promise<NftUtxo[]> {
    const api = (this.watchtower as any).BCH._api
    const response = await api.get(`utxo/wallet/${this.walletHash}/`, {
      params: { is_cashtoken: true },
    })
    const data = response?.data

    if (!data?.utxos || !Array.isArray(data.utxos)) return []

    const nfts: NftUtxo[] = []
    for (const utxo of data.utxos) {
      // NFTs have a non-null capability
      if (!utxo.is_cashtoken || utxo.capability === null || utxo.capability === undefined) continue
      if (category && utxo.tokenid !== category) continue

      nfts.push({
        txid: utxo.txid,
        vout: utxo.vout,
        category: utxo.tokenid,
        commitment: utxo.commitment || '',
        capability: utxo.capability,
        amount: utxo.amount || 0,
        value: utxo.value || 0,
      })
    }

    return nfts
  }

  /**
   * Send fungible CashTokens to a recipient.
   *
   * Delegates to watchtower-cash-js BCH.send() with the `token` parameter,
   * identical to how paytaca-app sends CashTokens.
   *
   * @param category - Token category ID (64-char hex)
   * @param tokenAmount - Amount in base units (before decimal scaling)
   * @param address - Recipient address (should be token-aware z-prefix)
   * @param changeAddress - Change address for leftover tokens + BCH
   */
  async sendToken(
    category: string,
    tokenAmount: bigint,
    address: string,
    changeAddress?: string
  ): Promise<SendResult> {
    const data = {
      sender: {
        walletHash: this.walletHash,
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      recipients: [
        {
          address,
          tokenAmount,
        },
      ],
      token: {
        tokenId: category,
      },
      changeAddress,
      wallet: {
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      broadcast: true,
    }

    const result = await this.watchtower.BCH.send(data)
    return result as SendResult
  }

  /**
   * Send an NFT (non-fungible CashToken) to a recipient.
   *
   * NFTs require specifying the exact UTXO (txid + vout) to spend,
   * plus the commitment and capability that identify the NFT.
   *
   * @param category - Token category ID (64-char hex)
   * @param commitment - NFT commitment (hex string, can be empty "")
   * @param capability - NFT capability: 'none', 'minting', or 'mutable'
   * @param txid - UTXO txid containing the NFT
   * @param vout - UTXO output index
   * @param address - Recipient address
   * @param changeAddress - Change address for leftover BCH
   */
  async sendNft(
    category: string,
    commitment: string,
    capability: string,
    txid: string,
    vout: number,
    address: string,
    changeAddress?: string
  ): Promise<SendResult> {
    const data = {
      sender: {
        walletHash: this.walletHash,
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      recipients: [
        {
          address,
        },
      ],
      token: {
        tokenId: category,
        commitment,
        capability,
        txid,
        vout,
      },
      changeAddress,
      wallet: {
        mnemonic: this.mnemonic,
        derivationPath: this.derivationPath,
      },
      broadcast: true,
    }

    const result = await this.watchtower.BCH.send(data)
    return result as SendResult
  }
}
