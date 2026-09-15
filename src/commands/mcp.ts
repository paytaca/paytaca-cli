import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { Command } from 'commander'
import chalk from 'chalk'
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

function writeJson(client: McpClient, path: string, json: Record<string, unknown>): void {
  let merged: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      merged = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      throw new Error(`Existing config at ${path} is not valid JSON; not overwriting.`)
    }
  }
  merged = { ...merged, ...json }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Run the Paytaca MCP server (stdio) for AI agents')
    .option('--chipnet', 'Default tools to chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      await runMcpServer({ defaultChipnet: Boolean(opts.chipnet) })
    })

  mcp
    .command('config')
    .description('Print or write the MCP client configuration')
    .option(
      '--client <client>',
      `MCP client: ${CLIENTS.join(', ')}`,
      'generic'
    )
    .option('--chipnet', 'Configure the server to default to chipnet')
    .option('--write', 'Write/merge the configuration into the client config file')
    .option('--path <path>', 'Override the target config file path (with --write)')
    .option('--json', 'Output the template as JSON')
    .action(async (opts) => {
      const client = String(opts.client || 'generic').toLowerCase() as McpClient
      if (!CLIENTS.includes(client)) {
        console.error(chalk.red(`Unknown client "${client}". Use one of: ${CLIENTS.join(', ')}.`))
        process.exit(1)
      }

      const template = buildTemplate(client, Boolean(opts.chipnet))

      if (opts.write) {
        const target = opts.path || template.path
        if (!target) {
          console.error(chalk.red(`No known config file for client "${client}". Use --path.`))
          process.exit(1)
        }
        try {
          if (template.format === 'toml') {
            const existing = existsSync(target) ? readFileSync(target, 'utf-8') : ''
            if (existing.includes('[mcp_servers.paytaca]')) {
              console.error(chalk.yellow(`paytaca already configured in ${target}`))
            } else {
              mkdirSync(dirname(target), { recursive: true })
              writeFileSync(target, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + '\n' + template.toml, 'utf-8')
              console.error(chalk.green(`Wrote ${target}`))
            }
          } else {
            writeJson(client, target, template.json as Record<string, unknown>)
            console.error(chalk.green(`Wrote ${target}`))
          }
        } catch (err: any) {
          console.error(chalk.red(`Error: ${err?.message || err}`))
          process.exit(1)
        }
        return
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              client: template.client,
              path: template.path,
              format: template.format,
              config: template.json ?? template.toml,
              instructions: template.instructions,
            },
            null,
            2
          )
        )
        return
      }

      console.log(chalk.bold(`\n   Paytaca MCP — ${template.client}\n`))
      if (template.path) {
        console.log(chalk.dim(`   Config file: ${template.path}`))
      }
      console.log()
      console.log(template.snippet)
      console.log()
      console.log(chalk.dim(`   ${template.instructions}`))
      console.log(
        chalk.dim(
          `   Non-interactive: paytaca mcp config --client ${template.client} --write`
        )
      )
      console.log()
    })
}