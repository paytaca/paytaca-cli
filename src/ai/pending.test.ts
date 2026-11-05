import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  listPendingApprovals,
  lockPendingApproval,
  removePendingApproval,
  resolvePendingApproval,
  savePendingApproval,
} from './pending.js'

const args = { prompt: 'a cat', isChipnet: false }

function record(orderId: string) {
  return {
    kind: 'image' as const,
    args,
    selection: { modelId: 'nano-banana', params: {} },
    quote: {
      orderId,
      model: 'nano-banana',
      amountSats: 1500,
      amountUsd: 0.01,
      prompt: 'a cat',
    },
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'paytaca-pending-test-'))
  process.env.PAYTACA_PENDING_DIR = dir
})

afterEach(async () => {
  delete process.env.PAYTACA_PENDING_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('pending approvals', () => {
  it('persists and lists an approval', async () => {
    const saved = await savePendingApproval(record('abc-123'))
    expect(saved.id).toBe('abc-123')
    expect(saved.createdAt).toBeTruthy()

    const all = await listPendingApprovals()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: 'abc-123',
      kind: 'image',
      args: { prompt: 'a cat' },
      quote: { amountSats: 1500 },
    })
  })

  it('resolves an unambiguous id prefix', async () => {
    await savePendingApproval(record('aaaa-1111'))
    await savePendingApproval(record('bbbb-2222'))
    const found = await resolvePendingApproval('aaaa')
    expect(found.id).toBe('aaaa-1111')
  })

  it('rejects an ambiguous prefix', async () => {
    await savePendingApproval(record('aaaa-1111'))
    await savePendingApproval(record('aaaa-2222'))
    await expect(resolvePendingApproval('aaaa')).rejects.toThrow(/matches 2/)
  })

  it('rejects an unknown id', async () => {
    await expect(resolvePendingApproval('nope')).rejects.toThrow(/no pending approval/i)
  })

  it('rejects ids that could escape the pending directory', async () => {
    await expect(resolvePendingApproval('../etc/passwd')).rejects.toThrow(/valid approval id/i)
  })

  it('removes an approval', async () => {
    await savePendingApproval(record('abc-123'))
    await removePendingApproval('abc-123')
    expect(await listPendingApprovals()).toHaveLength(0)
  })

  it('skips corrupt entries instead of failing the whole list', async () => {
    await savePendingApproval(record('good-1'))
    await writeFile(path.join(dir, 'broken.json'), '{not json', 'utf8')
    const all = await listPendingApprovals()
    expect(all.map((entry) => entry.id)).toEqual(['good-1'])
  })

  it('takes an exclusive lock per approval', async () => {
    await savePendingApproval(record('abc-123'))
    const release = await lockPendingApproval('abc-123')
    await expect(lockPendingApproval('abc-123')).rejects.toThrow(/already being processed/i)
    await release()
    const releaseAgain = await lockPendingApproval('abc-123')
    await releaseAgain()
  })
})
