import { describe, it, expect } from 'vitest'
import type { AiConfig, AiModelConfig } from './client.js'
import { selectModel, selectTier, listPlans, listModels } from './models.js'

const flash: AiModelConfig = {
  id: 'z-ai/glm-5.3-flash',
  display_name: 'GLM 5.3 Flash',
  tier: 'budget',
  price_tiers: [
    { minutes: 15, price_sats: 4000 },
    { minutes: 30, price_sats: 8000 },
    { minutes: 60, price_sats: 15000 },
  ],
}

const pro: AiModelConfig = {
  id: 'deepseek/deepseek-v4-pro',
  display_name: 'DeepSeek V4 Pro',
  tier: 'premium',
  price_tiers: [
    { minutes: 15, price_sats: 9000 },
    { minutes: 30, price_sats: 17000 },
  ],
}

const config: AiConfig = { models: [flash, pro], default_model: flash.id }

describe('selectModel', () => {
  it('matches exact id', () => {
    expect(selectModel(config.models, 'deepseek/deepseek-v4-pro')).toBe(pro)
  })

  it('matches display name case-insensitively', () => {
    expect(selectModel(config.models, 'glm 5.3 flash')).toBe(flash)
  })

  it('matches substrings', () => {
    expect(selectModel(config.models, 'pro')).toBe(pro)
  })

  it('returns null for unknown models', () => {
    expect(selectModel(config.models, 'nope')).toBeNull()
  })
})

describe('selectTier', () => {
  it('returns the exact tier', () => {
    expect(selectTier(flash, 30)?.price_sats).toBe(8000)
  })

  it('rounds up to the next available tier', () => {
    expect(selectTier(flash, 20)?.minutes).toBe(30)
  })

  it('falls back to the longest tier when none is long enough', () => {
    expect(selectTier(pro, 60)?.minutes).toBe(30)
  })
})

describe('listModels', () => {
  it('returns the models array', () => {
    expect(listModels(config)).toHaveLength(2)
  })

  it('tolerates a missing models array', () => {
    expect(listModels({} as AiConfig)).toEqual([])
  })
})

describe('listPlans', () => {
  it('groups plans by tier in canonical order', () => {
    const groups = listPlans(config)
    expect(groups.map((g) => g.tier)).toEqual(['budget', 'premium'])
    expect(groups[0].models[0].id).toBe(flash.id)
    expect(groups[1].models[0].id).toBe(pro.id)
  })

  it('filters to a single model', () => {
    const groups = listPlans(config, 'pro')
    expect(groups).toHaveLength(1)
    expect(groups[0].tier).toBe('premium')
    expect(groups[0].models).toHaveLength(1)
  })

  it('returns nothing for an unknown model filter', () => {
    expect(listPlans(config, 'unknown-model')).toEqual([])
  })
})