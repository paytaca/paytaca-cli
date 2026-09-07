/**
 * CLI command: balance
 *
 * Displays the BCH balance for the current wallet.
 * Shows both BCH and satoshi denominations, plus spendable vs total
 * when they differ (e.g. unconfirmed UTXOs).
 *
 * Use --token <category> to display the balance for a specific CashToken.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import { getBchUsdPrice, formatUsd, getUsdPerToken, tokenAmountToUsd } from '../utils/prices.js'

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
    .option('--token <id>', 'Show balance for a specific CashToken category (64-character hex)')
    .option('--sats', 'Display balance in satoshis only')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSatsOnly = Boolean(opts.sats)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const tokenId: string = opts.token || ''

      if (tokenId && !/^[a-fA-F0-9]{64}$/.test(tokenId)) {
        console.log(chalk.red('\nError: Token must be a 64-character hex string.\n'))
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

      try {
        if (tokenId) {
          // ── Token balance ────────────────────────────────────────────
          let tokenName = ''
          let tokenSymbol = ''
          let decimals = 0

          try {
            const info = await bchWallet.getTokenInfo(tokenId)
            if (info) {
              tokenName = info.name !== 'Unknown Token' ? info.name : ''
              tokenSymbol = info.symbol || ''
              decimals = info.decimals || 0
            }
          } catch {
            // Token info unavailable — proceed without metadata
          }

          const label = tokenSymbol || tokenName || 'Token'
          console.log(chalk.bold(`\n   ${label} Balance (${network})\n`))
          console.log(chalk.dim(`   Category: ${tokenId}`))
          if (tokenName) {
            console.log(chalk.dim(`   Name:     ${tokenName}`))
          }

          const result = await bchWallet.getTokenBalance(tokenId)
          const displayBalance = decimals > 0
            ? (result.balance / 10 ** decimals)
            : result.balance
          const unit = tokenSymbol || 'tokens'

          let usdPerToken: number | undefined
          try {
            const p = await getUsdPerToken(tokenId, isChipnet)
            if (p !== null) usdPerToken = p
          } catch {
            // Pricing unavailable — show token only
          }

          console.log(`   Balance:    ${displayBalance} ${unit}`)
          if (usdPerToken !== undefined) {
            const usdValue = tokenAmountToUsd(result.balance, decimals, usdPerToken)
            console.log(
              chalk.dim(`               ≈ ${formatUsd(usdValue)}`)
            )
          }
        } else {
          // ── BCH balance ──────────────────────────────────────────────
          console.log(chalk.bold(`\n   Balance (${network})\n`))

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
            let usdPerBch: number | null = null
            try {
              usdPerBch = await getBchUsdPrice(isChipnet)
            } catch {
              // USD price unavailable — show BCH only
            }
            console.log(`   Balance:    ${result.balance} BCH`)
            if (usdPerBch !== null) {
              console.log(
                chalk.dim(`               ≈ ${formatUsd(result.balance * usdPerBch)}`)
              )
            }
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
