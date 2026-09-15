/**
 * CLI command: receive
 *
 * Displays a receiving address and its QR code for accepting BCH or CashToken payments.
 *
 * Use --token to display a token-aware (z-prefix) address for receiving CashTokens.
 * Use --amount to embed a requested amount into the URI.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import qrcode from 'qrcode-terminal'
import { WalletNotConfiguredError } from '../core/context.js'
import { getReceiveAddressView } from '../core/wallet.js'

export function registerReceiveCommand(program: Command): void {
  program
    .command('receive')
    .description('Display receiving address and QR code')
    .option('--index <n>', 'Address index (default: 0)', '0')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token [category]', 'Show token-aware (z-prefix) address; optionally specify a category ID for a PayPro URI')
    .option('--amount <amount>', 'Request a specific amount (BCH for plain, token units when --token <category> is set)')
    .option('--no-qr', 'Hide QR code, show address only')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showQr = opts.qr !== false
      const asJson = Boolean(opts.json)
      const tokenOpt: boolean | string = opts.token
      const isToken = Boolean(tokenOpt)
      const category = typeof tokenOpt === 'string' ? tokenOpt : ''
      const index = parseInt(opts.index, 10)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const rawAmount = opts.amount ? parseFloat(opts.amount) : undefined

      if (isNaN(index) || index < 0) {
        console.log(chalk.red('\nError: Index must be a non-negative integer.\n'))
        process.exit(1)
      }

      if (rawAmount !== undefined && (isNaN(rawAmount) || rawAmount <= 0)) {
        console.log(chalk.red('\nError: Amount must be a positive number.\n'))
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

      try {
        const view = await getReceiveAddressView(
          { index, token: isToken, category, amount: rawAmount },
          isChipnet
        )

        if (asJson) {
          console.log(JSON.stringify(view, null, 2))
          return
        }

        const label = category
          ? `Receive ${view.tokenName || 'CashTokens'}`
          : isToken
            ? 'Receive CashTokens'
            : 'Receive BCH'
        console.log(chalk.bold(`\n   ${label} (${network})\n`))
        console.log(`   Address:  ${view.address}`)
        console.log(chalk.dim(`   Index:    ${view.index}`))
        console.log(
          view.subscribed
            ? chalk.dim('   Watching: subscribed with Watchtower')
            : chalk.yellow('   Watching: not subscribed (address may not be monitored)')
        )
        if (isToken) console.log(chalk.dim('   Type:     token-aware (z-prefix)'))
        if (category) console.log(chalk.dim(`   Category: ${category}`))
        if (rawAmount !== undefined) {
          const unit = category ? (view.tokenName || 'tokens') : 'BCH'
          console.log(`   Amount:   ${rawAmount} ${unit}`)
        }
        if (view.paymentUri) console.log(`   URI:      ${view.paymentUri}`)

        if (showQr) {
          console.log()
          qrcode.generate(view.qrContent, { small: true }, (qr: string) => {
            const indented = qr
              .split('\n')
              .map((line) => '   ' + line)
              .join('\n')
            console.log(indented)
          })
        }

        console.log()
      } catch (err: any) {
        if (asJson) {
          console.log(JSON.stringify({ error: err.message || String(err) }, null, 2))
          process.exit(1)
        }
        if (err instanceof WalletNotConfiguredError) {
          console.log(chalk.red(`\n${err.message}\n`))
          process.exit(1)
        }
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }
    })
}