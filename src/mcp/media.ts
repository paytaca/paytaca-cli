import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createImageOrder,
  listImageModels,
  type ImageModel,
  type ImageOrderQuote,
} from '../ai/images.js'
import {
  createAudioOrder,
  listAudioModels,
  type AudioModel,
  type AudioOrderQuote,
} from '../ai/audio.js'
import {
  createVideoOrder,
  listVideoModels,
  type VideoModel,
  type VideoOrderQuote,
} from '../ai/videos.js'
import { formatCostUsd } from '../utils/prices.js'
import {
  savePendingApproval,
  type AudioGenerationArgs,
  type ImageGenerationArgs,
  type PendingKind,
  type VideoGenerationArgs,
} from '../ai/pending.js'
import {
  confirmMediaSpend,
  shellQuote,
  type MediaModelOption,
  type MediaParamField,
  type MediaSelection,
  type MediaSpendOutcome,
  type MediaSpendRequest,
} from './approval.js'

export type {
  AudioGenerationArgs,
  ImageGenerationArgs,
  VideoGenerationArgs,
} from '../ai/pending.js'

/** Sentinel form value meaning "leave this to the model/backend default". */
const AUTO = 'auto'

function option(value: string | undefined | null, fallback: string): string {
  if (value === undefined || value === null) return fallback
  return value || fallback
}

function paramOrUndefined(value: string | undefined): string | undefined {
  if (!value || value === AUTO) return undefined
  return value
}

/**
 * Coerce a numeric form value, dropping anything non-finite. The host echoes
 * form values back, so a hostile or buggy client can send "abc" for a numeric
 * field; that must not reach the backend as NaN.
 */
function numberParam(value: string | undefined): number | undefined {
  const raw = paramOrUndefined(value)
  if (raw === undefined) return undefined
  const num = Number(raw)
  return Number.isFinite(num) ? num : undefined
}

/** Keep the caller's value selectable even when the model list omits it. */
function withValue(options: string[], value: string | undefined): string[] {
  if (!value || value === AUTO || options.includes(value)) return options
  return [...options, value]
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function pickModel<T extends { id: string; display_name?: string }>(
  models: T[],
  wanted?: string
): T | undefined {
  const list = models.filter((m) => m && m.id)
  if (list.length === 0) return undefined
  if (wanted) {
    const q = wanted.toLowerCase()
    const exact = list.find(
      (m) =>
        m.id.toLowerCase() === q ||
        String(m.display_name || '').toLowerCase() === q
    )
    if (exact) return exact
    const partial = list.find(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        String(m.display_name || '').toLowerCase().includes(q)
    )
    if (partial) return partial
  }
  return undefined
}

/** Recommended (or cheapest) model first, then up to four alternatives. */
function buildOptions<T extends { id: string }>(
  models: T[],
  recommended: T | undefined,
  priceHint: (model: T) => string,
  costOf: (model: T) => number
): MediaModelOption[] {
  const sorted = [...models].sort((a, b) => costOf(a) - costOf(b))
  const head = recommended ?? sorted[0]
  if (!head) return []
  const rest = sorted.filter((m) => m.id !== head.id).slice(0, 4)
  return [head, ...rest].map((m) => ({ id: m.id, priceHint: priceHint(m) }))
}

function fallbackOptions(
  wanted: string | undefined,
  hint: string
): MediaModelOption[] {
  return [{ id: wanted || 'default', priceHint: hint }]
}

function quoteModelId(selection: MediaSelection): string | undefined {
  return selection.modelId === 'default' ? undefined : selection.modelId
}

function paramLines(selection: MediaSelection): string[] {
  const shown = Object.entries(selection.params)
    .filter(([, value]) => value && value !== AUTO)
    .map(([key, value]) => `${key}: ${value}`)
  return shown.length > 0 ? [`Params:  ${shown.join(' · ')}`] : []
}

/**
 * Build the spend request for an image. Shared by the MCP approval path and
 * the terminal `paytaca approve` path so both show identical quotes.
 */
export async function buildImageSpendRequest(
  args: ImageGenerationArgs
): Promise<MediaSpendRequest<ImageOrderQuote>> {
  let models: ImageModel[] = []
  try {
    models = await listImageModels({ backendUrl: args.backendUrl })
  } catch {
    models = []
  }
  const needsReferences = Boolean(args.input_references?.length)
  const eligible = needsReferences
    ? models.filter(
        (m) => m.supported_parameters && 'input_references' in m.supported_parameters
      )
    : models
  const usable = eligible.length > 0 ? eligible : models

  const unitOf = (m: ImageModel) => {
    const unit = m.pricing_unit ?? 'image'
    if (unit === 'megapixel') return 'per megapixel'
    if (unit === 'token') return 'per token'
    return 'per image'
  }
  const costOf = (m: ImageModel) =>
    m.cost_per_unit_usd ?? Number.POSITIVE_INFINITY
  const priceHint = (m: ImageModel) =>
    m.cost_per_unit_usd !== undefined
      ? `${formatCostUsd(m.cost_per_unit_usd)} ${unitOf(m)}`
      : 'price quoted on approval'

  const options =
    usable.length > 0
      ? buildOptions(usable, pickModel(usable, args.model), priceHint, costOf)
      : fallbackOptions(args.model, 'price quoted on approval')
  const recommendedModelId = options[0]?.id ?? 'default'

  return {
    kind: 'image',
    prompt: args.prompt,
    isChipnet: args.isChipnet,
    recommendedModelId,
    models: options,
    paramFields: (selection) => imageParamFields(args, selection),
    createQuote: async (selection) => {
      const quote = await createImageOrder({
        prompt: args.prompt,
        model: quoteModelId(selection),
        aspectRatio: paramOrUndefined(selection.params.aspect_ratio),
        quality: paramOrUndefined(selection.params.quality),
        resolution: paramOrUndefined(selection.params.resolution),
        inputReferences: args.input_references,
        isChipnet: args.isChipnet,
        backendUrl: args.backendUrl,
      })
      return {
        quote,
        summary: {
          amountSats: quote.amountSats,
          amountUsd: quote.amountUsd,
          lines: [`Order:   ${quote.orderId}`, ...paramLines(selection)],
        },
      }
    },
    persistPending: (selection, quoted) =>
      persist('image', args, selection, quoted.quote, quoted.summary),
  }
}

export async function approveImageGeneration(
  server: McpServer,
  args: ImageGenerationArgs
): Promise<MediaSpendOutcome<ImageOrderQuote>> {
  const cliCommand = [
    'paytaca ai image generate',
    shellQuote(args.prompt),
    args.model ? `--model ${args.model}` : '',
    args.aspect_ratio ? `--aspect-ratio ${args.aspect_ratio}` : '',
    args.quality ? `--quality ${args.quality}` : '',
    args.resolution ? `--resolution ${args.resolution}` : '',
    ...(args.input_references ?? []).map(
      (ref) => `--input-reference ${shellQuote(ref)}`
    ),
    args.isChipnet ? '--chipnet' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const request = await buildImageSpendRequest(args)
  return confirmMediaSpend(server, request, cliCommand)
}

function imageParamFields(
  args: ImageGenerationArgs,
  selection: MediaSelection
): MediaParamField[] {
  const field = (
    name: string,
    label: string,
    description: string,
    options: string[],
    requested?: string
  ): MediaParamField => {
    const value = selection.params[name] ?? option(requested, AUTO)
    return {
      name,
      label,
      description,
      options: withValue(options, value),
      value: value || AUTO,
    }
  }
  return [
    field(
      'aspect_ratio',
      'Aspect ratio',
      'Output aspect ratio.',
      [AUTO, '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      args.aspect_ratio
    ),
    field(
      'quality',
      'Quality',
      'Rendering quality.',
      [AUTO, 'low', 'medium', 'high'],
      args.quality
    ),
    field(
      'resolution',
      'Resolution',
      'Output resolution.',
      [AUTO, '512', '1K', '2K', '4K'],
      args.resolution
    ),
  ]
}

/**
 * Build the spend request for a video. Shared by the MCP approval path and the
 * terminal `paytaca approve` path.
 */
export async function buildVideoSpendRequest(
  args: VideoGenerationArgs
): Promise<MediaSpendRequest<VideoOrderQuote>> {
  let models: VideoModel[] = []
  try {
    models = await listVideoModels({ backendUrl: args.backendUrl })
  } catch {
    models = []
  }
  const needsReferences = Boolean(args.input_references?.length)
  const eligible = needsReferences
    ? models.filter(
        (m) =>
          Array.isArray(m.input_reference_types) &&
          m.input_reference_types.length > 0
      )
    : models
  const usable = eligible.length > 0 ? eligible : models
  const modelById = new Map(usable.map((m) => [m.id, m]))

  const unitOf = (m: VideoModel) => {
    const unit = m.pricing_unit ?? 'second'
    if (unit === 'second' || unit === 'second_cents') return 'per second'
    if (unit === 'token') return 'per token'
    if (unit === 'megapixel_second_cents') return 'per megapixel-second'
    return `per ${unit}`
  }
  const costOf = (m: VideoModel) =>
    m.cost_per_unit_usd ?? m.cost_per_unit_no_audio_usd ?? Number.POSITIVE_INFINITY
  const priceHint = (m: VideoModel) => {
    const cost =
      args.generate_audio === false && m.cost_per_unit_no_audio_usd !== undefined
        ? m.cost_per_unit_no_audio_usd
        : m.cost_per_unit_usd
    return cost !== undefined
      ? `${formatCostUsd(cost)} ${unitOf(m)}`
      : 'price quoted on approval'
  }

  const options =
    usable.length > 0
      ? buildOptions(usable, pickModel(usable, args.model), priceHint, costOf)
      : fallbackOptions(args.model, 'price quoted on approval')
  const recommendedModelId = options[0]?.id ?? 'default'

  return {
    kind: 'video',
    prompt: args.prompt,
    isChipnet: args.isChipnet,
    recommendedModelId,
    models: options,
    paramFields: (selection) =>
      videoParamFields(args, selection, modelById.get(selection.modelId)),
    createQuote: async (selection) => {
      const quote = await createVideoOrder({
        prompt: args.prompt,
        model: quoteModelId(selection),
        duration: numberParam(selection.params.duration),
        resolution: paramOrUndefined(selection.params.resolution),
        aspectRatio: paramOrUndefined(selection.params.aspect_ratio),
        generateAudio: booleanParam(selection.params.generate_audio),
        inputReferences: args.input_references,
        isChipnet: args.isChipnet,
        backendUrl: args.backendUrl,
      })
      return {
        quote,
        summary: {
          amountSats: quote.amountSats,
          amountUsd: quote.amountUsd,
          lines: [
            `Order:   ${quote.orderId}`,
            ...(quote.duration !== undefined
              ? [`Length:  ${quote.duration}s`]
              : []),
            ...(quote.resolution ? [`Size:    ${quote.resolution}`] : []),
            ...paramLines(selection),
          ],
        },
      }
    },
    persistPending: (selection, quoted) =>
      persist('video', args, selection, quoted.quote, quoted.summary),
  }
}

export async function approveVideoGeneration(
  server: McpServer,
  args: VideoGenerationArgs
): Promise<MediaSpendOutcome<VideoOrderQuote>> {
  const cliCommand = [
    'paytaca ai video generate',
    shellQuote(args.prompt),
    args.model ? `--model ${args.model}` : '',
    args.duration !== undefined ? `--duration ${args.duration}` : '',
    args.resolution ? `--resolution ${args.resolution}` : '',
    args.aspect_ratio ? `--aspect-ratio ${args.aspect_ratio}` : '',
    args.generate_audio !== undefined
      ? `--audio ${args.generate_audio ? 'on' : 'off'}`
      : '',
    ...(args.input_references ?? []).map((ref) =>
      ref.frame_type === 'first_frame'
        ? `--first-frame ${shellQuote(ref.url)}`
        : ref.frame_type === 'last_frame'
          ? `--last-frame ${shellQuote(ref.url)}`
          : `--input-reference ${shellQuote(ref.url)}`
    ),
    args.isChipnet ? '--chipnet' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const request = await buildVideoSpendRequest(args)
  return confirmMediaSpend(server, request, cliCommand)
}

function videoParamFields(
  args: VideoGenerationArgs,
  selection: MediaSelection,
  model: VideoModel | undefined
): MediaParamField[] {
  const current = (name: string, requested?: string) =>
    selection.params[name] ?? option(requested, AUTO)
  const requestedDuration =
    args.duration === undefined ? undefined : String(args.duration)
  const currentDuration = selection.params.duration ?? requestedDuration

  const durationOptions = withValue(
    dedupe([
      AUTO,
      ...(model?.supported_durations ?? []).map(String),
      ...(requestedDuration ? [requestedDuration] : []),
    ]),
    currentDuration
  )
  const resolutionOptions = withValue(
    dedupe([
      AUTO,
      ...(model?.supported_resolutions ?? []),
      ...(args.resolution ? [args.resolution] : []),
    ]),
    args.resolution
  )
  const aspectOptions = withValue(
    dedupe([
      AUTO,
      ...(model?.supported_aspect_ratios ?? []),
      ...(args.aspect_ratio ? [args.aspect_ratio] : []),
    ]),
    args.aspect_ratio
  )
  const audioValue =
    selection.params.generate_audio ??
    (args.generate_audio === undefined
      ? AUTO
      : args.generate_audio
        ? 'on'
        : 'off')

  return [
    {
      name: 'duration',
      label: 'Duration (seconds)',
      description: 'Clip length.',
      options: durationOptions,
      value: currentDuration ? currentDuration : AUTO,
    },
    {
      name: 'resolution',
      label: 'Resolution',
      description: 'Output resolution.',
      options: resolutionOptions,
      value: current('resolution', args.resolution),
    },
    {
      name: 'aspect_ratio',
      label: 'Aspect ratio',
      description: 'Output aspect ratio.',
      options: aspectOptions,
      value: current('aspect_ratio', args.aspect_ratio),
    },
    {
      name: 'generate_audio',
      label: 'Generate audio',
      description: 'Whether the clip includes sound.',
      options: [AUTO, 'on', 'off'],
      optionLabels: ['Model default', 'Yes', 'No'],
      value: audioValue,
    },
  ]
}

function booleanParam(value: string | undefined): boolean | undefined {
  if (value === 'on') return true
  if (value === 'off') return false
  return undefined
}

/**
 * Build the spend request for audio. Shared by the MCP approval path and the
 * terminal `paytaca approve` path.
 */
export async function buildAudioSpendRequest(
  args: AudioGenerationArgs
): Promise<MediaSpendRequest<AudioOrderQuote>> {
  let models: AudioModel[] = []
  try {
    models = await listAudioModels({ backendUrl: args.backendUrl })
  } catch {
    models = []
  }
  const modelById = new Map(
    models.filter((m) => m?.id).map((m) => [m.id, m])
  )
  const costOf = (m: AudioModel) =>
    m.output_cost_per_unit_usd ?? m.cost_per_unit_usd ?? Number.POSITIVE_INFINITY
  const priceHint = (m: AudioModel) => {
    const cost = costOf(m)
    return isFinite(cost)
      ? `${formatCostUsd(cost)} per character`
      : 'price quoted on approval'
  }

  const options =
    models.length > 0
      ? buildOptions(models, pickModel(models, args.model), priceHint, costOf)
      : fallbackOptions(args.model, 'price quoted on approval')
  const recommendedModelId = options[0]?.id ?? 'default'

  return {
    kind: 'audio',
    prompt: args.prompt,
    isChipnet: args.isChipnet,
    recommendedModelId,
    models: options,
    paramFields: (selection) =>
      audioParamFields(args, selection, modelById.get(selection.modelId)),
    createQuote: async (selection) => {
      const quote = await createAudioOrder({
        prompt: args.prompt,
        model: quoteModelId(selection),
        voice: paramOrUndefined(selection.params.voice),
        responseFormat: paramOrUndefined(selection.params.response_format),
        speed: numberParam(selection.params.speed),
        isChipnet: args.isChipnet,
        backendUrl: args.backendUrl,
      })
      return {
        quote,
        summary: {
          amountSats: quote.amountSats,
          amountUsd: quote.amountUsd,
          lines: [
            `Order:   ${quote.orderId}`,
            ...(quote.voice ? [`Voice:   ${quote.voice}`] : []),
            ...(quote.responseFormat
              ? [`Format:  ${quote.responseFormat}`]
              : []),
            ...paramLines(selection),
          ],
        },
      }
    },
    persistPending: (selection, quoted) =>
      persist('audio', args, selection, quoted.quote, quoted.summary),
  }
}

export async function approveAudioGeneration(
  server: McpServer,
  args: AudioGenerationArgs
): Promise<MediaSpendOutcome<AudioOrderQuote>> {
  const cliCommand = [
    'paytaca ai audio generate',
    shellQuote(args.prompt),
    args.model ? `--model ${args.model}` : '',
    args.voice ? `--voice ${args.voice}` : '',
    args.response_format ? `--format ${args.response_format}` : '',
    args.speed !== undefined ? `--speed ${args.speed}` : '',
    args.isChipnet ? '--chipnet' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const request = await buildAudioSpendRequest(args)
  return confirmMediaSpend(server, request, cliCommand)
}

function audioParamFields(
  args: AudioGenerationArgs,
  selection: MediaSelection,
  model: AudioModel | undefined
): MediaParamField[] {
  const current = (name: string, requested?: string) =>
    selection.params[name] ?? option(requested, AUTO)
  const requestedSpeed =
    args.speed === undefined ? undefined : String(args.speed)
  const voices = withValue(
    dedupe([AUTO, ...(model?.supported_voices ?? []), ...(args.voice ? [args.voice] : [])]),
    args.voice
  )
  const speeds = withValue([AUTO, '0.5', '0.75', '1', '1.25', '1.5', '2'], requestedSpeed)
  return [
    {
      name: 'voice',
      label: 'Voice',
      description: 'Voice id (model default when left as is).',
      options: voices,
      value: current('voice', args.voice),
    },
    {
      name: 'response_format',
      label: 'Format',
      description: 'Audio container format.',
      options: withValue([AUTO, 'mp3', 'pcm'], args.response_format),
      value: current('response_format', args.response_format),
    },
    {
      name: 'speed',
      label: 'Speed',
      description: 'Playback speed multiplier.',
      options: speeds,
      value: current('speed', requestedSpeed),
    },
  ]
}

/** Persist the quote as a pending approval and return its handle. */
async function persist(
  kind: PendingKind,
  args: ImageGenerationArgs | VideoGenerationArgs | AudioGenerationArgs,
  selection: MediaSelection,
  quote: {
    orderId: string
    model?: string
    amountSats: number
    amountUsd?: number
  },
  summary: { amountSats: number; amountUsd?: number }
): Promise<{ id: string }> {
  const saved = await savePendingApproval({
    kind,
    args,
    selection,
    quote: {
      ...quote,
      amountSats: summary.amountSats || quote.amountSats,
      amountUsd: summary.amountUsd ?? quote.amountUsd,
      prompt: args.prompt,
    },
  })
  return { id: saved.id }
}

/**
 * Rebuild the spend request for a stored pending approval. Used by the
 * `paytaca approve` terminal command.
 */
export function buildPendingSpendRequest(record: {
  kind: PendingKind
  args: ImageGenerationArgs | VideoGenerationArgs | AudioGenerationArgs
}): Promise<MediaSpendRequest<any>> {
  switch (record.kind) {
    case 'image':
      return buildImageSpendRequest(record.args as ImageGenerationArgs)
    case 'video':
      return buildVideoSpendRequest(record.args as VideoGenerationArgs)
    case 'audio':
      return buildAudioSpendRequest(record.args as AudioGenerationArgs)
  }
}
