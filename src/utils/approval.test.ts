import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import {
  assertInteractiveApproval,
  NonInteractiveTerminalError,
  promptApproval,
} from './approval.js'

describe('assertInteractiveApproval', () => {
  it('allows execution when stdin is a TTY', () => {
    expect(() => assertInteractiveApproval(true)).not.toThrow()
  })

  it('refuses when stdin is not a TTY', () => {
    expect(() => assertInteractiveApproval(undefined)).toThrow(
      NonInteractiveTerminalError
    )
    expect(() => assertInteractiveApproval(false)).toThrow(
      NonInteractiveTerminalError
    )
  })

  it('does not require stdout to be a TTY so --json can be piped', () => {
    expect(() => assertInteractiveApproval(true)).not.toThrow()
  })

  it('uses the caller-supplied message verbatim', () => {
    expect(() => assertInteractiveApproval(false, 'spend blocked')).toThrow(
      'spend blocked'
    )
  })
})

describe('promptApproval', () => {
  async function ask(answer: string | null): Promise<boolean> {
    const input = new PassThrough()
    const output = new PassThrough()
    if (answer === null) input.end()
    else input.end(`${answer}\n`)
    return promptApproval('ok? ', output, input)
  }

  it('accepts an explicit yes', async () => {
    expect(await ask('y')).toBe(true)
    expect(await ask('yes')).toBe(true)
    expect(await ask('YES')).toBe(true)
    expect(await ask('  y  ')).toBe(true)
  })

  it('rejects anything that is not a yes', async () => {
    expect(await ask('n')).toBe(false)
    expect(await ask('')).toBe(false)
    expect(await ask('yep')).toBe(false)
    expect(await ask('yeah')).toBe(false)
    expect(await ask('ok')).toBe(false)
  })
})
