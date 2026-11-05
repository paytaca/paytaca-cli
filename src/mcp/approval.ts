import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
import { formatSpendCost, createSpendCostResolver } from '../utils/prices.js'
import { PAY_MEDIA_TOOL, verifyOmpPayMediaGate } from '../ai/ompGuard.js'

/** One selectable model, with the price hint shown next to it. */
export interface MediaModelOption {
  id: string
  priceHint: string
}

/** One optional, flat form field exposed to the user. */
export interface MediaParamField {
  name: string
  label: string
  description?: string
  /** Allowed values. The literal `auto` means "leave the model default". */
  options: string[]
  optionLabels?: string[]
  value: string
}

export interface MediaQuoteSummary {
  amountSats: number
  amountUsd?: number
  /** Extra lines describing the quoted request (e.g. "Duration: 5s"). */
  lines: string[]
}

export interface MediaSelection {
  modelId: string
  params: Record<string, string>
}

export interface MediaSpendRequest<Q> {
  kind: 'image' | 'video' | 'audio'
  prompt: string
  isChipnet: boolean
  /** The model the agent asked for (or the cheapest), preselected in the form. */
  recommendedModelId: string
  models: MediaModelOption[]
  /** Form fields for the currently selected model and parameter values. */
  paramFields: (selection: MediaSelection) => MediaParamField[]
  /** Create an unpaid order for the selection. Moves no funds. */
  createQuote: (
    selection: MediaSelection
  ) => Promise<{ quote: Q; summary: MediaQuoteSummary }>
  /**
   * Record the approval for a host that cannot elicit one. Returns a short
   * handle the user feeds to `paytaca approve` in their own terminal.
   */
  persistPending?: (
    selection: MediaSelection,
    quoted: { quote: Q; summary: MediaQuoteSummary }
  ) => Promise<{ id: string }>
}

export type MediaSpendOutcome<Q> =
  | {
      status: 'approved'
      quote: Q
      summary: MediaQuoteSummary
      selection: MediaSelection
    }
  | {
      status: 'pending'
      id: string
      quote: Q
      summary: MediaQuoteSummary
      selection: MediaSelection
      /**
       * Where the user should complete the approval. `pay_media` means the host
       * enforces an in-UI prompt for that tool, so the agent may call it;
       * `terminal` means the user must run `paytaca approve`.
       */
      approvalMode: 'pay_media' | 'terminal'
      prompt: string
      model?: string
      params: Record<string, string>
    }
  | { status: 'declined'; reason: string }
  | { status: 'unavailable'; reason: string; cliCommand: string }

/** Max times the form is shown when the user keeps changing the selection. */
const MAX_ROUNDS = 3

/**
 * Form elicitation is the only approval channel we can enforce, so anything
 * less than that capability must fail closed rather than spend.
 */
function hasElicitation(server: McpServer): boolean {
  try {
    return Boolean(server.server.getClientCapabilities()?.elicitation?.form)
  } catch {
    return false
  }
}

function clientName(server: McpServer): string | undefined {
  try {
    return server.server.getClientVersion()?.name
  } catch {
    return undefined
  }
}

/** Where a pending approval should be completed for this host. */
function pendingApprovalMode(server: McpServer): 'pay_media' | 'terminal' {
  return verifyOmpPayMediaGate(clientName(server)).verified
    ? 'pay_media'
    : 'terminal'
}

function modelLabel(option: MediaModelOption, recommended: boolean): string {
  const name = option.id === 'default' ? 'backend default model' : option.id
  const suffix = recommended ? ' (recommended)' : ''
  return `${name} — ${option.priceHint}${suffix}`
}

function paramSchema(field: MediaParamField): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: 'string',
    title: field.label,
    enum: field.options,
    default: field.options.includes(field.value) ? field.value : field.options[0],
  }
  if (field.description) schema.description = field.description
  if (field.optionLabels && field.optionLabels.length === field.options.length) {
    schema.enumNames = field.optionLabels
  }
  return schema
}

/**
 * Render the user's prompt on one bounded line so it cannot inject extra
 * lines that look like server-generated details (price, model, network).
 */
function quotePrompt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  const clipped = flat.length > 300 ? `${flat.slice(0, 297)}...` : flat
  return `"${clipped.replace(/"/g, "'")}"`
}

function describe<Q>(
  request: MediaSpendRequest<Q>,
  summary: MediaQuoteSummary,
  selection: MediaSelection,
  cost: string
): string {
  const model = request.models.find((m) => m.id === selection.modelId)
  const lines = [
    `Approve ${request.kind} generation?`,
    '',
    `Prompt:  ${quotePrompt(request.prompt)}`,
    `Model:   ${model ? modelLabel(model, selection.modelId === request.recommendedModelId) : selection.modelId}`,
    `Cost:    ${cost}`,
    `Network: ${request.isChipnet ? 'chipnet (testnet)' : 'mainnet'}`,
  ]
  for (const line of summary.lines) lines.push(line)
  lines.push('')
  lines.push(
    'Choose a model or change any optional parameter below, then approve to pay.'
  )
  lines.push('Declining or cancelling spends nothing.')
  return lines.join('\n')
}

/** The starting selection: the recommended model with its default parameters. */
export function seedSelection<Q>(request: MediaSpendRequest<Q>): MediaSelection {
  const seed: MediaSelection = { modelId: request.recommendedModelId, params: {} }
  return {
    modelId: seed.modelId,
    params: Object.fromEntries(
      request.paramFields(seed).map((field) => [field.name, field.value])
    ),
  }
}

/**
 * Ask the user to approve a media generation spend.
 *
 * Creates an unpaid order (no funds move), shows the exact quoted cost, and
 * pays nothing unless the host returns an explicit `accept` for that quote.
 * Hosts without elicitation support get a pending approval the user completes
 * with `paytaca approve` in their own terminal — never a silent spend.
 */
export async function confirmMediaSpend<Q>(
  server: McpServer,
  request: MediaSpendRequest<Q>,
  cliCommand: string
): Promise<MediaSpendOutcome<Q>> {
  if (!hasElicitation(server)) {
    if (!request.persistPending) {
      return {
        status: 'unavailable',
        reason:
          'this MCP host does not support elicitation, so Paytaca cannot show the request and get your explicit approval.',
        cliCommand,
      }
    }
    const selection = seedSelection(request)
    try {
      const quoted = await request.createQuote(selection)
      const pending = await request.persistPending(selection, quoted)
      return {
        status: 'pending',
        id: pending.id,
        quote: quoted.quote,
        summary: quoted.summary,
        selection,
        approvalMode: pendingApprovalMode(server),
        prompt: request.prompt,
        model: selection.modelId === 'default' ? undefined : selection.modelId,
        params: selection.params,
      }
    } catch (err: any) {
      return {
        status: 'unavailable',
        reason: `Paytaca could not prepare the approval request (${err?.message || err}).`,
        cliCommand,
      }
    }
  }

  let selection = seedSelection(request)

  let quoted: { quote: Q; summary: MediaQuoteSummary } | null = null
  let cost = ''
  let fields: MediaParamField[] = []
  const resolveCost = createSpendCostResolver(request.isChipnet)

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Safe on the first round: `selection` was seeded with the recommended
    // model's defaults above, so this quotes a fully initialized selection.
    quoted = await request.createQuote(selection)
    const spend = await resolveCost(
      quoted.summary.amountSats,
      quoted.summary.amountUsd
    )
    cost = `${formatSpendCost(spend)} (${quoted.summary.amountSats} sats)`

    fields = request.paramFields(selection)
    const properties: Record<string, unknown> = {
      model: {
        type: 'string',
        title: 'Model',
        enum: request.models.map((m) => m.id),
        enumNames: request.models.map((m) =>
          modelLabel(m, m.id === request.recommendedModelId)
        ),
        default: request.models.some((m) => m.id === selection.modelId)
          ? selection.modelId
          : request.models[0]?.id,
      },
    }
    for (const field of fields) properties[field.name] = paramSchema(field)

    let action: string
    let content: Record<string, unknown> = {}
    try {
      const result = await server.server.elicitInput({
        mode: 'form',
        message: describe(request, quoted.summary, selection, cost),
        requestedSchema: {
          type: 'object',
          properties,
        } as ElicitRequestFormParams['requestedSchema'],
      })
      action = result.action
      content = (result.content ?? {}) as Record<string, unknown>
    } catch (err: any) {
      // A host can advertise elicitation and still fail to answer (for example
      // an older client that throws MethodNotFound). Fall back to a pending
      // approval rather than forcing the user to reconstruct the command.
      if (request.persistPending && quoted) {
        try {
          const pending = await request.persistPending(selection, quoted)
          return {
            status: 'pending',
            id: pending.id,
            quote: quoted.quote,
            summary: quoted.summary,
            selection,
            approvalMode: pendingApprovalMode(server),
            prompt: request.prompt,
            model: selection.modelId === 'default' ? undefined : selection.modelId,
            params: selection.params,
          }
        } catch {
          // Fall through to the unavailable outcome below.
        }
      }
      return {
        status: 'unavailable',
        reason: `the approval prompt failed (${err?.message || err}).`,
        cliCommand,
      }
    }

    if (action !== 'accept') {
      return {
        status: 'declined',
        reason:
          action === 'decline'
            ? 'the user declined this generation; nothing was charged.'
            : 'the user cancelled the approval prompt; nothing was charged.',
      }
    }

    const chosenModel =
      typeof content.model === 'string' && content.model
        ? content.model
        : selection.modelId
    const chosenParams: Record<string, string> = {}
    for (const field of fields) {
      const raw = content[field.name]
      const value = typeof raw === 'string' && raw ? raw : field.value
      chosenParams[field.name] = value
    }

    const changed =
      chosenModel !== selection.modelId ||
      fields.some((field) => chosenParams[field.name] !== field.value)

    if (!changed) {
      return {
        status: 'approved',
        quote: quoted.quote,
        summary: quoted.summary,
        selection,
      }
    }

    if (chosenModel === selection.modelId) {
      selection = { modelId: chosenModel, params: chosenParams }
    } else {
      // A different model may not support the previous values (e.g. a 10s
      // clip), so drop anything the new model does not offer.
      const reset = request.paramFields({ modelId: chosenModel, params: {} })
      const params: Record<string, string> = {}
      for (const field of reset) {
        const wanted = chosenParams[field.name]
        params[field.name] =
          wanted && field.options.includes(wanted) ? wanted : field.value
      }
      selection = { modelId: chosenModel, params }
    }
  }

  return {
    status: 'declined',
    reason: `the selection was changed on all ${MAX_ROUNDS} approval prompts without an approval; nothing was charged.`,
  }
}

/** Shell-quote a prompt for the CLI fallback hint. */
export function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}
