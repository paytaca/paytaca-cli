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
import { listModels, listPlans, selectModel, formatPriceUsd, formatDuration } from '../ai/models.js'
import type { PlanView } from '../ai/models.js'
import {
  getWalletStatus,
  summarizeCredits,
  summarizeAllCredits,
  buildPurchaseHint,
  formatRemaining,
  type CreditsSummary,
  type PurchaseHint,
} from '../ai/credits.js'
import { buyPlan } from '../ai/purchase.js'
import {
  generateImage,
  getImageHistory,
  getImageOrderStatus,
  isStillProcessing,
  listImageModels,
} from '../ai/images.js'
import {
  armAutoRefill,
  disarmAutoRefill,
  readAutoRefillState,
  remainingBudget,
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

function clientName(server: McpServer): string {
  return server.server.getClientVersion()?.name ?? ''
}

function creditsResponse(
  server: McpServer,
  sessions: CreditsSummary[],
  hint: PurchaseHint | null,
  payload: Record<string, unknown>
): ToolResult {
  const name = clientName(server)
  if (name.startsWith('pi-mcp')) {
    return {
      content: [{ type: 'text', text: creditsText(sessions, hint) }],
      structuredContent: payload,
    }
  }
  if (name === 'opencode') {
    return {
      content: [{ type: 'text', text: creditsMarkdown(sessions, hint) }],
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

function creditsText(sessions: CreditsSummary[], hint?: PurchaseHint | null): string {
  const lines: string[] = ['Paytaca AI credits', '']
  if (sessions.length === 0) {
    lines.push('No AI credit sessions found.')
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
  if (hint) {
    lines.push('', hint.message)
  }
  return lines.join('\n')
}

function creditsMarkdown(sessions: CreditsSummary[], hint?: PurchaseHint | null): string {
  const lines: string[] = ['## Paytaca AI credits', '']
  if (sessions.length === 0) {
    lines.push('No AI credit sessions found.')
  } else {
    lines.push('| Model | Status | Remaining | Used | Token limit |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const r of creditRows(sessions)) {
      lines.push(`| ${r.name} | ${r.status} | ${r.remaining} | ${r.used} | ${r.limit} |`)
    }
  }
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
  get_credits            Remaining AI time credits
  buy_plan               Buy an AI plan with BCH or LIFT (spends funds)
  auto_refill            Arm/disarm/inspect automatic plan refills

Image generation:
  generate_image         Generate an image from a prompt (spends funds)
  get_image_status       Poll/resume a pending image generation order
  get_image_models       List image generation models
  get_image_history      Image generation order history

Notes:
  - All tools accept an optional "chipnet" flag (default mainnet).
  - send, buy_plan, and generate_image spend real funds from the active
    wallet; the MCP host is responsible for asking the user for approval
    before invoking them.
  - When get_credits reports an inactive session it includes a purchaseHint.
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
        'Return remaining Paytaca AI time credits for all models, or for one model when "model" is given. When a session is inactive, includes a purchaseHint whose "message" is the exact text to relay to the user (a copy-paste top-up command) instead of upsell or follow-up questions.',
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
        if (!model) {
          const sessions = summarizeAllCredits(status)
          const payload: Record<string, unknown> = { sessions }
          let hint: PurchaseHint | null = null
          if (!sessions.some((s) => s.active)) {
            hint = await resolvePurchaseHint(
              sessions[0]?.modelId ?? undefined,
              backend
            )
            if (hint) payload.purchaseHint = hint
          }
          return creditsResponse(server, sessions, hint, payload)
        }
        const summary = summarizeCredits(status, model)
        const payload: Record<string, unknown> = { ...summary }
        let hint: PurchaseHint | null = null
        if (!summary.active) {
          hint = await resolvePurchaseHint(model, backend)
          if (hint) payload.purchaseHint = hint
        }
        return creditsResponse(server, [summary], hint, payload)
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
    'auto_refill',
    {
      title: 'Manage auto-refill',
      description:
        'Arm, disarm, or inspect automatic plan refills. Arming buys a plan silently when credits run out, up to max_minutes.',
      inputSchema: {
        enabled: z.boolean().optional(),
        model: z.string().optional(),
        minutes: z.number().int().positive().optional(),
        max_minutes: z.number().int().positive().optional(),
        payment_method: z.enum(['bch', 'lift']).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ enabled, model, minutes, max_minutes, payment_method }) => {
      try {
        if (enabled === false) {
          return json(disarmAutoRefill())
        }

        if (enabled === true) {
          if (!model || !minutes || !max_minutes) {
            return fail(
              new Error(
                'Arming auto-refill requires model, minutes, and max_minutes.'
              )
            )
          }
          return json(
            armAutoRefill({
              model,
              minutes,
              maxMinutes: max_minutes,
              paymentMethod: payment_method ?? 'bch',
            })
          )
        }

        const state = readAutoRefillState()
        return json({
          armed: Boolean(state?.enabled),
          remainingMinutes: remainingBudget(state),
          state,
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
        'Poll an existing image generation order by ID. If generation is complete, returns the image inline plus the saved file path. If still processing, returns the current status so you can retry later. Use this to resume after generate_image returns a "processing" status.',
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
        })

        if (result.success && result.base64) {
          const mediaType = result.mediaType || 'image/png'
          return {
            content: [
              { type: 'image' as const, data: result.base64, mimeType: mediaType },
              {
                type: 'text' as const,
                text: [
                  `Image ready (order ${result.orderId}).`,
                  `Saved to: ${result.path}`,
                  `Model: ${result.model}`,
                  `Cost: ${result.amountSats} sats`,
                  `txid: ${result.txid}`,
                ].join('\n'),
              },
            ],
            structuredContent: {
              orderId: result.orderId,
              model: result.model,
              status: result.status,
              path: result.path,
              mediaType: result.mediaType,
              amountSats: result.amountSats,
              amountUsd: result.amountUsd,
              txid: result.txid,
            },
          }
        }

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
        'Generate an image from a text prompt with a Paytaca AI image model. Pays BCH on-chain from the active wallet (SPENDS REAL FUNDS). Returns the image inline plus the file path where it was saved. The MCP host must obtain user approval before calling this.',
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
        })

        if (isStillProcessing(result)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Image generation is still processing (order ${result.orderId}).`,
                  `The generation is running server-side — call get_image_status with order_id "${result.orderId}" to retrieve the result.`,
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

        if (!result.success || !result.base64) {
          return fail(new Error(result.error || 'Image generation failed.'))
        }
        const mediaType = result.mediaType || 'image/png'
        return {
          content: [
            { type: 'image' as const, data: result.base64, mimeType: mediaType },
            {
              type: 'text' as const,
              text: [
                `Image generated (order ${result.orderId}).`,
                `Saved to: ${result.path}`,
                `Model: ${result.model}`,
                `Cost: ${result.amountSats} sats`,
                `txid: ${result.txid}`,
              ].join('\n'),
            },
          ],
          structuredContent: {
            orderId: result.orderId,
            model: result.model,
            status: result.status,
            path: result.path,
            mediaType: result.mediaType,
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