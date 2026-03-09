/**
 * CLI commands: address derive | list
 *
 * Derives Bitcoin Cash addresses from the stored seed phrase
 * using the HD path m/44'/145'/0'/0/{index} (receiving)
 * and m/44'/145'/0'/1/{index} (change).
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

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
    .action((_index, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const index = parseInt(_index, 10)

      if (isNaN(index) || index < 0) {
        console.log(chalk.red('\nError: Index must be a non-negative integer.\n'))
        process.exit(1)
      }

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      const addressSet = bchWallet.getAddressSetAt(index)

      console.log(chalk.bold(`\n   Address at index ${index} (${network})\n`))
      console.log(`   Receiving:  ${addressSet.receiving}`)
      console.log(chalk.dim(`   Change:     ${addressSet.change}`))
      console.log()
    })

  // ── address list ───────────────────────────────────────────────────────
  address
    .command('list')
    .description('List derived receiving addresses')
    .option('-n, --count <count>', 'Number of addresses to derive', '5')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action((_opts) => {
      const isChipnet = Boolean(_opts.chipnet)
      const count = parseInt(_opts.count, 10)

      if (isNaN(count) || count < 1) {
        console.log(chalk.red('\nError: Count must be a positive integer.\n'))
        process.exit(1)
      }

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      console.log(chalk.bold(`\n   Addresses (${network})\n`))
      console.log(
        chalk.dim(
          `   ${'Index'.padEnd(8)}${'Receiving Address'}`
        )
      )
      console.log(chalk.dim(`   ${'─'.repeat(70)}`))

      for (let i = 0; i < count; i++) {
        const addressSet = bchWallet.getAddressSetAt(i)
        console.log(`   ${String(i).padEnd(8)}${addressSet.receiving}`)
      }

      console.log()
    })
}
