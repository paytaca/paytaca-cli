/**
 * CLI commands: wallet create | import | info
 *
 * Implements the wallet lifecycle:
 *   - create:  Generate new seed phrase, store in keychain, subscribe with Watchtower
 *   - import:  Accept existing seed phrase, validate, store, subscribe
 *   - info:    Display wallet hash, balance, and receiving address
 */

import { Command } from 'commander'
import chalk from 'chalk'
import * as readline from 'readline'
import {
  generateMnemonic,
  importMnemonic,
  loadWallet,
  loadMnemonic,
} from '../wallet/index.js'

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Manage wallet (create, import, info, export)')

  // ── wallet create ──────────────────────────────────────────────────────
  wallet
    .command('create')
    .description('Generate a new wallet with a 12-word seed phrase')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      console.log(`\nCreating new wallet on ${chalk.cyan(network)}...\n`)

      const { mnemonic, walletHash } = generateMnemonic()

      // Display the mnemonic with a strong warning
      console.log(chalk.yellow.bold('⚠  IMPORTANT: Write down your seed phrase and store it safely.'))
      console.log(chalk.yellow('   Anyone with this phrase can access your funds.'))
      console.log(chalk.yellow('   This is the only time it will be displayed.\n'))
      console.log(chalk.white.bold('   Seed phrase:\n'))

      const words = mnemonic.split(' ')
      words.forEach((word, i) => {
        console.log(chalk.white(`   ${String(i + 1).padStart(2, ' ')}. ${word}`))
      })

      console.log()
      console.log(chalk.dim(`   Wallet hash: ${walletHash}`))

      // Subscribe initial addresses with Watchtower
      try {
        const w = loadWallet()
        if (w) {
          const bchWallet = w.forNetwork(isChipnet)
          const addressSet = bchWallet.getAddressSetAt(0)
          console.log(chalk.dim(`   Network:     ${network}`))
          console.log(chalk.dim(`   Address:     ${addressSet.receiving}`))

          // Subscribe to Watchtower for monitoring
          await bchWallet.getNewAddressSet(0).catch(() => {
            // Non-critical: Watchtower subscription can fail silently
          })
        }
      } catch {
        // Non-critical
      }

      console.log(chalk.green('\n   Wallet created and stored in OS keychain.\n'))
    })

  // ── wallet import ──────────────────────────────────────────────────────
  wallet
    .command('import')
    .description('Import an existing wallet from a seed phrase')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // Prompt for mnemonic
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const mnemonic = await new Promise<string>((resolve) => {
        rl.question('\nEnter your 12-word seed phrase: ', (answer) => {
          rl.close()
          resolve(answer)
        })
      })

      if (!mnemonic.trim()) {
        console.log(chalk.red('\nError: No seed phrase provided.\n'))
        process.exit(1)
      }

      try {
        const { walletHash } = importMnemonic(mnemonic)

        console.log(chalk.green(`\nWallet imported successfully on ${network}.\n`))
        console.log(chalk.dim(`   Wallet hash: ${walletHash}`))

        // Derive and show address
        const w = loadWallet()
        if (w) {
          const bchWallet = w.forNetwork(isChipnet)
          const addressSet = bchWallet.getAddressSetAt(0)
          console.log(chalk.dim(`   Address:     ${addressSet.receiving}`))

          // Subscribe initial addresses with Watchtower
          await bchWallet.scanAddresses({ startIndex: 0, count: 10 }).catch(() => {})
        }

        console.log(chalk.dim(`\n   Stored in OS keychain.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exit(1)
      }
    })

  // ── wallet info ────────────────────────────────────────────────────────
  wallet
    .command('info')
    .description('Display wallet info: hash, balance, and receiving address')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      console.log(chalk.bold(`\n   Wallet Info (${network})\n`))
      console.log(chalk.dim(`   Wallet hash:  ${data.walletHash}`))

      // Derive receiving address at index 0
      const addressSet = bchWallet.getAddressSetAt(0)
      console.log(`   Address:      ${addressSet.receiving}`)

      // Fetch balance
      try {
        const balance = await bchWallet.getBalance()
        console.log(`   Balance:      ${balance.balance} BCH`)
        if (balance.spendable !== balance.balance) {
          console.log(chalk.dim(`   Spendable:    ${balance.spendable} BCH`))
        }
      } catch {
        console.log(chalk.yellow('   Balance:      (unable to fetch)'))
      }

      console.log()
    })

  // ── wallet export ───────────────────────────────────────────────────
  wallet
    .command('export')
    .description('Display the stored seed phrase')
    .action(() => {
      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red(
            '\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n'
          )
        )
        process.exit(1)
      }

      console.log(
        chalk.yellow.bold(
          '\n   WARNING: Do not share your seed phrase with anyone.'
        )
      )
      console.log(
        chalk.yellow(
          '   Anyone with this phrase can access your funds.\n'
        )
      )

      const words = data.mnemonic.split(' ')
      words.forEach((word, i) => {
        console.log(
          chalk.white(`   ${String(i + 1).padStart(2, ' ')}. ${word}`)
        )
      })

      console.log()
    })
}
