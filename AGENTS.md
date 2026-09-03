# AI Agent Instructions

## General Rules

- Do NOT auto-commit changes — ask before committing.
- Do NOT write new files unless explicitly asked; prefer editing existing code.
- Do NOT add comments to code unless requested.
- Keep explanations and responses concise.
- Follow existing code style and patterns in the codebase (TypeScript, ESM with `.js` import suffixes, 2-space indent).
- Prefer the dedicated tools (Read, Grep, Glob, Edit, Write) over bash for file operations.

## Environment

- This is a **command-line** tool for **desktop** (macOS, Linux, Windows) — there is no UI, no frontend code, no mobile code.
- The binary is `paytaca` (Commander.js), invoked as `node bin/paytaca.js` or the global `paytaca` command.
- `--chipnet` selects the testnet network; everything defaults to mainnet.

## Tech Stack

- **Language:** TypeScript (ES modules, compiled with `tsc` to `dist/`; imports use `.js` suffix).
- **CLI framework:** Commander.js
- **Key derivation:** `@bitauth/libauth` (pinned to 2.0.0-alpha.8) + `bip39` (BIP44: `m/44'/145'/0'` for BCH; `m/44'/1237'/0'/0/0` for Nostr).
- **Transactions:** `watchtower-cash-js` (UTXO fetching, tx building/signing/broadcasting).
- **Secret storage:** OS-native keychain via `@napi-rs/keyring` (prebuilt Rust binaries, no node-gyp).
- **Testing:** Vitest (`npm test` → `vitest run`). There is **no lint script** — run `npm run build` (tsc) to type-check.
- **Dev scripts:** `npm run build` (tsc), `npm run dev` (tsc --watch), `npm test` (vitest run).

## Conventions

- Run `npm run build` before signaling completion — it type-checks the whole project.
- Run `npm test` when changes affect tested code (tests live alongside sources as `*.test.ts`).
- Keep `console.error` out of test output — spy/mock expected error paths in tests or they leak noise into other tests.

## Key Storage (differs from paytaca-app)

- Secrets are stored in the **OS keychain**, NOT in app storage or capacitor plugins:
  - macOS — Keychain; Linux — GNOME Keyring / KWallet; Windows — Credential Manager.
 (Backed by `@napi-rs/keyring`, service name `paytaca-cli`.)
- Key names mirror paytaca-app for continuity:
  - Mnemonic: `mn_{walletHash}`; Active wallet: `active_wallet`.
  (`src/storage/keychain.ts`, `src/wallet/index.ts`)
- Nostr chat keys are **not stored** — they are re-derived from the wallet mnemonic at runtime via HD path `m/44'/1237'/0'/0/0` and held only in memory during a chat session (`src/nostr/keys.ts`).
- Chat state (contacts, rooms, messages) is persisted as JSON at `~/.paytaca/chat-state.json` (mode 0600) — this is non-secret metadata only;never write keys to it.

## Automated Code Review (Security)

Every pull request undergoes an AI-assisted security review. Pay particular attention to changes that could affect:

- Entropy and recovery-phrase generation (`bip39`, `src/wallet/index.ts`)
- Private-key derivation (`src/wallet/keys.ts`, `src/nostr/keys.ts`) — HD paths, WIF encoding, in-memory key material
- Recovery-phrase storage and retrieval (`src/storage/keychain.ts`, `src/wallet/index.ts`) — keychain-only, no plaintext files, no logging of phrases, no persistence beyond the keychain aside from `~/.paytaca/chat-state.json` metadata
- Encryption and signing (transactions via `watchtower-cash-js`/libauth, x402 payment signing, Nostr event signing in memory)
- Transaction construction (UTXO selection, change addresses, token-aware z-prefix addresses, `src/wallet/cauldron/*`)
- Smart contracts / token pools (Cauldron DEX swaps in `src/wallet/cauldron/*`)
- Secret material in memory — derived keys and mnemonic must not be logged, printed, or serialized into persisted state or CLI output except where explicitly requested (e.g. `wallet export` shows the seed phrase with a warning)
- Migration of sensitive data — no legacy key schemes exist in the CLI; do not introduce any
- External interfaces that could influence signing behavior — relay URLs (`kind 10050`), x402 `PaymentRequired` payloads, UTXO data from watchtower, cauldron pool data: never sign data without validating it is well-formed and intended
- CLI output handling — avoid echoing secrets into logs, `--json` output, or error messages (sanitize addresses/hex in errors).

For findings, reference the specific file and line, describe the risk and severity, and suggest a concrete fix.