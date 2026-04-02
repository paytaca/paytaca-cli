---
name: paytaca-wallet
description: Query wallet information including BCH balance, CashToken holdings, addresses, and transaction history. Use for read-only wallet operations.
---

# Paytaca Wallet Info

This skill provides read-only access to wallet information via the Paytaca CLI.

## Commands

### Check Balance

```bash
# BCH balance
paytaca balance

# Balance in satoshis
paytaca balance --sats

# Token balance
paytaca balance --token <category>

# Testnet (chipnet)
paytaca balance --chipnet
```

### View Transaction History

```bash
# Recent transactions
paytaca history

# Filter by type
paytaca history --type incoming
paytaca history --type outgoing

# Filter by token
paytaca history --token <category>

# Pagination
paytaca history --page 2

# Satoshis display
paytaca history --sats
```

### Get Receiving Address

```bash
# BCH address with QR code
paytaca receive

# Address at specific index
paytaca receive --index 5

# Address only (no QR)
paytaca receive --no-qr

# Token-aware address (z-prefix)
paytaca receive --token

# With payment amount (BIP21 URI)
paytaca receive --amount 0.5

# Token payment URI
paytaca receive --token <category> --amount 100
```

### Derive Addresses

```bash
# Address at index 0
paytaca address derive

# Address at index 5
paytaca address derive 5

# Token address
paytaca address derive --token

# List first 5 addresses
paytaca address list

# List 20 addresses
paytaca address list -n 20

# Token addresses
paytaca address list --token
```

### Wallet Info

```bash
# Wallet hash, address, balance
paytaca wallet info

# Testnet
paytaca wallet info --chipnet
```

### Token Information

```bash
# List all fungible tokens
paytaca token list

# Token details (name, symbol, decimals, balance, NFTs)
paytaca token info <category>
```

## JSON Output

For programmatic parsing, use `--json` where available:

```bash
paytaca balance --json          # Not yet supported
paytaca history --json          # Not yet supported
```

## Network

All commands default to **mainnet**. Use `--chipnet` for testnet:

```bash
paytaca balance --chipnet
paytaca history --chipnet
paytaca receive --chipnet
paytaca token list --chipnet
```

## Common Workflows

### Check wallet status
```bash
paytaca wallet info
paytaca balance
```

### Get deposit address
```bash
paytaca receive
```

### Check token holdings
```bash
paytaca token list
paytaca token info <category>
```

### View recent activity
```bash
paytaca history
paytaca history --type incoming
```