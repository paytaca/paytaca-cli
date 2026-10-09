import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getBalanceView,
  getHistoryView,
  getReceiveAddressView,
  getTokenBalances,
  getTokenDetail,
  sendBch,
  sendToken,
  isValidBchAddress,
} from '../core/wallet.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { loadWalletRef } from '../wallet/index.js'
import { getConfig } from '../ai/client.js'
import type { PriceTier } from '../ai/client.js'
import { listModels, listPlans, selectModel, formatPriceUsd, formatDuration, resolveModelId } from '../ai/models.js'
import type { PlanView } from '../ai/models.js'
import {
  getWalletStatus,
  summarizeCredits,
  summarizeAllCredits,
  buildPurchaseHint,
  formatRemaining,
  hasUsableCredits,
  paygBalanceUsd,
  paygEnabled,
  remainingSeconds as modelRemainingSeconds,
  type CreditsSummary,
  type PurchaseHint,
} from '../ai/credits.js'
import { buyPlan, topUpBalance } from '../ai/purchase.js'
import {
  generateImage,
  getImageHistory,
  getImageOrderStatus,
  isStillProcessing,
  listImageModels,
} from '../ai/images.js'
import {
  generateVideo,
  getVideoHistory,
  getVideoOrderStatus,
  isStillProcessing as isVideoStillProcessing,
  listVideoModels,
} from '../ai/videos.js'
import {
  generateAudio,
  getAudioHistory,
  getAudioOrderStatus,
  isStillProcessing as isAudioStillProcessing,
  listAudioModels,
} from '../ai/audio.js'
import {
  armAutoRefill,
  autoRefillTickOne,
  deleteAutoRefill,
  disarmAutoRefill,
  readAutoRefillStore,
  listAutoRefillEntries,
  normalizeModelKey,
  remainingBudget,
  remainingUsdBudget,
  type AutoRefillEntry,
  type AutoRefillState,
  type AutoRefillTarget,
  type RefillTickDeps,
  type RefillTickResult,
} from '../ai/autoRefill.js'

type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

type ToolResult = {
  content: ToolResultContent[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] }
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2))
}

export function createRefillTickDeps(
  isChipnet: boolean,
  backendUrl?: string
): RefillTickDeps {
  return {
    hasActiveCredits: async (model) => {
      const wallet = loadWalletRef()
      if (!wallet) throw new WalletNotConfiguredError()
      const status = await getWalletStatus(wallet.walletHash, {
        modelId: model,
        backendUrl,
      })
      return hasUsableCredits(status, model)
    },
    remainingSeconds: async (model) => {
      const wallet = loadWalletRef()
      if (!wallet) return null
      const status = await getWalletStatus(wallet.walletHash, {
        modelId: model,
        backendUrl,
      })
      return modelRemainingSeconds(status, model)
    },
    buy: async (opts) => {
      const result = await buyPlan({
        model: opts.model,
        minutes: opts.minutes,
        paymentMethod: opts.paymentMethod,
        isChipnet,
        backendUrl,
        confirmed: true,
      })
      return {
        success: result.success,
        paid: result.paid,
        txid: result.txid,
        priceSats: result.priceSats,
        error: result.error,
      }
    },
    paygBalance: async () => {
      const wallet = loadWalletRef()
      if (!wallet) throw new WalletNotConfiguredError()
      const status = await getWalletStatus(wallet.walletHash, { backendUrl })
      return paygBalanceUsd(status)
    },
    topUp: async (opts) => {
      const result = await topUpBalance({
        amountUsd: opts.amountUsd,
        paymentMethod: opts.paymentMethod,
        isChipnet,
        backendUrl,
        confirmed: true,
      })
      return {
        success: result.success,
        paid: result.paid,
        txid: result.txid,
        priceSats: result.priceSats,
        error: result.error,
      }
    },
  }
}

function tickSummary(tick: RefillTickResult): Record<string, unknown> {
  if (tick.action === 'idle') return { action: 'idle' }
  if (tick.action === 'skipped') return { action: 'skipped', reason: tick.reason }
  if (tick.action === 'refilled') {
    return {
      action: 'refilled',
      mode: tick.state.mode ?? null,
      model: tick.state.model ?? null,
      minutes: tick.state.minutes ?? null,
      amountUsd: tick.state.amountUsd ?? null,
      txid: tick.state.lastRefillTxid ?? null,
    }
  }
  return { action: 'disarmed', reason: tick.reason }
}

function sameModelId(a: string, b: string): boolean {
  const norm = (value: string): string =>
    value.trim().toLowerCase().replace(/^paytaca-ai\//, '')
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  return (
    x.slice(x.lastIndexOf('/') + 1) === y.slice(y.lastIndexOf('/') + 1)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function autoRefillField(
  state: AutoRefillState | null,
  key?: string
): Record<string, unknown> | null {
  if (!state) return null
  return {
    key: key ?? (state.mode === 'payg' ? 'payg' : normalizeModelKey(state.model ?? '')),
    armed: Boolean(state.enabled),
    mode: state.mode === 'payg' ? 'payg' : 'model',
    model: state.model ?? null,
    minutes: state.minutes ?? null,
    remainingMinutes: remainingBudget(state),
    amountUsd: state.amountUsd ?? null,
    thresholdUsd: state.thresholdUsd ?? null,
    remainingUsd: remainingUsdBudget(state),
    refillCount: state.refillCount ?? 0,
    lastEvent: state.lastEvent ?? null,
  }
}

function autoRefillFields(): Record<string, unknown>[] {
  return listAutoRefillEntries(readAutoRefillStore()).map(
    (entry) => autoRefillField(entry.state, entry.key)!
  )
}

function pickAutoRefill(
  entries: AutoRefillEntry[],
  model?: string
): AutoRefillState | null {
  if (model) {
    return (
      entries.find(
        (e) => e.mode === 'model' && sameModelId(e.state.model ?? '', model)
      )?.state ?? null
    )
  }
  return (
    entries.find((e) => e.mode === 'payg')?.state ?? entries[0]?.state ?? null
  )
}

async function resolveTargetModel(
  mode: 'model' | 'payg' | undefined,
  model: string | undefined,
  backend?: string
): Promise<AutoRefillTarget | undefined> {
  if (mode === 'payg') return { mode: 'payg' }
  if (!model) return undefined
  if (!backend) return { mode: 'model', model: normalizeModelKey(model) }
  try {
    const config = await getConfig({ backendUrl: backend })
    return { mode: 'model', model: resolveModelId(config, model) }
  } catch {
    return { mode: 'model', model: normalizeModelKey(model) }
  }
}

function clientName(server: McpServer): string {
  return server.server.getClientVersion()?.name ?? ''
}

interface PaygInfo {
  balanceUsd: number
  enabled: boolean
}

function paygLine(payg?: PaygInfo): string | null {
  if (!payg?.enabled || payg.balanceUsd <= 0) return null
  return (
    `Pay-as-you-go balance: ${formatPriceUsd(payg.balanceUsd)} — used ` +
    `automatically when a model has no active plan.`
  )
}

function creditsResponse(
  server: McpServer,
  sessions: CreditsSummary[],
  hint: PurchaseHint | null,
  payload: Record<string, unknown>,
  payg?: PaygInfo
): ToolResult {
  const name = clientName(server)
  if (name.startsWith('pi-mcp')) {
    return {
      content: [{ type: 'text', text: creditsText(sessions, hint, payg) }],
      structuredContent: payload,
    }
  }
  if (name === 'opencode') {
    return {
      content: [{ type: 'text', text: creditsMarkdown(sessions, hint, payg) }],
      structuredContent: payload,
    }
  }
  return json(payload)
}

function creditRows(sessions: CreditsSummary[]) {
  return sessions.map((session) => ({
    name: session.displayName || session.modelId || 'unknown',
    status: session.active ? 'active' : 'inactive',
    remaining: formatRemaining(session.timeRemainingSeconds),
    used: formatRemaining(session.timeUsedSeconds),
    limit: session.tokenLimit != null ? session.tokenLimit.toLocaleString('en-US') : '-',
  }))
}

function creditsText(
  sessions: CreditsSummary[],
  hint?: PurchaseHint | null,
  payg?: PaygInfo
): string {
  const lines: string[] = ['Paytaca AI credits', '']
  if (sessions.length === 0) {
    lines.push('No time-credit plans found.')
  } else {
    const rows = creditRows(sessions)
    const width = (key: keyof (typeof rows)[number], header: string) =>
      Math.max(header.length, ...rows.map((row) => row[key].length))
    const nameWidth = width('name', 'Model')
    const statusWidth = width('status', 'Status')
    const remainingWidth = width('remaining', 'Remaining')
    const usedWidth = width('used', 'Used')
    const limitWidth = width('limit', 'Token limit')
    const row = (...cells: string[]) => cells.map((cell, i) => cell.padEnd(
      [nameWidth, statusWidth, remainingWidth, usedWidth, limitWidth][i]
    )).join('  ')
    lines.push(row('Model', 'Status', 'Remaining', 'Used', 'Token limit'))
    for (const r of rows) {
      lines.push(row(r.name, r.status, r.remaining, r.used, r.limit))
    }
  }
  const paygText = paygLine(payg)
  if (paygText) lines.push('', paygText)
  if (hint) {
    lines.push('', hint.message)
  }
  return lines.join('\n')
}

function creditsMarkdown(
  sessions: CreditsSummary[],
  hint?: PurchaseHint | null,
  payg?: PaygInfo
): string {
  const lines: string[] = ['## Paytaca AI credits', '']
  if (sessions.length === 0) {
    lines.push('No time-credit plans found.')
  } else {
    lines.push('| Model | Status | Remaining | Used | Token limit |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const r of creditRows(sessions)) {
      lines.push(`| ${r.name} | ${r.status} | ${r.remaining} | ${r.used} | ${r.limit} |`)
    }
  }
  const paygText = paygLine(payg)
  if (paygText) lines.push('', paygText)
  if (hint) {
    lines.push('', hint.message)
  }
  return lines.join('\n')
}

function planPriceCell(tier: PriceTier | undefined): string {
  if (!tier) return '—'
  return formatPriceUsd(tier.price_usd)
}

function plansMarkdown(plans: PlanView[]): string {
  const lines: string[] = ['## Paytaca AI plans', '']
  if (plans.length === 0) {
    lines.push('No plans found.')
    return lines.join('\n')
  }
  const durations = Array.from(
    new Set(plans.flatMap((model) => model.plans.map((plan) => Number(plan.minutes))))
  ).sort((a, b) => a - b)
  const header = ['Model', ...durations.map(formatDuration)]
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const model of plans) {
    const byMinutes = new Map(
      model.plans.map((plan) => [Number(plan.minutes), plan])
    )
    const cells = [
      `${model.displayName} (\`${model.id}\`)`,
      ...durations.map((minutes) => planPriceCell(byMinutes.get(minutes))),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

function plansText(plans: PlanView[]): string {
  const lines: string[] = ['Paytaca AI plans', '']
  if (plans.length === 0) {
    lines.push('No plans found.')
    return lines.join('\n')
  }
  const durations = Array.from(
    new Set(plans.flatMap((model) => model.plans.map((plan) => Number(plan.minutes))))
  ).sort((a, b) => a - b)
  const headers = ['Model', ...durations.map(formatDuration)]
  const rows = plans.map((model) => {
    const byMinutes = new Map(model.plans.map((plan) => [Number(plan.minutes), plan]))
    return [
      `${model.displayName} (${model.id})`,
      ...durations.map((minutes) => planPriceCell(byMinutes.get(minutes))),
    ]
  })
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i].length))
  )
  const render = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join('  ')
  lines.push(render(headers))
  for (const row of rows) {
    lines.push(render(row))
  }
  return lines.join('\n')
}

function plansResponse(server: McpServer, plans: PlanView[]): ToolResult {
  const name = clientName(server)
  if (name.startsWith('pi-mcp')) {
    return {
      content: [{ type: 'text', text: plansText(plans) }],
      structuredContent: { models: plans },
    }
  }
  if (name === 'opencode') {
    return {
      content: [{ type: 'text', text: plansMarkdown(plans) }],
      structuredContent: { models: plans },
    }
  }
  return json(plans)
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function resolvePurchaseHint(
  modelQuery: string | undefined,
  backend: string | undefined
): Promise<PurchaseHint | null> {
  try {
    const config = await getConfig({ backendUrl: backend })
    const model = modelQuery ? selectModel(listModels(config), modelQuery) : null
    return buildPurchaseHint(model)
  } catch {
    return null
  }
}

const HELP = `Paytaca MCP tools

Wallet (read):
  get_balance            BCH balance (mainnet/chipnet)
  get_transactions       Paginated transaction history
  get_receiving_address  Derive a receiving address (+ BIP21/PayPro URI)
  get_tokens             List CashToken balances or inspect one category

Wallet (spend):
  send                   Send BCH or a CashToken to an address

Paytaca AI:
  get_models             List AI models
  get_plans              Plan pricing per AI model
  get_credits            Remaining AI time credits + pay-as-you-go balance
  buy_plan               Buy an AI plan with BCH or LIFT (spends funds)
  topup                  Add pay-as-you-go AI balance with BCH or LIFT (spends funds)
  auto_refill            Arm/disarm/inspect automatic refills (plans or pay-as-you-go)
  await_refill           Wait for armed auto-refill, then continue (no new spend)

Image generation:
  generate_image         Generate an image from a prompt (spends funds)
  get_image_status       Poll/resume a pending image generation order
  get_image_models       List image generation models
  get_image_history      Image generation order history

Video generation:
  generate_video         Generate a video from a prompt (spends funds)
  get_video_status       Poll/resume a pending video generation order
  get_video_models       List video generation models
  get_video_history      Video generation order history

Audio generation:
  generate_audio         Generate speech from text (spends funds)
  get_audio_status       Poll/resume a pending audio generation order
  get_audio_models       List audio (text-to-speech) models
  get_audio_history      Audio generation order history

Media downloads:
  Generated images, videos, and audio are NOT returned inline. generate_* and
  get_*_status return metadata only (order id, media type, size, ready). To get
  the actual file, run "paytaca ai image status <order_id>" (or video/audio) in
  a terminal; it streams the content to ~/.paytaca and prints the saved path.
  Content is cached server-side for a limited time, so download it promptly;
  call get_*_status again if it was already delivered or expired.

Notes:
  - All tools accept an optional "chipnet" flag (default mainnet).
  - send, buy_plan, topup, generate_image, generate_video, and generate_audio
    spend real funds from the active wallet; the MCP host is responsible for
    asking the user for approval before invoking them.
  - get_credits reports a pay-as-you-go "balance_usd" alongside plan sessions.
    When the balance covers usage, no purchaseHint is returned: the model is
    already usable, so just continue the task.
  - When get_credits reports no usable credits it includes a purchaseHint.
    Relay purchaseHint.message (it contains the exact copy-paste command to
    buy more time); do not replace it with upsell or "what next" questions.
  - Wallet is resolved from the OS keychain (run "paytaca wallet create" first).`

export function registerTools(
  server: McpServer,
  opts: { defaultChipnet?: boolean } = {}
): void {
  const cn = (value?: boolean): boolean =>
    value ?? Boolean(opts.defaultChipnet)

  server.registerTool(
    'get_help',
    {
      title: 'Paytaca help',
      description: 'List the Paytaca MCP tools and usage notes.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(HELP)
  )

  server.registerTool(
    'get_balance',
    {
      title: 'Get BCH balance',
      description:
        'Return the BCH balance (in BCH and sats) of the active wallet.',
      inputSchema: { chipnet: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chipnet }) => {
      try {
        return json(await getBalanceView(cn(chipnet)))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_transactions',
    {
      title: 'Get transaction history',
      description: 'Return paginated BCH/CashToken transaction history.',
      inputSchema: {
        chipnet: z.boolean().optional(),
        type: z.enum(['all', 'incoming', 'outgoing']).optional(),
        page: z.number().int().positive().optional(),
        token_category: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chipnet, type, page, token_category }) => {
      try {
        return json(
          await getHistoryView(
            {
              page: page ?? 1,
              recordType: type ?? 'all',
              tokenId: token_category || '',
            },
            cn(chipnet)
          )
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_receiving_address',
    {
      title: 'Get receiving address',
      description:
        'Derive a receiving address. With token_category, returns a token-aware (z-prefix) address and a PayPro URI. With amount, embeds the requested amount.',
      inputSchema: {
        chipnet: z.boolean().optional(),
        index: z.number().int().nonnegative().optional(),
        token: z.boolean().optional(),
        token_category: z.string().optional(),
        amount: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chipnet, index, token, token_category, amount }) => {
      try {
        return json(
          await getReceiveAddressView(
            {
              index: index ?? 0,
              token: Boolean(token) || Boolean(token_category),
              category: token_category,
              amount,
            },
            cn(chipnet)
          )
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_tokens',
    {
      title: 'Get CashToken balances',
      description:
        'List CashToken holdings, or return details for one token when token_category is given.',
      inputSchema: {
        chipnet: z.boolean().optional(),
        token_category: z.string().optional(),
        include_zero: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chipnet, token_category, include_zero }) => {
      try {
        if (token_category) {
          return json(await getTokenDetail(token_category, cn(chipnet)))
        }
        return json(
          await getTokenBalances(cn(chipnet), {
            includeZero: Boolean(include_zero),
          })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'send',
    {
      title: 'Send funds',
      description:
        'Send BCH, or a CashToken when token_category is given. Token amounts are in base units. SPENDS REAL FUNDS.',
      inputSchema: {
        address: z.string(),
        amount: z.string(),
        unit: z.enum(['bch', 'sats']).optional(),
        token_category: z.string().optional(),
        chipnet: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ address, amount, unit, token_category, chipnet }) => {
      const isChipnet = cn(chipnet)
      try {
        if (!isValidBchAddress(address, isChipnet)) {
          return fail(new Error('Invalid BCH address.'))
        }

        if (token_category) {
          let tokenAmount: bigint
          try {
            tokenAmount = BigInt(amount)
          } catch {
            return fail(new Error('Token amount must be an integer.'))
          }
          if (tokenAmount <= 0n) {
            return fail(new Error('Token amount must be positive.'))
          }
          return json(
            await sendToken(
              { category: token_category, amount: tokenAmount, address },
              isChipnet
            )
          )
        }

        const parsed = Number(amount)
        if (!isFinite(parsed) || parsed <= 0) {
          return fail(new Error('Amount must be a positive number.'))
        }
        const amountBch = unit === 'sats' ? parsed / 1e8 : parsed
        return json(await sendBch({ address, amountBch }, isChipnet))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_models',
    {
      title: 'List AI models',
      description: 'List the Paytaca AI models available for purchase.',
      inputSchema: { backend: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ backend }) => {
      try {
        const config = await getConfig({ backendUrl: backend })
        return json(listModels(config))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_plans',
    {
      title: 'Get AI plan pricing',
      description:
        'Return plan pricing per model. Pass model to filter a single model.',
      inputSchema: {
        model: z.string().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ model, backend }) => {
      try {
        const config = await getConfig({ backendUrl: backend })
        return plansResponse(server, listPlans(config, model))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_credits',
    {
      title: 'Get AI time credits',
      description:
        'Return remaining Paytaca AI time credits for all models, or for one model when "model" is given. When a session is inactive, includes a purchaseHint whose "message" is the exact text to relay to the user (a copy-paste top-up command) instead of upsell or follow-up questions. Armed auto-refill state is reported under "autoRefill"; refills themselves run in the background, never from this read-only call.',
      inputSchema: {
        model: z.string().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ model, chipnet, backend }) => {
      try {
        const wallet = loadWalletRef()
        if (!wallet) throw new WalletNotConfiguredError()
        const status = await getWalletStatus(wallet.walletHash, {
          modelId: model,
          backendUrl: backend,
        })

        const entries = listAutoRefillEntries(readAutoRefillStore())
        const auto = pickAutoRefill(entries, model)
        const payg = {
          balanceUsd: paygBalanceUsd(status),
          enabled: paygEnabled(status),
        }
        if (!model) {
          const sessions = summarizeAllCredits(status)
          const payload: Record<string, unknown> = {
            sessions,
            balance_usd: paygBalanceUsd(status),
            payg_enabled: paygEnabled(status),
          }
          const autoField = autoRefillField(auto)
          if (autoField) payload.autoRefill = autoField
          const allFields = autoRefillFields()
          if (allFields.length > 0) payload.autoRefills = allFields
          let hint: PurchaseHint | null = null
          if (!hasUsableCredits(status)) {
            hint = await resolvePurchaseHint(
              sessions[0]?.modelId ?? undefined,
              backend
            )
            if (hint) payload.purchaseHint = hint
            if (auto?.enabled && auto.model) {
              payload.resumeHint = {
                tool: 'await_refill',
                model: auto.model,
                message:
                  `Auto-refill is armed for ${auto.model}. Call await_refill ` +
                  `(model "${auto.model}") to wait for the refill, then continue ` +
                  `the task automatically — no need to ask the user to top up.`,
              }
            } else if (auto?.enabled && auto.mode === 'payg') {
              payload.resumeHint = {
                tool: 'await_refill',
                message:
                  'Pay-as-you-go auto-refill is armed. Call await_refill to wait ' +
                  'for the top-up, then continue the task automatically — no need ' +
                  'to ask the user to top up.',
              }
            }
          }
          return creditsResponse(server, sessions, hint, payload, payg)
        }
        const summary = summarizeCredits(status, model)
        const payload: Record<string, unknown> = {
          ...summary,
          balance_usd: paygBalanceUsd(status),
          payg_enabled: paygEnabled(status),
        }
        const autoField = autoRefillField(auto)
        if (autoField) payload.autoRefill = autoField
        const allFields = autoRefillFields()
        if (allFields.length > 0) payload.autoRefills = allFields
        let hint: PurchaseHint | null = null
        if (!hasUsableCredits(status, model)) {
          hint = await resolvePurchaseHint(model, backend)
          if (hint) payload.purchaseHint = hint
          if (auto?.enabled && auto.model) {
            payload.resumeHint = {
              tool: 'await_refill',
              model: auto.model,
              message:
                `Auto-refill is armed for ${auto.model}. Call await_refill ` +
                `(model "${auto.model}") to wait for the refill, then continue ` +
                `the task automatically — no need to ask the user to top up.`,
            }
          }
        }
        return creditsResponse(server, [summary], hint, payload, payg)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'buy_plan',
    {
      title: 'Buy an AI plan',
      description:
        'Purchase an AI plan for a model and duration, paying with BCH or LIFT via x402. SPENDS REAL FUNDS. The MCP host must obtain user approval before calling this.',
      inputSchema: {
        model: z.string(),
        minutes: z.number().int().positive(),
        payment_method: z.enum(['bch', 'lift']).optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ model, minutes, payment_method, chipnet, backend }) => {
      try {
        return json(
          await buyPlan({
            model,
            minutes,
            paymentMethod: payment_method ?? 'bch',
            isChipnet: cn(chipnet),
            backendUrl: backend,
            confirmed: true,
          })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'topup',
    {
      title: 'Top up AI balance',
      description:
        'Add prepaid USD balance for pay-as-you-go AI usage, paying with BCH or LIFT via x402. This is an alternative to buying a model-locked plan: the balance is charged per prompt by actual usage and works across all models. SPENDS REAL FUNDS. The MCP host must obtain user approval before calling this.',
      inputSchema: {
        amount_usd: z.number().positive().optional(),
        payment_method: z.enum(['bch', 'lift']).optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ amount_usd, payment_method, chipnet, backend }) => {
      try {
        return json(
          await topUpBalance({
            amountUsd: amount_usd,
            paymentMethod: payment_method ?? 'bch',
            isChipnet: cn(chipnet),
            backendUrl: backend,
            confirmed: true,
          })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'auto_refill',
    {
      title: 'Manage auto-refill',
      description:
        'Arm, disarm, delete, or inspect automatic refills. Two modes: "model" (default) buys a plan silently when time credits run out, up to max_minutes; "payg" tops up the pay-as-you-go USD balance whenever it falls to threshold_usd, adding amount_usd each time up to an optional max_usd budget. Arming runs one immediate refill check. Each execution is recorded in ~/.paytaca/auto-refill-events.jsonl and surfaced as lastEvent. delete=true removes the armed state (history is kept).',
      inputSchema: {
        enabled: z.boolean().optional(),
        mode: z.enum(['model', 'payg']).optional(),
        model: z.string().optional(),
        minutes: z.number().int().positive().optional(),
        max_minutes: z.number().int().positive().optional(),
        amount_usd: z.number().positive().optional(),
        threshold_usd: z.number().nonnegative().optional(),
        max_usd: z.number().positive().optional(),
        payment_method: z.enum(['bch', 'lift']).optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
        delete: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      enabled,
      mode,
      model,
      minutes,
      max_minutes,
      amount_usd,
      threshold_usd,
      max_usd,
      payment_method,
      chipnet,
      backend,
      delete: del,
    }) => {
      try {
        const wallet = loadWalletRef()
        const target = await resolveTargetModel(mode, model, backend)

        if (del) {
          const existed = deleteAutoRefill(target)
          return json({ deleted: true, existed })
        }

        if (enabled === false) {
          const store = disarmAutoRefill(target)
          return json({
            disarmed: target ? (target.mode === 'payg' ? 'payg' : target.model) : 'all',
            store,
          })
        }

        if (enabled === true) {
          let state: AutoRefillState
          let tickTarget: AutoRefillTarget
          if (mode === 'payg') {
            if (amount_usd == null || amount_usd <= 0 || threshold_usd == null) {
              return fail(
                new Error(
                  'Arming pay-as-you-go auto-refill requires amount_usd and threshold_usd.'
                )
              )
            }
            if (max_usd != null && max_usd < amount_usd) {
              return fail(new Error('max_usd must be at least amount_usd.'))
            }
            state = armAutoRefill({
              mode: 'payg',
              amountUsd: amount_usd,
              thresholdUsd: threshold_usd,
              maxUsd: max_usd,
              paymentMethod: payment_method ?? 'bch',
            })
            tickTarget = { mode: 'payg' }
          } else {
            if (!model || !minutes) {
              return fail(new Error('Arming auto-refill requires model and minutes.'))
            }
            const resolved = await resolveTargetModel('model', model, backend)
            const modelId =
              resolved && resolved.mode === 'model'
                ? resolved.model
                : normalizeModelKey(model)
            const existing = readAutoRefillStore().models[normalizeModelKey(modelId)]
            const effMinutes = minutes ?? existing?.minutes
            if (effMinutes == null) {
              return fail(new Error('Arming auto-refill requires minutes.'))
            }
            if (
              max_minutes != null &&
              (max_minutes < effMinutes * 2 || max_minutes % effMinutes !== 0)
            ) {
              return fail(
                new Error('max_minutes must be at least twice minutes and a multiple of it.')
              )
            }
            state = armAutoRefill({
              mode: 'model',
              model: modelId,
              minutes: effMinutes,
              maxMinutes: max_minutes,
              paymentMethod: payment_method ?? 'bch',
            })
            tickTarget = { mode: 'model', model: modelId }
          }
          let initialTick: Record<string, unknown> | null = null
          if (wallet?.canSign) {
            try {
              initialTick = tickSummary(
                await autoRefillTickOne(
                  createRefillTickDeps(cn(chipnet), backend),
                  tickTarget
                )
              )
            } catch (err: any) {
              initialTick = { action: 'skipped', reason: err?.message || String(err) }
            }
          }
          return json({ ...state, initialTick })
        }

        const entries = listAutoRefillEntries(readAutoRefillStore())
        const fields = entries
          .map((e) => autoRefillField(e.state, e.key))
          .filter((f): f is Record<string, unknown> => f != null)
        const primary = pickAutoRefill(entries, model)
        return json({
          autoRefills: fields,
          armed: Boolean(primary?.enabled),
          mode: primary?.mode === 'payg' ? 'payg' : 'model',
          remainingMinutes: remainingBudget(primary),
          remainingUsd: remainingUsdBudget(primary),
          refillCount: primary?.refillCount ?? 0,
          lastEvent: primary?.lastEvent ?? null,
          state: primary,
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'await_refill',
    {
      title: 'Wait for armed auto-refill, then continue',
      description:
        'Block until auto-refill makes the model usable again, then return so the current task can continue. Use this immediately when a turn was blocked by a "payment required" / out-of-credits response while auto-refill is armed. It triggers the armed refill if needed and polls until credits are active (or the timeout elapses). It NEVER buys unless auto-refill is already armed for the model, so the user has already pre-authorized the spend. Returns resumed:true with the refreshed credits, or resumed:false with a reason.',
      inputSchema: {
        model: z.string().optional(),
        timeout_seconds: z.number().int().positive().max(600).optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ model, timeout_seconds, chipnet, backend }) => {
      try {
        const wallet = loadWalletRef()
        if (!wallet) throw new WalletNotConfiguredError()
        const entries = listAutoRefillEntries(readAutoRefillStore())
        const paygEntry = entries.find((e) => e.mode === 'payg')
        let entry: AutoRefillEntry | undefined
        if (model) {
          entry = entries.find(
            (e) => e.mode === 'model' && sameModelId(e.state.model ?? '', model)
          )
          if (!entry) entry = paygEntry
          if (!entry) {
            const armed = entries.find((e) => e.mode === 'model')
            if (armed) {
              return json({
                resumed: false,
                reason: `Auto-refill is armed for ${armed.state.model}, not ${model}.`,
                model: armed.state.model,
              })
            }
          }
        } else {
          entry = paygEntry ?? entries[0]
        }
        if (!entry?.state.enabled) {
          return json({ resumed: false, reason: 'Auto-refill is not armed.' })
        }
        const state = entry.state

        if (entry.mode === 'payg') {
          const tickTarget: AutoRefillTarget = { mode: 'payg' }
          const deps = createRefillTickDeps(cn(chipnet), backend)
          let status = await getWalletStatus(wallet.walletHash, { backendUrl: backend })
          if (hasUsableCredits(status)) {
            return json({
              resumed: true,
              alreadyActive: true,
              mode: 'payg',
              balanceUsd: paygBalanceUsd(status),
            })
          }
          let tick: Record<string, unknown> | null = null
          if (wallet.canSign) {
            try {
              tick = tickSummary(await autoRefillTickOne(deps, tickTarget))
            } catch (err: any) {
              tick = { action: 'skipped', reason: err?.message || String(err) }
            }
          }
          const paygTimeoutMs = Math.max(1, timeout_seconds ?? 120) * 1000
          const paygDeadline = Date.now() + paygTimeoutMs
          while (!hasUsableCredits(status)) {
            const wait = paygDeadline - Date.now()
            if (wait <= 0) break
            await sleep(Math.min(3000, wait))
            status = await getWalletStatus(wallet.walletHash, { backendUrl: backend })
          }
          if (!hasUsableCredits(status)) {
            return json({
              resumed: false,
              reason: tick
                ? 'Timed out waiting for the top-up to complete.'
                : 'Wallet cannot sign; no top-up was attempted.',
              mode: 'payg',
              refillTick: tick,
              balanceUsd: paygBalanceUsd(status),
            })
          }
          return json({
            resumed: true,
            mode: 'payg',
            refillTick: tick,
            balanceUsd: paygBalanceUsd(status),
          })
        }

        if (!state.model) {
          return json({ resumed: false, reason: 'Auto-refill is not armed.' })
        }
        const armedModel = state.model
        if (model && !sameModelId(model, armedModel)) {
          return json({
            resumed: false,
            reason: `Auto-refill is armed for ${armedModel}, not ${model}.`,
            model: armedModel,
          })
        }

        const deps = createRefillTickDeps(cn(chipnet), backend)
        let status = await getWalletStatus(wallet.walletHash, {
          modelId: armedModel,
          backendUrl: backend,
        })
        if (hasUsableCredits(status, armedModel)) {
          return json({
            resumed: true,
            alreadyActive: true,
            model: armedModel,
            credits: summarizeCredits(status, armedModel),
          })
        }

        let tick: Record<string, unknown> | null = null
        if (wallet.canSign) {
          try {
            tick = tickSummary(
              await autoRefillTickOne(deps, { mode: 'model', model: armedModel })
            )
          } catch (err: any) {
            tick = { action: 'skipped', reason: err?.message || String(err) }
          }
        }

        const timeoutMs = Math.max(1, timeout_seconds ?? 120) * 1000
        const deadline = Date.now() + timeoutMs
        while (!hasUsableCredits(status, armedModel)) {
          const wait = deadline - Date.now()
          if (wait <= 0) break
          await sleep(Math.min(3000, wait))
          status = await getWalletStatus(wallet.walletHash, {
            modelId: armedModel,
            backendUrl: backend,
          })
        }

        if (!hasUsableCredits(status, armedModel)) {
          return json({
            resumed: false,
            reason: tick
              ? 'Timed out waiting for the refill to complete.'
              : 'Wallet cannot sign; no refill was attempted.',
            model: armedModel,
            refillTick: tick,
            credits: summarizeCredits(status, armedModel),
          })
        }
        return json({
          resumed: true,
          model: armedModel,
          refillTick: tick,
          credits: summarizeCredits(status, armedModel),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_image_models',
    {
      title: 'List image models',
      description:
        'List the image generation models available through Paytaca AI.',
      inputSchema: { backend: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ backend }) => {
      try {
        return json(await listImageModels({ backendUrl: backend }))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_image_history',
    {
      title: 'Get image order history',
      description: 'Return paginated Paytaca image generation order history.',
      inputSchema: {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ page, page_size, backend }) => {
      try {
        return json(
          await getImageHistory({ page, pageSize: page_size, backendUrl: backend })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_image_status',
    {
      title: 'Poll image generation status',
      description:
        'Poll an existing image generation order by ID. When generation is complete, returns metadata only (no image bytes) plus a command to download the image from the command line. If still processing, returns the current status so you can retry later. Use this to resume after generate_image returns a "processing" status.',
      inputSchema: {
        order_id: z.string().min(1),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ order_id, chipnet, backend }) => {
      try {
        const result = await getImageOrderStatus(order_id, {
          isChipnet: cn(chipnet),
          backendUrl: backend,
          download: false,
        })

        if (isStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Image generation is still processing (order ${result.orderId}).`,
                  `Try again in a few seconds with get_image_status.`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              status: 'processing',
            },
          }
        }

        if (result.success && result.ready) {
          const lines = [`Image ready (order ${result.orderId}).`]
          if (result.note) {
            lines.push(result.note)
            lines.push(
              'The cached image is no longer available (it was already delivered or expired), so it cannot be downloaded again.'
            )
          } else {
            lines.push(
              `Download it from the command line: paytaca ai image status ${result.orderId}`
            )
            lines.push(
              'Run the download promptly — the generated image is cached server-side for only ~10 minutes.'
            )
          }
          if (result.model) lines.push(`Model: ${result.model}`)
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: result.status,
              mediaType: result.mediaType,
              ready: true,
              note: result.note,
            },
          }
        }

        return fail(new Error(result.error || 'Image generation failed.'))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'generate_image',
    {
      title: 'Generate an image',
      description:
        'Generate an image from a text prompt with a Paytaca AI image model. Pays BCH on-chain from the active wallet (SPENDS REAL FUNDS). Returns metadata only (no image bytes); download the image from the command line with `paytaca ai image status <order_id>`. The MCP host must obtain user approval before calling this.',
      inputSchema: {
        prompt: z.string().min(1),
        model: z.string().optional(),
        aspect_ratio: z.string().optional(),
        quality: z.string().optional(),
        resolution: z.string().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ prompt, model, aspect_ratio, quality, resolution, chipnet, backend }) => {
      try {
        const result = await generateImage({
          prompt,
          model,
          aspectRatio: aspect_ratio,
          quality,
          resolution,
          isChipnet: cn(chipnet),
          backendUrl: backend,
          deferDownload: true,
        })

        if (isStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Image generation is still processing (order ${result.orderId}).`,
                  `The generation is running server-side — call get_image_status with order_id "${result.orderId}" to check it, then run \`paytaca ai image status ${result.orderId}\` to download it.`,
                  `Model: ${result.model}`,
                  `Paid: ${result.amountSats} sats (txid: ${result.txid})`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: 'processing',
              amountSats: result.amountSats,
              amountUsd: result.amountUsd,
              txid: result.txid,
            },
          }
        }

        if (!result.success || !result.ready) {
          return fail(new Error(result.error || 'Image generation failed.'))
        }

        const lines = [
          `Image generated (order ${result.orderId}).`,
          `Download it from the command line: paytaca ai image status ${result.orderId}`,
          'Run the download promptly — the generated image is cached server-side for only ~10 minutes.',
        ]
        if (result.model) lines.push(`Model: ${result.model}`)
        if (result.amountSats !== undefined) lines.push(`Cost: ${result.amountSats} sats`)
        if (result.txid) lines.push(`txid: ${result.txid}`)
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: {
            orderId: result.orderId,
            model: result.model,
            status: result.status,
            mediaType: result.mediaType,
            ready: true,
            amountSats: result.amountSats,
            amountUsd: result.amountUsd,
            txid: result.txid,
          },
        }
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_video_models',
    {
      title: 'List video models',
      description:
        'List the video generation models available through Paytaca AI.',
      inputSchema: {
        search: z.string().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ search, backend }) => {
      try {
        return json(await listVideoModels({ search, backendUrl: backend }))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_video_history',
    {
      title: 'Get video order history',
      description: 'Return paginated Paytaca video generation order history.',
      inputSchema: {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ page, page_size, backend }) => {
      try {
        return json(
          await getVideoHistory({ page, pageSize: page_size, backendUrl: backend })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_video_status',
    {
      title: 'Poll video generation status',
      description:
        'Poll an existing video generation order by ID. When generation is complete, returns metadata only (no video bytes) plus a command to download the video from the command line. If still processing, returns the current status so you can retry later. Use this to resume after generate_video returns a "processing" status.',
      inputSchema: {
        order_id: z.string().min(1),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ order_id, chipnet, backend }) => {
      try {
        const result = await getVideoOrderStatus(order_id, {
          isChipnet: cn(chipnet),
          backendUrl: backend,
          download: false,
        })

        if (isVideoStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Video generation is still processing (order ${result.orderId}).`,
                  `Try again in a few seconds with get_video_status.`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              status: 'processing',
            },
          }
        }

        if (result.success && result.ready) {
          const lines = [`Video ready (order ${result.orderId}).`]
          if (result.note) {
            lines.push(result.note)
            lines.push(
              'The cached video is no longer available (it was already delivered or expired), so it cannot be downloaded again.'
            )
          } else {
            lines.push(
              `Download it from the command line: paytaca ai video status ${result.orderId}`
            )
            lines.push(
              'Run the download promptly — the generated video is cached server-side for only a limited time.'
            )
          }
          if (result.model) lines.push(`Model: ${result.model}`)
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: result.status,
              mediaType: result.mediaType,
              ready: true,
              note: result.note,
            },
          }
        }

        return fail(new Error(result.error || 'Video generation failed.'))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'generate_video',
    {
      title: 'Generate a video',
      description:
        'Generate a video from a text prompt with a Paytaca AI video model. Pays BCH on-chain from the active wallet (SPENDS REAL FUNDS). Returns metadata only (no video bytes); download the video from the command line with `paytaca ai video status <order_id>`. The MCP host must obtain user approval before calling this.',
      inputSchema: {
        prompt: z.string().min(1),
        model: z.string().optional(),
        duration: z.number().int().positive().optional(),
        resolution: z.string().optional(),
        aspect_ratio: z.string().optional(),
        generate_audio: z.boolean().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      prompt,
      model,
      duration,
      resolution,
      aspect_ratio,
      generate_audio,
      chipnet,
      backend,
    }) => {
      try {
        const result = await generateVideo({
          prompt,
          model,
          duration,
          resolution,
          aspectRatio: aspect_ratio,
          generateAudio: generate_audio,
          isChipnet: cn(chipnet),
          backendUrl: backend,
          deferDownload: true,
        })

        if (isVideoStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Video generation is still processing (order ${result.orderId}).`,
                  `The generation is running server-side — call get_video_status with order_id "${result.orderId}" to check it, then run \`paytaca ai video status ${result.orderId}\` to download it.`,
                  `Model: ${result.model}`,
                  `Paid: ${result.amountSats} sats (txid: ${result.txid})`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: 'processing',
              amountSats: result.amountSats,
              amountUsd: result.amountUsd,
              txid: result.txid,
            },
          }
        }

        if (!result.success || !result.ready) {
          return fail(new Error(result.error || 'Video generation failed.'))
        }

        const lines = [
          `Video generated (order ${result.orderId}).`,
          `Download it from the command line: paytaca ai video status ${result.orderId}`,
          'Run the download promptly — the generated video is cached server-side for only a limited time.',
        ]
        if (result.model) lines.push(`Model: ${result.model}`)
        if (result.amountSats !== undefined) lines.push(`Cost: ${result.amountSats} sats`)
        if (result.txid) lines.push(`txid: ${result.txid}`)
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: {
            orderId: result.orderId,
            model: result.model,
            status: result.status,
            mediaType: result.mediaType,
            ready: true,
            amountSats: result.amountSats,
            amountUsd: result.amountUsd,
            txid: result.txid,
          },
        }
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_audio_models',
    {
      title: 'List audio models',
      description:
        'List the audio (text-to-speech) models available through Paytaca AI.',
      inputSchema: {
        search: z.string().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ search, backend }) => {
      try {
        return json(await listAudioModels({ search, backendUrl: backend }))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_audio_history',
    {
      title: 'Get audio order history',
      description: 'Return paginated Paytaca audio generation order history.',
      inputSchema: {
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ page, page_size, backend }) => {
      try {
        return json(
          await getAudioHistory({ page, pageSize: page_size, backendUrl: backend })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'get_audio_status',
    {
      title: 'Poll audio generation status',
      description:
        'Poll an existing audio generation order by ID. When generation is complete, returns metadata only (no audio bytes) plus a command to download the audio from the command line. If still processing, returns the current status so you can retry later. Use this to resume after generate_audio returns a "processing" status.',
      inputSchema: {
        order_id: z.string().min(1),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ order_id, chipnet, backend }) => {
      try {
        const result = await getAudioOrderStatus(order_id, {
          isChipnet: cn(chipnet),
          backendUrl: backend,
          download: false,
        })

        if (isAudioStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Audio generation is still processing (order ${result.orderId}).`,
                  `Try again in a few seconds with get_audio_status.`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              status: 'processing',
            },
          }
        }

        if (result.success && result.ready) {
          const lines = [`Audio ready (order ${result.orderId}).`]
          if (result.note) {
            lines.push(result.note)
            lines.push(
              'The cached audio is no longer available (it was already delivered or expired), so it cannot be downloaded again.'
            )
          } else {
            lines.push(
              `Download it from the command line: paytaca ai audio status ${result.orderId}`
            )
            lines.push(
              'Run the download promptly — the generated audio is cached server-side for only a limited time.'
            )
          }
          if (result.model) lines.push(`Model: ${result.model}`)
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: result.status,
              mediaType: result.mediaType,
              ready: true,
              note: result.note,
            },
          }
        }

        return fail(new Error(result.error || 'Audio generation failed.'))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    'generate_audio',
    {
      title: 'Generate speech from text',
      description:
        'Generate speech from a text prompt with a Paytaca AI audio (text-to-speech) model. Pays BCH on-chain from the active wallet (SPENDS REAL FUNDS). Returns metadata only (no audio bytes); download the audio from the command line with `paytaca ai audio status <order_id>`. The MCP host must obtain user approval before calling this.',
      inputSchema: {
        prompt: z.string().min(1),
        model: z.string().optional(),
        voice: z.string().optional(),
        response_format: z.enum(['mp3', 'pcm']).optional(),
        speed: z.number().positive().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ prompt, model, voice, response_format, speed, chipnet, backend }) => {
      try {
        const result = await generateAudio({
          prompt,
          model,
          voice,
          responseFormat: response_format,
          speed,
          isChipnet: cn(chipnet),
          backendUrl: backend,
          deferDownload: true,
        })

        if (isAudioStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Audio generation is still processing (order ${result.orderId}).`,
                  `The generation is running server-side — call get_audio_status with order_id "${result.orderId}" to check it, then run \`paytaca ai audio status ${result.orderId}\` to download it.`,
                  `Model: ${result.model}`,
                  `Paid: ${result.amountSats} sats (txid: ${result.txid})`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: 'processing',
              amountSats: result.amountSats,
              amountUsd: result.amountUsd,
              txid: result.txid,
            },
          }
        }

        if (!result.success || !result.ready) {
          return fail(new Error(result.error || 'Audio generation failed.'))
        }

        const lines = [
          `Audio generated (order ${result.orderId}).`,
          `Download it from the command line: paytaca ai audio status ${result.orderId}`,
          'Run the download promptly — the generated audio is cached server-side for only a limited time.',
        ]
        if (result.model) lines.push(`Model: ${result.model}`)
        if (result.amountSats !== undefined) lines.push(`Cost: ${result.amountSats} sats`)
        if (result.txid) lines.push(`txid: ${result.txid}`)
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: {
            orderId: result.orderId,
            model: result.model,
            status: result.status,
            mediaType: result.mediaType,
            ready: true,
            amountSats: result.amountSats,
            amountUsd: result.amountUsd,
            txid: result.txid,
          },
        }
      } catch (err) {
        return fail(err)
      }
    }
  )
}