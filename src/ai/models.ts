import type { AiConfig, AiModelConfig, PriceTier } from './client.js'

const TIER_ORDER = ['budget', 'premium', 'frontier', 'cheap', 'other']

export interface PlanView {
  id: string
  displayName: string
  tier: string
  plans: PriceTier[]
}

export interface PlanGroup {
  tier: string
  models: PlanView[]
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} hr` : `${minutes} min`
}

export function formatPriceUsd(usd: number | undefined): string {
  if (usd === undefined || usd === null || !isFinite(usd)) return 'n/a'
  return `$${usd.toFixed(2)}`
}

export function selectModel(
  models: AiModelConfig[],
  query: string
): AiModelConfig | null {
  if (!query) return null
  const q = query.toLowerCase()
  const exact = models.find(
    (m) =>
      String(m.id).toLowerCase() === q ||
      String(m.display_name).toLowerCase() === q
  )
  if (exact) return exact
  return (
    models.find((m) => {
      const id = String(m.id).toLowerCase()
      const name = String(m.display_name).toLowerCase()
      return id.includes(q) || name.includes(q)
    }) || null
  )
}

export function selectTier(
  model: AiModelConfig,
  minutes: number
): PriceTier | null {
  const tiers = Array.isArray(model.price_tiers) ? model.price_tiers : []
  const exact = tiers.find((t) => Number(t.minutes) === Number(minutes))
  if (exact) return exact
  const sorted = [...tiers].sort((a, b) => a.minutes - b.minutes)
  return sorted.find((t) => t.minutes >= minutes) || sorted[sorted.length - 1] || null
}

export function listModels(config: AiConfig): AiModelConfig[] {
  return Array.isArray(config.models) ? config.models : []
}

export function listPlans(
  config: AiConfig,
  modelQuery?: string
): PlanGroup[] {
  let models = listModels(config)
  if (modelQuery) {
    const model = selectModel(models, modelQuery)
    models = model ? [model] : []
  }

  const groups = new Map<string, PlanView[]>()
  for (const model of models) {
    const tier = String(model.tier || 'other').toLowerCase()
    const view: PlanView = {
      id: model.id,
      displayName: model.display_name,
      tier,
      plans: Array.isArray(model.price_tiers) ? model.price_tiers : [],
    }
    const list = groups.get(tier) || []
    list.push(view)
    groups.set(tier, list)
  }

  const orderedTiers = [...groups.keys()].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a)
    const bi = TIER_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  return orderedTiers.map((tier) => ({ tier, models: groups.get(tier)! }))
}