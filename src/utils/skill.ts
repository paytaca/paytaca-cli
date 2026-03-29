/**
 * Skill management utilities for AI assistant integration.
 * Provides generic functions for installing/uninstalling/checking status
 * of paytaca skill for various AI assistants.
 */

import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

export interface AssistantConfig {
  name: string
  skillsDir: string
}

export const SUPPORTED_ASSISTANTS: AssistantConfig[] = [
  { name: 'opencode', skillsDir: path.join(os.homedir(), '.config', 'opencode', 'skills') },
  { name: 'Claude Code', skillsDir: path.join(os.homedir(), '.claude', 'skills') },
]

export function getSkillSourcePath(): string {
  try {
    const modulePath = require.resolve('paytaca-cli')
    const packageDir = path.dirname(modulePath)
    return path.join(packageDir, 'skills', 'paytaca', 'SKILL.md')
  } catch {
    const currentFilePath = fileURLToPath(import.meta.url)
    const srcPath = path.dirname(currentFilePath)
    return path.join(srcPath, '..', '..', 'skills', 'paytaca', 'SKILL.md')
  }
}

export function getSkillDestPath(skillsDir: string): string {
  return path.join(skillsDir, 'paytaca', 'SKILL.md')
}

export function installSkill(skillsDir: string, assistantName: string): void {
  try {
    const sourcePath = getSkillSourcePath()
    const destDir = path.join(skillsDir, 'paytaca')
    const destPath = getSkillDestPath(skillsDir)

    if (!fs.existsSync(sourcePath)) {
      console.log(chalk.red('Skill source file not found. Is paytaca-cli properly installed?'))
      process.exit(1)
    }

    fs.mkdirSync(destDir, { recursive: true })

    const content = fs.readFileSync(sourcePath, 'utf8')
    fs.writeFileSync(destPath, content)

    console.log(chalk.green(`\n✓ Skill installed successfully for ${assistantName}!\n`))
    console.log(chalk.bold('What this does:'))
    console.log('  When the AI assistant encounters HTTP 402 or calls x402-enabled APIs,')
    console.log('  it will automatically use paytaca to handle payments.\n')
    console.log(chalk.dim('Location: ') + destPath)
    console.log(chalk.dim('Source:   ') + sourcePath)
    console.log()
    console.log(`Restart ${assistantName} to load the new skill.\n`)
  } catch (err: any) {
    console.log(chalk.red(`\nFailed to install skill: ${err.message}\n`))
    process.exit(1)
  }
}

export function uninstallSkill(skillsDir: string, assistantName: string): void {
  try {
    const destDir = path.join(skillsDir, 'paytaca')
    const destPath = getSkillDestPath(skillsDir)

    if (!fs.existsSync(destPath)) {
      console.log(chalk.yellow('\nSkill is not installed.\n'))
      process.exit(0)
    }

    fs.rmSync(destDir, { recursive: true })
    console.log(chalk.green(`\n✓ Skill uninstalled for ${assistantName}!\n`))
  } catch (err: any) {
    console.log(chalk.red(`\nFailed to uninstall skill: ${err.message}\n`))
    process.exit(1)
  }
}

export function checkStatus(skillsDir: string, assistantName: string): void {
  const destPath = getSkillDestPath(skillsDir)

  if (fs.existsSync(destPath)) {
    console.log(chalk.green('\n✓ Paytaca skill is installed\n'))
    console.log(chalk.dim('Location: ') + destPath)
  } else {
    console.log(chalk.yellow(`\n○ Paytaca skill is not installed for ${assistantName}\n`))
    console.log(`Run: paytaca ${assistantName.toLowerCase()} install`)
    console.log()
  }
}

export function handleSkillAction(
  assistant: AssistantConfig,
  action: string
): void {
  switch (action) {
    case 'install':
      installSkill(assistant.skillsDir, assistant.name)
      break
    case 'uninstall':
      uninstallSkill(assistant.skillsDir, assistant.name)
      break
    case 'status':
      checkStatus(assistant.skillsDir, assistant.name)
      break
    default:
      console.log(chalk.yellow(`Unknown action: ${action}`))
      console.log('Use: install, uninstall, or status')
  }
}
