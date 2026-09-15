import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServer } from './server.js'

let server: McpServer | undefined
let client: Client | undefined

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  server = createServer()
  client = new Client({ name: 'paytaca-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

afterEach(async () => {
  await client?.close()
  await server?.close()
  client = undefined
  server = undefined
})

describe('paytaca MCP server', () => {
  it('advertises the full tool set', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'ai_chat',
        'auto_refill',
        'buy_plan',
        'get_balance',
        'get_credits',
        'get_help',
        'get_models',
        'get_plans',
        'get_receiving_address',
        'get_tokens',
        'get_transactions',
        'send',
      ].sort()
    )
  })

  it('answers get_help without a wallet', async () => {
    const c = await connect()
    const result = await c.callTool({ name: 'get_help', arguments: {} })
    const content = result.content as { type: string; text: string }[]
    expect(content[0].type).toBe('text')
    expect(content[0].text).toMatch(/get_balance/)
    expect(content[0].text).toMatch(/buy_plan/)
  })

  it('marks spending tools as destructive', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    const send = tools.find((t) => t.name === 'send')
    const buy = tools.find((t) => t.name === 'buy_plan')
    expect(send?.annotations?.destructiveHint).toBe(true)
    expect(buy?.annotations?.destructiveHint).toBe(true)
  })
})