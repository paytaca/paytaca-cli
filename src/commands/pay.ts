/**
 * CLI command: pay <url>
 *
 * Makes an HTTP request to a URL, handling x402-bch v2.2 payment requirements.
 * If the server returns 402 PAYMENT-REQUIRED, the wallet pays for the request.
 *
 * Flow:
 *   1. Make HTTP request to URL
 *   2. If 402 response, parse PaymentRequired JSON body
 *   3. Build BCH transaction to pay the required amount
 *   4. Broadcast transaction
 *   5. Build PaymentPayload per x402-bch v2.2 spec
 *   6. Retry original request with PAYMENT-SIGNATURE header containing JSON PayloadPayload
 */

import { Command } from 'commander'
import chalk from 'chalk'
import readline from 'readline'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import { LibauthHDWallet } from '../wallet/keys.js'
import { BchWallet } from '../wallet/bch.js'
import { X402Payer } from '../wallet/x402.js'
import { parsePaymentRequiredJson, selectBchPaymentRequirements } from '../utils/x402.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import { PaymentRequired, PaymentRequirements, BCH_ASSET_ID } from '../types/x402.js'

interface PayOptions {
  method?: string
  header?: string[]
  body?: string
  chipnet: boolean
  maxAmount?: string
  changeAddress?: string
  payer?: string
  dryRun: boolean
  json: boolean
  confirmed: boolean
}

interface DryRunInfo {
  url: string
  method: string
  willRequirePayment: boolean
  payment?: {
    acceptsBch: boolean
    paymentUrl: string
    amountSats: string
    maxTimeoutSeconds: number
    resourceUrl: string
    payerAddress: string
    changeAddress: string
    network: string
  }
  balanceCheck?: {
    available: string
    required: string
    sufficient: boolean
  }
}

interface JsonResult {
  success: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  data?: any
  payment?: {
    required: boolean
    txid?: string
    error?: string
    recipientAddress?: string
  }
  error?: string
}

export function registerPayCommand(program: Command): void {
  program
    .command('pay')
    .description('Make a paid HTTP request with BCH payment via x402-bch v2.2 protocol')
    .argument('<url>', 'URL to request')
    .option('-X, --method <method>', 'HTTP method (default: GET)', 'GET')
    .option('-H, --header <header>', 'Add header to request (repeatable)')
    .option('-d, --body <body>', 'Request body for POST/PUT requests')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--max-amount <amount>', 'Maximum payment amount in satoshis (overrides server\'s max-amount)')
    .option('--change-address <address>', 'Change address for BCH transaction')
    .option('--payer <value>', 'Payer identifier (defaults to wallet address index 0, or pass custom value like user ID for server-side lookups)')
    .option('--dry-run', 'Show what would happen without making payment')
    .option('--json', 'Output results as JSON')
    .option('--confirmed', 'Skip confirmation prompt (prior approval already obtained via paytaca check)')
    .action(async (url: string, opts: PayOptions) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const isJson = Boolean(opts.json)
      const isDryRun = Boolean(opts.dryRun)

      const data = loadMnemonic()
      if (!data) {
        const err = 'No wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.'
        if (isJson) {
          console.log(JSON.stringify({ success: false, error: err }))
        } else {
          console.log(chalk.red(`\n${err}\n`))
        }
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
            const err = `Invalid header format: ${h}. Expected "Key: Value"`
            if (isJson) {
              console.log(JSON.stringify({ success: false, error: err }))
            } else {
              console.log(chalk.red(`\n   Error: ${err}\n`))
            }
            process.exit(1)
          }
          const key = h.substring(0, idx).trim()
          const value = h.substring(idx + 1).trim()
          headers[key] = value
        }
      }

      const method = opts.method?.toUpperCase() || 'GET'
      const body = opts.body

      if (isJson) {
        await runPayJson(url, method, headers, body, opts, x402Payer, bchWallet, isChipnet)
      } else if (isDryRun) {
        await runPayDryRun(url, method, headers, body, opts, x402Payer, bchWallet, isChipnet)
      } else {
        await runPayHuman(url, method, headers, body, opts, x402Payer, bchWallet, isChipnet, opts.confirmed)
      }
    })
}

async function runPayHuman(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  opts: PayOptions,
  x402Payer: X402Payer,
  bchWallet: BchWallet,
  isChipnet: boolean,
  confirmed: boolean = false
): Promise<void> {
  const network = isChipnet ? 'chipnet' : 'mainnet'

  console.log(`\n   ${chalk.bold(method)} ${url}`)
  console.log(chalk.dim(`   Network: ${chalk.cyan(network)}`))
  console.log(chalk.dim(`   Payer: ${opts.payer || x402Payer.getPayerAddress()}`))
  if (Object.keys(headers).length > 0) {
    console.log(chalk.dim(`   Headers: ${JSON.stringify(headers)}`))
  }
  console.log()

  try {
    const result = await executePay(url, method, headers, body, opts, x402Payer, bchWallet, false, confirmed)

    if (result.payment?.required && result.payment.txid) {
      const explorer = isChipnet
        ? 'https://chipnet.chaingraph.cash/tx/'
        : 'https://bchexplorer.info/tx/'
      console.log(chalk.dim(`   Payment txid: ${explorer}${result.payment.txid}`))
      if (result.payment.recipientAddress) {
        console.log(chalk.dim(`   Recipient:   ${result.payment.recipientAddress}`))
      }
    }

    console.log(chalk.green(`\n   Response: ${result.status} ${result.statusText}`))
    console.log()
    console.log(formatResponse(result.data))
  } catch (err: any) {
    console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
    process.exit(1)
  }

  console.log()
}

async function runPayDryRun(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  opts: PayOptions,
  x402Payer: X402Payer,
  bchWallet: BchWallet,
  isChipnet: boolean
): Promise<void> {
  const network = isChipnet ? 'chipnet' : 'mainnet'
  const dryRunInfo: DryRunInfo = {
    url,
    method,
    willRequirePayment: false,
  }

  console.log(`\n   ${chalk.bold(method)} ${url} ${chalk.dim('[DRY RUN]')}`)
  console.log(chalk.dim(`   Network: ${chalk.cyan(network)}`))
  console.log(chalk.dim(`   Payer: ${opts.payer || x402Payer.getPayerAddress()}`))
  console.log()

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
    })

    if (response.status === 402) {
      dryRunInfo.willRequirePayment = true

      const responseBody = await response.json()
      const paymentRequired = parsePaymentRequiredJson(responseBody)

      if (!paymentRequired) {
        console.log(chalk.red('   Error: Could not parse PaymentRequired from 402 response body'))
        process.exit(1)
      }

      const requirements = selectBchPaymentRequirements(paymentRequired, isChipnet ? 'chipnet' : 'mainnet')
      if (!requirements) {
        console.log(chalk.red('   Error: Server does not accept BCH payment'))
        const acceptedSchemes = paymentRequired.accepts.map(a => `${a.scheme}:${a.network}`).join(', ')
        console.log(chalk.dim(`   Accepted schemes: ${acceptedSchemes}`))
        process.exit(1)
      }

      const changeAddressSet = bchWallet.getAddressSetAt(0)
      const changeAddress = opts.changeAddress || changeAddressSet.change

      dryRunInfo.payment = {
        acceptsBch: true,
        paymentUrl: requirements.payTo,
        amountSats: requirements.amount,
        maxTimeoutSeconds: requirements.maxTimeoutSeconds,
        resourceUrl: paymentRequired.resource.url,
        payerAddress: opts.payer || x402Payer.getPayerAddress(),
        changeAddress,
        network: requirements.network,
      }

      try {
        const balanceResult = await bchWallet.getBalance()
        const available = (balanceResult.spendable * 1e8).toFixed(0)
        const required = requirements.amount
        const sufficient = BigInt(available) >= BigInt(required)

        dryRunInfo.balanceCheck = {
          available,
          required,
          sufficient,
        }

        console.log(chalk.yellow('   402 PAYMENT REQUIRED'))
        console.log(chalk.dim('   Payment details:'))
        console.log(chalk.dim(`     PayTo:      ${requirements.payTo}`))
        console.log(chalk.dim(`     Amount:     ${requirements.amount} sats (${(Number(requirements.amount) / 1e8).toFixed(8)} BCH)`))
        console.log(chalk.dim(`     Timeout:    ${requirements.maxTimeoutSeconds}s`))
        console.log(chalk.dim(`     Resource:   ${paymentRequired.resource.url}`))
        console.log()
        console.log(chalk.dim('   Wallet:'))
        console.log(chalk.dim(`     Payer:     ${opts.payer || x402Payer.getPayerAddress()}`))
        console.log(chalk.dim(`     Change:     ${changeAddress}`))
        console.log()
        if (sufficient) {
          console.log(chalk.green(`   Balance OK: ${available} sats available, ${required} sats required`))
        } else {
          console.log(chalk.red(`   Insufficient: ${available} sats available, ${required} sats required`))
        }
      } catch (balanceErr) {
        console.log(chalk.dim(`   (Could not check balance: ${(balanceErr as Error).message})`))
      }
    } else {
      console.log(chalk.green(`   Response: ${response.status} ${response.statusText} (no payment required)`))
    }

    console.log()
    console.log(chalk.dim('   To execute: paytaca pay ' + url))
  } catch (err: any) {
    console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
    process.exit(1)
  }
}

async function runPayJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  opts: PayOptions,
  x402Payer: X402Payer,
  bchWallet: BchWallet,
  isChipnet: boolean
): Promise<void> {
  try {
    const result = await executePay(url, method, headers, body, opts, x402Payer, bchWallet, false)
    console.log(JSON.stringify(result, null, 2))
  } catch (err: any) {
    const errorResult: JsonResult = { success: false, error: err.message || String(err) }
    console.log(JSON.stringify(errorResult, null, 2))
    process.exit(1)
  }
}

async function executePay(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  opts: PayOptions,
  x402Payer: X402Payer,
  bchWallet: BchWallet,
  skipPayment: boolean,
  confirmed: boolean = false
): Promise<JsonResult> {
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
    const paymentRequired = parsePaymentRequiredJson(responseData)
    if (!paymentRequired) {
      return { success: false, status: 402, error: 'Could not parse PaymentRequired from 402 response body' }
    }

    const requirements = selectBchPaymentRequirements(paymentRequired, opts.chipnet ? 'chipnet' : 'mainnet')
    if (!requirements) {
      return {
        success: false,
        status: 402,
        error: 'Server does not accept BCH payment',
        data: { acceptedSchemes: paymentRequired.accepts.map(a => ({ scheme: a.scheme, network: a.network })) },
      }
    }

    if (skipPayment) {
      return {
        success: true,
        status: 402,
        payment: { required: true },
      }
    }

    const payerAddress = opts.payer || x402Payer.getPayerAddress()

    const address = requirements.payTo

    const amountBch = Number(requirements.amount) / 1e8

    const changeAddressSet = bchWallet.getAddressSetAt(0)
    const changeAddress = opts.changeAddress || changeAddressSet.change

    console.log(chalk.yellow('\n   ⚠ Payment Required'))
    console.log(chalk.dim(`   Amount:     ${amountBch} BCH (${requirements.amount} sats)`))
    console.log(chalk.dim(`   To:         ${address}`))
    console.log(chalk.dim(`   Change:     ${changeAddress}`))
    console.log(chalk.dim(`   Payer:      ${payerAddress}`))

    const userConfirmed = confirmed || await promptConfirmation('Confirm payment?')
    if (!userConfirmed) {
      return {
        success: false,
        status: 402,
        payment: { required: true, error: 'Payment rejected by user' },
        error: 'Payment rejected by user',
      }
    }

    const sendResult = await bchWallet.sendBch(amountBch, address, changeAddress)

    if (!sendResult.success) {
      return {
        success: false,
        status: 402,
        payment: { required: true, error: sendResult.error },
        error: sendResult.error,
      }
    }

    const txid = sendResult.txid!

    const paymentPayload = await x402Payer.createPaymentPayload(
      requirements,
      paymentRequired.resource.url,
      txid,
      0,
      requirements.amount
    )

    headers['PAYMENT-SIGNATURE'] = JSON.stringify(paymentPayload)

    const retryResponse = await fetch(url, {
      method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
    })

    const retryResponseHeaders: Record<string, string> = {}
    retryResponse.headers.forEach((value, key) => {
      retryResponseHeaders[key] = value
    })

    const retryResponseText = await retryResponse.text()
    let retryResponseData: any
    try {
      retryResponseData = JSON.parse(retryResponseText)
    } catch {
      retryResponseData = retryResponseText
    }

    return {
      success: retryResponse.ok,
      status: retryResponse.status,
      statusText: retryResponse.statusText,
      headers: retryResponseHeaders,
      data: retryResponseData,
      payment: { required: true, txid, recipientAddress: address },
    }
  }

  return {
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    data: responseData,
    payment: { required: false },
  }
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

async function promptConfirmation(message: string): Promise<boolean> {
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
