/**
 * CLI command: opencode
 *
 * Set up paytaca x402 payment handling for opencode AI assistant.
 * Installs the paytaca skill so opencode knows how to handle 402 responses.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'

const OPENCODE_SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills')

export function registerOpencodeCommand(program: Command): void {
  program
    .command('opencode')
    .description('Set up paytaca x402 payments for opencode AI assistant')
    .argument('[action]', 'Action: install, uninstall, status', 'status')
    .action(async (action: string) => {
      switch (action) {
        case 'install':
          installSkill()
          break
        case 'uninstall':
          uninstallSkill()
          break
        case 'status':
          checkStatus()
          break
        default:
          console.log(chalk.yellow(`Unknown action: ${action}`))
          console.log('Use: install, uninstall, or status')
      }
    })
}

function getSkillSourcePath(): string {
  try {
    const modulePath = require.resolve('paytaca-cli')
    const packageDir = path.dirname(modulePath)
    return path.join(packageDir, 'skills', 'paytaca', 'SKILL.md')
  } catch {
    const srcPath = path.dirname(new URL(import.meta.url).pathname)
    return path.join(srcPath, '..', '..', 'skills', 'paytaca', 'SKILL.md')
  }
}

function getSkillDestPath(): string {
  return path.join(OPENCODE_SKILLS_DIR, 'paytaca', 'SKILL.md')
}

function installSkill(): void {
  try {
    const sourcePath = getSkillSourcePath()
    const destDir = path.join(OPENCODE_SKILLS_DIR, 'paytaca')
    const destPath = getSkillDestPath()

    if (!fs.existsSync(sourcePath)) {
      console.log(chalk.red('Skill source file not found. Is paytaca-cli properly installed?'))
      process.exit(1)
    }

    fs.mkdirSync(destDir, { recursive: true })

    const content = fs.readFileSync(sourcePath, 'utf8')
    fs.writeFileSync(destPath, content)

    console.log(chalk.green('\n✓ Skill installed successfully!\n'))
    console.log(chalk.bold('What this does:'))
    console.log('  When opencode encounters HTTP 402 or calls x402-enabled APIs,')
    console.log('  it will automatically use paytaca to handle payments.\n')
    console.log(chalk.dim('Location: ') + destPath)
    console.log(chalk.dim('Source:   ') + sourcePath)
    console.log()
    console.log('Restart opencode to load the new skill.\n')
  } catch (err: any) {
    console.log(chalk.red(`\nFailed to install skill: ${err.message}\n`))
    process.exit(1)
  }
}

function uninstallSkill(): void {
  try {
    const destDir = path.join(OPENCODE_SKILLS_DIR, 'paytaca')
    const destPath = getSkillDestPath()

    if (!fs.existsSync(destPath)) {
      console.log(chalk.yellow('\nSkill is not installed.\n'))
      process.exit(0)
    }

    fs.rmSync(destDir, { recursive: true })
    console.log(chalk.green('\n✓ Skill uninstalled successfully!\n'))
  } catch (err: any) {
    console.log(chalk.red(`\nFailed to uninstall skill: ${err.message}\n`))
    process.exit(1)
  }
}

function checkStatus(): void {
  const destPath = getSkillDestPath()

  if (fs.existsSync(destPath)) {
    console.log(chalk.green('\n✓ Paytaca skill is installed\n'))
    console.log(chalk.dim('Location: ') + destPath)
  } else {
    console.log(chalk.yellow('\n○ Paytaca skill is not installed\n'))
    console.log('Run: paytaca skill install')
    console.log()
  }
}
