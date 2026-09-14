/**
 * CLI commands: wallet create | import | info
 *
 * Implements the wallet lifecycle:
 *   - create:  Generate new seed phrase, store in keychain, subscribe with Watchtower
 *   - import:  Accept existing seed phrase, validate, store, subscribe
 *   - info:    Display wallet hash, balance, and receiving address
 */

import { Command } from 'commander'
import chalk from 'chalk'
import * as readline from 'readline'
import * as os from 'node:os'
import { randomInt } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  generateMnemonic,
  importMnemonic,
  loadWallet,
  loadMnemonic,
} from '../wallet/index.js'
import { getBchUsdPrice, formatUsd } from '../utils/prices.js'

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Manage wallet (create, import, info, export)')

  // ── wallet create ──────────────────────────────────────────────────────
  wallet
    .command('create')
    .description('Generate a new wallet with a 12-word seed phrase')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      console.log(`\nCreating new wallet on ${chalk.cyan(network)}...\n`)

      const { mnemonic, walletHash } = generateMnemonic()

      // Display the mnemonic with a strong warning
      console.log(chalk.yellow.bold('⚠  IMPORTANT: Write down your seed phrase and store it safely.'))
      console.log(chalk.yellow('   Anyone with this phrase can access your funds.'))
      console.log(chalk.yellow('   This is the only time it will be displayed.\n'))
      console.log(chalk.white.bold('   Seed phrase:\n'))

      const words = mnemonic.split(' ')
      words.forEach((word, i) => {
        console.log(chalk.white(`   ${String(i + 1).padStart(2, ' ')}. ${word}`))
      })

      console.log()
      console.log(chalk.dim(`   Wallet hash: ${walletHash}`))

      // Subscribe initial addresses with Watchtower
      try {
        const w = loadWallet()
        if (w) {
          const bchWallet = w.forNetwork(isChipnet)
          const addressSet = bchWallet.getAddressSetAt(0)
          console.log(chalk.dim(`   Network:     ${network}`))
          console.log(chalk.dim(`   Address:     ${addressSet.receiving}`))

          // Subscribe to Watchtower for monitoring
          await bchWallet.getNewAddressSet(0).catch(() => {
            // Non-critical: Watchtower subscription can fail silently
          })
        }
      } catch {
        // Non-critical
      }

      console.log(chalk.green('\n   Wallet created and stored in OS keychain.\n'))
    })

  // ── wallet import ──────────────────────────────────────────────────────
  wallet
    .command('import')
    .description('Import an existing wallet from a seed phrase')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      // Prompt for mnemonic
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const mnemonic = await new Promise<string>((resolve) => {
        rl.question('\nEnter your 12-word seed phrase: ', (answer) => {
          rl.close()
          resolve(answer)
        })
      })

      if (!mnemonic.trim()) {
        console.log(chalk.red('\nError: No seed phrase provided.\n'))
        process.exit(1)
      }

      try {
        const { walletHash } = importMnemonic(mnemonic)

        console.log(chalk.green(`\nWallet imported successfully on ${network}.\n`))
        console.log(chalk.dim(`   Wallet hash: ${walletHash}`))

        // Derive and show address
        const w = loadWallet()
        if (w) {
          const bchWallet = w.forNetwork(isChipnet)
          const addressSet = bchWallet.getAddressSetAt(0)
          console.log(chalk.dim(`   Address:     ${addressSet.receiving}`))

          // Subscribe initial addresses with Watchtower
          await bchWallet.scanAddresses({ startIndex: 0, count: 10 }).catch(() => {})
        }

        console.log(chalk.dim(`\n   Stored in OS keychain.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\nError: ${err.message}\n`))
        process.exit(1)
      }
    })

  // ── wallet info ────────────────────────────────────────────────────────
  wallet
    .command('info')
    .description('Display wallet info: hash, balance, and receiving address')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .action(async (opts) => {
      const isChipnet = Boolean(opts.chipnet)
      const network = isChipnet ? 'chipnet' : 'mainnet'

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n')
        )
        process.exit(1)
      }

      const w = loadWallet()!
      const bchWallet = w.forNetwork(isChipnet)

      console.log(chalk.bold(`\n   Wallet Info (${network})\n`))
      console.log(chalk.dim(`   Wallet hash:  ${data.walletHash}`))

      // Derive receiving address at index 0
      const addressSet = bchWallet.getAddressSetAt(0)
      console.log(`   Address:      ${addressSet.receiving}`)

      // Fetch balance with USD conversion
      try {
        const balance = await bchWallet.getBalance()

        // Fetch USD price per BCH (non-critical — omit on failure)
        let usdPerBch: number | null = null
        try {
          usdPerBch = await getBchUsdPrice(isChipnet)
        } catch {
          // Pricing unavailable — proceed without USD values
        }

        console.log(`   Balance:      ${balance.balance} BCH`)
        if (usdPerBch !== null) {
          console.log(
            chalk.dim(`                 ≈ ${formatUsd(balance.balance * usdPerBch)}`)
          )
        }
      } catch {
        console.log(chalk.yellow('   Balance:      (unable to fetch)'))
      }

      console.log()
    })

  // ── wallet export ───────────────────────────────────────────────────
  wallet
    .command('export')
    .description('Display the stored seed phrase (interactive terminal only)')
    .action(async () => {
      requireInteractiveTerminal()

      const data = loadMnemonic()
      if (!data) {
        console.log(
          chalk.red(
            '\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n'
          )
        )
        process.exit(1)
      }

      const verified = await promptHumanVerification()
      if (!verified) {
        console.log(chalk.red('\n   Verification failed. Seed phrase not shown.\n'))
        process.exit(1)
      }

      console.log(
        chalk.yellow.bold(
          '\n   WARNING: Do not share your seed phrase with anyone.'
        )
      )
      console.log(
        chalk.yellow(
          '   Anyone with this phrase can access your funds.\n'
        )
      )

      const words = data.mnemonic.split(' ')
      words.forEach((word, i) => {
        console.log(
          chalk.white(`   ${String(i + 1).padStart(2, ' ')}. ${word}`)
        )
      })

      console.log()
    })
}

/**
 * Refuse to reveal the seed phrase unless the command is attached to a real
 * interactive terminal. This blocks piping, redirection, `echo ... | paytaca`,
 * command substitution, and non-interactive agent execution.
 */
function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      chalk.red(
        '\nRefusing to export seed phrase: this command must be run directly in an interactive terminal.\n' +
          'It cannot be piped, redirected, or executed by a non-interactive process.\n'
      )
    )
    process.exit(1)
  }
}

/**
 * Require a live human presence before revealing the seed phrase. Where the OS
 * exposes biometric authentication (macOS Touch ID, Linux fprintd, Windows
 * Hello), that prompt is used and cannot be driven or dismissed by an automated
 * caller. Where biometrics are unavailable, fall back to typing a random
 * one-time code, which non-interactive callers cannot answer.
 */
async function promptHumanVerification(): Promise<boolean> {
  const biometric = verifyBiometric()

  if (biometric === 'ok') {
    console.log(chalk.green('\n   Identity confirmed via biometric authentication.\n'))
    return true
  }

  if (biometric === 'denied') {
    console.log(chalk.red('\n   Biometric authentication failed or was cancelled.\n'))
    return false
  }

  console.log(
    chalk.dim('   Biometric authentication not available — falling back to code entry.\n')
  )

  return promptChallenge()
}

function verifyBiometric(): BiometricResult {
  switch (process.platform) {
    case 'darwin':
      return verifyTouchId()
    case 'linux':
      return verifyFprintd()
    case 'win32':
      return verifyWindowsHello()
    default:
      return 'unavailable'
  }
}

/**
 * Random one-time code the operator must type back. Automated callers cannot
 * read and answer this prompt, even when a pseudo-terminal is allocated.
 */
async function promptChallenge(): Promise<boolean> {
  const challenge = generateChallenge()
  const timeoutMs = 120_000

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  console.log(
    chalk.yellow.bold('\n   Human verification required before the seed phrase is revealed.')
  )
  console.log(chalk.dim('   Type the code below exactly as shown to confirm you are at the terminal.\n'))
  console.log(chalk.cyan.bold(`       ${challenge}\n`))

  const answer = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      rl.close()
      resolve(null)
    }, timeoutMs)

    rl.question('   Code: ', (input) => {
      clearTimeout(timer)
      rl.close()
      resolve(input)
    })
  })

  return answer !== null && answer.trim().toUpperCase() === challenge
}

function generateChallenge(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
  return `${group()}-${group()}`
}

type BiometricResult = 'ok' | 'denied' | 'unavailable' | 'error'

const BIO_OK = 'PAYTACA_BIO_OK'
const BIO_FAIL = 'PAYTACA_BIO_FAIL'
const BIO_UNAVAILABLE = 'PAYTACA_BIO_UNAVAILABLE'

function classifyBiometricOutput(output: string): BiometricResult {
  if (output.includes(BIO_UNAVAILABLE)) return 'unavailable'
  if (output.includes(BIO_OK)) return 'ok'
  if (output.includes(BIO_FAIL)) return 'denied'
  return 'error'
}

function commandExists(command: string): boolean {
  const res = spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' })
  return res.status === 0
}

// ── macOS: Touch ID via LocalAuthentication ────────────────────────────

/**
 * JXA script executed by the system `osascript`: bridges to the macOS
 * LocalAuthentication framework and blocks on the native Touch ID prompt.
 * JXA `console.log` writes to stderr (captured below).
 */
const TOUCH_ID_JXA = `
ObjC.import('LocalAuthentication')
ObjC.import('Foundation')

const policy = $.LAPolicyDeviceOwnerAuthenticationWithBiometrics
const ctx = $.LAContext.alloc.init
const err = $()

if (!ctx.canEvaluatePolicyError(policy, err)) {
  console.log('${BIO_UNAVAILABLE}')
} else {
  let done = false
  let ok = false
  ctx.evaluatePolicyLocalizedReasonReply(
    policy,
    $('Confirm it is you to reveal your Paytaca seed phrase'),
    (success) => {
      ok = Boolean(success)
      done = true
    }
  )
  const deadline = Date.now() + 120000
  while (!done && Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate(
      $.NSDefaultRunLoopMode,
      $.NSDate.dateWithTimeIntervalSinceNow(0.25)
    )
  }
  console.log(done && ok ? '${BIO_OK}' : '${BIO_FAIL}')
}
`

function verifyTouchId(): BiometricResult {
  const res = spawnSync('osascript', ['-l', 'JavaScript', '-e', TOUCH_ID_JXA], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 130_000,
  })

  return classifyBiometricOutput(`${res.stderr ?? ''}${res.stdout ?? ''}`)
}

// ── Linux: fingerprint verification via fprintd ────────────────────────

/**
 * `fprintd-verify` reads the physical fingerprint reader over D-Bus and exits
 * 0 only on a match, so an automated caller cannot satisfy it. Enrollment is
 * confirmed first via `fprintd-list` so un-enrolled users fall back to the code
 * challenge rather than being locked out.
 */
function verifyFprintd(): BiometricResult {
  if (!commandExists('fprintd-verify')) return 'unavailable'
  if (!commandExists('fprintd-list')) return 'unavailable'

  const user = os.userInfo().username

  const enrolled = spawnSync('fprintd-list', [user], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (enrolled.error) return 'unavailable'

  const listed = enrolled.stdout ?? ''
  if (!listed.trim() || /no fingerprints enrolled/i.test(listed)) return 'unavailable'

  const verify = spawnSync('fprintd-verify', [user], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (verify.status === 0) return 'ok'
  return 'denied'
}

// ── Windows: Windows Hello via UserConsentVerifier ─────────────────────

/**
 * Calls the WinRT UserConsentVerifier through Windows PowerShell, which shows
 * the native Windows Hello prompt (face / fingerprint / PIN). The async WinRT
 * operation is awaited via System.Runtime.WindowsRuntime.
 */
const WINDOWS_HELLO_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }
  $Ucv = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
  $avail = Await ($Ucv::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
  if ($avail -ne [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) {
    Write-Output '${BIO_UNAVAILABLE}'
  } else {
    $res = Await ($Ucv::RequestVerificationAsync('Confirm it is you to reveal your Paytaca seed phrase')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
    if ($res -eq [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) {
      Write-Output '${BIO_OK}'
    } else {
      Write-Output '${BIO_FAIL}'
    }
  }
} catch {
  Write-Output '${BIO_UNAVAILABLE}'
}
`

function verifyWindowsHello(): BiometricResult {
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', WINDOWS_HELLO_PS],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 130_000,
    }
  )

  return classifyBiometricOutput(`${res.stdout ?? ''}${res.stderr ?? ''}`)
}
