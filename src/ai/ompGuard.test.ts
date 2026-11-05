import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PAY_MEDIA_POLICY_KEY,
  readOmpApprovalPolicy,
  upsertOmpApprovalPolicyYaml,
  verifyOmpPayMediaGate,
} from './ompGuard.js'

describe('omp approval policy YAML', () => {
  it('reads a nested tools.approval policy', () => {
    const yaml = [
      'setupVersion: 2',
      'tools:',
      '  approvalMode: yolo',
      '  approval:',
      `    ${PAY_MEDIA_POLICY_KEY}: prompt`,
      '    other_tool: deny',
      'modelRoles:',
      '  default: paytaca-ai/x',
    ].join('\n')
    expect(readOmpApprovalPolicy(yaml, PAY_MEDIA_POLICY_KEY)).toBe('prompt')
    expect(readOmpApprovalPolicy(yaml, 'other_tool')).toBe('deny')
    expect(readOmpApprovalPolicy(yaml, 'missing')).toBeNull()
  })

  it('handles quoted values', () => {
    const yaml = `tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: "prompt"\n`
    expect(readOmpApprovalPolicy(yaml, PAY_MEDIA_POLICY_KEY)).toBe('prompt')
  })

  it('creates the whole tools/approval tree on an empty file', () => {
    const out = upsertOmpApprovalPolicyYaml('', {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    expect(out).toBe(`tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: prompt\n`)
  })

  it('preserves unrelated top-level keys', () => {
    const existing = 'setupVersion: 2\nmodelRoles:\n  default: x\n'
    const out = upsertOmpApprovalPolicyYaml(existing, {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    expect(out).toContain('setupVersion: 2')
    expect(out).toContain('modelRoles:\n  default: x')
    expect(readOmpApprovalPolicy(out, PAY_MEDIA_POLICY_KEY)).toBe('prompt')
  })

  it('adds approval next to other tools keys without dropping them', () => {
    const existing = 'tools:\n  approvalMode: yolo\n'
    const out = upsertOmpApprovalPolicyYaml(existing, {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    expect(out).toContain('  approvalMode: yolo')
    expect(out).toContain('  approval:')
    expect(readOmpApprovalPolicy(out, PAY_MEDIA_POLICY_KEY)).toBe('prompt')
  })

  it('updates an existing policy and keeps other approval policies', () => {
    const existing = [
      'tools:',
      '  approval:',
      `    ${PAY_MEDIA_POLICY_KEY}: allow`,
      '    other_tool: deny',
      'other:',
      '  key: value',
    ].join('\n')
    const out = upsertOmpApprovalPolicyYaml(existing, {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    expect(readOmpApprovalPolicy(out, PAY_MEDIA_POLICY_KEY)).toBe('prompt')
    expect(readOmpApprovalPolicy(out, 'other_tool')).toBe('deny')
    expect(out).toContain('other:\n  key: value')
  })

  it('is idempotent', () => {
    const once = upsertOmpApprovalPolicyYaml('', {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    const twice = upsertOmpApprovalPolicyYaml(once, {
      [PAY_MEDIA_POLICY_KEY]: 'prompt',
    })
    expect(twice).toBe(once)
  })
})

describe('verifyOmpPayMediaGate', () => {
  const configPath = '/fake/omp/config.yml'
  const projectDir = '/nonexistent-project-dir'
  const good = `tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: prompt\n`

  it('verifies omp with the prompt policy', () => {
    const result = verifyOmpPayMediaGate('omp-coding-agent', {
      configPath,
      projectDir,
      readFile: () => good,
    })
    expect(result.verified).toBe(true)
  })

  it('rejects a different host', () => {
    const result = verifyOmpPayMediaGate('claude-code', {
      configPath,
      projectDir,
      readFile: () => good,
    })
    expect(result.verified).toBe(false)
  })

  it('rejects a missing config file', () => {
    const result = verifyOmpPayMediaGate('omp-coding-agent', {
      configPath,
      projectDir,
      readFile: () => {
        throw new Error('ENOENT')
      },
    })
    expect(result.verified).toBe(false)
  })

  it('rejects allow/deny/missing policies', () => {
    for (const yaml of [
      `tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: allow\n`,
      `tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: deny\n`,
      'tools:\n  approval: {}\n',
      '',
    ]) {
      expect(
        verifyOmpPayMediaGate('omp-coding-agent', {
          configPath,
          projectDir,
          readFile: () => yaml,
        }).verified
      ).toBe(false)
    }
  })

  it('rejects a project overlay that downgrades the policy', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'paytaca-omp-project-'))
    try {
      await mkdir(path.join(dir, '.omp'), { recursive: true })
      await writeFile(
        path.join(dir, '.omp', 'config.yml'),
        `tools:\n  approval:\n    ${PAY_MEDIA_POLICY_KEY}: allow\n`,
        'utf8'
      )
      const result = verifyOmpPayMediaGate('omp-coding-agent', {
        configPath,
        projectDir: dir,
        readFile: (file) => (file === configPath ? good : readFileSync(file, 'utf8')),
      })
      expect(result.verified).toBe(false)
      expect(result.reason).toMatch(/project config overrides/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('allows a project overlay that leaves the policy alone', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'paytaca-omp-project-'))
    try {
      await mkdir(path.join(dir, '.omp'), { recursive: true })
      await writeFile(
        path.join(dir, '.omp', 'config.yml'),
        'modelRoles:\n  default: paytaca-ai/x\n',
        'utf8'
      )
      const result = verifyOmpPayMediaGate('omp-coding-agent', {
        configPath,
        projectDir: dir,
        readFile: (file) => (file === configPath ? good : readFileSync(file, 'utf8')),
      })
      expect(result.verified).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
