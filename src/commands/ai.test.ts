import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { registerAiCommands } from './ai.js'

function generateCommand(kind: 'image' | 'video' | 'audio') {
  const program = new Command()
  registerAiCommands(program)
  const ai = program.commands.find((c) => c.name() === 'ai')!
  const group = ai.commands.find((c) => c.name() === kind)!
  return group.commands.find((c) => c.name() === 'generate')!
}

describe('ai media generate approval', () => {
  for (const kind of ['image', 'video', 'audio'] as const) {
    describe(`ai ${kind} generate`, () => {
      it('has no --yes flag to skip the spend confirmation', () => {
        const cmd = generateCommand(kind)
        const flags = cmd.options.map((o) => o.long)
        expect(flags).not.toContain('--yes')
        expect(cmd.options.map((o) => o.short)).not.toContain('-y')
      })

      it('keeps --json so the quote can be read without paying', () => {
        const cmd = generateCommand(kind)
        expect(cmd.options.map((o) => o.long)).toContain('--json')
      })
    })
  }
})
