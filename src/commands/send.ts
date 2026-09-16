/**
 * CLI command: send <address> <amount> [currency]
 *
 * Sends BCH from the wallet to an external address.
 * currency defaults to "bch"; also accepts "sats" / "satoshis" or "usd".
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { WalletNotConfiguredError } from '../core/context.js'
import { isValidBchAddress, sendBch } from '../core/wallet.js'
import { explorerTxUrl } from '../utils/format.js'
import { getBchUsdPrice, formatUsd } from '../utils/prices.js'

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description('Send BCH to an address')
    .argument('<address>', 'Recipient BCH address (CashAddr format)')
    .argument('<amount>', 'Amount to send')
    .argument('[currency]', 'Currency: bch (default), sats / satoshis, or usd', 'bch')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (address: string, amountStr: string, currency: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const unit = currency.toLowerCase()
      const network = isChipnet ? 'chipnet' : 'mainnet'

      let amountBch = parseFloat(amountStr)
      if (isNaN(amountBch) || amountBch <= 0) {
        console.log(chalk.red('\nError: Amount must be a positive number.\n'))
        process.exit(1)
      }

      let usdPrice: number | null = null
      if (unit === 'sats' || unit === 'satoshis') {
        amountBch = amountBch / 1e8
      } else if (unit === 'usd') {
        usdPrice = await getBchUsdPrice(isChipnet)
        if (usdPrice === null) {
          console.log(chalk.red('\nError: Unable to fetch current BCH-USD price.\n'))
          process.exit(1)
        }
        amountBch = amountBch / usdPrice
      } else if (unit !== 'bch') {
        console.log(chalk.red("\nError: Currency must be 'bch', 'sats'/'satoshis', or 'usd'.\n"))
        process.exit(1)
      }

      if (!isValidBchAddress(address, isChipnet)) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      try {
        if (!asJson) {
          const bchFormatted = amountBch.toFixed(8).replace(/\.?0+$/, '')
          console.log(
            `\n   Sending ${chalk.bold(bchFormatted + ' BCH')}` +
              (usdPrice !== null ? chalk.dim(` (≈ ${formatUsd(amountBch * usdPrice)})`) : '') +
              ` on ${chalk.cyan(network)}`
          )
          if (usdPrice !== null) {
            console.log(chalk.dim(`   Rate:    1 BCH = ${formatUsd(usdPrice)}`))
          }
          console.log(chalk.dim(`   To:     ${address}`))
          console.log()
        }

        const outcome = await sendBch({ address, amountBch }, isChipnet)

        if (asJson) {
          console.log(
            JSON.stringify(
              { ...outcome, address, amountBch },
              null,
              2
            )
          )
          if (!outcome.success) process.exit(1)
          return
        }

        if (outcome.success) {
          console.log(chalk.green('   Transaction sent successfully!\n'))
          if (outcome.txid) {
            console.log(`   txid: ${outcome.txid}`)
            console.log(chalk.dim(`   ${outcome.explorerUrl}`))
          }
        } else {
          console.log(chalk.red(`   Transaction failed: ${outcome.error || 'Unknown error'}`))
          if (outcome.lackingSats) {
            console.log(
              chalk.yellow(
                `   Insufficient balance. Short by ${outcome.lackingSats} satoshis.`
              )
            )
          }
          process.exit(1)
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