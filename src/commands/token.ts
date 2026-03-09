/**
 * CLI commands: token list | info | send | send-nft
 *
 * CashTokens support for the Paytaca CLI.
 *
 * CashTokens are the native token protocol on Bitcoin Cash, supporting
 * both fungible tokens (FTs) and non-fungible tokens (NFTs) at the
 * consensus layer. Tokens are received at token-aware addresses
 * (z-prefix CashAddr format).
 *
 * Token sends are delegated to watchtower-cash-js BCH.send() with
 * the `token` parameter — identical to how paytaca-app handles it.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { Address } from 'watchtower-cash-js'
import { loadWallet, loadMnemonic } from '../wallet/index.js'

/** Truncate a hex string for display */
function shortHex(hex: string, len: number = 8): string {
  if (hex.length <= len * 2 + 3) return hex
  return hex.slice(0, len) + '...' + hex.slice(-len)
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

export function registerTokenCommands(program: Command): void {
  const token = program
    .command('token')
    .description('CashToken operations (fungible tokens and NFTs)')

  // ── token list ─────────────────────────────────────────────────────

  token
    .command('list')
    .description('List fungible CashTokens in the wallet')
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

      console.log(chalk.bold(`\n   CashTokens (${network})\n`))

      try {
        const tokens = await bchWallet.getFungibleTokens()

        if (tokens.length === 0) {
          console.log(chalk.dim('   No tokens found.\n'))
          return
        }

        for (const t of tokens) {
          const amount = formatTokenAmount(t.balance, t.decimals)
          const symbol = t.symbol ? ` ${t.symbol}` : ''
          const name = t.name !== 'Unknown Token' ? t.name : ''

          console.log(`   ${chalk.bold(amount + symbol)}`)
          if (name) {
            console.log(chalk.dim(`   ${name}`))
          }
          console.log(chalk.dim(`   ${t.category}`))
          console.log()
        }

        console.log(chalk.dim(`   ${tokens.length} token${tokens.length !== 1 ? 's' : ''} total`))
      } catch (err: any) {
        const status = err?.response?.status
        if (status === 404) {
          console.log(
            chalk.yellow('   Wallet not yet registered with Watchtower on this network.')
          )
          console.log(
            chalk.dim('   Run `paytaca wallet create` or `paytaca wallet import` to register.')
          )
        } else {
          console.log(chalk.red(`   Error fetching tokens: ${err.message || err}`))
          process.exit(1)
        }
      }

      console.log()
    })

  // ── token info ─────────────────────────────────────────────────────

  token
    .command('info')
    .description('Show details for a specific CashToken')
    .argument('<category>', 'Token category ID (64-character hex)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (category: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // Validate category format
      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      console.log(chalk.bold(`\n   Token Info (${network})\n`))

      try {
        const tokenInfo = await bchWallet.getTokenInfo(category)

        if (!tokenInfo) {
          console.log(chalk.yellow('   Token not found.\n'))
          return
        }

        console.log(`   Name:      ${tokenInfo.name}`)
        if (tokenInfo.symbol) {
          console.log(`   Symbol:    ${tokenInfo.symbol}`)
        }
        console.log(`   Decimals:  ${tokenInfo.decimals}`)
        console.log(`   Category:  ${tokenInfo.category}`)

        // Fetch wallet-specific balance
        try {
          const balResult = await bchWallet.getTokenBalance(category)
          const amount = formatTokenAmount(balResult.balance, tokenInfo.decimals)
          const symbol = tokenInfo.symbol ? ` ${tokenInfo.symbol}` : ''
          console.log(`   Balance:   ${amount}${symbol}`)
        } catch {
          // Balance may not be available if wallet doesn't hold this token
          console.log(chalk.dim('   Balance:   0'))
        }

        // Show NFTs for this category
        try {
          const nfts = await bchWallet.getNftUtxos(category)
          if (nfts.length > 0) {
            console.log(`\n   ${chalk.bold('NFTs')} (${nfts.length})\n`)
            for (const nft of nfts) {
              const cap = nft.capability === 'none' ? '' : ` [${nft.capability}]`
              const commitment = nft.commitment ? shortHex(nft.commitment) : '(empty)'
              console.log(`   ${chalk.cyan(commitment)}${cap}`)
              console.log(chalk.dim(`   ${nft.txid}:${nft.vout}`))
              console.log()
            }
          }
        } catch {
          // NFT fetch may fail; non-critical
        }
      } catch (err: any) {
        console.log(chalk.red(`   Error: ${err.message || err}`))
        process.exit(1)
      }

      console.log()
    })

  // ── token send ─────────────────────────────────────────────────────

  token
    .command('send')
    .description('Send fungible CashTokens to an address')
    .argument('<address>', 'Recipient address (token-aware z-prefix recommended)')
    .argument('<amount>', 'Token amount to send (in base units, before decimal scaling)')
    .requiredOption('--token <id>', 'Token category ID (64-character hex)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (address: string, amountStr: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const category: string = opts.token
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // Validate wallet
      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      // Validate category
      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      // Parse amount as bigint
      let tokenAmount: bigint
      try {
        tokenAmount = BigInt(amountStr)
      } catch {
        console.log(chalk.red('\nError: Amount must be a valid integer.\n'))
        process.exit(1)
        return // unreachable, but helps TS narrowing
      }

      if (tokenAmount <= 0n) {
        console.log(chalk.red('\nError: Amount must be positive.\n'))
        process.exit(1)
      }

      // Validate recipient address
      const addressValidator = new Address(address)
      if (
        !addressValidator.isValidBCHAddress(isChipnet) &&
        !(addressValidator as any).isP2SH?.() &&
        !(addressValidator as any).isTokenAddress?.()
      ) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      // Warn if not a token address
      if (!(addressValidator as any).isTokenAddress?.()) {
        console.log(
          chalk.yellow('\n   Warning: Address is not a token-aware (z-prefix) address.')
        )
        console.log(
          chalk.yellow('   Tokens should be sent to token-aware addresses to avoid loss.\n')
        )
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      // Token change goes to our token address
      const tokenChangeAddress = bchWallet.getTokenAddressSetAt(0).change

      // Fetch token info for display
      let tokenLabel = shortHex(category)
      try {
        const info = await bchWallet.getTokenInfo(category)
        if (info?.symbol) tokenLabel = info.symbol
        else if (info?.name && info.name !== 'Unknown Token') tokenLabel = info.name
      } catch {
        // Non-critical; use category hex
      }

      console.log(`\n   Sending ${chalk.bold(amountStr + ' ' + tokenLabel)} on ${chalk.cyan(network)}`)
      console.log(chalk.dim(`   Category: ${category}`))
      console.log(chalk.dim(`   To:       ${address}`))
      console.log(chalk.dim(`   Change:   ${tokenChangeAddress}`))
      console.log()

      try {
        const result = await bchWallet.sendToken(
          category,
          tokenAmount,
          address,
          tokenChangeAddress
        )

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
              chalk.yellow(`   Insufficient BCH for transaction fees. Short by ${result.lackingSats} satoshis.`)
            )
          }
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }

      console.log()
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
    .action(async (address: string, opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const category: string = opts.token
      const commitment: string = opts.commitment
      const capability: string = opts.capability || 'none'
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // Validate wallet
      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      // Validate category
      if (!/^[a-fA-F0-9]{64}$/.test(category)) {
        console.log(chalk.red('\nError: Category must be a 64-character hex string.\n'))
        process.exit(1)
      }

      // Validate capability
      if (!['none', 'minting', 'mutable'].includes(capability)) {
        console.log(chalk.red('\nError: Capability must be "none", "minting", or "mutable".\n'))
        process.exit(1)
      }

      // Validate address
      const addressValidator = new Address(address)
      if (
        !addressValidator.isValidBCHAddress(isChipnet) &&
        !(addressValidator as any).isP2SH?.() &&
        !(addressValidator as any).isTokenAddress?.()
      ) {
        console.log(chalk.red('\nError: Invalid BCH address.\n'))
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      // Resolve UTXO — either from flags or auto-detect
      let txid: string = opts.txid || ''
      let vout: number = opts.vout !== undefined ? parseInt(opts.vout, 10) : -1

      if (!txid || vout < 0) {
        // Auto-detect: find the NFT UTXO matching category + commitment + capability
        console.log(chalk.dim('\n   Searching for NFT UTXO...'))
        try {
          const nfts = await bchWallet.getNftUtxos(category)
          const match = nfts.find(
            (n) => n.commitment === commitment && n.capability === capability
          )

          if (!match) {
            console.log(
              chalk.red(`\n   Error: No NFT found matching category ${shortHex(category)} ` +
                `with commitment "${commitment}" and capability "${capability}".\n`)
            )
            console.log(chalk.dim('   Use `paytaca token info <category>` to list available NFTs.\n'))
            process.exit(1)
          }

          txid = match.txid
          vout = match.vout
        } catch (err: any) {
          console.log(chalk.red(`\n   Error searching for NFTs: ${err.message || err}\n`))
          process.exit(1)
        }
      }

      // Change address for leftover BCH
      const changeAddress = bchWallet.getTokenAddressSetAt(0).change

      console.log(`\n   Sending NFT on ${chalk.cyan(network)}`)
      console.log(chalk.dim(`   Category:   ${category}`))
      console.log(chalk.dim(`   Commitment: ${commitment || '(empty)'}`))
      console.log(chalk.dim(`   Capability: ${capability}`))
      console.log(chalk.dim(`   UTXO:       ${shortHex(txid)}:${vout}`))
      console.log(chalk.dim(`   To:         ${address}`))
      console.log()

      try {
        const result = await bchWallet.sendNft(
          category,
          commitment,
          capability,
          txid,
          vout,
          address,
          changeAddress
        )

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
              chalk.yellow(`   Insufficient BCH for transaction fees. Short by ${result.lackingSats} satoshis.`)
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
