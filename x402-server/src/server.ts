/**
 * Reference x402-bch Server Implementation
 * 
 * Conforms to x402-bch specification v2.2
 * https://github.com/x402-bch/x402-bch/blob/master/specs/x402-bch-specification-v2.2.md
 * 
 * Run with: npm start
 * 
 * Endpoints:
 *   GET /api/quote     - Returns a random quote (costs 1000 sats)
 *   GET /api/weather   - Returns fake weather data (costs 50 sats)
 *   GET /api/status    - Returns server status (costs 1 sat)
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
const ASSET_ID = '0x0000000000000000000000000000000000000001'
const MAX_TIMEOUT_SECONDS = 60

const RECEIVE_ADDRESS = process.env.RECEIVE_ADDRESS || null

interface PaymentRequirements {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra: object
}

interface ResourceInfo {
  url: string
  description?: string
  mimeType?: string
}

interface PaymentRequired {
  x402Version: number
  error?: string
  resource: ResourceInfo
  accepts: PaymentRequirements[]
  extensions: object
}

interface Authorization {
  from: string
  to: string
  value: string
  txid: string
  vout: number | null
  amount: string | null
}

interface Payload {
  signature: string
  authorization: Authorization
}

interface PaymentPayload {
  x402Version: number
  resource?: ResourceInfo
  accepted: PaymentRequirements
  payload: Payload
  extensions: object
}

interface VerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  remainingBalanceSat?: string
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

function getPayToAddress(): string {
  if (!RECEIVE_ADDRESS) {
    return bchNetwork.name === 'mainnet' 
      ? 'bitcoincash:placeholder' 
      : 'bchtest:placeholder'
  }
  const addr = RECEIVE_ADDRESS.toLowerCase()
  if (addr.startsWith('bitcoincash:') || addr.startsWith('bchtest:') || addr.startsWith('bch:')) {
    return RECEIVE_ADDRESS
  }
  const prefix = bchNetwork.name === 'mainnet' ? 'bitcoincash' : 'bchtest'
  return `bch:${prefix}:${RECEIVE_ADDRESS}`
}

function buildPaymentRequired(resourceUrl: string, priceSats: number): PaymentRequired {
  return {
    x402Version: 2,
    error: 'PAYMENT-SIGNATURE header is required',
    resource: {
      url: resourceUrl,
      description: routes[resourceUrl]?.description || '',
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'utxo',
      network: NETWORK_ID,
      amount: priceSats.toString(),
      asset: ASSET_ID,
      payTo: getPayToAddress(),
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: {},
    }],
    extensions: {},
  }
}

function send402Response(res: http.ServerResponse, paymentRequired: PaymentRequired): void {
  res.writeHead(402, 'Payment Required', {
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(paymentRequired, null, 2))
}

function sendErrorResponse(res: http.ServerResponse, statusCode: number, invalidReason: string, paymentRequired?: PaymentRequired): void {
  res.writeHead(statusCode, 'Payment Failed', {
    'Content-Type': 'application/json',
  })
  const body: any = {
    isValid: false,
    invalidReason,
  }
  if (paymentRequired) {
    body.paymentRequired = paymentRequired
  }
  res.end(JSON.stringify(body, null, 2))
}

function parsePaymentPayload(headerValue: string): { payload?: PaymentPayload; error?: string } {
  if (!headerValue) {
    return { error: 'missing_authorization' }
  }

  let paymentPayload: PaymentPayload
  try {
    paymentPayload = JSON.parse(headerValue)
  } catch {
    return { error: 'invalid_payload' }
  }

  if (paymentPayload.x402Version !== 2) {
    return { error: 'invalid_x402_version' }
  }

  return { payload: paymentPayload }
}

function verifyPaymentPayload(payload: PaymentPayload, resourceUrl: string, maxAmountSats: bigint): { valid: boolean; invalidReason?: string; txid?: string; payer?: string } {
  const accepted = payload.accepted

  if (accepted.scheme !== 'utxo') {
    return { valid: false, invalidReason: 'invalid_scheme' }
  }

  if (accepted.network !== NETWORK_ID) {
    return { valid: false, invalidReason: 'invalid_network' }
  }

  if (accepted.payTo !== getPayToAddress()) {
    return { valid: false, invalidReason: 'invalid_receiver_address' }
  }

  const acceptedAmount = BigInt(accepted.amount)
  if (acceptedAmount > maxAmountSats) {
    return { valid: false, invalidReason: 'insufficient_utxo_balance' }
  }

  if (accepted.asset !== ASSET_ID) {
    return { valid: false, invalidReason: 'invalid_payload' }
  }

  const auth = payload.payload?.authorization
  if (!auth) {
    return { valid: false, invalidReason: 'missing_authorization' }
  }

  const valueSats = BigInt(auth.value)
  if (valueSats > maxAmountSats) {
    return { valid: false, invalidReason: 'insufficient_utxo_balance' }
  }

  if (auth.to !== accepted.payTo) {
    return { valid: false, invalidReason: 'invalid_receiver_address' }
  }

  const txid = auth.txid === '*' ? crypto.randomUUID() : auth.txid
  const payer = auth.from

  console.log(`[PAYMENT REQUEST]`, JSON.stringify({
    payer,
    txid,
    vout: auth.vout,
    amount: auth.amount,
    value: auth.value,
    resource: resourceUrl,
  }, null, 2))

  if (!payload.payload?.signature) {
    return { valid: false, invalidReason: 'invalid_exact_bch_payload_signature' }
  }

  return {
    valid: true,
    txid,
    payer,
    invalidReason: undefined,
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const query = url.searchParams
  const resourceUrl = `${path}${query.toString() ? '?' + query.toString() : ''}`

  const route = routes[path]
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found', available: Object.keys(routes) }))
    return
  }

  const priceSats = route.price
  const paymentRequired = buildPaymentRequired(`http://localhost:${PORT}${resourceUrl}`, priceSats)

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const paymentSignature = req.headers['payment-signature'] as string | undefined
  const parsed = parsePaymentPayload(paymentSignature || '')

  if (!parsed.payload) {
    console.log(`[PAYMENT REQUIRED] ${path} - ${priceSats} sats - ${req.socket.remoteAddress}`)
    send402Response(res, paymentRequired)
    return
  }

  console.log(`[VERIFYING] ${path} from ${req.socket.remoteAddress}`)

  const verifyResult = verifyPaymentPayload(parsed.payload, resourceUrl, BigInt(priceSats))

  if (!verifyResult.valid) {
    console.log(`[VERIFICATION FAILED] ${path} - ${verifyResult.invalidReason}`)
    sendErrorResponse(res, 402, verifyResult.invalidReason!, paymentRequired)
    return
  }

  console.log(`[VERIFIED] ${path} - txid: ${verifyResult.txid}`)

  try {
    const data = await route.handler(query)

    const verifyResponse: VerifyResponse = {
      isValid: true,
      payer: verifyResult.payer,
      remainingBalanceSat: '0',
    }

    res.writeHead(200, {
      'Content-Type': route.mimeType,
      'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(verifyResponse)).toString('base64'),
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
║   x402-bch Reference Server (v2.2 Compatible)            ║
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
