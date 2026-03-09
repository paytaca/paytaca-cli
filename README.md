# Paytaca CLI

A command-line interface for the Paytaca [Bitcoin Cash](https://bitcoincash.org) (BCH) wallet. Built with the same core logic as the [Paytaca mobile app](https://github.com/paytaca/paytaca-app), using [watchtower-cash-js](https://github.com/paytaca/watchtower-cash-js) for transaction operations and [libauth](https://github.com/bitauth/libauth) for HD key derivation.

Bitcoin Cash is peer-to-peer electronic cash, enabling fast, low-fee transactions for everyday use. Paytaca CLI brings the full capabilities of the Paytaca wallet to the terminal — create wallets, derive addresses, send and receive BCH, manage CashTokens (fungible tokens and NFTs), and view transaction history, all from the command line.

Designed to be AI agent-friendly and useful for automation by power users.

## Requirements

- Node.js >= 20 (developed on 22.12.0)

## Installation

```bash
git clone <repo-url> && cd paytaca-cli
npm install
npm run build
npm link
```

After linking, the `paytaca` command is available globally.

## Commands

### Wallet

```bash
paytaca wallet create              # Generate a new 12-word seed phrase
paytaca wallet create --chipnet    # Create on chipnet (testnet)
paytaca wallet import              # Import an existing seed phrase
paytaca wallet info                # Show wallet hash, address, and balance
paytaca wallet export              # Display the stored seed phrase
```

### Balance

```bash
paytaca balance                    # Show BCH balance (BCH + sats)
paytaca balance --sats             # Show in satoshis only
paytaca balance --token <category> # Show balance for a specific CashToken
paytaca balance --chipnet          # Query chipnet balance
```

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

### Send

```bash
paytaca send <address> <amount>              # Send BCH
paytaca send <address> 50000 --unit sats     # Send in satoshis
paytaca send <address> 0.001 --chipnet       # Send on chipnet
```

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
paytaca token list                                   # List fungible tokens with balances
paytaca token info <category>                        # Token metadata, balance, and NFTs
paytaca token send <address> <amount> --token <cat>  # Send fungible tokens
paytaca token send-nft <address> --token <cat> --commitment <hex>  # Send an NFT
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

## Architecture

```
src/
  commands/        CLI command definitions (Commander.js)
    wallet.ts        wallet create | import | info | export
    balance.ts       balance display (BCH and CashTokens)
    receive.ts       receiving address + QR code + payment URIs
    send.ts          BCH sending
    history.ts       transaction history (BCH and CashTokens)
    address.ts       HD address derivation (standard and z-prefix)
    token.ts         CashToken commands (list, info, send, send-nft)
  wallet/
    index.ts         Wallet class, mnemonic gen/import/load
    bch.ts           BchWallet (balance, send, history, CashTokens)
    keys.ts          LibauthHDWallet (HD key derivation, token addresses)
  storage/
    keychain.ts      OS keychain wrapper (@napi-rs/keyring)
  utils/
    crypto.ts        pubkey -> CashAddress pipeline
    network.ts       Watchtower URLs, derivation paths
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `watchtower-cash-js` | UTXO fetching, tx building/signing/broadcasting |
| `@bitauth/libauth` | HD key derivation (pinned to 2.0.0-alpha.8) |
| `@napi-rs/keyring` | OS-native keychain storage |
| `bip39` | Mnemonic generation and validation |
| `commander` | CLI framework |
| `chalk` | Terminal colors |
| `qrcode-terminal` | Terminal QR code rendering |

## Development

```bash
npm run dev        # Watch mode (recompile on change)
npm run build      # One-time build
npm run clean      # Remove dist/
```

## License

Copyright Paytaca Inc. 2021. All rights reserved. See [LICENSE](LICENSE) for details.
