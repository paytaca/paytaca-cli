import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLIENTS, buildTemplate } from './mcp.js'

describe('mcp config templates', () => {
  it('exposes every supported client', () => {
    expect(CLIENTS).toEqual(['claude', 'opencode', 'cursor', 'codex', 'pi', 'generic'])
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

  it('claude and cursor use mcpServers with command/args', () => {
    for (const client of ['claude', 'cursor', 'generic'] as const) {
      const { json } = buildTemplate(client, false)
      expect(json).toEqual({
        mcpServers: { paytaca: { command: 'paytaca', args: ['mcp'] } },
      })
    }
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

  it('codex emits a TOML table', () => {
    const template = buildTemplate('codex', false)
    expect(template.format).toBe('toml')
    expect(template.toml).toContain('[mcp_servers.paytaca]')
    expect(template.toml).toContain('command = "paytaca"')
  })

  it('adds --chipnet when requested', () => {
    const template = buildTemplate('opencode', true)
    expect(template.json).toMatchObject({
      mcp: { paytaca: { command: ['paytaca', 'mcp', '--chipnet'] } },
    })
  })
})