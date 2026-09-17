import { describe, it, expect } from 'vitest'
import type { AiConfig, AiModelConfig } from './client.js'
import { selectModel, selectTier, listPlans, listModels } from './models.js'

const flash: AiModelConfig = {
  id: 'z-ai/glm-5.3-flash',
  display_name: 'GLM 5.3 Flash',
  price_tiers: [
    { minutes: 15, price_sats: 4000 },
    { minutes: 30, price_sats: 8000 },
    { minutes: 60, price_sats: 15000 },
  ],
}

const pro: AiModelConfig = {
  id: 'deepseek/deepseek-v4-pro',
  display_name: 'DeepSeek V4 Pro',
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
  it('returns each model with its plans', () => {
    const models = listPlans(config)
    expect(models.map((m) => m.id)).toEqual([flash.id, pro.id])
    expect(models[0].displayName).toBe('GLM 5.3 Flash')
    expect(models[0].plans).toHaveLength(3)
  })

  it('filters to a single model', () => {
    const models = listPlans(config, 'pro')
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe(pro.id)
  })

  it('returns nothing for an unknown model filter', () => {
    expect(listPlans(config, 'unknown-model')).toEqual([])
  })
})