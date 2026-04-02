# Paytaca CLI Skills

This directory contains AI agent skills for the Paytaca CLI.

## Available Skills

### paytaca-x402

Handles x402 HTTP payment requests using Paytaca BCH wallet. Use when encountering HTTP 402 responses or when calling APIs that may require payment via the x402 protocol.

```bash
npx skills add paytaca/paytaca-cli --skill paytaca-x402 -a <agent> -g
```

### paytaca-wallet

Query wallet information including BCH balance, CashToken holdings, addresses, and transaction history. Use for read-only wallet operations.

```bash
npx skills add paytaca/paytaca-cli --skill paytaca-wallet -a <agent> -g
```

### paytaca-send

Send BCH and CashTokens from the wallet. **Requires user approval** before any sending operation.

```bash
npx skills add paytaca/paytaca-cli --skill paytaca-send -a <agent> -g
```

## Installation

Install specific skill:
```bash
npx skills add paytaca/paytaca-cli --skill <skill-name> -a <agent> -g
```

Install all skills:
```bash
npx skills add paytaca/paytaca-cli --all
```

List available skills:
```bash
npx skills add paytaca/paytaca-cli --list
```

## Skill Overview

| Skill | Purpose | Approval Needed |
|-------|---------|-----------------|
| paytaca-x402 | HTTP 402 payment handling | Yes (before payment) |
| paytaca-wallet | Balance, addresses, history, token info | No (read-only) |
| paytaca-send | Send BCH and tokens | Yes (before sending) |

## Adding New Skills

To add a new skill:

1. Create a new directory: `skills/<skill-name>/`
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: <skill-name>
   description: What this skill does and when to use it
   ---
   ```
3. Write the skill instructions below the frontmatter