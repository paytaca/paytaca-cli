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
  dryRun: boolean
  json: boolean
}

interface DryRunInfo {
  url: string
  method: string
  willRequirePayment: boolean
  payment?: {
    acceptsBch: boolean
    paymentUrl: string
    amountSats: string
    maxTimeoutMs: number
    resourceId: string
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
  }
  error?: string
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
    .option('--dry-run', 'Show what would happen without making payment')
    .option('--json', 'Output results as JSON')
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
        await runPayHuman(url, method, headers, body, opts, x402Payer, bchWallet, isChipnet)
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
  isChipnet: boolean
): Promise<void> {
  const network = isChipnet ? 'chipnet' : 'mainnet'

  console.log(`\n   ${chalk.bold(method)} ${url}`)
  console.log(chalk.dim(`   Network: ${chalk.cyan(network)}`))
  console.log(chalk.dim(`   Payer: ${x402Payer.getPayerAddress()}`))
  if (Object.keys(headers).length > 0) {
    console.log(chalk.dim(`   Headers: ${JSON.stringify(headers)}`))
  }
  console.log()

  try {
    const result = await executePay(url, method, headers, body, opts, x402Payer, bchWallet, false)

    if (result.payment?.required && result.payment.txid) {
      const explorer = isChipnet
        ? 'https://chipnet.chaingraph.cash/tx/'
        : 'https://bchexplorer.info/tx/'
      console.log(chalk.dim(`   Payment txid: ${explorer}${result.payment.txid}`))
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
  console.log(chalk.dim(`   Payer: ${x402Payer.getPayerAddress()}`))
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

    if (response.status === 402) {
      dryRunInfo.willRequirePayment = true

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

      const changeAddressSet = bchWallet.getAddressSetAt(0)
      const changeAddress = opts.changeAddress || changeAddressSet.change
      const amountSats = bchRequirements.maxAmount.toString()

      dryRunInfo.payment = {
        acceptsBch: true,
        paymentUrl: bchRequirements.paymentUrl,
        amountSats,
        maxTimeoutMs: bchRequirements.maxTimeoutMs,
        resourceId: bchRequirements.resourceId,
        payerAddress: x402Payer.getPayerAddress(),
        changeAddress,
        network: bchRequirements.network,
      }

      try {
        const balanceResult = await bchWallet.getBalance()
        const available = (balanceResult.spendable * 1e8).toFixed(0)
        const required = amountSats
        const sufficient = BigInt(available) >= BigInt(required)

        dryRunInfo.balanceCheck = {
          available,
          required,
          sufficient,
        }

        console.log(chalk.yellow('   402 PAYMENT REQUIRED'))
        console.log(chalk.dim('   Payment details:'))
        console.log(chalk.dim(`     URL:        ${bchRequirements.paymentUrl}`))
        console.log(chalk.dim(`     Amount:     ${amountSats} sats (${(Number(amountSats) / 1e8).toFixed(8)} BCH)`))
        console.log(chalk.dim(`     Timeout:    ${bchRequirements.maxTimeoutMs}ms`))
        console.log(chalk.dim(`     Resource:   ${bchRequirements.resourceId}`))
        console.log()
        console.log(chalk.dim('   Wallet:'))
        console.log(chalk.dim(`     Payer:      ${x402Payer.getPayerAddress()}`))
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
  skipPayment: boolean
): Promise<JsonResult> {
  const isChipnet = Boolean(opts.chipnet)

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
    const paymentHeaders: PaymentRequired = {}
    for (const [key, value] of Object.entries(responseHeaders)) {
      paymentHeaders[key.toLowerCase()] = value
    }

    const requirements = parsePaymentRequired(paymentHeaders)
    if (!requirements) {
      return { success: false, status: 402, error: 'Could not parse PAYMENT-REQUIRED headers' }
    }

    const bchRequirements = selectBchPaymentRequirements(requirements)
    if (!bchRequirements) {
      return {
        success: false,
        status: 402,
        error: 'Server does not accept BCH payment',
        data: { acceptCurrencies: requirements.acceptCurrencies },
      }
    }

    if (skipPayment) {
      return {
        success: true,
        status: 402,
        payment: { required: true },
      }
    }

    bchRequirements.payer = x402Payer.getPayerAddress()

    const recipients = [
      {
        address: bchRequirements.paymentUrl.split(':')[1]?.replace(/^\/\//, '') || '',
        amount: bchRequirements.maxAmount,
        currency: 'BCH',
      },
    ]

    if (!recipients[0].address) {
      return { success: false, status: 402, error: 'Invalid payment URL in requirements' }
    }

    const changeAddressSet = bchWallet.getAddressSetAt(0)
    const changeAddress = opts.changeAddress || changeAddressSet.change

    const sendResult = await bchWallet.sendBch(
      Number(recipients[0].amount) / 1e8,
      recipients[0].address,
      changeAddress
    )

    if (!sendResult.success) {
      return {
        success: false,
        status: 402,
        payment: { required: true, error: sendResult.error },
        error: sendResult.error,
      }
    }

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
      payment: { required: true, txid: sendResult.txid },
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
