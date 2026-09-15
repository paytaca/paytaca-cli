/**
 * CLI command: balance
 *
 * Displays the BCH balance for the current wallet.
 * Shows both BCH and satoshi denominations, plus spendable vs total
 * when they differ (e.g. unconfirmed UTXOs).
 *
 *   (default)            BCH balance only
 *   --token <category>   balance for a specific CashToken
 *   --tokens             CashToken balances only (positive balances)
 *   --all                BCH and CashToken balances
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { WalletNotConfiguredError } from '../core/context.js'
import {
  getBalanceView,
  getTokenBalances,
  getTokenDetail,
  type BalanceView,
  type TokenBalanceView,
} from '../core/wallet.js'
import { formatSats } from '../utils/format.js'
import { formatUsd } from '../utils/prices.js'

function printBchBalance(balance: BalanceView, showSatsOnly: boolean): void {
  if (showSatsOnly) {
    console.log(`   Balance:    ${formatSats(balance.balanceSats)} sats`)
    if (balance.spendableBch !== balance.balanceBch) {
      console.log(chalk.dim(`   Spendable:  ${formatSats(balance.spendableSats)} sats`))
    }
    return
  }

  console.log(`   Balance:    ${balance.balanceBch} BCH`)
  if (balance.usd !== null) {
    console.log(chalk.dim(`               ≈ ${formatUsd(balance.usd)}`))
  }
}

function printTokenBalances(tokens: TokenBalanceView[]): void {
  if (tokens.length === 0) {
    console.log(chalk.dim('   No CashTokens with a positive balance.\n'))
    return
  }

  let totalUsd = 0
  let pricedCount = 0

  console.log(chalk.dim('   Tokens:'))

  for (const t of tokens) {
    const symbol = t.symbol ? ` ${t.symbol}` : ''
    const name = t.name !== 'Unknown Token' ? t.name : ''

    console.log(`   ${chalk.bold(t.displayBalance + symbol)}`)
    if (name) console.log(chalk.dim(`   ${name}`))
    console.log(chalk.dim(`   ${t.category}`))
    if (t.usd !== null) {
      totalUsd += t.usd
      pricedCount += 1
      console.log(chalk.green(`   ≈ ${formatUsd(t.usd)}`))
    }
    console.log()
  }

  console.log(
    chalk.dim(`   ${tokens.length} token${tokens.length !== 1 ? 's' : ''} with balance`)
  )
  if (pricedCount > 0) {
    console.log(chalk.bold(`   Total: ${formatUsd(totalUsd)}`))
  }
}

function handleError(err: any): void {
  if (err instanceof WalletNotConfiguredError) {
    console.log(chalk.red(`\n${err.message}\n`))
    process.exit(1)
  }
  const status = err?.response?.status
  if (status === 404) {
    console.log(
      chalk.yellow('   Wallet not yet registered with Watchtower on this network.')
    )
    console.log(
      chalk.dim('   Run `paytaca wallet create` or `paytaca wallet import` to register.')
    )
    return
  }
  console.log(chalk.red(`   Error fetching balance: ${err.message || err}`))
  process.exit(1)
}

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Display wallet balance')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token <id>', 'Show balance for a specific CashToken category (64-character hex)')
    .option('--tokens', 'Show CashToken balances only (excludes BCH)')
    .option('--all', 'Show BCH and CashToken balances')
    .option('--sats', 'Display BCH balance in satoshis only')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSatsOnly = Boolean(opts.sats)
      const showTokens = Boolean(opts.tokens)
      const showAll = Boolean(opts.all)
      const asJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const tokenId: string = opts.token || ''

      if (tokenId && !/^[a-fA-F0-9]{64}$/.test(tokenId)) {
        console.log(chalk.red('\nError: Token must be a 64-character hex string.\n'))
        process.exit(1)
      }

      if (showTokens && showAll) {
        console.log(chalk.red('\nError: --tokens and --all cannot be used together.\n'))
        process.exit(1)
      }

      if (tokenId && (showTokens || showAll)) {
        console.log(
          chalk.red('\nError: --token cannot be combined with --tokens or --all.\n')
        )
        process.exit(1)
      }

      try {
        if (tokenId) {
          const detail = await getTokenDetail(tokenId, isChipnet)
          if (asJson) {
            console.log(JSON.stringify(detail, null, 2))
            return
          }
          const label = detail.symbol || (detail.name !== 'Unknown Token' ? detail.name : '') || 'Token'
          console.log(chalk.bold(`\n   ${label} Balance (${network})\n`))
          console.log(chalk.dim(`   Category: ${tokenId}`))
          if (detail.name !== 'Unknown Token') {
            console.log(chalk.dim(`   Name:     ${detail.name}`))
          }
          const unit = detail.symbol || 'tokens'
          console.log(`   Balance:    ${detail.displayBalance} ${unit}`)
          if (detail.usd !== null) {
            console.log(chalk.dim(`               ≈ ${formatUsd(detail.usd)}`))
          }
          console.log()
          return
        }

        if (showTokens || showAll) {
          const tokenResult = await getTokenBalances(isChipnet)
          const balance = showAll ? await getBalanceView(isChipnet) : null

          if (asJson) {
            console.log(
              JSON.stringify(
                showAll ? { balance, tokens: tokenResult.tokens } : tokenResult.tokens,
                null,
                2
              )
            )
            return
          }

          const title = showAll ? 'Balances' : 'Token Balances'
          console.log(chalk.bold(`\n   ${title} (${network})\n`))
          if (balance) {
            printBchBalance(balance, showSatsOnly)
            console.log()
          }
          printTokenBalances(tokenResult.tokens)
          console.log()
          return
        }

        const balance = await getBalanceView(isChipnet)
        if (asJson) {
          console.log(JSON.stringify(balance, null, 2))
          return
        }

        console.log(chalk.bold(`\n   Balance (${network})\n`))
        printBchBalance(balance, showSatsOnly)
        console.log()
      } catch (err: any) {
        if (asJson) {
          console.log(JSON.stringify({ error: err.message || String(err) }, null, 2))
          process.exit(1)
        }
        handleError(err)
      }
    })
}