import { join } from 'node:path'
import { homedir } from 'node:os'
import { Command } from 'commander'
import { runMcpServer } from '../mcp/server.js'

export type McpClient = 'opencode' | 'pi'

export const CLIENTS: McpClient[] = ['opencode', 'pi']

export interface ClientTemplate {
  client: McpClient
  format: 'json'
  path: string | null
  json?: Record<string, unknown>
  snippet: string
  instructions: string
}

function serverArgs(chipnet: boolean): string[] {
  return chipnet ? ['mcp', '--chipnet'] : ['mcp']
}

export function buildTemplate(client: McpClient, chipnet: boolean): ClientTemplate {
  const args = serverArgs(chipnet)

  switch (client) {
    case 'opencode': {
      const json = {
        mcp: {
          paytaca: {
            type: 'local',
            command: ['paytaca', ...args],
            enabled: true,
          },
        },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.config', 'opencode', 'opencode.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions:
          'Add this to your project opencode.json or ~/.config/opencode/opencode.json, then restart opencode.',
      }
    }
    case 'pi': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args, directTools: true } },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.pi', 'agent', 'mcp.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions:
          'Pi requires the pi-mcp-adapter extension.\nInstall it: pi install npm:pi-mcp-adapter\nThen restart Pi and verify it loaded with: pi list.\nPi reads standard mcpServers config from ~/.pi/agent/mcp.json (or ~/.config/mcp/mcp.json).',
      }
    }
  }
  throw new Error(`Unsupported harness "${client}".`)
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the Paytaca MCP server (stdio) for AI agents')
    .option('--chipnet', 'Default tools to chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      await runMcpServer({ defaultChipnet: Boolean(opts.chipnet) })
    })
}