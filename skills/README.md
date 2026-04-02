# Paytaca CLI Skills

This directory contains AI agent skills for the Paytaca CLI.

## Available Skills

### paytaca-x402

Handles x402 HTTP payment requests using Paytaca BCH wallet. Use when encountering HTTP 402 responses or when calling APIs that may require payment via the x402 protocol.

```bash
npx skills add paytaca/paytaca-cli --skill paytaca-x402 -a opencode -g
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