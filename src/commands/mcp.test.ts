import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLIENTS, buildTemplate } from './mcp.js'

describe('mcp config templates', () => {
  it('exposes every supported client', () => {
    expect(CLIENTS).toEqual(['opencode', 'pi', 'omp'])
  })

  it('opencode uses the local mcp block with an array command', () => {
    const { json } = buildTemplate('opencode', false)
    expect(json).toEqual({
      mcp: {
        paytaca: {
          type: 'local',
          command: ['paytaca', 'mcp'],
          enabled: true,
        },
      },
    })
  })

  it('pi writes the standard mcpServers block to the adapter path', () => {
    const template = buildTemplate('pi', false)
    expect(template.format).toBe('json')
    expect(template.path).toBe(join(homedir(), '.pi', 'agent', 'mcp.json'))
    expect(template.json).toEqual({
      mcpServers: { paytaca: { command: 'paytaca', args: ['mcp'], directTools: true } },
    })
    expect(template.instructions).toMatch(/pi-mcp-adapter/)
  })

  it('omp writes the native mcpServers block without adapter fields', () => {
    const template = buildTemplate('omp', false)
    expect(template.format).toBe('json')
    expect(template.path).toBe(join(homedir(), '.omp', 'agent', 'mcp.json'))
    expect(template.json).toEqual({
      mcpServers: { paytaca: { command: 'paytaca', args: ['mcp'] } },
    })
    expect(template.instructions).not.toMatch(/adapter/)
  })

  it('adds --chipnet when requested', () => {
    const template = buildTemplate('opencode', true)
    expect(template.json).toMatchObject({
      mcp: { paytaca: { command: ['paytaca', 'mcp', '--chipnet'] } },
    })
  })
})