/**
 * CLI commands: token list | info | price | send | send-nft
 *
 * CashTokens support for the Paytaca CLI.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { WalletNotConfiguredError, requireWallet } from '../core/context.js'
import {
  getTokenBalances,
  getTokenDetail,
  isValidBchAddress,
  isTokenAddress,
  sendToken,
} from '../core/wallet.js'
import { explorerTxUrl, formatTokenAmount, shortHex } from '../utils/format.js'
import { formatUsd } from '../utils/prices.js'

function reportError(err: any, asJson: boolean, contextLabel: string): never {
  if (asJson) {
    console.log(JSON.stringify({ error: err.message || String(err) }, null, 2))
    process.exit(1)
  }
  if (err instanceof WalletNotConfiguredError) {
    console.log(chalk.red(`\n${err.message}\n`))
    process.exit(1)
  }
  console.log(chalk.red(`   Error ${contextLabel}: ${err.message || err}`))
  process.exit(1)
}

export function registerTokenCommands(program: Command): void {
  const token = program
    .command('token')
    .description('CashToken operations (fungible tokens and NFTs)')

  // ── token list ─────────────────────────────────────────────────────

  token
    .command('list')
    .description('List fungible CashTokens in the wallet')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      try {
        const result = await getTokenBalances(isChipnet)

        if (asJson) {
          console.log(JSON.stringify(result.tokens, null, 2))
          return
        }

        console.log(chalk.bold(`\n   CashTokens (${network})\n`))

        if (result.tokens.length === 0) {
          console.log(chalk.dim('   No tokens found.\n'))
          return
        }

        let totalUsd = 0
        let pricedCount = 0

        for (const t of result.tokens) {
          const symbol = t.symbol ? ` ${t.symbol}` : ''
          const name = t.name !== 'Unknown Token' ? t.name : ''

          console.log(`   ${chalk.bold(t.displayBalance + symbol)}`)
          if (name) console.log(chalk.dim(`   ${name}`))
          console.log(chalk.dim(`   ${t.category}`))
          if (t.usd !== null) {
            totalUsd += t.usd
            pricedCount += 1
            console.log(chalk.green(`   ≈ ${formatUsd(t.usd)}`))
          }
          console.log()
        }

        if (pricedCount > 0) {
          console.log(chalk.dim(`   ${result.tokens.length} token${result.tokens.length !== 1 ? 's' : ''} total`))
          console.log(chalk.dim(`   ${pricedCount} priced`))
          console.log(chalk.bold(`   Total: ${formatUsd(totalUsd)}`))
          console.log()
        } else {
          console.log(chalk.dim(`   ${result.tokens.length} token${result.tokens.length !== 1 ? 's' : ''} total`))
        }
        console.log()
      } catch (err: any) {
        if (err instanceof WalletNotConfiguredError) reportError(err, asJson, '')
        const status = err?.response?.status
        if (status === 404 && !asJson) {
          console.log(
            chalk.yellow('   Wallet not yet registered with Watchtower on this network.')
          )
          console.log(
            chalk.dim('   Run `paytaca wallet create` or `paytaca wallet import` to register.')
          )
          console.log()
          return
        }
        reportError(err, asJson, 'fetching tokens')
      }
    })

  // ── token info ─────────────────────────────────────────────────────

  token
    .command('info')
    .description('Show details for a specific CashToken')
    .argument('<category>', 'Token category ID (64-character hex)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (category: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      try {
        const detail = await getTokenDetail(category, isChipnet)

        if (asJson) {
          console.log(JSON.stringify(detail, null, 2))
          return
        }

        console.log(chalk.bold(`\n   Token Info (${network})\n`))
        console.log(`   Name:      ${detail.name}`)
        if (detail.symbol) console.log(`   Symbol:    ${detail.symbol}`)
        console.log(`   Decimals:  ${detail.decimals}`)
        console.log(`   Category:  ${detail.category}`)

        const symbol = detail.symbol ? ` ${detail.symbol}` : ''
        console.log(`   Balance:   ${detail.displayBalance}${symbol}`)
        if (detail.usd !== null) {
          console.log(chalk.green(`   Value:     ≈ ${formatUsd(detail.usd)}`))
        }
        if (detail.usdPerToken !== null) {
          console.log(
            chalk.dim(
              `   Price:     ${formatUsd(detail.usdPerToken)} per ${detail.symbol || 'token'}`
            )
          )
        }

        if (detail.nfts.length > 0) {
          console.log(`\n   ${chalk.bold('NFTs')} (${detail.nfts.length})\n`)
          for (const nft of detail.nfts) {
            const cap = nft.capability === 'none' ? '' : ` [${nft.capability}]`
            const commitment = nft.commitment ? shortHex(nft.commitment) : '(empty)'
            console.log(`   ${chalk.cyan(commitment)}${cap}`)
            console.log(chalk.dim(`   ${nft.txid}:${nft.vout}`))
            console.log()
          }
        }

        console.log()
      } catch (err: any) {
        reportError(err, asJson, '')
      }
    })

  // ── token price ────────────────────────────────────────────────────

  token
    .command('price')
    .description('Show USD price of a CashToken and value of a given amount')
    .argument('<category>', 'Token category ID (64-character hex)')
    .argument('[amount]', 'Token amount in display units (defaults to wallet balance)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (category: string, amountStr: string | undefined, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      let requestedAmount: number | null = null
      if (amountStr !== undefined) {
        requestedAmount = Number(amountStr)
        if (!isFinite(requestedAmount) || requestedAmount < 0) {
          console.log(chalk.red('\nError: Amount must be a non-negative number.\n'))
          process.exit(1)
        }
      }

      try {
        const detail = await getTokenDetail(category, isChipnet)
        const displayAmount =
          requestedAmount !== null
            ? requestedAmount
            : detail.rawBalance / Math.pow(10, detail.decimals)

        if (asJson) {
          console.log(
            JSON.stringify(
              {
                network,
                category,
                symbol: detail.symbol,
                name: detail.name,
                decimals: detail.decimals,
                amount: displayAmount,
                usdPerToken: detail.usdPerToken,
                usd:
                  detail.usdPerToken !== null
                    ? displayAmount * detail.usdPerToken
                    : null,
              },
              null,
              2
            )
          )
          return
        }

        const label = detail.symbol || (detail.name !== 'Unknown Token' ? detail.name : '') || shortHex(category)
        console.log(chalk.bold(`\n   Token Price (${network})\n`))
        console.log(`   Token:    ${label}`)
        if (detail.name !== 'Unknown Token') console.log(chalk.dim(`   Name:     ${detail.name}`))
        console.log(chalk.dim(`   Category: ${category}`))

        if (detail.usdPerToken === null) {
          console.log(chalk.yellow('\n   No market price available for this token.\n'))
          return
        }

        const usdValue = displayAmount * detail.usdPerToken
        console.log(
          chalk.green(`   Price:    ${formatUsd(detail.usdPerToken)} per ${detail.symbol || 'token'}`)
        )
        console.log(
          chalk.bold(`   Value:    ${formatUsd(usdValue)} for ${displayAmount} ${detail.symbol || 'token(s)'}`)
        )
        console.log()
      } catch (err: any) {
        reportError(err, asJson, '')
      }
    })

  // ── token send ─────────────────────────────────────────────────────

  token
    .command('send')
    .description('Send fungible CashTokens to an address')
    .argument('<address>', 'Recipient address (token-aware z-prefix recommended)')
    .argument('<amount>', 'Token amount to send (in base units, before decimal scaling)')
    .requiredOption('--token <id>', 'Token category ID (64-character hex)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (address: string, amountStr: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const category: string = opts.token
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      let tokenAmount: bigint
      try {
        tokenAmount = BigInt(amountStr)
      } catch {
        console.log(chalk.red('\nError: Amount must be a valid integer.\n'))
        process.exit(1)
        return
      }

      if (tokenAmount <= 0n) {
        console.log(chalk.red('\nError: Amount must be positive.\n'))
        process.exit(1)
      }

      if (!isValidBchAddress(address, isChipnet)) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      if (!isTokenAddress(address) && !asJson) {
        console.log(
          chalk.yellow('\n   Warning: Address is not a token-aware (z-prefix) address.')
        )
        console.log(
          chalk.yellow('   Tokens should be sent to token-aware addresses to avoid loss.\n')
        )
      }

      try {
        let tokenLabel = shortHex(category)
        try {
          const detail = await getTokenDetail(category, isChipnet)
          if (detail.symbol) tokenLabel = detail.symbol
          else if (detail.name !== 'Unknown Token') tokenLabel = detail.name
        } catch {
          // non-critical
        }

        if (!asJson) {
          console.log(`\n   Sending ${chalk.bold(amountStr + ' ' + tokenLabel)} on ${chalk.cyan(network)}`)
          console.log(chalk.dim(`   Category: ${category}`))
          console.log(chalk.dim(`   To:       ${address}`))
          console.log()
        }

        const outcome = await sendToken(
          { category, amount: tokenAmount, address },
          isChipnet
        )

        if (asJson) {
          console.log(
            JSON.stringify(
              {
                ...outcome,
                address,
                category,
                amount: amountStr,
              },
              null,
              2
            )
          )
          if (!outcome.success) process.exit(1)
          return
        }

        if (outcome.success) {
          console.log(chalk.green('   Transaction sent successfully!\n'))
          if (outcome.txid) {
            console.log(`   txid: ${outcome.txid}`)
            console.log(chalk.dim(`   ${outcome.explorerUrl}`))
          }
        } else {
          console.log(chalk.red(`   Transaction failed: ${outcome.error || 'Unknown error'}`))
          if (outcome.lackingSats) {
            console.log(
              chalk.yellow(`   Insufficient BCH for transaction fees. Short by ${outcome.lackingSats} satoshis.`)
            )
          }
          process.exit(1)
        }
        console.log()
      } catch (err: any) {
        reportError(err, asJson, '')
      }
    })

  // ── token send-nft ─────────────────────────────────────────────────

  token
    .command('send-nft')
    .description('Send a non-fungible CashToken (NFT) to an address')
    .argument('<address>', 'Recipient address')
    .requiredOption('--token <id>', 'Token category ID (64-character hex)')
    .requiredOption('--commitment <hex>', 'NFT commitment (hex string, use "" for empty)')
    .option('--capability <type>', 'NFT capability: none, minting, or mutable (default: none)', 'none')
    .option('--txid <txid>', 'UTXO txid containing the NFT (auto-detected if omitted)')
    .option('--vout <n>', 'UTXO output index (auto-detected if omitted)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (address: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const asJson = Boolean(opts.json)
      const category: string = opts.token
      const commitment: string = opts.commitment
      const capability: string = opts.capability || 'none'
      const network = isChipnet ? 'chipnet' : 'mainnet'

      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      if (!['none', 'minting', 'mutable'].includes(capability)) {
        console.log(chalk.red('\nError: Capability must be "none", "minting", or "mutable".\n'))
        process.exit(1)
      }

      if (!isValidBchAddress(address, isChipnet)) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      try {
        const ctx = requireWallet(isChipnet)

        let txid: string = opts.txid || ''
        let vout: number = opts.vout !== undefined ? parseInt(opts.vout, 10) : -1

        if (!txid || vout < 0) {
          if (!asJson) console.log(chalk.dim('\n   Searching for NFT UTXO...'))
          const nfts = await ctx.bch.getNftUtxos(category)
          const match = nfts.find(
            (n) => n.commitment === commitment && n.capability === capability
          )

          if (!match) {
            if (asJson) {
              console.log(
                JSON.stringify(
                  { error: `No NFT found matching category ${category}` },
                  null,
                  2
                )
              )
              process.exit(1)
            }
            console.log(
              chalk.red(`\n   Error: No NFT found matching category ${shortHex(category)} ` +
                `with commitment "${commitment}" and capability "${capability}".\n`)
            )
            console.log(chalk.dim('   Use `paytaca token info <category>` to list available NFTs.\n'))
            process.exit(1)
          }

          txid = match.txid
          vout = match.vout
        }

        const changeAddress = ctx.bch.getTokenAddressSetAt(0).change

        if (!asJson) {
          console.log(`\n   Sending NFT on ${chalk.cyan(network)}`)
          console.log(chalk.dim(`   Category:   ${category}`))
          console.log(chalk.dim(`   Commitment: ${commitment || '(empty)'}`))
          console.log(chalk.dim(`   Capability: ${capability}`))
          console.log(chalk.dim(`   UTXO:       ${shortHex(txid)}:${vout}`))
          console.log(chalk.dim(`   To:         ${address}`))
          console.log()
        }

        const result = await ctx.bch.sendNft(
          category,
          commitment,
          capability,
          txid,
          vout,
          address,
          changeAddress
        )

        const jsonResult = {
          network,
          success: result.success,
          txid: result.txid,
          explorerUrl: result.txid ? explorerTxUrl(result.txid, isChipnet) : undefined,
          error: result.error,
          category,
          commitment,
          capability,
          address,
        }

        if (asJson) {
          console.log(JSON.stringify(jsonResult, null, 2))
          if (!result.success) process.exit(1)
          return
        }

        if (result.success) {
          console.log(chalk.green('   Transaction sent successfully!\n'))
          if (result.txid) {
            console.log(`   txid: ${result.txid}`)
            console.log(chalk.dim(`   ${explorerTxUrl(result.txid, isChipnet)}`))
          }
        } else {
          console.log(chalk.red(`   Transaction failed: ${result.error || 'Unknown error'}`))
          if (result.lackingSats) {
            console.log(
              chalk.yellow(`   Insufficient BCH for transaction fees. Short by ${result.lackingSats} satoshis.`)
            )
          }
          process.exit(1)
        }
        console.log()
      } catch (err: any) {
        reportError(err, asJson, '')
      }
    })
}