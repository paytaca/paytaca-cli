import { join } from 'node:path'
import { homedir } from 'node:os'
import { Command } from 'commander'
import { runMcpServer } from '../mcp/server.js'
import { DEFAULT_PROXY_PORT, startProxy, stopProxy } from '../ai/anthropicProxy.js'

export type McpClient = 'opencode' | 'pi' | 'omp' | 'claude'

export const CLIENTS: McpClient[] = ['opencode', 'pi', 'omp', 'claude']

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

export function buildTemplate(
  client: McpClient,
  chipnet: boolean,
  opencodeMajor: number = 1
): ClientTemplate {
  const args = serverArgs(chipnet)

  switch (client) {
    case 'opencode': {
      const json =
        opencodeMajor >= 2
          ? {
              mcp: {
                servers: {
                  paytaca: { type: 'local', command: ['paytaca', ...args] },
                },
              },
            }
          : {
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
    case 'omp': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.omp', 'agent', 'mcp.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions:
          'Oh My Pi has native MCP support.\nRestart omp and verify with /mcp.\nomp reads standard mcpServers config from ~/.omp/agent/mcp.json.',
      }
    }
    case 'claude': {
      const json = {
        mcpServers: { paytaca: { command: 'paytaca', args } },
      }
      return {
        client,
        format: 'json',
        path: join(homedir(), '.claude.json'),
        json,
        snippet: JSON.stringify(json, null, 2),
        instructions:
          'Claude Code reads mcpServers from ~/.claude.json and model/env settings from ~/.claude/settings.json.\nRestart `claude` and verify the server with /mcp.\nYou can also install it directly: claude mcp add -s user paytaca -- paytaca mcp',
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
    .option('--proxy', 'Run the Anthropic-compatible gateway for Claude Code instead of stdio')
    .option('--port <port>', 'Port for the Anthropic gateway', String(DEFAULT_PROXY_PORT))
    .option('--backend <url>', 'Override backend URL for the gateway')
    .option('--stop', 'Stop a running Anthropic gateway')
    .action(async (opts) => {
      if (opts.stop) {
        const result = stopProxy()
        if (result.stopped) {
          console.error(`[paytaca] Anthropic gateway stopped (pid ${result.pid}).`)
        } else {
          console.error('[paytaca] No Anthropic gateway is running.')
        }
        return
      }

      if (opts.proxy) {
        const port = Number(opts.port)
        if (!Number.isFinite(port) || port <= 0) {
          console.error('[paytaca] Invalid --port.')
          process.exitCode = 1
          return
        }
        const server = startProxy({
          port,
          backendUrl: opts.backend,
          onListening: () => {
            console.error(
              `[paytaca] Anthropic gateway listening on http://127.0.0.1:${port}`
            )
          },
        })
        server.on('error', (error: NodeJS.ErrnoException) => {
          const message =
            error.code === 'EADDRINUSE'
              ? `Port ${port} is already in use.`
              : error.message
          console.error(`[paytaca] Anthropic gateway failed: ${message}`)
          process.exitCode = 1
        })
        return
      }

      try {
        await runMcpServer({ defaultChipnet: Boolean(opts.chipnet) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[paytaca] MCP server failed to start: ${message}`)
        process.exitCode = 1
      }
    })
}