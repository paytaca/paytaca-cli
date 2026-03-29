/**
 * CLI command: pay <url>
 *
 * Makes an HTTP request to a URL, handling x402 payment requirements.
 * If the server returns 402 PAYMENT-REQUIRED, the wallet pays for the request.
 *
 * Flow:
 *   1. Make HTTP request to URL
 *   2. If 402 response, parse PAYMENT-REQUIRED headers
 *   3. Build BCH transaction to pay the required amount
 *   4. Broadcast transaction
 *   5. Retry original request with PAYMENT-SIGNATURE header
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import { LibauthHDWallet } from '../wallet/keys.js'
import { BchWallet } from '../wallet/bch.js'
import { X402Payer } from '../wallet/x402.js'
import { parsePaymentRequired, selectBchPaymentRequirements } from '../utils/x402.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import { PaymentRequired, BchPaymentRequirements } from '../types/x402.js'

interface PayOptions {
  method?: string
  header?: string[]
  body?: string
  chipnet: boolean
  maxAmount?: string
  changeAddress?: string
}

export function registerPayCommand(program: Command): void {
  program
    .command('pay')
    .description('Make a paid HTTP request with BCH payment via x402 protocol')
    .argument('<url>', 'URL to request')
    .option('-X, --method <method>', 'HTTP method (default: GET)', 'GET')
    .option('-H, --header <header>', 'Add header to request (repeatable)')
    .option('-d, --body <body>', 'Request body for POST/PUT requests')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--max-amount <amount>', 'Maximum payment amount in satoshis (overrides server\'s max-amount)')
    .option('--change-address <address>', 'Change address for BCH transaction')
    .action(async (url: string, opts: PayOptions) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const wallet = loadWallet()!
      const bchWallet = wallet.forNetwork(isChipnet)
      const hdWallet = new LibauthHDWallet(
        data.mnemonic,
        BCH_DERIVATION_PATH,
        isChipnet ? 'chipnet' : 'mainnet'
      )

      const x402Payer = new X402Payer({ hdWallet, addressIndex: 0 })

      const headers: Record<string, string> = {}
      if (opts.header) {
        for (const h of opts.header) {
          const idx = h.indexOf(':')
          if (idx === -1) {
            console.log(chalk.red(`\n   Error: Invalid header format: ${h}. Expected "Key: Value"\n`))
            process.exit(1)
          }
          const key = h.substring(0, idx).trim()
          const value = h.substring(idx + 1).trim()
          headers[key] = value
        }
      }

      const method = opts.method?.toUpperCase() || 'GET'
      const body = opts.body

      console.log(`\n   ${chalk.bold(method)} ${url}`)
      console.log(chalk.dim(`   Network: ${chalk.cyan(network)}`))
      console.log(chalk.dim(`   Payer: ${x402Payer.getPayerAddress()}`))
      if (Object.keys(headers).length > 0) {
        console.log(chalk.dim(`   Headers: ${JSON.stringify(headers)}`))
      }
      console.log()

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
        })

        const responseHeaders: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value
        })

        const responseText = await response.text()
        let responseData: any
        try {
          responseData = JSON.parse(responseText)
        } catch {
          responseData = responseText
        }

        if (response.status === 402) {
          console.log(chalk.yellow('   402 PAYMENT REQUIRED'))
          console.log(chalk.dim('   Parsing payment requirements...\n'))

          const paymentHeaders: PaymentRequired = {}
          for (const [key, value] of Object.entries(responseHeaders)) {
            paymentHeaders[key.toLowerCase()] = value
          }

          const requirements = parsePaymentRequired(paymentHeaders)
          if (!requirements) {
            console.log(chalk.red('   Error: Could not parse PAYMENT-REQUIRED headers'))
            process.exit(1)
          }

          const bchRequirements = selectBchPaymentRequirements(requirements)
          if (!bchRequirements) {
            console.log(chalk.red('   Error: Server does not accept BCH payment'))
            console.log(chalk.dim(`   Accepted currencies: ${requirements.acceptCurrencies.join(', ')}`))
            process.exit(1)
          }

          bchRequirements.payer = x402Payer.getPayerAddress()

          const maxAmountSat = opts.maxAmount
            ? BigInt(opts.maxAmount)
            : bchRequirements.maxAmount

          if (bchRequirements.maxAmount > 0n && maxAmountSat > bchRequirements.maxAmount) {
            console.log(
              chalk.yellow(`   Warning: --max-amount (${maxAmountSat}) exceeds server max (${bchRequirements.maxAmount})`)
            )
          }

          console.log(chalk.dim(`   Payment URL: ${bchRequirements.paymentUrl}`))
          console.log(chalk.dim(`   Max timeout: ${bchRequirements.maxTimeoutMs}ms`))
          console.log(chalk.dim(`   Max amount: ${bchRequirements.maxAmount} satoshis`))
          console.log()

          const recipients = [
            {
              address: bchRequirements.paymentUrl.split(':')[1]?.replace(/^\/\//, '') || '',
              amount: bchRequirements.maxAmount,
              currency: 'BCH',
            },
          ]

          if (!recipients[0].address) {
            console.log(chalk.red('   Error: Invalid payment URL in requirements'))
            process.exit(1)
          }

          console.log(chalk.dim(`   Sending payment to: ${recipients[0].address}`))
          console.log(chalk.dim(`   Amount: ${recipients[0].amount} satoshis`))

          const changeAddressSet = bchWallet.getAddressSetAt(0)
          const changeAddress = opts.changeAddress || changeAddressSet.change
          console.log(chalk.dim(`   Change address: ${changeAddress}`))
          console.log()

          console.log(chalk.cyan('   Broadcasting BCH transaction...'))
          const sendResult = await bchWallet.sendBch(
            Number(recipients[0].amount) / 1e8,
            recipients[0].address,
            changeAddress
          )

          if (!sendResult.success) {
            console.log(chalk.red(`   Payment failed: ${sendResult.error}`))
            if (sendResult.lackingSats) {
              console.log(chalk.yellow(`   Insufficient balance. Short by ${sendResult.lackingSats} satoshis.`))
            }
            process.exit(1)
          }

          console.log(chalk.green('   Payment successful!'))
          console.log(chalk.dim(`   txid: ${sendResult.txid}`))
          console.log()

          console.log(chalk.cyan('   Retrying original request with payment...'))

          const authHeader = await x402Payer.createAuthorization(
            bchRequirements,
            {
              scheme: 'utxo',
              network: bchRequirements.network,
              max_timeout_ms: bchRequirements.maxTimeoutMs,
              resource_id: bchRequirements.resourceId,
              payment: {
                scheme: 'utxo',
                network: bchRequirements.network,
                recipients: recipients.map(r => ({
                  address: r.address,
                  amount: r.amount.toString(),
                  currency: r.currency,
                })),
              },
              payer: x402Payer.getPayerAddress(),
            }
          )

          headers['Authorization'] = `x402 ${authHeader}`

          const retryResponse = await fetch(url, {
            method,
            headers,
            body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
          })

          const retryResponseText = await retryResponse.text()
          let retryResponseData: any
          try {
            retryResponseData = JSON.parse(retryResponseText)
          } catch {
            retryResponseData = retryResponseText
          }

          console.log(chalk.green(`\n   Response: ${retryResponse.status} ${retryResponse.statusText}`))
          console.log()
          console.log(formatResponse(retryResponseData))

          if (sendResult.txid) {
            const explorer = isChipnet
              ? 'https://chipnet.chaingraph.cash/tx/'
              : 'https://bchexplorer.info/tx/'
            console.log(chalk.dim(`   Payment txid: ${explorer}${sendResult.txid}`))
          }
        } else {
          console.log(chalk.green(`   Response: ${response.status} ${response.statusText}`))
          console.log()
          console.log(formatResponse(responseData))
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }

      console.log()
    })
}

function formatResponse(data: any): string {
  if (typeof data === 'string') return data
  if (typeof data === 'object') {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }
  return String(data)
}
