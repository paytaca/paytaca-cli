# Paytaca CLI

A command-line interface for the Paytaca [Bitcoin Cash](https://bitcoincash.org) (BCH) wallet. Built with the same core logic as the [Paytaca mobile app](https://github.com/paytaca/paytaca-app), using [watchtower-cash-js](https://github.com/paytaca/watchtower-cash-js) for transaction operations and [libauth](https://github.com/bitauth/libauth) for HD key derivation.

Bitcoin Cash is peer-to-peer electronic cash, enabling fast, low-fee transactions for everyday use. Paytaca CLI brings the full capabilities of the Paytaca wallet to the terminal — create wallets, derive addresses, send and receive BCH, manage CashTokens (fungible tokens and NFTs), swap tokens on the Cauldron DEX, pay x402 HTTP APIs, chat over Nostr, and view transaction history, all from the command line.

Designed to be AI agent-friendly and useful for automation by power users. It ships an MCP server and a one-step installer for the Paytaca AI provider.

## Requirements

- Node.js >= 20 (developed on 22.12.0)

## Installation

```bash
npm install -g paytaca-cli
```

Or install from source:

```bash
git clone https://github.com/paytaca/paytaca-cli.git && cd paytaca-cli
npm install
npm run build
npm link
```

After installing, the `paytaca` command is available globally.

## Commands

Most commands accept `--json` for machine-readable output and `--chipnet` to target testnet (see [Network](#network)). Run `paytaca <command> --help` for the full option list.

### Wallet

```bash
paytaca wallet create              # Generate a new 12-word seed phrase
paytaca wallet create --chipnet    # Create on chipnet (testnet)
paytaca wallet import              # Import an existing seed phrase
paytaca wallet info                # Show wallet hash, address, and balance
paytaca wallet export              # Display the stored seed phrase (interactive terminal + biometrics)
```

> `wallet export` requires an interactive terminal and prompts for biometric
> authentication (Touch ID, fingerprint, or Windows Hello) when available. It
> cannot be used from scripts, pipes, or other non-interactive processes.

### Balance

```bash
paytaca balance                    # Show BCH balance with USD conversion
paytaca balance --sats             # Show in satoshis only
paytaca balance --token <category> # Show balance for a specific CashToken
paytaca balance --tokens           # Show CashToken balances only (balance > 0)
paytaca balance --all              # Show BCH and CashToken balances
paytaca balance --chipnet          # Query chipnet balance
```

The default balance view shows the BCH (or token) amount plus its fiat value (e.g. `0.01218811 BCH` / `≈ 3.17 USD`). Fiat conversion is skipped when no price is available. `--tokens` and `--all` list only tokens with a positive balance.

### Receive

```bash
paytaca receive                              # Show receiving address with QR code
paytaca receive --index 3                    # Show address at index 3
paytaca receive --no-qr                      # Address only, no QR code
paytaca receive --amount 0.5                 # BIP21 URI with BCH amount
paytaca receive --token                      # Token-aware z-prefix address
paytaca receive --token <category>           # PayPro URI for a specific token
paytaca receive --token <category> --amount 100  # PayPro URI with token amount
```

The displayed address (and its token-aware variant) is automatically subscribed with Watchtower so incoming BCH and CashTokens are monitored, even for indices not covered by the initial wallet scan.

### Send

```bash
paytaca send <address> <amount>               # Send BCH (default currency: bch)
paytaca send <address> 50000 sats             # Send in satoshis
paytaca send <address> 50000 satoshis         # Send in satoshis (alias)
paytaca send <address> 10 usd                 # Send a USD amount (converted at live rate)
paytaca send <address> 0.001 --chipnet        # Send on chipnet
```

The `[currency]` argument is positional: `bch` (default), `sats`/`satoshis`, or `usd`. When sending with `usd`, the current BCH-USD rate is fetched and applied, and the fiat value is shown inline with the amount.

### Transaction History

```bash
paytaca history                    # Show recent transactions
paytaca history --sats             # Amounts in satoshis
paytaca history --type incoming    # Filter: incoming, outgoing, or all
paytaca history --page 2           # Pagination
paytaca history --token <category> # Filter by CashToken category
```

### Address

```bash
paytaca address derive             # Derive address at index 0
paytaca address derive 5           # Derive address at index 5
paytaca address derive --token     # Derive token-aware z-prefix address
paytaca address list               # List first 5 addresses
paytaca address list -n 20         # List first 20 addresses
paytaca address list --token       # List token-aware z-prefix addresses
```

### CashTokens

```bash
paytaca token list                                   # List fungible tokens with balances and USD values
paytaca token info <category>                        # Token metadata, balance, USD value, and NFTs
paytaca token price <category> [amount]              # USD price of a token and value of an amount (default: balance)
paytaca token send <address> <amount> --token <cat>  # Send fungible tokens
paytaca token send-nft <address> --token <cat> --commitment <hex>  # Send an NFT
paytaca token send-nft <address> --token <cat> --commitment '' --capability minting
```

`token send-nft` also accepts `--capability <none|minting|mutable>` (default `none`), and `--txid` / `--vout` to pin a specific NFT UTXO (auto-detected otherwise).

### Swap (Cauldron DEX)

```bash
paytaca swap <tokenId> <amount>                # Sell tokens for BCH (default: sell)
paytaca swap <tokenId> <amount> --action buy   # Buy tokens with BCH
paytaca swap <tokenId> <amount> --raw          # Amount is in raw base units
paytaca swap <tokenId> <amount> --yes          # Skip the confirmation prompt
```

The `--action` option is `sell` (token→BCH) or `buy` (BCH→token). Swaps run on mainnet only; `--chipnet` is accepted but exits with an error.

### x402 Payments

The x402 protocol enables HTTP payments via BCH. Some APIs require payment to access.

```bash
paytaca check <url>                    # Check if URL requires payment, shows estimated cost
paytaca check <url> -X POST -d '{}'    # Check a POST endpoint (-X/--method, -H/--header, -d/--body)
paytaca pay <url>                      # Make a paid HTTP request (handles 402 automatically)
paytaca pay <url> --json               # JSON output (recommended for AI agents)
paytaca pay <url> --dry-run            # Preview payment without executing
paytaca pay <url> -X POST -d '{"prompt":"hello"}'
paytaca pay <url> --max-amount 500     # Cap payment in sats (overrides server max)
paytaca pay <url> --change-address <addr>  # Custom change address
paytaca pay <url> --payer <value>      # Payer identifier (defaults to wallet index 0)
paytaca pay <url> --confirmed          # Skip the confirmation prompt
```

**Example workflow:**
```bash
paytaca check https://api.example.com/v1/complete --json
# → {"paymentRequired": true, "estimatedCostSats": "100"}

paytaca pay https://api.example.com/v1/complete --method POST --body '{"prompt":"hello"}'
# → Handles 402 → pays → returns response
```

### Paytaca AI

Paytaca AI is a pay-as-you-go model gateway paid with BCH or LIFT via x402. Manage it from the CLI:

```bash
paytaca ai configure [harness]      # Install MCP + AI provider (opencode is the default)
paytaca ai api-key create           # Create a wallet-bound API key (shown once)
paytaca ai models                   # List available models
paytaca ai plans [model]            # Plan pricing, optionally for a single model
paytaca ai credits [--model <id>]   # Remaining time credits per model
paytaca ai usage                    # Per-session usage
paytaca ai balance                  # BCH + LIFT funds available for purchases
paytaca ai purchase --model <id> --minutes <n>              # Buy a plan
paytaca ai purchase --model <id> --minutes 60 --lift        # Pay with LIFT (discount)
paytaca ai auto-refill --enable --model <id> --minutes <n> --max-minutes <n>
paytaca ai auto-refill --status     # Inspect; also --disable
```

`ai configure` accepts `--backend`, `--path`, `--api-key`, `--chipnet`, and `-y/--yes`. `ai purchase` and `ai auto-refill` accept `--lift` to pay with LIFT tokens at a discount. Add `--json` to any `ai` subcommand for machine-readable output.

### MCP Server

Configure an AI harness in one step. This installs the Paytaca MCP server and, for opencode, also the Paytaca AI provider (model catalogue + API key) so the Paytaca AI models are usable immediately:

```bash
paytaca ai configure opencode   # opencode | pi
```

The command creates a wallet-bound API key against the Paytaca AI backend, writes the provider (base URL, models, key) and MCP server into the harness config, then checks your AI credits and offers to buy a plan when none are active.

Re-running is idempotent: an existing provider API key is reused. Then run the server over stdio:

```bash
paytaca mcp              # mainnet
paytaca mcp --chipnet    # default MCP tools to chipnet (testnet)
```

**Read-only wallets:** if the active wallet cannot sign (no seed phrase in the keychain), `ai configure` asks for an API key instead of creating one. Generate it from your full wallet and hand it over:

```bash
paytaca ai api-key create                          # full wallet: prints sk-pytc-… once
paytaca ai configure opencode --api-key sk-pytc-…  # read-only wallet
```

Read-only wallets report credits from the shared wallet hash but can't buy plans — fund credits from the full wallet.

**MCP tools:** wallet reads (`get_balance`, `get_transactions`, `get_receiving_address`, `get_tokens`, `send`) plus Paytaca AI (`get_models`, `get_plans`, `get_credits`, `buy_plan`, `auto_refill`, `get_help`).

Spending tools (`send`, `buy_plan`, `auto_refill`) require host-level approval. By default MCP operates on your **main wallet** and can spend real funds.

When `get_credits` finds a model with no active session (e.g. after a `402` from the Paytaca AI provider), the result includes a `purchaseHint`. Relay `purchaseHint.message` as-is — it carries the exact copy-paste top-up command (no upsell or follow-up questions needed):

```json
{
  "modelId": "deepseek/deepseek-v4.1-flash",
  "active": false,
  "purchaseHint": {
    "model": "deepseek/deepseek-v4.1-flash",
    "minutes": 15,
    "command": "paytaca ai purchase --model deepseek/deepseek-v4.1-flash --minutes 15",
    "message": "To keep using DeepSeek V4.1 Flash, top up by running this in a terminal:\n\n    paytaca ai purchase --model deepseek/deepseek-v4.1-flash --minutes 15\n\n(Switch models with `paytaca ai plans`.)"
  }
}
```

### Nostr Chat

End-to-end encrypted Nostr chat keyed from the wallet mnemonic (HD path `m/44'/1237'/0'/0/0`; keys are derived in memory and never stored). Conversation metadata (contacts, rooms, messages) is persisted at `~/.paytaca/chat-state.json`.

```bash
paytaca chat identity                     # Show your npub and pubkey
paytaca chat profile                      # Show display name and published BCH address
paytaca chat contacts                     # List saved contacts
paytaca chat add-contact <npub> [name]    # Add a contact
paytaca chat start <npub>                 # Start a 1:1 conversation
paytaca chat list                         # List conversations
paytaca chat open <room-id> --tail 20     # Show recent messages (--tail, --json)
paytaca chat send <room-id> <text>        # Send a message
paytaca chat listen [--contact <npub|name>]  # Subscribe to new messages (long-running)
paytaca chat set-display-name <name>      # Publish profile name to relays (NIP-78)
paytaca chat set-bch-address <address>    # Publish a BCH address to relays (NIP-78)
paytaca chat remove-display-name          # Remove published name
paytaca chat remove-bch-address           # Remove published address
```

## Network

All commands default to **mainnet**. Pass `--chipnet` for testnet:

```bash
paytaca wallet create --chipnet
paytaca balance --chipnet
paytaca send <address> <amount> --chipnet
```

## Security

Seed phrases are stored in the OS native keychain:

- **macOS** — Keychain
- **Linux** — GNOME Keyring / KWallet
- **Windows** — Credential Manager

Powered by [@napi-rs/keyring](https://github.com/Brooooooklyn/keyring-node) (prebuilt Rust binaries, no node-gyp required).

Nostr chat keys are **not** persisted — they are re-derived from the wallet mnemonic at runtime via HD path `m/44'/1237'/0'/0/0` and held only in memory for the duration of a session. Non-secret chat metadata (contacts, rooms, messages) is written to `~/.paytaca/chat-state.json` with mode `0600`; no key material is ever written there.

## Architecture

```
src/
  commands/        CLI command definitions (Commander.js)
    wallet.ts        wallet create | import | info | export
    balance.ts       balance display (BCH and CashTokens, USD conversion)
    receive.ts       receiving address + QR code + payment URIs
    send.ts          BCH sending (bch/sats/usd amounts)
    history.ts       transaction history (BCH and CashTokens)
    address.ts       HD address derivation (standard and z-prefix)
    token.ts         CashToken commands (list, info, price, send, send-nft)
    swap.ts          Cauldron DEX swaps (sell/buy with --action)
    pay.ts           x402 BCH payment handler for HTTP requests
    check.ts         Check if URL requires x402 payment
    ai.ts            Paytaca AI (configure, api-key, models, plans, credits, purchase, auto-refill)
    chat.ts          Nostr chat (contacts, conversations, identity, listen)
    mcp.ts           `paytaca mcp` stdio entry + per-harness config templates
  core/
    context.ts       Wallet context resolution (keychain + network), embed-safe
    wallet.ts        Render-agnostic wallet ops shared by CLI and MCP tools
  mcp/
    server.ts        MCP server construction and stdio lifecycle
    tools.ts         MCP tool registration (wallet reads, send, Paytaca AI)
  wallet/
    index.ts         Wallet class, mnemonic gen/import/load
    bch.ts           BchWallet (balance, send, history, CashTokens)
    keys.ts          LibauthHDWallet (HD key derivation, token addresses)
    x402.ts          X402Payer (BCH payment signing and verification)
    cauldron/
      api.ts           Cauldron (riften indexer) REST client
      pools.ts         Pool conversions and helpers
      swap.ts          Swap orchestration: quote estimation and execution
      transact.ts      Cauldron trade transaction building
  storage/
    keychain.ts      OS keychain wrapper (@napi-rs/keyring)
  utils/
    crypto.ts        pubkey -> CashAddress pipeline
    format.ts        Shared display/formatting helpers
    network.ts       Watchtower URLs, derivation paths
    prices.ts        Watchtower asset-prices client (USD per token/BCH)
    x402.ts          x402 header parsing, payment requirement selection
  types/
    x402.ts          x402 payment types (PaymentRequired, PaymentPayload, etc.)
  ai/
    client.ts        Paytaca AI backend client (config, wallet status)
    config.ts        Backend URL, LIFT token id, ~/.paytaca paths
    oauth.ts         BCH OAuth challenge -> access token -> API key
    models.ts        Model catalogue, plan tiers, price/duration helpers
    credits.ts       Credit session lookup and summaries
    purchase.ts      Plan purchase via x402 (BCH or LIFT)
    autoRefill.ts    Auto-refill state and orchestration
    configure.ts     Harness setup (MCP + Paytaca AI provider + credits offer)
  nostr/
    keys.ts          Nostr key derivation from wallet mnemonic (in memory)
    chat.ts          DM event building/signing (NIP-17 style)
    relay.ts         Relay connection/subscription service
    store.ts         Contact/room/message JSON store (~/.paytaca)
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `watchtower-cash-js` | UTXO fetching, tx building/signing/broadcasting |
| `@bitauth/libauth` | HD key derivation (pinned to 2.0.0-alpha.8) |
| `@cashlab/cauldron` | Cauldron DEX swap building |
| `@napi-rs/keyring` | OS-native keychain storage |
| `@modelcontextprotocol/sdk` | MCP server (stdio) |
| `bip39` | Mnemonic generation and validation |
| `nostr-tools` | Nostr chat events, keys, and relay transport |
| `js-sha256` | Hashing for key derivation and payment headers |
| `commander` | CLI framework |
| `chalk` | Terminal colors |
| `qrcode-terminal` | Terminal QR code rendering |
| `zod` | MCP tool input schemas |

## Development

```bash
npm run dev        # Watch mode (recompile on change)
npm run build      # One-time build (also type-checks)
npm test           # Run the Vitest suite
npm run clean      # Remove dist/
```

There is no lint script; `npm run build` is the type-check. Tests live next to sources as `*.test.ts`.

## x402 Server

A reference x402 server accepting BCH (the `utxo` scheme) is included for testing:

```bash
cd x402-server
npm install
npm run dev        # Start dev server on port 3000 (npm start to run once)
```

Configuration via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BCH_NETWORK` | `mainnet` or `chipnet` | `mainnet` |
| `RECEIVE_ADDRESS` | BCH address to receive payments | required for real payments |

The server exposes:

| Endpoint | Cost | Description |
|----------|------|-------------|
| `GET /api/quote` | 100 sats | Random inspirational quote |
| `GET /api/weather` | 50 sats | Fake weather data |
| `GET /api/status` | 1 sat | Server status |

Useful for testing the `paytaca check` / `paytaca pay` workflow locally (see `x402-server/README.md` for the header-level protocol details).

## License

Copyright Paytaca Inc. 2021. All rights reserved. See [LICENSE](LICENSE) for details.
