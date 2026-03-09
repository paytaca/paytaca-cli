/**
 * CLI command: receive
 *
 * Displays a receiving address and its QR code for accepting BCH payments.
 * The QR code encodes the address in CashAddr format, rendered directly
 * in the terminal using Unicode block characters.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import qrcode from 'qrcode-terminal'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

export function registerReceiveCommand(program: Command): void {
  program
    .command('receive')
    .description('Display receiving address and QR code')
    .argument('[index]', 'Address index (default: 0)', '0')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--no-qr', 'Hide QR code, show address only')
    .action((_index, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showQr = opts.qr !== false
      const index = parseInt(_index, 10)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (isNaN(index) || index < 0) {
        console.log(
          chalk.red('\nError: Index must be a non-negative integer.\n')
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
      const addressSet = bchWallet.getAddressSetAt(index)
      const address = addressSet.receiving

      console.log(chalk.bold(`\n   Receive BCH (${network})\n`))
      console.log(`   Address:  ${address}`)
      console.log(chalk.dim(`   Index:    ${index}`))

      if (showQr) {
        console.log()
        qrcode.generate(address, { small: true }, (qr: string) => {
          // Indent QR code for alignment with the rest of the output
          const indented = qr
            .split('\n')
            .map((line) => '   ' + line)
            .join('\n')
          console.log(indented)
        })
      }

      console.log()
    })
}
