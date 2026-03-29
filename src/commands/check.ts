/**
 * CLI command: check <url>
 *
 * Check if a URL accepts x402 BCH payments without making the actual request.
 * Useful for AI to determine if payment will be required before committing.
 *
 * Usage:
 *   paytaca check https://api.example.com
 *   paytaca check https://api.example.com --json
 *   paytaca check https://api.example.com --method POST --body '{"query":"hi"}'
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import { LibauthHDWallet } from '../wallet/keys.js'
import { BchWallet } from '../wallet/bch.js'
import { parsePaymentRequired, selectBchPaymentRequirements } from '../utils/x402.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import { PaymentRequired } from '../types/x402.js'

interface CheckOptions {
  method?: string
  header?: string[]
  body?: string
  chipnet: boolean
  json: boolean
}

interface CheckResult {
  url: string
  acceptsX402: boolean
  acceptsBch: boolean
  paymentRequired: boolean
  estimatedCostSats?: string
  costInBch?: string
  paymentUrl?: string
  maxTimeoutMs?: number
  resourceId?: string
  acceptCurrencies?: string[]
  error?: string
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Check if a URL accepts x402 BCH payments')
    .argument('<url>', 'URL to check')
    .option('-X, --method <method>', 'HTTP method to test (default: GET)', 'GET')
    .option('-H, --header <header>', 'Add header to request (repeatable)')
    .option('-d, --body <body>', 'Request body for POST/PUT requests')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output results as JSON')
    .action(async (url: string, opts: CheckOptions) => {
      const isChipnet = Boolean(opts.chipnet)
      const isJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      const data = loadMnemonic()
      if (!data) {
        const err = 'No wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.'
        if (isJson) {
          console.log(JSON.stringify({ url, acceptsX402: false, acceptsBch: false, paymentRequired: false, error: err }))
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

      const headers: Record<string, string> = {}
      if (opts.header) {
        for (const h of opts.header) {
          const idx = h.indexOf(':')
          if (idx === -1) {
            const err = `Invalid header format: ${h}. Expected "Key: Value"`
            if (isJson) {
              console.log(JSON.stringify({ url, acceptsX402: false, acceptsBch: false, error: err }))
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

      if (!isJson) {
        console.log(`\n   ${chalk.bold('CHECK')} ${url}`)
        console.log(chalk.dim(`   Network: ${chalk.cyan(network)}`))
        console.log(chalk.dim(`   Method: ${method}`))
        console.log()
      }

      try {
        const result = await checkUrl(url, method, headers, body, bchWallet, isChipnet)

        if (isJson) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          printCheckResult(result)
        }
      } catch (err: any) {
        const errorResult: CheckResult = {
          url,
          acceptsX402: false,
          acceptsBch: false,
          paymentRequired: false,
          error: err.message || String(err),
        }
        if (isJson) {
          console.log(JSON.stringify(errorResult, null, 2))
        } else {
          console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        }
        process.exit(1)
      }

      if (!isJson) console.log()
    })
}

async function checkUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  bchWallet: BchWallet,
  isChipnet: boolean
): Promise<CheckResult> {
  const result: CheckResult = {
    url,
    acceptsX402: false,
    acceptsBch: false,
    paymentRequired: false,
  }

  const response = await fetch(url, {
    method,
    headers,
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
  })

  result.paymentRequired = response.status === 402

  if (response.status === 402) {
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    const paymentHeaders: PaymentRequired = {}
    for (const [key, value] of Object.entries(responseHeaders)) {
      paymentHeaders[key.toLowerCase()] = value
    }

    const requirements = parsePaymentRequired(paymentHeaders)
    if (requirements) {
      result.acceptsX402 = true
      result.acceptCurrencies = requirements.acceptCurrencies
      result.maxTimeoutMs = requirements.maxTimeoutMs
      result.resourceId = requirements.resourceId

      const bchReqs = selectBchPaymentRequirements(requirements)
      if (bchReqs) {
        result.acceptsBch = true
        result.paymentUrl = bchReqs.paymentUrl
        result.estimatedCostSats = bchReqs.maxAmount.toString()
        result.costInBch = (Number(bchReqs.maxAmount) / 1e8).toFixed(8)
      }
    }
  }

  return result
}

function printCheckResult(result: CheckResult): void {
  if (result.paymentRequired) {
    console.log(chalk.yellow('   Payment Required'))

    if (result.acceptsX402) {
      console.log(chalk.green('   ✓ Accepts x402 protocol'))

      if (result.acceptsBch) {
        console.log(chalk.green(`   ✓ Accepts BCH payment`))
        console.log(chalk.dim(`     Amount: ${result.estimatedCostSats} sats (${result.costInBch} BCH)`))
        console.log(chalk.dim(`     Payment URL: ${result.paymentUrl}`))
        console.log(chalk.dim(`     Timeout: ${result.maxTimeoutMs}ms`))
        console.log(chalk.dim(`     Resource: ${result.resourceId}`))
      } else {
        console.log(chalk.red('   ✗ Does not accept BCH'))
        console.log(chalk.dim(`     Accepted currencies: ${result.acceptCurrencies?.join(', ')}`))
      }
    } else {
      console.log(chalk.red('   ✗ Unknown payment protocol (not x402)'))
    }
  } else {
    console.log(chalk.green('   ✓ No payment required'))
    console.log(chalk.dim(`     Status: ${result.url} is free to access`))
  }
}
