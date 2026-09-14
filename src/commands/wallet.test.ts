import { describe, it, expect } from 'vitest'
import {
  assertInteractiveTerminal,
  NonInteractiveTerminalError,
  classifyBiometricOutput,
  generateChallenge,
  isChallengeAnswerCorrect,
} from './wallet.js'

describe('assertInteractiveTerminal', () => {
  it('allows execution when both stdin and stdout are TTYs', () => {
    expect(() => assertInteractiveTerminal(true, true)).not.toThrow()
  })

  it('refuses when stdin is not a TTY', () => {
    expect(() => assertInteractiveTerminal(undefined, true)).toThrow(
      NonInteractiveTerminalError
    )
  })

  it('refuses when stdout is not a TTY', () => {
    expect(() => assertInteractiveTerminal(true, undefined)).toThrow(
      NonInteractiveTerminalError
    )
  })

  it('refuses when neither stream is a TTY', () => {
    expect(() => assertInteractiveTerminal(false, false)).toThrow(
      NonInteractiveTerminalError
    )
  })
})

describe('classifyBiometricOutput', () => {
  it('maps the unavailable token', () => {
    expect(classifyBiometricOutput('PAYTACA_BIO_UNAVAILABLE')).toBe('unavailable')
  })

  it('maps the success token', () => {
    expect(classifyBiometricOutput('PAYTACA_BIO_OK')).toBe('ok')
  })

  it('maps the failure token', () => {
    expect(classifyBiometricOutput('PAYTACA_BIO_FAIL')).toBe('denied')
  })

  it('treats unrecognized output as an error', () => {
    expect(classifyBiometricOutput('')).toBe('error')
    expect(classifyBiometricOutput('some unrelated output')).toBe('error')
  })

  it('lets a failure token win if both fail and ok appear', () => {
    expect(
      classifyBiometricOutput('PAYTACA_BIO_FAIL\nPAYTACA_BIO_OK')
    ).toBe('denied')
  })

  it('does not confuse the unavailable token with success', () => {
    expect(classifyBiometricOutput('PAYTACA_BIO_UNAVAILABLE')).not.toBe('ok')
  })
})

describe('generateChallenge', () => {
  it('produces two 4-character groups from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const challenge = generateChallenge()
      expect(challenge).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    }
  })

  it('generates different codes across calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateChallenge()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('isChallengeAnswerCorrect', () => {
  const challenge = 'ABCD-2345'

  it('accepts an exact match', () => {
    expect(isChallengeAnswerCorrect(challenge, challenge)).toBe(true)
  })

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(isChallengeAnswerCorrect(challenge, '  abcd-2345  ')).toBe(true)
  })

  it('rejects a wrong answer', () => {
    expect(isChallengeAnswerCorrect(challenge, 'WXYZ-9876')).toBe(false)
  })

  it('rejects a missing answer (timeout)', () => {
    expect(isChallengeAnswerCorrect(challenge, null)).toBe(false)
  })

  it('rejects an empty answer', () => {
    expect(isChallengeAnswerCorrect(challenge, '')).toBe(false)
  })
})
