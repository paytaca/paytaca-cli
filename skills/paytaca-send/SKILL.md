---
name: paytaca-send
description: Send BCH and CashTokens from the wallet. REQUIRES USER APPROVAL before any sending operation.
---

# Paytaca Send

This skill handles sending BCH and CashTokens. **All sending operations require explicit user approval before execution.**

## ⚠️ User Approval Required

**CRITICAL**: The agent MUST NOT execute any `paytaca send` or `paytaca token send` command without first:
1. Informing the user of the exact amount and recipient
2. Waiting for explicit user confirmation (e.g., "yes", "send it", "confirm")
3. Only then executing the send command

These commands spend real funds from the user's wallet.

---

## Send BCH

```bash
# Basic send (BCH amount)
paytaca send <address> <amount>

# Send in satoshis
paytaca send <address> 50000 --unit sats

# Testnet (chipnet)
paytaca send <address> 0.001 --chipnet
```

### Example Workflow
```
Agent: I'll send 0.001 BCH to bitcoincash:qpm5... 
Confirm? (This will spend real funds)

User: yes

Agent: paytaca send bitcoincash:qpm5... 0.001
  → Transaction sent: txid...
```

---

## Send Fungible Tokens

```bash
# Send tokens (amount in base units)
paytaca token send <address> <amount> --token <category>

# Example: Send 1000 units of a token
paytaca token send bitcoincash:zpm5... 1000 --token abc123...
```

**Note**: Token amounts are in base units. If a token has 8 decimals, sending `1` token requires `100000000` base units.

### Token Address Warning
Tokens should be sent to token-aware (z-prefix) addresses. The CLI will warn if the recipient address is not token-aware.

---

## Send NFTs

```bash
# Send NFT (auto-detect UTXO)
paytaca token send-nft <address> --token <category> --commitment <hex>

# Example: Send NFT with empty commitment
paytaca token send-nft bitcoincash:zpm5... --token abc123... --commitment ""

# With capability (minting or mutable)
paytaca token send-nft <address> --token <category> --commitment <hex> --capability minting
```

### Find NFT details
```bash
# List NFTs for a token category
paytaca token info <category>
```

---

## Network

All commands default to **mainnet**. Use `--chipnet` for testnet:

```bash
paytaca send <address> 0.01 --chipnet
paytaca token send <address> 100 --token <cat> --chipnet
paytaca token send-nft <address> --token <cat> --commitment "" --chipnet
```

---

## Decision Flow

When user requests to send funds:

1. **Validate inputs**: Check address format and amount
2. **Inform user**: State the exact amount, recipient, and network
3. **Wait for approval**: Ask "Send X [BCH/tokens] to <address>? Confirm?"
4. **Execute**: Only after explicit approval

### Example: Sending BCH
```
User: Send 0.01 BCH to bitcoincash:qpm5qz6j5p5s5s5s5s5s5s5s5s5s5s5s5s5

Agent: Checking wallet balance...
paytaca balance

Agent: Balance: 0.5 BCH
Sending 0.01 BCH to bitcoincash:qpm5qz6j5p5s5s5s5s5s5s5s5s5s5s5s5s
Confirm? (yes/no)

User: yes

Agent: paytaca send bitcoincash:qpm5qz6j5p5s5s5s5s5s5s5s5s5s5s5s5s 0.01
  → Transaction sent!
  txid: abc123...
```

### Example: Sending Tokens
```
User: Send 1000 tokens to bitcoincash:zpm5...

Agent: Let me check your token balance first...
paytaca token info <category>

Agent: You have 5000 tokens.
Sending 1000 base units to bitcoincash:zpm5...
Confirm? (yes/no)

User: yes

Agent: paytaca token send bitcoincash:zpm5... 1000 --token <category>
  → Transaction sent!
```

---

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Insufficient balance` | Not enough BCH | Check `paytaca balance` first |
| `Insufficient BCH for fees` | Can't afford tx fee | Need more BCH for miner fee |
| `Invalid address` | Bad address format | Use CashAddr format |
| `Token not found` | Unknown category | Check token category ID |

---

## Security Notes

- Seed phrase is stored in OS keychain (never transmitted)
- Transactions are signed locally
- Always verify recipient address before confirming
- Test with small amounts on mainnet, or use `--chipnet` for testing