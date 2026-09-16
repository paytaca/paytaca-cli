/**
 * CLI command: history
 *
 * Displays transaction history for the current wallet.
 * Fetches paginated records from the Watchtower API, showing
 * direction (incoming/outgoing), amount, date, and txid.
 *
 * Use --token to filter history for a specific CashToken.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { WalletNotConfiguredError } from '../core/context.js'
import { getHistoryView } from '../core/wallet.js'
import { bchToSats, formatDate, shortTxid } from '../utils/format.js'
import { formatUsd } from '../utils/prices.js'

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('Display transaction history')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--page <page>', 'Page number (default: 1)', '1')
    .option(
      '--type <type>',
      'Filter by type: all, incoming, outgoing (default: all)',
      'all'
    )
    .option('--token <id>', 'Filter by CashToken category ID (64-character hex)')
    .option('--sats', 'Display amounts in satoshis')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSats = Boolean(opts.sats)
      const asJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const page = parseInt(opts.page, 10)
      const recordType: string = opts.type
      const tokenId: string = opts.token || ''

      if (isNaN(page) || page < 1) {
        console.log(chalk.red('\nError: Page must be a positive integer.\n'))
        process.exit(1)
      }

      if (!['all', 'incoming', 'outgoing'].includes(recordType)) {
        console.log(
          chalk.red(
            '\nError: Type must be "all", "incoming", or "outgoing".\n'
          )
        )
        process.exit(1)
      }

      if (tokenId && !/^[a-fA-F0-9]{64}$/.test(tokenId)) {
        console.log(chalk.red('\nError: Token must be a 64-character hex string.\n'))
        process.exit(1)
      }

      try {
        const view = await getHistoryView({ page, recordType, tokenId }, isChipnet)

        if (asJson) {
          console.log(JSON.stringify(view, null, 2))
          return
        }

        console.log(chalk.bold(`\n   ${view.headerLabel} (${network})\n`))
        if (tokenId) console.log(chalk.dim(`   Category: ${tokenId}\n`))

        if (view.records.length === 0) {
          console.log(chalk.dim('   No transactions found.\n'))
          return
        }

        for (const tx of view.records) {
          const isIncoming = tx.record_type === 'incoming'
          const arrow = isIncoming ? chalk.green('  IN') : chalk.red(' OUT')

          const amount = tokenId
            ? `${tx.amount}`
            : showSats
              ? `${bchToSats(tx.amount).toLocaleString('en-US')} sats`
              : `${tx.amount} BCH`

          let usdSuffix = ''
          if (
            !tokenId &&
            typeof tx.usd_price === 'number' &&
            tx.usd_price > 0 &&
            tx.amount != null
          ) {
            const usdValue = tx.amount * tx.usd_price
            if (usdValue > 0) usdSuffix = chalk.dim(` | ≈ ${formatUsd(usdValue)}`)
          }

          const amountColored =
            (isIncoming ? chalk.green(`+${amount}`) : chalk.red(`-${amount}`)) + usdSuffix
          const date = formatDate(tx.tx_timestamp || tx.date_created)
          const explorer = isChipnet
            ? 'https://chipnet.bchexplorer.info/tx/'
            : 'https://bchexplorer.info/tx/'

          console.log(`   ${arrow}  ${amountColored}`)
          console.log(chalk.dim(`         ${date}`))
          console.log(chalk.dim(`         ${shortTxid(tx.txid)}`))
          console.log(chalk.dim(`         ${explorer}${tx.txid}`))
          console.log()
        }

        const tokenFlag = tokenId ? ` --token ${tokenId}` : ''
        console.log(
          chalk.dim(
            `   Page ${view.page} of ${view.numPages}` +
              (view.hasNext
                ? `  —  next: paytaca history --page ${view.page + 1}${tokenFlag}${isChipnet ? ' --chipnet' : ''}`
                : '')
          )
        )
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
        const status = err?.response?.status
        if (status === 404) {
          console.log(
            chalk.yellow(
              '   Wallet not yet registered with Watchtower on this network.'
            )
          )
          console.log(
            chalk.dim(
              '   Run `paytaca wallet create` or `paytaca wallet import` to register.'
            )
          )
        } else {
          console.log(chalk.red(`   Error fetching history: ${err.message || err}`))
          process.exit(1)
        }
        console.log()
      }
    })
}