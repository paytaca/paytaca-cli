/**
 * CLI commands: address derive | list
 *
 * Derives Bitcoin Cash addresses from the stored seed phrase
 * using the HD path m/44'/145'/0'/0/{index} (receiving)
 * and m/44'/145'/0'/1/{index} (change).
 *
 * Use --token to derive token-aware (z-prefix) addresses for CashTokens.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { WalletNotConfiguredError, resolveNetwork, requireWallet } from '../core/context.js'

export function registerAddressCommands(program: Command): void {
  const address = program
    .command('address')
    .description('Derive and list BCH addresses')

  // ── address derive ─────────────────────────────────────────────────────
  address
    .command('derive')
    .description('Derive receiving and change addresses at a given index')
    .argument('[index]', 'Address index (default: 0)', '0')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token', 'Show token-aware (z-prefix) addresses for CashTokens')
    .option('--json', 'Output as JSON')
    .action(async (_index, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const isToken = Boolean(opts.token)
      const asJson = Boolean(opts.json)
      const index = parseInt(_index, 10)

      if (isNaN(index) || index < 0) {
        console.log(chalk.red('\nError: Index must be a non-negative integer.\n'))
        process.exit(1)
      }

      try {
        const ctx = requireWallet(isChipnet)
        const network = resolveNetwork(isChipnet).network
        const addressSet = isToken
          ? ctx.bch.getTokenAddressSetAt(index)
          : ctx.bch.getAddressSetAt(index)

        let subscribed = false
        try {
          subscribed = Boolean(await ctx.bch.getNewAddressSet(index))
        } catch {
          // Non-critical
        }

        if (asJson) {
          console.log(
            JSON.stringify(
              {
                network,
                index,
                token: isToken,
                receiving: addressSet.receiving,
                change: addressSet.change,
                subscribed,
              },
              null,
              2
            )
          )
          return
        }

        const label = isToken ? 'Token address' : 'Address'
        console.log(chalk.bold(`\n   ${label} at index ${index} (${network})\n`))
        console.log(`   Receiving:  ${addressSet.receiving}`)
        console.log(chalk.dim(`   Change:     ${addressSet.change}`))
        if (isToken) console.log(chalk.dim('   Type:       token-aware (z-prefix)'))
        console.log(
          subscribed
            ? chalk.dim('   Watching:   subscribed with Watchtower')
            : chalk.yellow('   Watching:   not subscribed (address may not be monitored)')
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
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }
    })

  // ── address list ───────────────────────────────────────────────────────
  address
    .command('list')
    .description('List derived receiving addresses')
    .option('-n, --count <count>', 'Number of addresses to derive', '5')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token', 'Show token-aware (z-prefix) addresses for CashTokens')
    .option('--json', 'Output as JSON')
    .action((_opts) => {
      const isChipnet = Boolean(_opts.chipnet)
      const isToken = Boolean(_opts.token)
      const asJson = Boolean(_opts.json)
      const count = parseInt(_opts.count, 10)

      if (isNaN(count) || count < 1) {
        console.log(chalk.red('\nError: Count must be a positive integer.\n'))
        process.exit(1)
      }

      try {
        const ctx = requireWallet(isChipnet)
        const network = resolveNetwork(isChipnet).network

        const addresses = []
        for (let i = 0; i < count; i++) {
          const addressSet = isToken
            ? ctx.bch.getTokenAddressSetAt(i)
            : ctx.bch.getAddressSetAt(i)
          addresses.push({
            index: i,
            receiving: addressSet.receiving,
            change: addressSet.change,
          })
        }

        if (asJson) {
          console.log(JSON.stringify({ network, token: isToken, addresses }, null, 2))
          return
        }

        const typeLabel = isToken ? 'Token Addresses' : 'Addresses'
        console.log(chalk.bold(`\n   ${typeLabel} (${network})\n`))
        console.log(chalk.dim(`   ${'Index'.padEnd(8)}${'Receiving Address'}`))
        console.log(chalk.dim(`   ${'─'.repeat(70)}`))

        for (const a of addresses) {
          console.log(`   ${String(a.index).padEnd(8)}${a.receiving}`)
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