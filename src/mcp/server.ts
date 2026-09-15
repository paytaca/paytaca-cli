import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.js'

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
}