import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRefillTickDeps, registerTools } from './tools.js'
import { startAutoRefillLoop } from '../ai/autoRefill.js'
import { loadWalletRef } from '../wallet/index.js'

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    )
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function createServer(opts: { defaultChipnet?: boolean } = {}): McpServer {
  const server = new McpServer(
    { name: 'paytaca', version: readVersion() },
    { capabilities: { tools: {} } }
  )
  registerTools(server, opts)
  return server
}

export async function runMcpServer(opts: { defaultChipnet?: boolean } = {}): Promise<void> {
  installProcessGuards()

  const server = createServer(opts)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  setImmediate(() => {
    try {
      startRefillLoop(Boolean(opts.defaultChipnet))
    } catch (error) {
      console.error(`[paytaca] auto-refill bootstrap failed: ${describeError(error)}`)
    }
  })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function installProcessGuards(): void {
  process.on('uncaughtException', (error) => {
    console.error(`[paytaca] uncaught exception: ${describeError(error)}`)
  })
  process.on('unhandledRejection', (reason) => {
    console.error(`[paytaca] unhandled rejection: ${describeError(reason)}`)
  })
}

function startRefillLoop(isChipnet: boolean): () => void {
  let wallet
  try {
    wallet = loadWalletRef()
  } catch {
    return () => {}
  }
  if (!wallet || !wallet.canSign) return () => {}

  return startAutoRefillLoop({
    ...createRefillTickDeps(isChipnet),
    onEvent: (outcome) => {
      const result = outcome.result
      if (result.action === 'refilled') {
        const desc =
          result.state.mode === 'payg'
            ? `topped up ${result.state.amountUsd ?? ''} USD of pay-as-you-go balance`
            : `bought ${result.state.minutes} min of ${result.state.model}`
        console.error(`[paytaca] auto-refill (${outcome.key}): ${desc}`)
      } else if (result.action === 'disarmed') {
        console.error(`[paytaca] auto-refill disarmed (${outcome.key}): ${result.reason}`)
      } else if (result.action === 'skipped') {
        console.error(
          `[paytaca] auto-refill skipped (${outcome.key || 'unknown'}): ${result.reason}`
        )
      }
    },
  })
}