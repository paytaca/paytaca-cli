# Paytaca CLI

A command-line interface for the Paytaca wallet. Built with the same core logic as the [Paytaca mobile app](https://github.com/nicefiction/paytaca-app), using [watchtower-cash-js](https://github.com/nicefiction/watchtower-cash-js) for transaction operations and [libauth](https://github.com/bitauth/libauth) for HD key derivation.

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
paytaca balance --chipnet          # Query chipnet balance
```

### Receive

```bash
paytaca receive                    # Show receiving address with QR code
paytaca receive 3                  # Show address at index 3
paytaca receive --no-qr            # Address only, no QR code
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
```

### Address

```bash
paytaca address derive             # Derive address at index 0
paytaca address derive 5           # Derive address at index 5
paytaca address list               # List first 5 addresses
paytaca address list -n 20         # List first 20 addresses
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

Powered by [@napi-rs/keyring](https://github.com/nicefiction/keyring) (prebuilt Rust binaries, no node-gyp).

## Architecture

```
src/
  commands/        CLI command definitions (Commander.js)
    wallet.ts        wallet create | import | info | export
    balance.ts       balance display
    receive.ts       receiving address + QR code
    send.ts          BCH sending
    history.ts       transaction history
    address.ts       HD address derivation
  wallet/
    index.ts         Wallet class, mnemonic gen/import/load
    bch.ts           BchWallet (balance, send, history, subscribe)
    keys.ts          LibauthHDWallet (HD key derivation)
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

MIT
