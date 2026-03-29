/**
 * Reference x402 Server Implementation accepting BCH payments
 * 
 * This server demonstrates how to accept x402 payments using BCH.
 * Run with: npm start
 * 
 * Endpoints:
 *   GET /api/quote     - Returns a random quote (costs 100 sats)
 *   GET /api/weather   - Returns fake weather data (costs 50 sats)
 *   GET /api/status    - Returns server status (costs 1 sat)
 *   GET /api/echo/<m> - Echoes back message (costs 10 sats)
 */

import http from 'http'
import crypto from 'crypto'

const PORT = process.env.PORT || 3000
const BCH_NETWORK = process.env.BCH_NETWORK || 'mainnet'

const BCH_MAINNET = {
  bip122: '000000000000000000651ef99cb9fcbe',
  name: 'mainnet'
}

const BCH_CHIPNET = {
  bip122: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  name: 'chipnet'
}

const bchNetwork = BCH_NETWORK === 'chipnet' ? BCH_CHIPNET : BCH_MAINNET
const NETWORK_ID = `bip122:${bchNetwork.bip122}`

const RECEIVE_ADDRESS = process.env.RECEIVE_ADDRESS || null

interface PaymentHeaders {
  'x-scheme': string
  'x-network': string
  'max-timeout-ms': string
  'payment-url': string
  'max-amount': string
  'resource-id': string
  'accept-currencies': string
  'mime-type': string
}

interface RouteConfig {
  price: number
  description: string
  mimeType: string
  handler: (query: URLSearchParams) => Promise<any>
}

const routes: Record<string, RouteConfig> = {
  '/api/quote': {
    price: 1000,
    description: 'Get a random inspirational quote',
    mimeType: 'application/json',
    handler: async () => {
      const quotes = [
        { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb' },
        { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein' },
        { text: 'Code is like humor. When you have to explain it, it\'s bad.', author: 'Cory House' },
        { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
        { text: 'Experience is the name everyone gives to their mistakes.', author: 'Oscar Wilde' },
      ]
      return quotes[Math.floor(Math.random() * quotes.length)]
    }
  },
  '/api/weather': {
    price: 50,
    description: 'Get current weather information',
    mimeType: 'application/json',
    handler: async () => {
      const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy']
      const condition = conditions[Math.floor(Math.random() * conditions.length)]
      return {
        temperature: Math.floor(Math.random() * 35) + 5,
        condition,
        humidity: Math.floor(Math.random() * 60) + 20,
        windSpeed: Math.floor(Math.random() * 30),
      }
    }
  },
  '/api/status': {
    price: 1,
    description: 'Server status check',
    mimeType: 'application/json',
    handler: async () => ({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      network: BCH_NETWORK,
      memory: process.memoryUsage(),
    })
  },
}

function parseResourceId(path: string, query: URLSearchParams): string {
  return `${path}${query.toString() ? '?' + query.toString() : ''}`
}

function buildPaymentHeaders(resourceId: string, priceSats: number, paymentUrl: string, networkId: string): PaymentHeaders {
  return {
    'x-scheme': 'utxo',
    'x-network': networkId,
    'max-timeout-ms': '60000',
    'payment-url': paymentUrl,
    'max-amount': priceSats.toString(),
    'resource-id': resourceId,
    'accept-currencies': 'BCH,bch,BCHn,bitcoincash',
    'mime-type': 'application/json',
  }
}

function send402Response(
  res: http.ServerResponse,
  headers: PaymentHeaders
): void {
  res.writeHead(402, 'Payment Required', {
    'Content-Type': 'application/json',
    ...Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, String(v)])
    )
  })
  res.end(JSON.stringify({
    error: 'Payment required',
    message: 'This endpoint requires payment via x402 protocol',
    scheme: headers['x-scheme'],
    maxAmount: headers['max-amount'],
    resourceId: headers['resource-id'],
  }))
}

async function verifyPayment(
  authHeader: string,
  resourceId: string,
  maxAmount: bigint,
  paymentUrl: string
): Promise<{ valid: boolean; error?: string; txid?: string }> {
  if (!authHeader.startsWith('x402 ')) {
    return { valid: false, error: 'Invalid authorization scheme' }
  }

  const encoded = authHeader.slice(5)
  let auth: any

  try {
    auth = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch {
    return { valid: false, error: 'Invalid base64 encoding' }
  }

  if (auth.scheme !== 'utxo') {
    return { valid: false, error: `Unsupported scheme: ${auth.scheme}` }
  }

  if (auth.network !== NETWORK_ID) {
    return { valid: false, error: `Wrong network: ${auth.network}` }
  }

  if (auth.resource_id !== resourceId) {
    return { valid: false, error: `Resource mismatch: ${auth.resource_id} !== ${resourceId}` }
  }

  if (!auth.payload_signature) {
    return { valid: false, error: 'Missing payload signature' }
  }

  let payloadObj: any
  try {
    payloadObj = typeof auth.payload === 'string' ? JSON.parse(auth.payload) : auth.payload
  } catch {
    payloadObj = { payload: auth.payload }
  }

  console.log(`[PAYMENT REQUEST]`, JSON.stringify({
    payer: payloadObj.payer,
    payment: payloadObj.payment,
    resource_id: payloadObj.resource_id,
    resource_meta: payloadObj.resource_meta,
    nonce: payloadObj.nonce,
  }, null, 2))

  const payment = payloadObj?.payment || auth.payment
  if (!payment?.recipients?.length) {
    return { valid: false, error: 'Missing payment recipients' }
  }

  const recipient = payment.recipients[0]
  const amountSats = BigInt(recipient.amount)

  if (amountSats > maxAmount) {
    return { valid: false, error: `Amount exceeds maximum: ${amountSats} > ${maxAmount}` }
  }

  const validCurrency = ['BCH', 'bch', 'BCHn', 'bitcoincash'].includes(recipient.currency)
  if (!validCurrency) {
    return { valid: false, error: `Unsupported currency: ${recipient.currency}` }
  }

  if (!auth.nonce) {
    return { valid: false, error: 'Missing nonce' }
  }

  if (!auth.payload) {
    return { valid: false, error: 'Missing payload' }
  }

  const txid = payloadObj.txid || crypto.randomUUID()
  const vout = payloadObj.vout || 0
  const settleAddress = recipient.address

  return {
    valid: true,
    txid,
    error: undefined,
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const query = url.searchParams

  const route = routes[path]
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found', available: Object.keys(routes) }))
    return
  }

  const resourceId = parseResourceId(path, query)
  const priceSats = route.price
  const paymentUrl = (() => {
    if (!RECEIVE_ADDRESS) {
      return `bch:${bchNetwork.name === 'mainnet' ? 'bitcoincash:' : 'bchtest:'}placeholder`
    }
    // Return address with bch: prefix, ensuring proper CashAddress format
    // If address already has bitcoincash: or bchtest: prefix, use as-is after bch:
    // Otherwise assume it's a legacy address and wrap with proper prefix
    const addr = RECEIVE_ADDRESS.toLowerCase()
    if (addr.startsWith('bitcoincash:') || addr.startsWith('bchtest:') || addr.startsWith('bch:')) {
      return RECEIVE_ADDRESS
    }
    // Legacy address - wrap with proper CashAddress prefix
    const prefix = bchNetwork.name === 'mainnet' ? 'bitcoincash' : 'bchtest'
    return `bch:${prefix}:${RECEIVE_ADDRESS}`
  })()

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const authHeader = req.headers.authorization
  const hasPayment = authHeader?.startsWith('x402 ')

  if (!hasPayment) {
    const headers = buildPaymentHeaders(resourceId, priceSats, paymentUrl, NETWORK_ID)
    console.log(`[PAYMENT REQUIRED] ${path} - ${priceSats} sats - ${req.socket.remoteAddress}`)
    send402Response(res, headers)
    return
  }

  console.log(`[VERIFYING] ${path} from ${req.socket.remoteAddress}`)

  const verifyResult = await verifyPayment(
    authHeader!,
    resourceId,
    BigInt(priceSats),
    paymentUrl
  )

  if (!verifyResult.valid) {
    console.log(`[VERIFICATION FAILED] ${path} - ${verifyResult.error}`)
    res.writeHead(402, 'Payment Verification Failed', { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: verifyResult.error }))
    return
  }

  console.log(`[VERIFIED] ${path} - txid: ${verifyResult.txid}`)

  try {
    const data = await route.handler(query)
    const payload = Buffer.from(JSON.stringify({
      txid: verifyResult.txid,
      vout: 0,
      settle_address: RECEIVE_ADDRESS || 'unknown',
      resource_id: resourceId,
    })).toString('base64')

    res.writeHead(200, {
      'Content-Type': route.mimeType,
      'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({
        success: true,
        txid: verifyResult.txid,
        vout: 0,
        settle_address: RECEIVE_ADDRESS || 'unknown',
        preimage: payload,
      })).toString('base64'),
    })
    res.end(JSON.stringify(data))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res)
  } catch (err) {
    console.error('[ERROR]', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Internal server error' }))
  }
})

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   x402 BCH Reference Server                               ║
║   Network: ${bchNetwork.name.padEnd(47)}║
║   Port:   ${PORT.toString().padEnd(47)}║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Endpoints:                                              ║
║   GET /api/quote     - ${routes['/api/quote'].price} sats - ${routes['/api/quote'].description.padEnd(25)}║
║   GET /api/weather   - ${routes['/api/weather'].price} sats - ${routes['/api/weather'].description.padEnd(25)}║
║   GET /api/status    - ${routes['/api/status'].price} sat   - ${routes['/api/status'].description.padEnd(25)}║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   To test with paytaca-cli:                              ║
║   paytaca check http://localhost:${PORT}/api/quote            ║
║   paytaca pay http://localhost:${PORT}/api/quote              ║
║                                                           ║
║   Set RECEIVE_ADDRESS env var to your BCH address         ║
║   Set BCH_NETWORK=chipnet for testnet                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`)
})

server.on('error', (err) => {
  console.error('Server error:', err)
  process.exit(1)
})
