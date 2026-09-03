/**
 * CLI command: swap <tokenId> <amount>
 *
 * Swap a CashToken against BCH through Cauldron pools.
 *
 * Two directions:
 *   - sell (default): sell tokens for BCH
 *   - buy: spend BCH to buy tokens
 *
 * Shows a quote (rate, amounts, trade fee), asks for confirmation, then
 * builds + signs the trade transaction and broadcasts it.
 *
 * Cauldron is a liquidity protocol on Bitcoin Cash. Swaps execute against
 * the active pools advertised by the riften indexer; the trade transaction
 * is built with @cashlab/cauldron's ExchangeLab (libauth templates).
 */

import { Command } from 'commander'
import readline from 'readline'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import {
  executeSwap,
  estimateSwap,
  formatQuote,
  type SwapDirection,
} from '../wallet/cauldron/swap.js'
import { fetchTokenData } from '../wallet/cauldron/api.js'

function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(chalk.bold(`\n   ${message} (y/N): `), (answer) => {
      rl.close()
      const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
      resolve(confirmed)
    })
  })
}

export function registerSwapCommand(program: Command): void {
  program
    .command('swap')
    .description('Swap a CashToken for BCH (sell) or BCH for a CashToken (buy)')
    .argument('<tokenId>', '64-char hex token category to swap')
    .argument('<amount>', 'Token amount (in the token\'s units)')
    .option(
      '--direction <direction>',
      'Swap direction: sell (token→BCH) or buy (BCH→token) (default: sell)',
      'sell'
    )
    .option(
      '--raw',
      'Interpret <amount> as raw base units instead of decimal token units'
    )
    .option('--yes', 'Skip the confirmation prompt')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (tokenId: string, amountStr: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const direction: SwapDirection =
        opts.direction === 'buy' ? 'buy' : 'sell'

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red(
            '\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n'
          )
        )
        process.exit(1)
      }

      if (!/^[a-fA-F0-9]{64}$/.test(tokenId)) {
        console.log(chalk.red('\nError: tokenId must be a 64-char hex token category.\n'))
        process.exit(1)
      }

      const parsedAmount = parseFloat(amountStr)
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.log(chalk.red('\nError: Amount must be a positive number.\n'))
        process.exit(1)
      }

      console.log(chalk.bold(`\n   ${direction === 'buy' ? 'Buying' : 'Selling'} token on ${network}`))
      console.log(chalk.dim(`   Token:  ${tokenId}`))
      console.log()

      try {
        // Resolve token metadata for decimals + symbol
        const tokenData = await fetchTokenData(tokenId)
        if (!tokenData) {
          console.log(chalk.red('\nError: No cauldron token data found for this token.\n'))
          process.exit(1)
        }
        const decimals = tokenData.bcmr.token.decimals
        const symbol = tokenData.bcmr.token.symbol || tokenData.display_symbol

        // Convert decimal amount to base units
        const amount = opts.raw
          ? BigInt(parsedAmount)
          : BigInt(Math.round(parsedAmount * 10 ** decimals))

        // Show quote first
        const quote = await estimateSwap({ tokenId, direction, amount })
        console.log(chalk.cyan('   Quote:'))
        for (const line of formatQuote(quote).split('\n')) {
          console.log(`   ${line}`)
        }
        console.log()

        if (!opts.yes) {
          const confirmed = await promptConfirmation('Confirm swap?')
          if (!confirmed) {
            console.log(chalk.yellow('   Swap cancelled.\n'))
            process.exit(0)
          }
        }

        const w = loadWallet()!
        const bchWallet = w.forNetwork(isChipnet)

        const result = await executeSwap({
          tokenId,
          direction,
          amount,
          bchWallet,
          mnemonic: data.mnemonic,
          derivationPath: BCH_DERIVATION_PATH,
        })

        if (result.success) {
          console.log(chalk.green('\n   Swap successful!\n'))
          if (result.txid) {
            console.log(`   txid: ${result.txid}`)
            const explorer = isChipnet
              ? 'https://chipnet.chaingraph.cash/tx/'
              : 'https://bchexplorer.info/tx/'
            console.log(chalk.dim(`   ${explorer}${result.txid}`))
          }
        } else {
          console.log(chalk.red(`\n   Swap failed: ${result.error || 'Unknown error'}\n`))
          process.exit(1)
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }
    })
}