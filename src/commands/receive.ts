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
 */

import { Command } from 'commander'
import chalk from 'chalk'
import qrcode from 'qrcode-terminal'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

/**
 * Build a PayPro payment URI for CashToken receiving.
 *
 * Format: bitcoincash:<z-address>?c=<category>
 * This follows the convention used by paytaca-app (see receive.vue addressAmountFormat).
 */
function buildTokenPaymentUri(address: string, category: string): string {
  // Strip the bitcoincash: or bchtest: prefix if present, then reconstruct
  // with a consistent bitcoincash: scheme (PayPro convention).
  const bare = address.replace(/^(bitcoincash|bchtest):/, '')
  return `bitcoincash:${bare}?c=${category}`
}

export function registerReceiveCommand(program: Command): void {
  program
    .command('receive')
    .description('Display receiving address and QR code')
    .argument('[index]', 'Address index (default: 0)', '0')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token [category]', 'Show token-aware (z-prefix) address; optionally specify a category ID for a PayPro URI')
    .option('--no-qr', 'Hide QR code, show address only')
    .action(async (_index, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showQr = opts.qr !== false
      const tokenOpt: boolean | string = opts.token
      const isToken = Boolean(tokenOpt)
      const category = typeof tokenOpt === 'string' ? tokenOpt : ''
      const index = parseInt(_index, 10)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (isNaN(index) || index < 0) {
        console.log(
          chalk.red('\nError: Index must be a non-negative integer.\n')
        )
        process.exit(1)
      }

      if (category && !/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(
          chalk.red('\nError: Token category must be a 64-character hex string.\n')
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
      let tokenName = ''
      if (category) {
        try {
          const info = await bchWallet.getTokenInfo(category)
          if (info?.symbol) {
            tokenName = info.symbol
          } else if (info?.name && info.name !== 'Unknown Token') {
            tokenName = info.name
          }
        } catch {
          // Token info unavailable — proceed without name
        }
      }

      // ── Build display URI ────────────────────────────────────────────
      const paymentUri = category
        ? buildTokenPaymentUri(address, category)
        : ''
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
