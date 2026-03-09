/**
 * CLI command: history
 *
 * Displays transaction history for the current wallet.
 * Fetches paginated records from the Watchtower API, showing
 * direction (incoming/outgoing), amount, date, and txid.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

/** Convert BCH to satoshis (1 BCH = 100,000,000 sats) */
function bchToSats(bch: number): number {
  return Math.round(bch * 1e8)
}

/** Format a date string to a concise local representation */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return isoDate
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Truncate a txid for display */
function shortTxid(txid: string): string {
  if (txid.length <= 20) return txid
  return txid.slice(0, 10) + '...' + txid.slice(-10)
}

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
    .option('--sats', 'Display amounts in satoshis')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSats = Boolean(opts.sats)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const page = parseInt(opts.page, 10)
      const recordType: string = opts.type

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

      console.log(chalk.bold(`\n   Transaction History (${network})\n`))

      try {
        const result = await bchWallet.getHistory({ page, recordType })

        if (!result.history || result.history.length === 0) {
          console.log(chalk.dim('   No transactions found.\n'))
          return
        }

        // ── Table header ───────────────────────────────────────────────
        const explorer = isChipnet
          ? 'https://chipnet.chaingraph.cash/tx/'
          : 'https://bchexplorer.info/tx/'

        for (const tx of result.history) {
          const isIncoming = tx.record_type === 'incoming'
          const arrow = isIncoming
            ? chalk.green('  IN')
            : chalk.red(' OUT')

          const amount = showSats
            ? `${bchToSats(tx.amount).toLocaleString('en-US')} sats`
            : `${tx.amount} BCH`

          const amountColored = isIncoming
            ? chalk.green(`+${amount}`)
            : chalk.red(`-${amount}`)

          const date = formatDate(tx.tx_timestamp || tx.date_created)

          console.log(`   ${arrow}  ${amountColored}`)
          console.log(chalk.dim(`         ${date}`))
          console.log(chalk.dim(`         ${shortTxid(tx.txid)}`))
          console.log(chalk.dim(`         ${explorer}${tx.txid}`))
          console.log()
        }

        // ── Pagination info ────────────────────────────────────────────
        const pageNum = parseInt(result.page, 10) || page
        console.log(
          chalk.dim(
            `   Page ${pageNum} of ${result.num_pages}` +
              (result.has_next
                ? `  —  next: paytaca history --page ${pageNum + 1}${isChipnet ? ' --chipnet' : ''}`
                : '')
          )
        )
      } catch (err: any) {
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
          console.log(
            chalk.red(`   Error fetching history: ${err.message || err}`)
          )
          process.exit(1)
        }
      }

      console.log()
    })
}
