/**
 * CLI command: send <address> <amount>
 *
 * Sends BCH from the wallet to an external address.
 *
 * The transaction flow is identical to paytaca-app:
 *   1. Load mnemonic + walletHash from keychain
 *   2. Create BchWallet with watchtower-cash-js
 *   3. Call watchtower.BCH.send() which handles:
 *      - UTXO fetching from Watchtower API
 *      - Transaction building with libauth
 *      - Signing with HD-derived private keys
 *      - Broadcasting to the BCH network
 *   4. Return txid
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { Address } from 'watchtower-cash-js'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description('Send BCH to an address')
    .argument('<address>', 'Recipient BCH address (CashAddr format)')
    .argument('<amount>', 'Amount to send')
    .option('--unit <unit>', 'Amount unit: bch or sats (default: bch)', 'bch')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (address: string, amountStr: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const unit: string = opts.unit
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // ── Validate wallet ──────────────────────────────────────────────
      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      // ── Parse amount ─────────────────────────────────────────────────
      let amountBch = parseFloat(amountStr)
      if (isNaN(amountBch) || amountBch <= 0) {
        console.log(chalk.red('\nError: Amount must be a positive number.\n'))
        process.exit(1)
      }

      if (unit === 'sats') {
        amountBch = amountBch / 1e8
      } else if (unit !== 'bch') {
        console.log(chalk.red('\nError: Unit must be "bch" or "sats".\n'))
        process.exit(1)
      }

      // ── Validate recipient address ───────────────────────────────────
      const addressValidator = new Address(address)
      if (
        !addressValidator.isValidBCHAddress(isChipnet) &&
        !(addressValidator as any).isP2SH?.() &&
        !(addressValidator as any).isTokenAddress?.()
      ) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      // ── Build and send ───────────────────────────────────────────────
      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      // Use the first receiving address as change address (same as paytaca-app default)
      const changeAddressSet = bchWallet.getAddressSetAt(0)
      const changeAddress = changeAddressSet.change

      console.log(`\n   Sending ${chalk.bold(amountBch + ' BCH')} on ${chalk.cyan(network)}`)
      console.log(chalk.dim(`   To:     ${address}`))
      console.log(chalk.dim(`   Change: ${changeAddress}`))
      console.log()

      try {
        const result = await bchWallet.sendBch(amountBch, address, changeAddress)

        if (result.success) {
          console.log(chalk.green('   Transaction sent successfully!\n'))
          if (result.txid) {
            console.log(`   txid: ${result.txid}`)
            const explorer = isChipnet
              ? 'https://chipnet.chaingraph.cash/tx/'
              : 'https://bchexplorer.info/tx/'
            console.log(chalk.dim(`   ${explorer}${result.txid}`))
          }
        } else {
          console.log(chalk.red(`   Transaction failed: ${result.error || 'Unknown error'}`))
          if (result.lackingSats) {
            console.log(
              chalk.yellow(
                `   Insufficient balance. Short by ${result.lackingSats} satoshis.`
              )
            )
          }
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }

      console.log()
    })
}
