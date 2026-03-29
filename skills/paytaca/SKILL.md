---
name: paytaca-x402
description: Handles x402 HTTP payment requests using Paytaca BCH wallet. Use when encountering HTTP 402 responses or when calling APIs that may require payment via the x402 protocol.
---

# Paytaca x402 Payment Handler

This skill teaches the agent how to handle x402-based HTTP payments using the Paytaca CLI wallet.

## Overview

Some APIs (like nanogpt, etc.) use the x402 protocol for HTTP payments. When you call these APIs:
- Server returns **HTTP 402 PAYMENT REQUIRED**
- You must pay with BCH to access the resource
- After payment, the server returns the actual response

## Commands

### Check if a URL requires payment (recommended first step)

```bash
paytaca check <url> --json
# Returns: acceptsX402, acceptsBch, estimatedCostSats, etc.
```

Example output:
```json
{
  "url": "https://api.nanogpt.com/v1/complete",
  "acceptsX402": true,
  "acceptsBch": true,
  "paymentRequired": true,
  "estimatedCostSats": "100",
  "costInBch": "0.00000100"
}
```

### Preview payment without executing (dry-run)

```bash
paytaca pay <url> --dry-run --json
# Shows what would happen without actually paying
```

### Make a paid request

```bash
# Basic
paytaca pay <url>

# With JSON output (preferred for AI agents)
paytaca pay <url> --json

# POST request
paytaca pay <url> --method POST --body '{"prompt":"hello"}'

# Custom headers
paytaca pay <url> -H "Authorization: Bearer token123"
```

### Check wallet balance

```bash
paytaca balance
```

## Decision Flow

When preparing to call an unfamiliar API that might require payment:

1. **First check**: `paytaca check <url> --json`
   - If `paymentRequired: false` → proceed normally
   - If `paymentRequired: true` and `acceptsBch: true` → use paytaca pay
   - If `paymentRequired: true` but `acceptsBch: false` → inform user

2. **When encountering HTTP 402**:
   - Parse the `PAYMENT-REQUIRED` headers
   - Use `paytaca pay <url> --json` to handle payment automatically
   - The command handles: parse headers → build BCH tx → broadcast → retry with signature

3. **For known paid APIs**:
   - Just use `paytaca pay <url>` directly - it handles 402 automatically

## AI Agent Workflow

```
Task: Call nanogpt API
Agent: paytaca check https://api.nanogpt.com/v1/complete --json
  → {"acceptsBch": true, "estimatedCostSats": "100"}

Agent: paytaca pay https://api.nanogpt.com/v1/complete --method POST --body '{"prompt":"hello"}' --json
  → Handles 402 → pays 100 sats → returns response with txid
```

## Key Options

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable output (recommended for AI) |
| `--dry-run` | Preview payment without executing |
| `--chipnet` | Use chipnet (testnet) instead of mainnet |
| `--max-amount` | Override max payment amount in sats |

## Notes

- Payment is per-request (no batching)
- Each request = separate BCH transaction
- Only BCH payments are supported (no stablecoins)
- Uses local wallet from OS keychain (credentials never leave the machine)
