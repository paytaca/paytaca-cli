/**
 * Pending media approvals.
 *
 * Hosts without MCP elicitation cannot render an approval form, so instead of
 * paying immediately the server records the quote here and hands the agent a
 * short handle. The user completes the approval themselves with
 * `paytaca approve <id>` in their own terminal, which is the only place a real
 * TTY exists. The record holds no secrets and is safe to leave on disk: paying
 * still requires the wallet and an interactive confirmation.
 */

import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { MediaSelection } from '../mcp/approval.js'

export interface ImageGenerationArgs {
  prompt: string
  model?: string
  aspect_ratio?: string
  quality?: string
  resolution?: string
  input_references?: string[]
  isChipnet: boolean
  backendUrl?: string
}

export interface VideoGenerationArgs {
  prompt: string
  model?: string
  duration?: number
  resolution?: string
  aspect_ratio?: string
  generate_audio?: boolean
  input_references?: { url: string; frame_type?: 'first_frame' | 'last_frame' }[]
  isChipnet: boolean
  backendUrl?: string
}

export interface AudioGenerationArgs {
  prompt: string
  model?: string
  voice?: string
  response_format?: string
  speed?: number
  isChipnet: boolean
  backendUrl?: string
}

export type PendingKind = 'image' | 'video' | 'audio'

export type PendingArgs =
  | { kind: 'image'; args: ImageGenerationArgs }
  | { kind: 'video'; args: VideoGenerationArgs }
  | { kind: 'audio'; args: AudioGenerationArgs }

export interface PendingQuote {
  orderId: string
  model?: string
  amountSats: number
  amountUsd?: number
  prompt?: string
  contractAddress?: string
  [key: string]: unknown
}

export interface PendingApproval {
  id: string
  kind: PendingKind
  /** Everything needed to rebuild the request and re-quote at approval time. */
  args: ImageGenerationArgs | VideoGenerationArgs | AudioGenerationArgs
  /** The model/parameter selection the agent proposed. */
  selection: MediaSelection
  /** The quote shown when the approval was created. Reused if still fresh. */
  quote: PendingQuote
  createdAt: string
}

const DEFAULT_DIR = path.join(os.homedir(), '.paytaca', 'pending')

/** Overridable so tests (and embedders) never touch the real home directory. */
export function pendingDir(): string {
  return process.env.PAYTACA_PENDING_DIR || DEFAULT_DIR
}

function validId(id: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(id)
}

function fileFor(id: string): string {
  return path.join(pendingDir(), `${id}.json`)
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(pendingDir(), { recursive: true, mode: 0o700 })
}

async function writeAtomic(file: string, body: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, body, { mode: 0o600 })
  await fs.rename(tmp, file)
}

/** Persist a pending approval and return its handle. */
export async function savePendingApproval(
  record: Omit<PendingApproval, 'id' | 'createdAt'>
): Promise<PendingApproval> {
  await ensureDir()
  const saved: PendingApproval = {
    ...record,
    id: record.quote.orderId,
    createdAt: new Date().toISOString(),
  }
  if (!validId(saved.id)) {
    throw new Error('The backend returned an unusable order id.')
  }
  await writeAtomic(fileFor(saved.id), `${JSON.stringify(saved, null, 2)}\n`)
  return saved
}

/** List pending approvals, newest first. Corrupt files are skipped. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  let names: string[]
  try {
    names = await fs.readdir(pendingDir())
  } catch {
    return []
  }
  const records: PendingApproval[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.includes('.tmp')) continue
    const id = name.slice(0, -'.json'.length)
    if (!validId(id)) continue
    try {
      const raw = await fs.readFile(fileFor(id), 'utf8')
      const parsed = JSON.parse(raw) as PendingApproval
      if (parsed && parsed.id === id && parsed.kind && parsed.args) {
        records.push(parsed)
      }
    } catch {
      // Ignore unreadable or half-written entries.
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return records
}

/**
 * Resolve a full id or an unambiguous prefix. Throws with a helpful message so
 * the CLI can print it instead of a stack trace.
 */
export async function resolvePendingApproval(idOrPrefix: string): Promise<PendingApproval> {
  const cleaned = idOrPrefix.trim().toLowerCase()
  if (!validId(cleaned)) {
    throw new Error('That is not a valid approval id.')
  }
  const all = await listPendingApprovals()
  const exact = all.find((entry) => entry.id === cleaned)
  if (exact) return exact
  const matches = all.filter((entry) => entry.id.toLowerCase().startsWith(cleaned))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    throw new Error(
      `No pending approval matches "${idOrPrefix}". Run \`paytaca approve\` to list them.`
    )
  }
  throw new Error(
    `"${idOrPrefix}" matches ${matches.length} pending approvals; use more of the id.`
  )
}

export async function removePendingApproval(id: string): Promise<void> {
  if (!validId(id)) return
  await fs.unlink(fileFor(id)).catch(() => {})
}

/**
 * Take an exclusive lock for one approval so two concurrent `paytaca approve`
 * runs cannot both pay the same order. Returns a release function.
 */
export async function lockPendingApproval(id: string): Promise<() => Promise<void>> {
  await ensureDir()
  if (!validId(id)) throw new Error('That is not a valid approval id.')
  const lock = path.join(pendingDir(), `${id}.lock`)

  // Create the lock atomically with its pid already inside, so a competing
  // process can never observe an empty lock file and mistake it for stale.
  const acquire = async (): Promise<void> => {
    const tmp = path.join(pendingDir(), `${id}.lock.${process.pid}.${randomUUID()}`)
    await fs.writeFile(tmp, `${process.pid}\n`, { mode: 0o600 })
    try {
      await fs.link(tmp, lock)
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  }

  try {
    await acquire()
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err
    // A previous run may have been killed before releasing the lock. Reclaim it
    // only when the pid recorded there is definitely gone.
    const raw = await fs.readFile(lock, 'utf8').catch(() => '')
    const pid = Number(raw.trim())
    let alive = false
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
        alive = true
      } catch (probe: any) {
        alive = probe?.code === 'EPERM'
      }
    }
    if (alive) {
      throw new Error('This approval is already being processed in another terminal.')
    }
    await fs.unlink(lock).catch(() => {})
    await acquire()
  }

  return async () => {
    await fs.unlink(lock).catch(() => {})
  }
}
