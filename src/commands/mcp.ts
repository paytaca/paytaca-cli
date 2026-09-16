import { join } from 'node:path'
import { homedir } from 'node:os'
import { Command } from 'commander'
import { runMcpServer } from '../mcp/server.js'

export type McpClient = 'claude' | 'opencode' | 'cursor' | 'codex' | 'pi' | 'generic'

export const CLIENTS: McpClient[] = ['claude', 'opencode', 'cursor', 'codex', 'pi', 'generic']

export interface ClientTemplate {
  client: McpClient
  format: 'json' | 'toml'
  path: string | null
  json?: Record<string, unknown>
  toml?: string
  snippet: string
  instructions: string
}

function serverArgs(chipnet: boolean): string[] {
  return chipnet ? ['mcp', '--chipnet'] : ['mcp']
}

function claudeConfigPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
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
    case 'cursor': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.cursor', 'mcp.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions: 'Add this to ~/.cursor/mcp.json, then restart Cursor.',
      }
    }
    case 'codex': {
      const toml = `[mcp_servers.paytaca]\ncommand = "paytaca"\nargs = ${JSON.stringify(args)}\n`
      return {
        client,
        format: 'toml',
        path: join(homedir(), '.codex', 'config.toml'),
        toml,
        snippet: toml,
        instructions: 'Append this to ~/.codex/config.toml, then restart Codex.',
      }
    }
    case 'pi': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.pi', 'agent', 'mcp.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions:
          'Requires the pi-mcp-adapter extension: run `pi install npm:pi-mcp-adapter` and restart Pi. Pi reads standard mcpServers config from ~/.pi/agent/mcp.json (or ~/.config/mcp/mcp.json).',
      }
    }
    case 'claude': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: claudeConfigPath(),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions: `Add this to ${claudeConfigPath()}, then restart Claude. For Claude Code you can instead run: claude mcp add paytaca -- paytaca ${args.join(' ')}`,
      }
    }
    default: {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: null,
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions: 'Add this to your MCP client configuration.',
      }
    }
  }
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