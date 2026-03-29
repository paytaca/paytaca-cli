# x402 BCH Reference Server

A minimal reference implementation of an x402 server that accepts BCH payments.

## Overview

This server demonstrates how to build an x402-compatible API that accepts Bitcoin Cash (BCH) payments. It implements the `utxo` scheme for UTXO-based cryptocurrencies.

## Quick Start

```bash
cd x402-server
npm install
npm start
```

Server runs at `http://localhost:3000`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BCH_NETWORK` | `mainnet` or `chipnet` | `mainnet` |
| `RECEIVE_ADDRESS` | BCH address to receive payments | Required for real payments |

## Endpoints

| Endpoint | Cost | Description |
|----------|------|-------------|
| `GET /api/quote` | 100 sats | Returns a random inspirational quote |
| `GET /api/weather` | 50 sats | Returns fake weather data |
| `GET /api/status` | 1 sat | Returns server status |

## Testing with paytaca-cli

```bash
# Check if endpoint requires payment
paytaca check http://localhost:3000/api/quote

# Make a paid request (will get 402 without wallet)
paytaca pay http://localhost:3000/api/quote

# Dry run to see payment details
paytaca pay http://localhost:3000/api/quote --dry-run

# With JSON output
paytaca pay http://localhost:3000/api/quote --json
```

## How It Works

### 1. Initial Request (No Payment)

```
GET /api/quote
```

Returns `402 Payment Required` with headers:

```
PAYMENT-REQUIRED: <base64-encoded PaymentRequired>
X-Scheme: utxo
Max-Timeout-Ms: 60000
Max-Amount: 100
Resource-Id: /api/quote
Accept-Currencies: BCH,bch,BCHn,bitcoincash
```

### 2. Payment Flow

The client:
1. Parses the 402 response headers
2. Creates a BCH transaction paying the required amount
3. Signs the payment payload
4. Retries the request with `Authorization: x402 <base64-encoded-signature>`

### 3. Verification

The server verifies:
- Signature validity
- Network matches (mainnet/chipnet)
- Resource ID matches
- Amount doesn't exceed maximum
- Currency is accepted (BCH)

## x402 Headers

### Server → Client (402 Response)

| Header | Description |
|--------|-------------|
| `PAYMENT-REQUIRED` | Base64-encoded PaymentRequired object |
| `X-Scheme` | Payment scheme (`utxo`) |
| `Max-Timeout-Ms` | Maximum time to complete payment |
| `Max-Amount` | Maximum payment amount in satoshis |
| `Resource-Id` | Unique identifier for the resource |
| `Accept-Currencies` | Comma-separated list of accepted currencies |

### Client → Server (Retry with Payment)

| Header | Description |
|--------|-------------|
| `Authorization` | `x402 <base64-encoded-authorization>` |

## Network Identifiers

| Network | CAIP-2 ID |
|---------|-----------|
| BCH Mainnet | `bip122:000000000000000000651ef99cb9fcbe` |
| BCH Chipnet | `bip122:000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f` |

## Production Considerations

This is a **reference implementation** for testing. For production:

1. **Use a real facilitator** - The official x402 facilitator handles payment verification
2. **Set RECEIVE_ADDRESS** - Your BCH address for receiving payments
3. **Verify on-chain** - In production, verify the actual transaction on-chain
4. **Handle idempotency** - Prevent double-spending and replay attacks
5. **Add rate limiting** - Prevent abuse
6. **Use HTTPS** - In production, always use TLS

## See Also

- [x402 Protocol](https://x402.org)
- [x402 BCH Specification](https://github.com/x402-bch/x402-bch)
- [paytaca-cli](https://github.com/PayAINetwork/paytaca-cli)
