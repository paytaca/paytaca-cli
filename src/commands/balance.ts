/**
 * CLI command: balance
 *
 * Displays the BCH balance for the current wallet.
 * Shows both BCH and satoshi denominations, plus spendable vs total
 * when they differ (e.g. unconfirmed UTXOs).
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

/** Convert BCH to satoshis (1 BCH = 100,000,000 sats) */
function bchToSats(bch: number): number {
  return Math.round(bch * 1e8)
}

/** Format a number with thousands separators */
function formatSats(sats: number): string {
  return sats.toLocaleString('en-US')
}

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Display wallet balance')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--sats', 'Display balance in satoshis only')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSatsOnly = Boolean(opts.sats)
      const network = isChipnet ? 'chipnet' : 'mainnet'

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

      console.log(chalk.bold(`\n   Balance (${network})\n`))

      try {
        const result = await bchWallet.getBalance()

        const balanceSats = bchToSats(result.balance)
        const spendableSats = bchToSats(result.spendable)

        if (showSatsOnly) {
          console.log(`   Balance:    ${formatSats(balanceSats)} sats`)
          if (result.spendable !== result.balance) {
            console.log(
              chalk.dim(`   Spendable:  ${formatSats(spendableSats)} sats`)
            )
          }
        } else {
          console.log(`   Balance:    ${result.balance} BCH`)
          console.log(
            chalk.dim(`               ${formatSats(balanceSats)} sats`)
          )
          if (result.spendable !== result.balance) {
            console.log(`   Spendable:  ${result.spendable} BCH`)
            console.log(
              chalk.dim(`               ${formatSats(spendableSats)} sats`)
            )
          }
        }
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
            chalk.red(`   Error fetching balance: ${err.message || err}`)
          )
          process.exit(1)
        }
      }

      console.log()
    })
}
