/**
 * CLI command: claude
 *
 * Set up paytaca x402 payment handling for Claude Code AI assistant.
 * Installs the paytaca skill so Claude Code knows how to handle 402 responses.
 */

import { Command } from 'commander'
import os from 'os'
import path from 'path'
import { SUPPORTED_ASSISTANTS, handleSkillAction } from '../utils/skill.js'

export function registerClaudeCommand(program: Command): void {
  const assistant = SUPPORTED_ASSISTANTS.find(a => a.name === 'Claude Code')
  if (!assistant) return

  program
    .command('claude')
    .description('Set up paytaca x402 payments for Claude Code AI assistant')
    .argument('[action]', 'Action: install, uninstall, status', 'status')
    .action(async (action: string) => {
      handleSkillAction(assistant, action)
    })
}
