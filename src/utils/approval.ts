/**
 * Human-presence gates for commands that spend funds.
 *
 * An approval prompt only means something if a person is actually there to
 * answer it. `readline` happily accepts a piped `echo y |`, and an agent
 * driving the CLI in a captured shell can answer any free-text prompt. These
 * helpers refuse that case outright so the same code path cannot be scripted.
 */

import readline from 'node:readline'

export class NonInteractiveTerminalError extends Error {}

/**
 * Refuse to reveal the seed phrase unless the command is attached to a real
 * interactive terminal. This blocks piping, redirection, `echo ... | paytaca`,
 * command substitution, and non-interactive agent execution. Throws (rather
 * than exiting) so callers and tests can handle the refusal.
 */
export function assertInteractiveTerminal(
  stdinIsTTY: boolean | undefined,
  stdoutIsTTY: boolean | undefined,
  message: string = 'Refusing to export seed phrase: this command must be run directly in an interactive terminal.\n' +
    'It cannot be piped, redirected, or executed by a non-interactive process.'
): void {
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new NonInteractiveTerminalError(message)
  }
}

/**
 * Refuse a spend unless stdin is a real terminal.
 *
 * Only stdin is checked: stdout may legitimately be a pipe (`--json > out`),
 * but a piped or redirected stdin means the answer came from something other
 * than a person at a keyboard.
 */
export function assertInteractiveApproval(
  stdinIsTTY: boolean | undefined,
  message: string = 'Refusing to spend funds: this command must be run directly in an interactive terminal.\n' +
    'It cannot be piped, redirected, or executed by a non-interactive process.'
): void {
  if (!stdinIsTTY) {
    throw new NonInteractiveTerminalError(message)
  }
}

/** Ask a yes/no question, reading from the terminal. */
export async function promptApproval(
  question: string,
  output: NodeJS.WritableStream = process.stdout,
  input: NodeJS.ReadableStream = process.stdin
): Promise<boolean> {
  const rl = readline.createInterface({
    input,
    output: output as NodeJS.WritableStream & { write: (s: string) => boolean },
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      const yes =
        answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
      resolve(yes)
    })
  })
}

export interface SpendApprovalOptions {
  /** Route the prompt to stderr so stdout stays machine-readable. */
  asJson?: boolean
}

/**
 * Show the user exactly what is about to be paid for, then require an explicit
 * yes from a real terminal.
 *
 * Returns `false` when the user declines; throws `NonInteractiveTerminalError`
 * when there is no terminal to ask.
 */
export async function confirmSpend(
  details: string[],
  question: string,
  opts: SpendApprovalOptions = {}
): Promise<boolean> {
  assertInteractiveApproval(process.stdin.isTTY)

  const out = (opts.asJson ? process.stderr : process.stdout) as NodeJS.WritableStream
  out.write(`\n${details.join('\n')}\n`)
  return promptApproval(`   ${question} (y/N): `, out)
}
