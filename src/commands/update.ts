/**
 * CLI command: update
 *
 * Checks the npm registry for the latest published version of paytaca-cli
 * and, when the installed version is behind, updates the global install
 * via `npm install -g paytaca-cli@latest`.
 *
 * The version fetched from the registry is only ever used for comparison
 * and display — the install command uses a fixed `@latest` spec, so no
 * remote data is ever passed to the shell.
 *
 * Usage:
 *   paytaca update
 *   paytaca update --check
 *   paytaca update --json
 */

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import chalk from 'chalk'

export const NPM_PACKAGE = 'paytaca-cli'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const REQUEST_TIMEOUT_MS = 15000

function readCurrentVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    )
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Resolve the registry base URL from an explicit override, env, or default. */
export function resolveRegistryUrl(explicit?: string): string {
  const base = explicit || process.env.PAYTACA_NPM_REGISTRY || DEFAULT_REGISTRY
  if (!/^https?:\/\//.test(base)) {
    throw new Error(`Invalid npm registry URL: ${base}`)
  }
  return base.replace(/\/+$/, '')
}

/** Fetch the latest published version of the package from the npm registry. */
export async function fetchLatestVersion(opts: { registryUrl?: string } = {}): Promise<string> {
  const base = resolveRegistryUrl(opts.registryUrl)
  const url = `${base}/${NPM_PACKAGE}/latest`

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${NPM_PACKAGE}`)
  }
  const body: unknown = await response.json()
  const version = (body as { version?: unknown })?.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Unexpected registry response for ${NPM_PACKAGE} (missing version)`)
  }
  return version
}

/** Three-way version comparison: -1 when a < b, 1 when a > b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-')
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
    return { parts, pre }
  }
  const pa = parse(a)
  const pb = parse(b)

  for (let i = 0; i < 3; i++) {
    const x = pa.parts[i] ?? 0
    const y = pb.parts[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }

  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1

  const idA = pa.pre.split('.')
  const idB = pb.pre.split('.')
  for (let i = 0; i < Math.max(idA.length, idB.length); i++) {
    const x = idA[i]
    const y = idB[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number.parseInt(x, 10)
    const ny = Number.parseInt(y, 10)
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (!Number.isNaN(nx)) {
      return -1
    } else if (!Number.isNaN(ny)) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function isOutdated(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0
}

export function buildNpmInstallArgs(packageSpec: string = `${NPM_PACKAGE}@latest`): string[] {
  return ['install', '-g', packageSpec]
}

/** Run `npm install -g paytaca-cli@latest`, inheriting stdio. Resolves on exit 0. */
export function updateViaNpm(packageSpec: string = `${NPM_PACKAGE}@latest`): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', buildNpmInstallArgs(packageSpec), {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', (err) => reject(new Error(`Failed to run npm: ${err.message}`)))
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`npm install exited with code ${code ?? 'signal'}`))
      }
    })
  })
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update paytaca-cli to the latest version on npm')
    .option('--check', 'Only check for updates; do not install')
    .option('--registry <url>', 'Override the npm registry URL')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const json = Boolean(opts.json)
      const checkOnly = Boolean(opts.check)
      const current = readCurrentVersion()

      let latest: string
      try {
        latest = await fetchLatestVersion({ registryUrl: opts.registry })
      } catch (err: any) {
        const message = err?.message || String(err)
        if (json) console.log(JSON.stringify({ current, error: message }, null, 2))
        else console.log(chalk.red(`\n   Error: ${message}\n`))
        process.exitCode = 1
        return
      }

      const outdated = isOutdated(current, latest)

      if (!outdated) {
        if (json) {
          console.log(JSON.stringify({ current, latest, outdated: false, updated: false }, null, 2))
          return
        }
        if (compareVersions(current, latest) > 0) {
          console.log(chalk.green(`\n   paytaca-cli is up to date (running ${current}, ahead of npm ${latest}).\n`))
        } else {
          console.log(chalk.green(`\n   paytaca-cli is up to date (${current}).\n`))
        }
        return
      }

      if (checkOnly) {
        if (json) {
          console.log(JSON.stringify({ current, latest, outdated: true, updated: false }, null, 2))
          return
        }
        console.log(chalk.yellow(`\n   Update available: ${current} → ${latest}`))
        console.log(chalk.dim('   Run `paytaca update` to install.\n'))
        return
      }

      if (json) {
        try {
          await updateViaNpm()
          console.log(JSON.stringify({ current, latest, outdated: true, updated: true }, null, 2))
        } catch (err: any) {
          const message = err?.message || String(err)
          console.log(JSON.stringify({ current, latest, outdated: true, updated: false, error: message }, null, 2))
          process.exitCode = 1
        }
        return
      }

      console.log(`\n   Updating paytaca-cli ${chalk.bold(current)} → ${chalk.bold(latest)}...`)
      console.log(chalk.dim(`   $ npm install -g ${NPM_PACKAGE}@latest`))
      console.log()
      try {
        await updateViaNpm()
        console.log(chalk.green(`\n   Updated to ${latest}.`))
        console.log(chalk.dim('   Restart paytaca to use the new version.\n'))
      } catch (err: any) {
        console.log(chalk.red(`\n   Update failed: ${err?.message || err}\n`))
        process.exitCode = 1
      }
    })
}
