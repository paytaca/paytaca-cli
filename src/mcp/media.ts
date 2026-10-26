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
  confirmMediaSpend,
  shellQuote,
  type MediaModelOption,
  type MediaParamField,
  type MediaSelection,
  type MediaSpendOutcome,
} from './approval.js'

/** Sentinel form value meaning "leave this to the model/backend default". */
const AUTO = 'auto'

export interface ImageGenerationArgs {
  prompt: string
  model?: string
  aspect_ratio?: string
  quality?: string
  resolution?: string
  input_references?: string[]
  isChipnet: boolean
  backendUrl?: string
}

export interface VideoGenerationArgs {
  prompt: string
  model?: string
  duration?: number
  resolution?: string
  aspect_ratio?: string
  generate_audio?: boolean
  input_references?: { url: string; frame_type?: 'first_frame' | 'last_frame' }[]
  isChipnet: boolean
  backendUrl?: string
}

export interface AudioGenerationArgs {
  prompt: string
  model?: string
  voice?: string
  response_format?: string
  speed?: number
  isChipnet: boolean
  backendUrl?: string
}

function option(value: string | undefined | null, fallback: string): string {
  if (value === undefined || value === null) return fallback
  return value || fallback
}

function paramOrUndefined(value: string | undefined): string | undefined {
  if (!value || value === AUTO) return undefined
  return value
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

export async function approveImageGeneration(
  server: McpServer,
  args: ImageGenerationArgs
): Promise<MediaSpendOutcome<ImageOrderQuote>> {
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

  return confirmMediaSpend(
    server,
    {
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
            lines: [
              `Order:   ${quote.orderId}`,
              ...paramLines(selection),
            ],
          },
        }
      },
    },
    cliCommand
  )
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

export async function approveVideoGeneration(
  server: McpServer,
  args: VideoGenerationArgs
): Promise<MediaSpendOutcome<VideoOrderQuote>> {
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

  return confirmMediaSpend(
    server,
    {
      kind: 'video',
      prompt: args.prompt,
      isChipnet: args.isChipnet,
      recommendedModelId,
      models: options,
      paramFields: (selection) =>
        videoParamFields(args, selection, modelById.get(selection.modelId)),
      createQuote: async (selection) => {
        const duration = paramOrUndefined(selection.params.duration)
        const quote = await createVideoOrder({
          prompt: args.prompt,
          model: quoteModelId(selection),
          duration: duration === undefined ? undefined : Number(duration),
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
    },
    cliCommand
  )
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

export async function approveAudioGeneration(
  server: McpServer,
  args: AudioGenerationArgs
): Promise<MediaSpendOutcome<AudioOrderQuote>> {
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

  return confirmMediaSpend(
    server,
    {
      kind: 'audio',
      prompt: args.prompt,
      isChipnet: args.isChipnet,
      recommendedModelId,
      models: options,
      paramFields: (selection) =>
        audioParamFields(args, selection, modelById.get(selection.modelId)),
      createQuote: async (selection) => {
        const speed = paramOrUndefined(selection.params.speed)
        const quote = await createAudioOrder({
          prompt: args.prompt,
          model: quoteModelId(selection),
          voice: paramOrUndefined(selection.params.voice),
          responseFormat: paramOrUndefined(selection.params.response_format),
          speed: speed === undefined ? undefined : Number(speed),
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
    },
    cliCommand
  )
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
