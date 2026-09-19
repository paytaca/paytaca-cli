import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.js'
import { getWalletStatus, hasActiveCredits } from '../ai/credits.js'
import { buyPlan } from '../ai/purchase.js'
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
  const server = createServer(opts)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  startRefillLoop(Boolean(opts.defaultChipnet))
}

function startRefillLoop(isChipnet: boolean): () => void {
  let wallet
  try {
    wallet = loadWalletRef()
  } catch {
    return () => {}
  }
  if (!wallet) return () => {}

  return startAutoRefillLoop({
    hasActiveCredits: async (model) => {
      const status = await getWalletStatus(wallet.walletHash, { modelId: model })
      return hasActiveCredits(status, model)
    },
    buy: (opts) => buyPlan({ ...opts, isChipnet, confirmed: true }),
    onEvent: (result) => {
      if (result.action === 'refilled') {
        console.error(
          `[paytaca] auto-refill: bought ${result.state.minutes} min of ${result.state.model}`
        )
      } else if (result.action === 'disarmed') {
        console.error(`[paytaca] auto-refill disarmed: ${result.reason}`)
      } else if (result.action === 'skipped') {
        console.error(`[paytaca] auto-refill skipped: ${result.reason}`)
      }
    },
  })
}