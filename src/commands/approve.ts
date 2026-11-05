/**
 * CLI command: approve
 *
 * Completes a media-generation approval that an MCP host could not show itself
 * (no elicitation support). The agent gets a short handle, the user runs
 * `paytaca approve <id>` in their own terminal, reviews the exact quote, may
 * switch model or parameters, and only then pays.
 *
 * This is deliberately a real terminal-only flow: stdin must be a TTY, so an
 * agent cannot drive it through a pipe or a captured shell.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import readline from 'node:readline'
import {
  buildPendingSpendRequest,
} from '../mcp/media.js'
import type { MediaParamField, MediaSpendRequest } from '../mcp/approval.js'
import {
  listPendingApprovals,
  lockPendingApproval,
  removePendingApproval,
  resolvePendingApproval,
  type PendingApproval,
} from '../ai/pending.js'
import { fulfillImageOrder } from '../ai/images.js'
import { fulfillVideoOrder } from '../ai/videos.js'
import { fulfillAudioOrder } from '../ai/audio.js'
import { formatSpendCost, resolveSpendCost } from '../utils/prices.js'
import { assertInteractiveTerminal } from '../utils/approval.js'

const AUTO = 'auto'

function kindLabel(kind: PendingApproval['kind']): string {
  return kind === 'audio' ? 'speech' : kind
}

function clipPrompt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  return flat.length > 400 ? `${flat.slice(0, 397)}...` : flat
}

function paramLabel(field: MediaParamField, value: string): string {
  if (value === AUTO) return 'model default'
  if (field.optionLabels) {
    const index = field.options.indexOf(value)
    if (index >= 0 && field.optionLabels[index]) return field.optionLabels[index]
  }
  return value
}

interface PendingQuoteView {
  quote: any
  summary: { amountSats: number; amountUsd?: number; lines: string[] }
  cost: string
}

function renderQuote(
  record: PendingApproval,
  request: MediaSpendRequest<any>,
  view: PendingQuoteView
): string {
  const lines: string[] = []
  lines.push(chalk.bold(`   ${kindLabel(record.kind).toUpperCase()} — review and approve`))
  lines.push('')
  lines.push(`   Prompt:   ${clipPrompt(record.args.prompt)}`)
  const model = view.quote.model || request.models.find((m) => m.id === request.recommendedModelId)?.id
  const option = request.models.find((m) => m.id === model)
  lines.push(
    `   Model:    ${model || 'backend default'}${option ? chalk.dim(` — ${option.priceHint}`) : ''}`
  )
  for (const field of request.paramFields(record.selection)) {
    lines.push(
      `   ${`${field.label}:`.padEnd(14)} ${paramLabel(field, record.selection.params[field.name] ?? field.value)}`
    )
  }
  for (const line of view.summary.lines) {
    if (line.startsWith('Order:')) continue
    lines.push(`   ${line}`)
  }
  lines.push(`   Order:    ${view.quote.orderId}`)
  lines.push(`   Cost:     ${chalk.bold(view.cost)} (${view.summary.amountSats} sats)`)
  lines.push(`   Network:  ${record.args.isChipnet ? 'chipnet (testnet)' : 'mainnet'}`)
  return lines.join('\n')
}

async function askNumber(
  ask: (q: string) => Promise<string>,
  question: string,
  min: number,
  max: number
): Promise<number | null> {
  const answer = (await ask(question)).trim()
  if (!answer) return null
  const n = Number(answer)
  if (!Number.isInteger(n) || n < min || n > max) {
    console.log(chalk.red(`   Enter a number between ${min} and ${max}.`))
    return null
  }
  return n
}

export function registerApproveCommand(program: Command): void {
  program
    .command('approve')
    .description('Approve a pending media generation requested by an MCP agent')
    .argument(
      '[id]',
      'Pending approval id or unique prefix (omit to choose from a list)'
    )
    .action(async (idArg: string | undefined) => {
      try {
        assertInteractiveTerminal(
          process.stdin.isTTY,
          process.stdout.isTTY,
          'Refusing to approve a spend: this command must be run directly in an interactive terminal.\n' +
            'It cannot be piped, redirected, or executed by a non-interactive process.'
        )
      } catch (err) {
        console.log(chalk.red(`\n${(err as Error).message}\n`))
        process.exitCode = 1
        return
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      const pendingAsks = new Set<(value: string) => void>()
      rl.on('close', () => {
        for (const resolve of [...pendingAsks]) resolve('')
        pendingAsks.clear()
      })
      const ask = (q: string): Promise<string> =>
        new Promise((resolve) => {
          let settled = false
          const done = (value: string): void => {
            if (settled) return
            settled = true
            pendingAsks.delete(done)
            resolve(value)
          }
          pendingAsks.add(done)
          try {
            rl.question(q, done)
          } catch {
            // stdin closed between prompts (EOF): treat it as "cancel".
            done('')
          }
        })
      rl.on('SIGINT', () => {
        console.log(chalk.dim('\n   Cancelled — nothing was charged.'))
        rl.close()
        process.exit(130)
      })

      let release: (() => Promise<void>) | null = null
      try {
        let record = await choosePending(idArg, ask)
        if (!record) return

        release = await lockPendingApproval(record.id)
        // Re-read under the lock: pay_media (or another terminal) may have paid
        // and removed this quote between resolving it and taking the lock.
        record = await resolvePendingApproval(record.id)
        const request = await buildPendingSpendRequest(record)

        let view = await storedQuoteView(record)
        let needsQuote = false
        for (;;) {
          if (needsQuote) {
            console.log(chalk.dim('\n   Creating a fresh quote...'))
            view = await quoteRecord(record, request)
            needsQuote = false
          }

          console.log()
          console.log(renderQuote(record, request, view))
          console.log()

          const action = (
            await ask(
              chalk.bold(
                '   [p] Pay and generate   [m] Change model   [o] Change options   [c] Cancel: '
              )
            )
          )
            .trim()
            .toLowerCase()

          if (action === 'p' || action === 'pay') {
            const paid = await pay(record, view.quote)
            if (paid) {
              await removePendingApproval(record.id)
              return
            }
            console.log(
              chalk.dim(
                '\n   Nothing was charged. The approval is still pending — choose again to retry (a fresh quote will be created).\n'
              )
            )
            needsQuote = true
            continue
          }

          if (action === 'm' || action === 'model') {
            const chosen = await chooseModel(request, record, ask)
            if (chosen) {
              record.selection = {
                modelId: chosen,
                params: Object.fromEntries(
                  request
                    .paramFields({ modelId: chosen, params: {} })
                    .map((field) => [field.name, field.value])
                ),
              }
              needsQuote = true
            }
            continue
          }

          if (action === 'o' || action === 'options') {
            if (await chooseOption(request, record, ask)) needsQuote = true
            continue
          }

          if (action === 'c' || action === 'cancel' || action === '') {
            console.log(
              chalk.dim(
                '\n   Cancelled — nothing was charged. The approval stays pending for later.\n'
              )
            )
            return
          }

          console.log(chalk.red('   Unknown choice. Enter p, m, o, or c.'))
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   ${err?.message || String(err)}\n`))
        process.exitCode = 1
      } finally {
        rl.close()
        if (release) await release()
      }
    })
}

async function choosePending(
  idArg: string | undefined,
  ask: (q: string) => Promise<string>
): Promise<PendingApproval | null> {
  if (idArg) {
    return resolvePendingApproval(idArg)
  }

  const all = await listPendingApprovals()
  if (all.length === 0) {
    console.log(
      chalk.dim(
        '\n   No pending approvals. An MCP agent creates one when it asks for media on a host that cannot show the approval itself.\n'
      )
    )
    return null
  }

  console.log(chalk.bold('\n   Pending approvals\n'))
  all.forEach((entry, index) => {
    const amount =
      entry.quote.amountUsd !== undefined
        ? `$${entry.quote.amountUsd.toFixed(4)} (${entry.quote.amountSats} sats)`
        : `${entry.quote.amountSats} sats`
    console.log(
      `   ${index + 1}) ${entry.kind.padEnd(5)} ${amount.padEnd(24)} ${chalk.dim(
        `${new Date(entry.createdAt).toLocaleString()}  ${entry.id}`
      )}`
    )
  })
  console.log()

  const pick = await askNumber(ask, `   Choose 1-${all.length} (Enter to quit): `, 1, all.length)
  if (!pick) return null
  return all[pick - 1]
}

async function quoteRecord(
  record: PendingApproval,
  request: MediaSpendRequest<any>
): Promise<PendingQuoteView> {
  const { quote, summary } = await request.createQuote(record.selection)
  const spend = await resolveSpendCost(
    summary.amountSats,
    summary.amountUsd,
    record.args.isChipnet
  )
  return { quote, summary, cost: formatSpendCost(spend) }
}

async function storedQuoteView(record: PendingApproval): Promise<PendingQuoteView> {
  const spend = await resolveSpendCost(
    record.quote.amountSats,
    record.quote.amountUsd,
    record.args.isChipnet
  )
  return {
    quote: record.quote,
    summary: {
      amountSats: record.quote.amountSats,
      amountUsd: record.quote.amountUsd,
      lines: [],
    },
    cost: formatSpendCost(spend),
  }
}

async function chooseModel(
  request: MediaSpendRequest<any>,
  record: PendingApproval,
  ask: (q: string) => Promise<string>
): Promise<string | null> {
  console.log(chalk.bold('\n   Models\n'))
  request.models.forEach((model, index) => {
    const current = model.id === record.selection.modelId ? chalk.green(' (current)') : ''
    const recommended =
      model.id === request.recommendedModelId ? chalk.cyan(' (recommended)') : ''
    console.log(
      `   ${index + 1}) ${model.id} ${chalk.dim(`— ${model.priceHint}`)}${recommended}${current}`
    )
  })
  console.log()
  const pick = await askNumber(ask, `   Choose 1-${request.models.length} (Enter to keep): `, 1, request.models.length)
  if (!pick) return null
  return request.models[pick - 1].id
}

async function chooseOption(
  request: MediaSpendRequest<any>,
  record: PendingApproval,
  ask: (q: string) => Promise<string>
): Promise<boolean> {
  const fields = request.paramFields(record.selection)
  if (fields.length === 0) {
    console.log(chalk.dim('\n   This request has no optional parameters.\n'))
    return false
  }

  console.log(chalk.bold('\n   Options\n'))
  fields.forEach((field, index) => {
    console.log(
      `   ${index + 1}) ${field.label.padEnd(20)} ${paramLabel(field, record.selection.params[field.name] ?? field.value)}`
    )
  })
  console.log()
  const fieldIndex = await askNumber(
    ask,
    `   Change which option (1-${fields.length}, Enter to go back): `,
    1,
    fields.length
  )
  if (!fieldIndex) return false

  const field = fields[fieldIndex - 1]
  console.log(chalk.bold(`\n   ${field.label}\n`))
  field.options.forEach((value, index) => {
    const current =
      (record.selection.params[field.name] ?? field.value) === value
        ? chalk.green(' (current)')
        : ''
    console.log(`   ${index + 1}) ${paramLabel(field, value)}${current}`)
  })
  console.log()
  const valueIndex = await askNumber(
    ask,
    `   Choose 1-${field.options.length} (Enter to keep): `,
    1,
    field.options.length
  )
  if (!valueIndex) return false
  const next = field.options[valueIndex - 1]
  if (next === (record.selection.params[field.name] ?? field.value)) return false
  record.selection.params[field.name] = next
  return true
}

async function pay(record: PendingApproval, quote: any): Promise<boolean> {
  const opts = {
    isChipnet: record.args.isChipnet,
    backendUrl: record.args.backendUrl,
    deferDownload: false,
  }

  let result: any
  try {
    switch (record.kind) {
      case 'image':
        result = await fulfillImageOrder(quote, opts)
        break
      case 'video':
        result = await fulfillVideoOrder(quote, opts)
        break
      case 'audio':
        result = await fulfillAudioOrder(quote, opts)
        break
    }
  } catch (err: any) {
    console.log(chalk.red(`\n   Payment failed: ${err?.message || String(err)}\n`))
    return false
  }

  const kind = kindLabel(record.kind)
  if (!result) return false

  if (result.success) {
    if (!result.path) {
      console.log(
        chalk.yellow(
          `\n   ${kind} is still processing (order ${result.orderId}).`
        )
      )
      console.log(
        chalk.dim(
          `   Fetch it shortly with: paytaca ai ${record.kind} status ${result.orderId}\n`
        )
      )
      return true
    }
    console.log(chalk.green(`\n   ${kind} generated — ${result.path}`))
    if (result.orderId) console.log(`   Order:  ${result.orderId}`)
    if (result.model) console.log(`   Model:  ${result.model}`)
    if (result.amountSats !== undefined) {
      console.log(`   Cost:   ${result.amountSats} sats${result.amountUsd !== undefined ? ` ($${result.amountUsd})` : ''}`)
    }
    if (result.txid) console.log(`   txid:   ${result.txid}`)
    console.log()
    return true
  }

  console.log(chalk.red(`\n   ${result.error || 'Generation failed.'}`))

  if (result.paid) {
    // Funds already moved: never leave this pending, or a retry could pay twice.
    console.log(
      chalk.dim(
        `   Payment was sent (order ${result.orderId}). Check or resume with:\n` +
          `     paytaca ai ${record.kind} status ${result.orderId}\n`
      )
    )
    return true
  }

  console.log(chalk.dim('   Nothing was charged.'))
  return false
}
