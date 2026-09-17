/**
 * CLI commands: ai
 *
 * Paytaca AI integration: model catalogue, plan pricing, credits, plan
 * purchase via x402 (BCH or LIFT), non-streaming chat, and auto-refill.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import readline from 'readline'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getBalanceView, getTokenBalances } from '../core/wallet.js'
import { formatSats, bchToSats } from '../utils/format.js'
import { formatUsd } from '../utils/prices.js'
import {
  getConfig,
  getWalletStatus,
  type AiConfig,
  type AiModelConfig,
  type PriceTier,
} from '../ai/client.js'
import { resolveBackendUrl, LIFT_TOKEN_ID } from '../ai/config.js'
import {
  listPlans,
  selectModel,
  selectTier,
  formatDuration,
  formatPriceUsd,
} from '../ai/models.js'
import {
  summarizeCredits,
  summarizeAllCredits,
  getSessions,
  formatRemaining,
} from '../ai/credits.js'
import { buyPlan, type PaymentMethod } from '../ai/purchase.js'
import { provisionApiKey } from '../ai/oauth.js'
import { configureHarness, type ConfigureResult } from '../ai/configure.js'
import { CLIENTS, type McpClient } from './mcp.js'
import {
  armAutoRefill,
  disarmAutoRefill,
  readAutoRefillState,
  remainingBudget,
} from '../ai/autoRefill.js'

function outputJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function loadConfigOrExit(opts: { backend?: string; json?: boolean }): Promise<AiConfig | null> {
  try {
    return await getConfig({ backendUrl: opts.backend })
  } catch (err: any) {
    const message = err?.message || String(err)
    if (opts.json) outputJson({ error: message })
    else console.log(chalk.red(`\nError: ${message}\n`))
    process.exitCode = 1
    return null
  }
}

async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(chalk.bold(`\n   ${message} (y/N): `), (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

function promptSecret(message: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('A terminal is required to enter the API key.'))
  }
  process.stdout.write(chalk.bold(`\n   ${message}: `))
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
  stdin.setRawMode?.(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  return new Promise((resolve) => {
    let value = ''
    const finish = (result: string) => {
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.setRawMode?.(false)
      stdin.pause()
      process.stdout.write('\n')
      resolve(result)
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(value)
          return
        }
        if (char === '\u0003') {
          finish('')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }
    const onEnd = () => finish(value)
    stdin.on('data', onData)
    stdin.on('end', onEnd)
  })
}

function printPlans(config: AiConfig, modelQuery?: string): void {
  const models = listPlans(config, modelQuery)
  if (models.length === 0) {
    console.log(chalk.dim('\n   No plans found.\n'))
    return
  }
  for (const model of models) {
    console.log(`   ${chalk.bold(model.displayName)} ${chalk.dim(`(${model.id})`)}`)
    for (const plan of model.plans) {
      const price = formatPriceUsd(plan.price_usd)
      const sats = `${formatSats(Number(plan.price_sats) || 0)} sats`
      console.log(
        `     ${formatDuration(plan.minutes).padEnd(8)} ${price.padEnd(8)} ${chalk.dim(sats)}`
      )
    }
    console.log()
  }
}

export function registerAiCommands(program: Command): void {
  const ai = program.command('ai').description('Paytaca AI: models, plans, credits, purchase')

  // ── ai configure ────────────────────────────────────────────────────
  ai.command('configure')
    .description('Install the Paytaca MCP + AI provider into an AI harness')
    .argument('[harness]', `Target harness: ${CLIENTS.join(', ')}`, 'opencode')
    .option('--backend <url>', 'Override backend URL')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--path <path>', 'Override the target config file path')
    .option('--api-key <key>', 'Use an existing Paytaca API key (required for read-only wallets)')
    .option('-y, --yes', 'Buy a plan without prompting when no credits are active')
    .option('--json', 'Output as JSON')
    .action(async (harnessArg: string | undefined, opts) => {
      const harness = String(harnessArg || 'opencode').toLowerCase() as McpClient
      const json = Boolean(opts.json)
      const interactive =
        !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)

      const requestApiKey = async (): Promise<string | null> => {
        console.log(chalk.yellow('\n   This wallet is read-only; an API key is required.'))
        console.log(
          chalk.dim('   Create one from your full wallet: paytaca ai api-key create')
        )
        const entered = await promptSecret('Paste your Paytaca API key')
        return entered.trim() || null
      }

      let result: ConfigureResult
      try {
        result = await configureHarness({
          harness,
          chipnet: Boolean(opts.chipnet),
          backendUrl: opts.backend,
          path: opts.path,
          apiKey: opts.apiKey,
          requestApiKey: interactive ? requestApiKey : undefined,
        })
      } catch (err: any) {
        if (json) outputJson({ error: err.message })
        else console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exitCode = 1
        return
      }

      let purchased: Awaited<ReturnType<typeof buyPlan>> | null = null

      if (!json && result.canSign && !result.creditsActive && result.planSuggestion) {
        const plan = result.planSuggestion
        const proceed =
          Boolean(opts.yes) ||
          (await promptConfirmation(
            `No active AI credits. Buy a ${plan.minutes}-minute plan for ${plan.displayName} (${formatPriceUsd(plan.priceUsd)})?`
          ))
        if (proceed) {
          purchased = await buyPlan({
            model: plan.modelId,
            minutes: plan.minutes,
            paymentMethod: 'bch',
            isChipnet: Boolean(opts.chipnet),
            backendUrl: opts.backend,
            confirmed: true,
          })
        }
      }

      if (json) {
        outputJson({ ...result, purchased })
        if (!result.mcpInstalled || result.providerError) process.exitCode = 1
        return
      }

      console.log(chalk.bold(`\n   Paytaca AI — ${result.harness}\n`))
      if (result.path) console.log(`   Config:   ${result.path}`)
      console.log(
        `   MCP:      ${result.mcpInstalled ? chalk.green('configured') : chalk.red('failed')}`
      )
      if (result.harness === 'opencode' || result.harness === 'pi' || result.harness === 'omp') {
        if (result.providerInstalled) {
          const how = result.apiKeyReused
            ? 'existing API key'
            : result.apiKeyProvided
              ? 'provided API key'
              : 'new API key'
          const suffix = result.apiKeyPrefix ? `, ${result.apiKeyPrefix}…` : ''
          console.log(
            `   Provider: ${chalk.green('configured')} ${chalk.dim(`(${how}${suffix})`)}`
          )
          if (result.models.length > 0) {
            console.log(
              chalk.dim(
                `   Models:   ${result.models.length} available — use \`paytaca-ai/<model-id>\``
              )
            )
          }
        } else {
          const detail = result.providerError ? chalk.dim(` (${result.providerError})`) : ''
          console.log(`   Provider: ${chalk.yellow('not configured')}${detail}`)
        }
      }

      for (const warning of result.warnings || []) {
        console.log(chalk.yellow(`   Warning: ${warning}`))
      }

      if (result.creditsActive) {
        console.log(chalk.green('\n   AI credits active — ready to use.'))
      } else if (purchased?.paid) {
        console.log(
          chalk.green(
            `\n   Plan purchased: ${purchased.displayName || purchased.model} — ${purchased.minutes} minutes.`
          )
        )
        if (purchased.txid) console.log(chalk.dim(`   txid: ${purchased.txid}`))
      } else if (purchased && !purchased.success) {
        console.log(chalk.red(`\n   Purchase failed: ${purchased.error || 'unknown error'}`))
      } else if (!result.canSign) {
        console.log(chalk.yellow('\n   No active AI credits.'))
        if (result.planSuggestion) {
          console.log(
            chalk.dim(
              `   Fund from your full wallet: paytaca ai purchase --model ${result.planSuggestion.modelId} --minutes ${result.planSuggestion.minutes}`
            )
          )
        }
      } else if (result.planSuggestion) {
        console.log(chalk.yellow('\n   No active AI credits.'))
        console.log(
          chalk.dim(
            `   Buy a plan: paytaca ai purchase --model ${result.planSuggestion.modelId} --minutes ${result.planSuggestion.minutes}`
          )
        )
      }

      if (result.harness === 'pi') {
        console.log(chalk.yellow.bold('\n   Pi requires the pi-mcp-adapter extension.'))
        console.log(chalk.yellow('\n   Install it:'))
        console.log(chalk.cyan.bold('\n      pi install npm:pi-mcp-adapter\n'))
        console.log(
          chalk.yellow('   Then restart Pi and verify it loaded with ') +
            chalk.bold.cyan('pi list')
        )
      } else {
        console.log(chalk.dim('\n   Restart your AI harness to load the new configuration.\n'))
      }
      if (!result.mcpInstalled) process.exitCode = 1
    })

  // ── ai api-key ──────────────────────────────────────────────────────
  const apiKey = ai.command('api-key').description('Manage Paytaca AI API keys')

  apiKey
    .command('create')
    .description('Create an API key bound to your wallet (requires a full wallet)')
    .option('--name <name>', 'Label for the key', 'paytaca-cli')
    .option('--backend <url>', 'Override backend URL')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const wallet = loadWalletRef()
      if (!wallet) {
        const message =
          'No wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.'
        if (opts.json) outputJson({ error: message })
        else console.log(chalk.red(`\nError: ${message}\n`))
        process.exitCode = 1
        return
      }
      if (!wallet.canSign || !wallet.mnemonic) {
        const message = 'This wallet is read-only. Create an API key from your full wallet.'
        if (opts.json) outputJson({ error: message })
        else console.log(chalk.red(`\nError: ${message}\n`))
        process.exitCode = 1
        return
      }

      try {
        const created = await provisionApiKey({
          mnemonic: wallet.mnemonic,
          walletHash: wallet.walletHash,
          backendUrl: opts.backend,
          name: opts.name,
        })
        if (opts.json) {
          outputJson(created)
          return
        }
        console.log(chalk.bold('\n   Paytaca AI API key created\n'))
        console.log(`   Name:    ${created.name}`)
        console.log(`   Prefix:  ${created.keyPrefix}`)
        console.log(`   API key: ${chalk.bold(created.key)}`)
        console.log(chalk.yellow('\n   Copy this key now — it will not be shown again.'))
        console.log(
          chalk.dim(
            '   Then configure a harness: paytaca ai configure opencode --api-key <key>\n'
          )
        )
      } catch (err: any) {
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exitCode = 1
      }
    })

  // ── ai models ───────────────────────────────────────────────────────
  ai.command('models')
    .description('List available AI models')
    .option('--backend <url>', 'Override backend URL')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const config = await loadConfigOrExit(opts)
      if (!config) return
      const models = (config.models || []).map((m: AiModelConfig) => ({
        id: m.id,
        displayName: m.display_name,
        plans: m.price_tiers || [],
      }))
      if (opts.json) {
        outputJson({ defaultModel: config.default_model, models })
        return
      }
      console.log(chalk.bold('\n   AI Models\n'))
      for (const m of models) {
        console.log(`   ${chalk.bold(m.displayName)} ${chalk.dim(`(${m.id})`)}`)
        if (m.plans.length > 0) {
          const cheapest = m.plans.reduce((a: PriceTier, b: PriceTier) =>
            a.price_usd !== undefined && (b.price_usd === undefined || a.price_usd <= b.price_usd) ? a : b
          )
          console.log(
            chalk.dim(`     from ${formatPriceUsd(cheapest.price_usd)} · ${m.plans.length} plans`)
          )
        }
      }
      console.log()
    })

  // ── ai plans ────────────────────────────────────────────────────────
  ai.command('plans')
    .description('Show plan pricing for AI models')
    .argument('[model]', 'Filter to a single model id or display name')
    .option('--backend <url>', 'Override backend URL')
    .option('--json', 'Output as JSON')
    .action(async (model: string | undefined, opts) => {
      const config = await loadConfigOrExit(opts)
      if (!config) return
      const models = listPlans(config, model)
      if (opts.json) {
        outputJson({
          discountPercent: config.lift_payment_discount_percent ?? 0,
          models,
        })
        return
      }
      console.log(chalk.bold(`\n   AI Plans${model ? ` — ${model}` : ''}\n`))
      printPlans(config, model)
      const discount = config.lift_payment_discount_percent
      if (discount) {
        console.log(chalk.green(`   Pay with LIFT for a ${discount}% discount.\n`))
      }
    })

  // ── ai credits ──────────────────────────────────────────────────────
  ai.command('credits')
    .description('Show remaining AI time credits')
    .option('--model <id>', 'Filter to a single model')
    .option('--backend <url>', 'Override backend URL')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const wallet = loadWalletRef()
      if (!wallet) {
        const err = new WalletNotConfiguredError()
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\n${err.message}\n`))
        process.exitCode = 1
        return
      }
      const walletHash = wallet.walletHash
      try {
        const status = await getWalletStatus(walletHash, {
          backendUrl: opts.backend,
          modelId: opts.model,
        })
        if (opts.json) {
          if (opts.model) {
            outputJson({ walletHash, ...summarizeCredits(status, opts.model) })
          } else {
            outputJson({ walletHash, sessions: summarizeAllCredits(status) })
          }
          return
        }
        const summaries = opts.model
          ? [summarizeCredits(status, opts.model)]
          : summarizeAllCredits(status)
        console.log(chalk.bold('\n   AI Credits\n'))
        if (summaries.length === 0) {
          console.log(chalk.dim('   No sessions found.\n'))
          return
        }
        for (const summary of summaries) {
          console.log(
            `   ${chalk.bold(summary.displayName || summary.modelId || 'unknown')}`
          )
          console.log(`     Model:     ${summary.modelId || '(unknown)'}`)
          console.log(`     Remaining: ${formatRemaining(summary.timeRemainingSeconds)}`)
          console.log(`     Used:      ${formatRemaining(summary.timeUsedSeconds)}`)
          console.log(`     Total:     ${formatRemaining(summary.timeCreditsSeconds)}`)
          console.log(
            `     Status:    ${summary.active ? chalk.green('active') : chalk.dim('inactive')}`
          )
          console.log()
        }
      } catch (err: any) {
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exitCode = 1
      }
    })

  // ── ai usage ────────────────────────────────────────────────────────
  ai.command('usage')
    .description('Show per-session AI usage')
    .option('--backend <url>', 'Override backend URL')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const wallet = loadWalletRef()
      if (!wallet) {
        const err = new WalletNotConfiguredError()
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\n${err.message}\n`))
        process.exitCode = 1
        return
      }
      const walletHash = wallet.walletHash
      try {
        const status = await getWalletStatus(walletHash, { backendUrl: opts.backend })
        const sessions = getSessions(status).map((s) => ({
          model: s.model_id || s.ai_model || null,
          displayName: s.display_name || null,
          active: s.model_active === true || s.session_active === true,
          remainingSeconds: s.time_remaining_seconds ?? 0,
          usedSeconds: s.time_used_seconds ?? 0,
          creditsSeconds: s.time_credits_seconds ?? 0,
        }))
        if (opts.json) {
          outputJson({ walletHash, sessions })
          return
        }
        console.log(chalk.bold('\n   AI Usage\n'))
        if (sessions.length === 0) {
          console.log(chalk.dim('   No sessions found.\n'))
          return
        }
        for (const s of sessions) {
          console.log(`   ${chalk.bold(s.displayName || s.model || 'unknown')}`)
          console.log(
            chalk.dim(
              `     used ${formatRemaining(s.usedSeconds)} · remaining ${formatRemaining(
                s.remainingSeconds
              )} of ${formatRemaining(s.creditsSeconds)}`
            )
          )
          console.log()
        }
      } catch (err: any) {
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exitCode = 1
      }
    })

  // ── ai balance ──────────────────────────────────────────────────────
  ai.command('balance')
    .description('Show wallet balance available for AI plan purchases (BCH + LIFT)')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      try {
        const balance = await getBalanceView(isChipnet)
        const tokens = await getTokenBalances(isChipnet)
        const lift = tokens.tokens.find((t) => t.category === LIFT_TOKEN_ID)
        if (opts.json) {
          outputJson({
            network: balance.network,
            bch: {
              balance: balance.balanceBch,
              spendable: balance.spendableBch,
              sats: balance.spendableSats,
              usd: balance.usd,
            },
            lift: lift
              ? {
                  category: lift.category,
                  symbol: lift.symbol,
                  displayBalance: lift.displayBalance,
                  rawBalance: lift.rawBalance,
                }
              : null,
          })
          return
        }
        console.log(chalk.bold(`\n   Funds for AI Plans (${balance.network})\n`))
        console.log(`   BCH:   ${balance.spendableBch} BCH ${chalk.dim(`(${formatSats(balance.spendableSats)} sats)`)}`)
        if (balance.usd !== null) {
          console.log(chalk.dim(`          ≈ ${formatUsd(balance.usd)}`))
        }
        if (lift) {
          console.log(`   LIFT:  ${lift.displayBalance} ${lift.symbol || 'LIFT'}`)
        } else {
          console.log(chalk.dim('   LIFT:  none'))
        }
        console.log()
      } catch (err: any) {
        if (opts.json) outputJson({ error: err.message })
        else console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exitCode = 1
      }
    })

  // ── ai purchase ─────────────────────────────────────────────────────
  ai.command('purchase')
    .description('Purchase an AI plan (x402 payment with BCH or LIFT)')
    .requiredOption('--model <model>', 'Model id or display name')
    .requiredOption('--minutes <minutes>', 'Plan duration in minutes')
    .option('--lift', 'Pay with LIFT tokens (discount) instead of BCH')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--backend <url>', 'Override backend URL')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const paymentMethod: PaymentMethod = opts.lift ? 'lift' : 'bch'
      const minutes = Number(opts.minutes)
      const json = Boolean(opts.json)

      if (!Number.isFinite(minutes) || minutes <= 0) {
        if (json) outputJson({ error: 'Minutes must be a positive number.' })
        else console.log(chalk.red('\nError: Minutes must be a positive number.\n'))
        process.exitCode = 1
        return
      }

      const config = await loadConfigOrExit(opts)
      if (!config) return
      const model = selectModel(config.models || [], opts.model)
      if (!model) {
        const err = `Unknown model "${opts.model}".`
        if (json) outputJson({ error: err })
        else console.log(chalk.red(`\nError: ${err}\n`))
        process.exitCode = 1
        return
      }
      const tier = selectTier(model, minutes)
      if (!tier) {
        const err = `No ${minutes}-minute plan for ${model.display_name || model.id}.`
        if (json) outputJson({ error: err })
        else console.log(chalk.red(`\nError: ${err}\n`))
        process.exitCode = 1
        return
      }

      let discountPercent = 0
      if (paymentMethod === 'lift') {
        discountPercent = config.lift_payment_discount_percent ?? 0
      }
      const rawSats = Number(tier.price_sats) || 0
      const discountSats = Math.round(rawSats * (discountPercent / 100))
      const effectiveSats = rawSats - discountSats

      const confirmed =
        Boolean(opts.yes) ||
        (json
          ? false
          : await promptConfirmation(
              `Buy ${tier.minutes}-minute plan for ${model.display_name || model.id} for ${
                (effectiveSats / 1e8).toFixed(8)
              } BCH${paymentMethod === 'lift' ? ' (paid with LIFT)' : ''}?`
            ))

      if (json && !opts.yes) {
        outputJson({
          error: 'Payment not confirmed. Re-run with --yes to execute.',
          model: model.id,
          displayName: model.display_name,
          minutes: tier.minutes,
          priceSats: effectiveSats,
          paymentMethod,
        })
        process.exitCode = 1
        return
      }

      if (!confirmed) {
        if (json) outputJson({ error: 'Payment rejected by user.' })
        else console.log(chalk.dim('\n   Purchase cancelled.\n'))
        process.exitCode = 1
        return
      }

      const result = await buyPlan({
        model: model.id,
        minutes: tier.minutes,
        paymentMethod,
        isChipnet: Boolean(opts.chipnet),
        backendUrl: opts.backend,
        confirmed: true,
      })

      if (json) {
        outputJson(result)
        if (!result.success) process.exitCode = 1
        return
      }

      if (!result.success) {
        console.log(chalk.red(`\n   Error: ${result.error || 'Purchase failed.'}\n`))
        process.exitCode = 1
        return
      }
      if (!result.paid) {
        console.log(chalk.yellow(`\n   ${result.error || 'No purchase made.'}\n`))
        return
      }
      console.log(chalk.green(`\n   Plan purchased: ${result.displayName || result.model} — ${result.minutes} minutes.`))
      if (result.paymentMethod === 'lift') {
        console.log(chalk.dim(`   Paid with LIFT${discountPercent ? ` (${discountPercent}% discount)` : ''}.`))
      }
      if (result.txid) console.log(`   txid: ${result.txid}`)
      if (result.timeRemainingSeconds !== undefined) {
        console.log(chalk.dim(`   Credits remaining: ${formatRemaining(result.timeRemainingSeconds)}`))
      }
      console.log()
    })

  // ── ai auto-refill ──────────────────────────────────────────────────
  ai.command('auto-refill')
    .description('Arm, disarm, or inspect automatic plan refills')
    .option('--enable', 'Arm auto-refill')
    .option('--disable', 'Disarm auto-refill')
    .option('--status', 'Show auto-refill status (default)')
    .option('--model <id>', 'Model id or display name to auto-refill')
    .option('--minutes <minutes>', 'Plan size in minutes per refill')
    .option('--max-minutes <minutes>', 'Maximum total minutes to auto-buy')
    .option('--lift', 'Pay refills with LIFT tokens')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      if (opts.enable) {
        const minutes = opts.minutes !== undefined ? Number(opts.minutes) : undefined
        const maxMinutes =
          opts.maxMinutes !== undefined ? Number(opts.maxMinutes) : undefined
        const badMinutes = minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)
        const badMaxMinutes =
          maxMinutes !== undefined && (!Number.isFinite(maxMinutes) || maxMinutes <= 0)
        if (badMinutes || badMaxMinutes) {
          const message = '--minutes and --max-minutes must be positive numbers.'
          if (opts.json) outputJson({ error: message })
          else console.log(chalk.red(`\nError: ${message}\n`))
          process.exitCode = 1
          return
        }
        const state = armAutoRefill({
          model: opts.model,
          minutes,
          maxMinutes,
          paymentMethod: opts.lift ? 'lift' : 'bch',
        })
        if (opts.json) outputJson(state)
        else console.log(chalk.green(`\n   Auto-refill armed${state.model ? ` for ${state.model}` : ''}.\n`))
        return
      }
      if (opts.disable) {
        const state = disarmAutoRefill()
        if (opts.json) outputJson(state)
        else console.log(chalk.dim('\n   Auto-refill disarmed.\n'))
        return
      }
      const state = readAutoRefillState()
      if (opts.json) {
        outputJson({ state, remainingMinutes: remainingBudget(state) })
        return
      }
      console.log(chalk.bold('\n   Auto-Refill\n'))
      if (!state) {
        console.log(chalk.dim('   Not configured.\n'))
        return
      }
      console.log(`   Enabled:  ${state.enabled ? chalk.green('yes') : chalk.dim('no')}`)
      console.log(`   Model:    ${state.model || '(any)'}`)
      console.log(`   Plan:     ${state.minutes ? formatDuration(state.minutes) : '(any)'}`)
      console.log(`   Payment:  ${state.paymentMethod || 'bch'}`)
      const budget = remainingBudget(state)
      console.log(`   Budget:   ${budget === null ? '(unlimited)' : `${budget} min remaining`}`)
      console.log()
    })
}