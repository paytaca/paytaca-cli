/**
 * CLI command: opencode
 *
 * Set up paytaca x402 payment handling for opencode AI assistant.
 * Installs the paytaca skill so opencode knows how to handle 402 responses.
 */

import { Command } from 'commander'
import { SUPPORTED_ASSISTANTS, handleSkillAction } from '../utils/skill.js'

export function registerOpencodeCommand(program: Command): void {
  const assistant = SUPPORTED_ASSISTANTS.find(a => a.name === 'opencode')
  if (!assistant) return

  program
    .command('opencode')
    .description('Set up paytaca x402 payments for opencode AI assistant')
    .argument('[action]', 'Action: install, uninstall, status', 'status')
    .action(async (action: string) => {
      handleSkillAction(assistant, action)
    })
}
