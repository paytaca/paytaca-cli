/**
 * Oh My Pi (omp) approval-policy support.
 *
 * omp can gate any tool behind an in-TUI Allow/Deny prompt with a per-tool
 * policy:
 *
 *   tools:
 *     approval:
 *       mcp__paytaca_pay_media: prompt
 *
 * Per-tool `prompt` policies are honored in every approval mode (including the
 * default `yolo`) and are not bypassed by `--auto-approve`. That lets the MCP
 * server treat `pay_media` as the only spending tool and rely on omp to ask the
 * user inside the agent UI.
 *
 * The server only pays directly when it can verify that the policy is really
 * installed for the connected host. Any doubt fails closed.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The only Paytaca MCP tool that may move funds on a gated host. */
export const PAY_MEDIA_TOOL = 'pay_media'

/** omp names MCP tools `mcp__<server>_<tool>` (server is `paytaca`). */
export const PAY_MEDIA_POLICY_KEY = `mcp__paytaca_${PAY_MEDIA_TOOL}`

/** The policy value required for the server to trust the host gate. */
export const REQUIRED_POLICY = 'prompt'

/** Client names omp uses when connecting to an MCP server. */
const OMP_CLIENT_NAMES = new Set(['omp-coding-agent', 'omp'])

export interface OmpGateResult {
  verified: boolean
  /** Human-readable explanation, always set when not verified. */
  reason?: string
  /** The config file inspected, when it could be determined. */
  configPath?: string
}

/** Resolve omp's agent directory, honoring the same env overrides omp uses. */
export function ompAgentDir(): string {
  return (
    process.env.OMP_AGENT_DIR ||
    process.env.PI_AGENT_DIR ||
    join(homedir(), '.omp', 'agent')
  )
}

export function ompConfigPath(agentDir = ompAgentDir()): string {
  return join(agentDir, 'config.yml')
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

interface YamlEntry {
  indent: number
  key: string
  value: string
}

function parseEntry(line: string): YamlEntry | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const match = line.match(/^(\s*)([^:#][^:]*?)\s*:\s*(.*?)\s*$/)
  if (!match) return null
  return {
    indent: match[1].length,
    key: stripQuotes(match[2].trim()),
    value: match[3].trim(),
  }
}

function indentOf(line: string): number {
  const match = line.match(/^ */)
  return match ? match[0].length : 0
}

function isIgnorable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

/**
 * Read `tools.approval.<key>` from an omp config.yml. Returns the raw scalar
 * value (unquoted) or null when the path is absent.
 */
export function readOmpApprovalPolicy(
  yaml: string,
  key: string
): string | null {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  let toolsIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (entry.indent === 0 && entry.key === 'tools') {
      toolsIndex = i
      break
    }
  }
  if (toolsIndex === -1) return null

  const toolsEnd = blockEnd(lines, toolsIndex)
  let approvalIndex = -1
  for (let i = toolsIndex + 1; i < toolsEnd; i += 1) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (entry.indent === 2 && entry.key === 'approval') {
      approvalIndex = i
      break
    }
  }
  if (approvalIndex === -1) return null

  const approvalEnd = blockEnd(lines, approvalIndex)
  for (let i = approvalIndex + 1; i < approvalEnd; i += 1) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (entry.indent >= 3 && entry.key === key) {
      return entry.value === '' ? null : stripQuotes(entry.value)
    }
  }
  return null
}

/** Exclusive end index of the YAML block starting at `start`. */
function blockEnd(lines: string[], start: number): number {
  const parentIndent = indentOf(lines[start])
  let i = start + 1
  for (; i < lines.length; i += 1) {
    if (isIgnorable(lines[i])) continue
    if (indentOf(lines[i]) <= parentIndent) break
  }
  return i
}

/**
 * Insert or update `tools.approval.<key>` values while preserving every other
 * key in the file. Only scalar policy values are supported, which is all omp's
 * `tools.approval` record accepts.
 */
export function upsertOmpApprovalPolicyYaml(
  existingYaml: string,
  policies: Record<string, string>
): string {
  const normalized = existingYaml.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const renderApprovalEntries = (): string[] =>
    Object.entries(policies).map(([key, value]) => `    ${key}: ${value}`)

  let toolsIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (entry.indent === 0 && entry.key === 'tools') {
      toolsIndex = i
      break
    }
  }

  if (toolsIndex === -1) {
    const head = lines.length > 0 ? [...lines, ''] : []
    return (
      [...head, 'tools:', '  approval:', ...renderApprovalEntries()].join('\n') +
      '\n'
    )
  }

  // A scalar `tools: ...` cannot host a mapping; replace it with a block and
  // re-insert the original value under a compat key is not possible, so only
  // rewrite when it is empty (the normal shape).
  const toolsEntry = parseEntry(lines[toolsIndex])
  if (toolsEntry && toolsEntry.value !== '') {
    lines[toolsIndex] = 'tools:'
  }

  const toolsEnd = blockEnd(lines, toolsIndex)
  let approvalIndex = -1
  for (let i = toolsIndex + 1; i < toolsEnd; i += 1) {
    const entry = parseEntry(lines[i])
    if (!entry) continue
    if (entry.indent === 2 && entry.key === 'approval') {
      approvalIndex = i
      break
    }
  }

  if (approvalIndex === -1) {
    lines.splice(toolsIndex + 1, 0, '  approval:', ...renderApprovalEntries())
    return `${lines.join('\n')}\n`
  }

  // Rebuild the approval block: keep unrelated policies/comments, update the
  // keys we own, and append any that are missing.
  const approvalEnd = blockEnd(lines, approvalIndex)
  const kept: string[] = []
  const seen = new Set<string>()
  for (let i = approvalIndex + 1; i < approvalEnd; i += 1) {
    const line = lines[i]
    const entry = parseEntry(line)
    if (entry && entry.indent >= 3 && entry.key in policies) {
      kept.push(`    ${entry.key}: ${policies[entry.key]}`)
      seen.add(entry.key)
    } else {
      kept.push(line)
    }
  }
  for (const [key, value] of Object.entries(policies)) {
    if (!seen.has(key)) kept.push(`    ${key}: ${value}`)
  }

  lines.splice(approvalIndex, approvalEnd - approvalIndex, '  approval:', ...kept)
  return `${lines.join('\n')}\n`
}

/**
 * Verify that the connected host will show an in-TUI approval for `pay_media`.
 *
 * Fails closed: an unrecognized host, a missing config file, or a missing /
 * non-`prompt` policy all return `verified: false` and the caller must fall
 * back to the terminal approval flow.
 */
export function verifyOmpPayMediaGate(
  clientName: string | undefined,
  options: {
    configPath?: string
    projectDir?: string
    readFile?: (path: string) => string
  } = {}
): OmpGateResult {
  if (!clientName || !OMP_CLIENT_NAMES.has(clientName)) {
    return {
      verified: false,
      reason: `the connected host (${clientName || 'unknown'}) has no verified in-UI approval gate`,
    }
  }

  const configPath = options.configPath ?? ompConfigPath()
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))

  let yaml: string
  try {
    yaml = read(configPath)
  } catch {
    return {
      verified: false,
      reason: `omp's config could not be read at ${configPath}`,
      configPath,
    }
  }

  const policy = readOmpApprovalPolicy(yaml, PAY_MEDIA_POLICY_KEY)
  if (policy !== REQUIRED_POLICY) {
    return {
      verified: false,
      reason: policy
        ? `omp's ${PAY_MEDIA_POLICY_KEY} policy is "${policy}", not "${REQUIRED_POLICY}"`
        : `omp's ${PAY_MEDIA_POLICY_KEY} policy is not set to "${REQUIRED_POLICY}"`,
      configPath,
    }
  }

  // omp also merges a per-project `.omp/config.yml`. A project overlay must not
  // be able to downgrade the global prompt policy to allow (which would let the
  // server pay without showing the user anything).
  const projectConfigPath = join(
    options.projectDir ?? process.cwd(),
    '.omp',
    'config.yml'
  )
  if (projectConfigPath !== configPath && existsSync(projectConfigPath)) {
    let projectYaml: string
    try {
      projectYaml = read(projectConfigPath)
    } catch {
      return {
        verified: false,
        reason: `omp's project config could not be read at ${projectConfigPath}`,
        configPath: projectConfigPath,
      }
    }
    const projectPolicy = readOmpApprovalPolicy(projectYaml, PAY_MEDIA_POLICY_KEY)
    if (projectPolicy !== null && projectPolicy !== REQUIRED_POLICY) {
      return {
        verified: false,
        reason: `omp's project config overrides ${PAY_MEDIA_POLICY_KEY} to "${projectPolicy}"`,
        configPath: projectConfigPath,
      }
    }
  }

  return { verified: true, configPath }
}
