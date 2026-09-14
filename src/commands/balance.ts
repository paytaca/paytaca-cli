/**
 * CLI command: balance
 *
 * Displays the BCH balance for the current wallet.
 * Shows both BCH and satoshi denominations, plus spendable vs total
 * when they differ (e.g. unconfirmed UTXOs).
 *
 *   (default)            BCH balance only
 *   --token <category>   balance for a specific CashToken
 *   --tokens             CashToken balances only (positive balances)
 *   --all                BCH and CashToken balances
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadWallet, loadMnemonic } from '../wallet/index.js'
import type { BchWallet } from '../wallet/bch.js'
import {
  getBchUsdPrice,
  formatUsd,
  fetchAssetPrices,
  getUsdPerToken,
  tokenAmountToUsd,
} from '../utils/prices.js'

/** Convert BCH to satoshis (1 BCH = 100,000,000 sats) */
function bchToSats(bch: number): number {
  return Math.round(bch * 1e8)
}

/** Format a number with thousands separators */
function formatSats(sats: number): string {
  return sats.toLocaleString('en-US')
}

/** Format a token amount with decimals */
function formatTokenAmount(rawAmount: number, decimals: number): string {
  if (decimals === 0) return rawAmount.toLocaleString('en-US')
  const scaled = rawAmount / Math.pow(10, decimals)
  return scaled.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

/** Print the BCH balance (BCH + USD, or sats with --sats). */
async function showBchBalance(
  bchWallet: BchWallet,
  isChipnet: boolean,
  showSatsOnly: boolean
): Promise<void> {
  const result = await bchWallet.getBalance()

  const balanceSats = bchToSats(result.balance)
  const spendableSats = bchToSats(result.spendable)

  if (showSatsOnly) {
    console.log(`   Balance:    ${formatSats(balanceSats)} sats`)
    if (result.spendable !== result.balance) {
      console.log(chalk.dim(`   Spendable:  ${formatSats(spendableSats)} sats`))
    }
    return
  }

  let usdPerBch: number | null = null
  try {
    usdPerBch = await getBchUsdPrice(isChipnet)
  } catch {
    // USD price unavailable — show BCH only
  }

  console.log(`   Balance:    ${result.balance} BCH`)
  if (usdPerBch !== null) {
    console.log(
      chalk.dim(`               ≈ ${formatUsd(result.balance * usdPerBch)}`)
    )
  }
}

/** Print CashToken balances, excluding tokens with a zero balance. */
async function showTokenBalances(
  bchWallet: BchWallet,
  isChipnet: boolean
): Promise<void> {
  const tokens = (await bchWallet.getFungibleTokens()).filter((t) => t.balance > 0)

  if (tokens.length === 0) {
    console.log(chalk.dim('   No CashTokens with a positive balance.\n'))
    return
  }

  // Fetch USD prices for all held tokens (batched by the util)
  const prices = new Map<string, number>()
  try {
    const priceData = await fetchAssetPrices(
      tokens.map((t) => `ct/${t.category}`),
      ['USD'],
      isChipnet
    )
    for (const p of priceData) {
      if (String(p.currency || '').toLowerCase() !== 'usd') continue
      const catMatch = String(p.asset || '').match(/^ct\/([a-fA-F0-9]+)$/)
      if (!catMatch) continue
      const raw = parseFloat(p.price_value)
      if (!isFinite(raw) || raw === 0) continue
      prices.set(catMatch[1], 1 / raw)
    }
  } catch {
    // Pricing unavailable — proceed without USD values
  }

  let totalUsd = 0
  let pricedCount = 0

  console.log(chalk.dim('   Tokens:'))

  for (const t of tokens) {
    const amount = formatTokenAmount(t.balance, t.decimals)
    const symbol = t.symbol ? ` ${t.symbol}` : ''
    const name = t.name !== 'Unknown Token' ? t.name : ''
    const usdPerToken = prices.get(t.category)

    console.log(`   ${chalk.bold(amount + symbol)}`)
    if (name) {
      console.log(chalk.dim(`   ${name}`))
    }
    console.log(chalk.dim(`   ${t.category}`))
    if (usdPerToken !== undefined) {
      const usdValue = tokenAmountToUsd(t.balance, t.decimals, usdPerToken)
      totalUsd += usdValue
      pricedCount += 1
      console.log(chalk.green(`   ≈ ${formatUsd(usdValue)}`))
    }
    console.log()
  }

  console.log(
    chalk.dim(`   ${tokens.length} token${tokens.length !== 1 ? 's' : ''} with balance`)
  )
  if (pricedCount > 0) {
    console.log(chalk.bold(`   Total: ${formatUsd(totalUsd)}`))
  }
}

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Display wallet balance')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--token <id>', 'Show balance for a specific CashToken category (64-character hex)')
    .option('--tokens', 'Show CashToken balances only (excludes BCH)')
    .option('--all', 'Show BCH and CashToken balances')
    .option('--sats', 'Display BCH balance in satoshis only')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const showSatsOnly = Boolean(opts.sats)
      const showTokens = Boolean(opts.tokens)
      const showAll = Boolean(opts.all)
      const network = isChipnet ? 'chipnet' : 'mainnet'
      const tokenId: string = opts.token || ''

      if (tokenId && !/^[a-fA-F0-9]{64}$/.test(tokenId)) {
        console.log(chalk.red('\nError: Token must be a 64-character hex string.\n'))
        process.exit(1)
      }

      if (showTokens && showAll) {
        console.log(chalk.red('\nError: --tokens and --all cannot be used together.\n'))
        process.exit(1)
      }

      if (tokenId && (showTokens || showAll)) {
        console.log(
          chalk.red('\nError: --token cannot be combined with --tokens or --all.\n')
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

      try {
        if (tokenId) {
          // ── Specific token balance ──────────────────────────────────
          let tokenName = ''
          let tokenSymbol = ''
          let decimals = 0

          try {
            const info = await bchWallet.getTokenInfo(tokenId)
            if (info) {
              tokenName = info.name !== 'Unknown Token' ? info.name : ''
              tokenSymbol = info.symbol || ''
              decimals = info.decimals || 0
            }
          } catch {
            // Token info unavailable — proceed without metadata
          }

          const label = tokenSymbol || tokenName || 'Token'
          console.log(chalk.bold(`\n   ${label} Balance (${network})\n`))
          console.log(chalk.dim(`   Category: ${tokenId}`))
          if (tokenName) {
            console.log(chalk.dim(`   Name:     ${tokenName}`))
          }

          const result = await bchWallet.getTokenBalance(tokenId)
          const displayBalance = decimals > 0
            ? (result.balance / 10 ** decimals)
            : result.balance
          const unit = tokenSymbol || 'tokens'

          let usdPerToken: number | undefined
          try {
            const p = await getUsdPerToken(tokenId, isChipnet)
            if (p !== null) usdPerToken = p
          } catch {
            // Pricing unavailable — show token only
          }

          console.log(`   Balance:    ${displayBalance} ${unit}`)
          if (usdPerToken !== undefined) {
            const usdValue = tokenAmountToUsd(result.balance, decimals, usdPerToken)
            console.log(
              chalk.dim(`               ≈ ${formatUsd(usdValue)}`)
            )
          }
        } else if (showTokens || showAll) {
          // ── Token balances, optionally with BCH ─────────────────────
          const title = showAll ? 'Balances' : 'Token Balances'
          console.log(chalk.bold(`\n   ${title} (${network})\n`))

          if (showAll) {
            await showBchBalance(bchWallet, isChipnet, showSatsOnly)
            console.log()
          }
          await showTokenBalances(bchWallet, isChipnet)
        } else {
          // ── BCH balance ─────────────────────────────────────────────
          console.log(chalk.bold(`\n   Balance (${network})\n`))
          await showBchBalance(bchWallet, isChipnet, showSatsOnly)
        }
      } catch (err: any) {
        const status = err?.response?.status
        if (status === 404) {
          console.log(
            chalk.yellow(
              '   Wallet not yet registered with Watchtower on this network.'
            )
          )
          console.log(
            chalk.dim(
              '   Run `paytaca wallet create` or `paytaca wallet import` to register.'
            )
          )
        } else {
          console.log(
            chalk.red(`   Error fetching balance: ${err.message || err}`)
          )
          process.exit(1)
        }
      }

      console.log()
    })
}