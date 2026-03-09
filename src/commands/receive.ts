/**
 * CLI command: receive
 *
 * Displays a receiving address and its QR code for accepting BCH or CashToken payments.
 * The QR code encodes the address in CashAddr format, rendered directly
 * in the terminal using Unicode block characters.
 *
 * Use --token to display a token-aware (z-prefix) address for receiving CashTokens.
 * Optionally pass a category ID to generate a PayPro payment URI:
 *   --token <category>  →  bitcoincash:<z-address>?c=<category>
 *
 * Use --amount to embed a requested amount into the URI:
 *   BCH:   bitcoincash:<address>?amount=<bch>           (BIP21)
 *   Token: bitcoincash:<z-address>?c=<cat>&f=<base_units> (PayPro)
 */

import { Command } from 'commander'
import chalk from 'chalk'
import qrcode from 'qrcode-terminal'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import type { FungibleToken } from '../wallet/bch.js'

/**
 * Build a BIP21 payment URI for BCH.
 * Format: bitcoincash:<address>?amount=<bch_amount>
 */
function buildBchPaymentUri(address: string, amount?: number): string {
  const bare = address.replace(/^(bitcoincash|bchtest):/, '')
  let uri = `bitcoincash:${bare}`
  if (amount !== undefined && amount > 0) {
    uri += `?amount=${amount}`
  }
  return uri
}

/**
 * Build a PayPro payment URI for CashToken receiving.
 *
 * Format: bitcoincash:<z-address>?c=<category>[&f=<base_unit_amount>]
 * This follows the convention used by paytaca-app (see receive.vue addressAmountFormat).
 *
 * The `f` parameter is the token amount in base units (scaled by 10^decimals).
 */
function buildTokenPaymentUri(
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

export function registerReceiveCommand(program: Command): void {
  program
    .command('receive')
    .description('Display receiving address and QR code')
    .option('--index <n>', 'Address index (default: 0)', '0')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token [category]', 'Show token-aware (z-prefix) address; optionally specify a category ID for a PayPro URI')
    .option('--amount <amount>', 'Request a specific amount (BCH for plain, token units when --token <category> is set)')
    .option('--no-qr', 'Hide QR code, show address only')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showQr = opts.qr !== false
      const tokenOpt: boolean | string = opts.token
      const isToken = Boolean(tokenOpt)
      const category = typeof tokenOpt === 'string' ? tokenOpt : ''
      const index = parseInt(opts.index, 10)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const rawAmount = opts.amount ? parseFloat(opts.amount) : undefined

      if (isNaN(index) || index < 0) {
        console.log(
          chalk.red('\nError: Index must be a non-negative integer.\n')
        )
        process.exit(1)
      }

      if (rawAmount !== undefined && (isNaN(rawAmount) || rawAmount <= 0)) {
        console.log(
          chalk.red('\nError: Amount must be a positive number.\n')
        )
        process.exit(1)
      }

      if (category && !/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(
          chalk.red('\nError: Token category must be a 64-character hex string.\n')
        )
        process.exit(1)
      }

      if (rawAmount !== undefined && isToken && !category) {
        console.log(
          chalk.red('\nError: --amount with --token requires a category ID.\n')
        )
        console.log(
          chalk.dim('   Usage: paytaca receive --token <category> --amount <amount>\n')
        )
        process.exit(1)
      }

      // ── Validate wallet ──────────────────────────────────────────────
      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red(
            '\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n'
          )
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      const address = isToken
        ? bchWallet.getTokenAddressSetAt(index).receiving
        : bchWallet.getAddressSetAt(index).receiving

      // ── Resolve token metadata (if category specified) ─────────────
      let tokenInfo: FungibleToken | null = null
      let tokenName = ''
      if (category) {
        try {
          tokenInfo = await bchWallet.getTokenInfo(category)
          if (tokenInfo?.symbol) {
            tokenName = tokenInfo.symbol
          } else if (tokenInfo?.name && tokenInfo.name !== 'Unknown Token') {
            tokenName = tokenInfo.name
          }
        } catch {
          // Token info unavailable — proceed without metadata
        }
      }

      // ── Build payment URI ────────────────────────────────────────────
      let paymentUri = ''

      if (category) {
        // PayPro: token amount scaled to base units via decimals
        const decimals = tokenInfo?.decimals ?? 0
        const baseUnitAmount = rawAmount !== undefined
          ? rawAmount * 10 ** decimals
          : undefined
        paymentUri = buildTokenPaymentUri(address, category, baseUnitAmount)
      } else if (rawAmount !== undefined) {
        // BIP21: plain BCH amount
        paymentUri = buildBchPaymentUri(address, rawAmount)
      }

      const qrContent = paymentUri || address

      // ── Output ───────────────────────────────────────────────────────
      const label = category
        ? `Receive ${tokenName || 'CashTokens'}`
        : isToken
          ? 'Receive CashTokens'
          : 'Receive BCH'
      console.log(chalk.bold(`\n   ${label} (${network})\n`))
      console.log(`   Address:  ${address}`)
      console.log(chalk.dim(`   Index:    ${index}`))
      if (isToken) {
        console.log(chalk.dim('   Type:     token-aware (z-prefix)'))
      }
      if (category) {
        console.log(chalk.dim(`   Category: ${category}`))
      }
      if (rawAmount !== undefined) {
        const unit = category
          ? (tokenName || 'tokens')
          : 'BCH'
        console.log(`   Amount:   ${rawAmount} ${unit}`)
      }
      if (paymentUri) {
        console.log(`   URI:      ${paymentUri}`)
      }

      if (showQr) {
        console.log()
        qrcode.generate(qrContent, { small: true }, (qr: string) => {
          // Indent QR code for alignment with the rest of the output
          const indented = qr
            .split('\n')
            .map((line) => '   ' + line)
            .join('\n')
          console.log(indented)
        })
      }

      console.log()
    })
}
