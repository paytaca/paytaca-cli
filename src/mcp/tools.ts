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
import { requireWallet } from '../core/context.js'
import { getConfig } from '../ai/client.js'
import { listModels, listPlans } from '../ai/models.js'
import {
  getWalletStatus,
  summarizeCredits,
} from '../ai/credits.js'
import { aiChat } from '../ai/chat.js'
import { buyPlan } from '../ai/purchase.js'
import {
  armAutoRefill,
  disarmAutoRefill,
  readAutoRefillState,
  remainingBudget,
} from '../ai/autoRefill.js'

type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] }
}

function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2))
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
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
  get_plans              Plan pricing grouped by tier
  get_credits            Remaining AI time credits
  buy_plan               Buy an AI plan with BCH or LIFT (spends funds)
  auto_refill            Arm/disarm/inspect automatic plan refills
  ai_chat                Non-streaming chat via Paytaca AI

Notes:
  - All tools accept an optional "chipnet" flag (default mainnet).
  - send and buy_plan spend real funds from the active wallet; the MCP host
    is responsible for asking the user for approval before invoking them.
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
        'Return plan pricing grouped by tier. Pass model to filter a single model.',
      inputSchema: {
        model: z.string().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ model, backend }) => {
      try {
        const config = await getConfig({ backendUrl: backend })
        return json(listPlans(config, model))
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
        'Return remaining Paytaca AI time credits, optionally for one model.',
      inputSchema: {
        model: z.string().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ model, chipnet, backend }) => {
      try {
        const ctx = requireWallet(cn(chipnet))
        const status = await getWalletStatus(ctx.walletHash, {
          modelId: model,
          backendUrl: backend,
        })
        return json(summarizeCredits(status, model))
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
    'ai_chat',
    {
      title: 'Chat with Paytaca AI',
      description:
        'Send a non-streaming chat request to a Paytaca AI model. Returns the assistant reply, or a payment_required note if a plan must be bought first.',
      inputSchema: {
        message: z.string(),
        model: z.string().optional(),
        system: z.string().optional(),
        chipnet: z.boolean().optional(),
        backend: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ message, model, system, chipnet, backend }) => {
      try {
        const ctx = requireWallet(cn(chipnet))
        return json(
          await aiChat({
            messages: [{ role: 'user', content: message }],
            model,
            system,
            walletHash: ctx.walletHash,
            backendUrl: backend,
          })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}