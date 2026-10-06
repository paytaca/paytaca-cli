import { Command } from 'commander'
import chalk from 'chalk'
import { spawn, execSync } from 'node:child_process'
import { platform } from 'node:os'
import { loadWalletRef } from '../wallet/index.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { startWebServer } from '../web/server.js'

function pidsListeningOn(port: number): number[] {
  if (platform() === 'win32') {
    try {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' })
      const pids = new Set<number>()
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
        if (m && Number(m[1]) === port) pids.add(Number(m[2]))
      }
      return [...pids]
    } catch {
      return []
    }
  }
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
    return out.split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0)
  } catch {
    // lsof unavailable (e.g. minimal Linux); fall back to ss.
  }
  try {
    const out = execSync(`ss -ltnp 'sport = :${port}'`, { encoding: 'utf8' })
    const pids = new Set<number>()
    for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]))
    return [...pids]
  } catch {
    return []
  }
}

function isPaytacaProcess(pid: number): boolean {
  try {
    const cmd =
      platform() === 'win32'
        ? execSync(
            `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
            { encoding: 'utf8' }
          )
        : execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' })
    return /paytaca/.test(cmd)
  } catch {
    return false
  }
}

function terminate(pid: number): void {
  try {
    process.kill(pid)
  } catch {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Kill an existing `paytaca web` on this port. Returns the PIDs terminated. */
function reclaimPort(port: number): number[] {
  const killed: number[] = []
  for (const pid of pidsListeningOn(port)) {
    if (pid !== process.pid && isPaytacaProcess(pid)) {
      terminate(pid)
      killed.push(pid)
    }
  }
  return killed
}

export function registerWebCommand(program: Command): void {
  program.command('web')
    .description('Launch a local web UI for wallet, swap, and AI')
    .option('--port <port>', 'Port to listen on', '7474')
    .option('--chipnet', 'Use chipnet (testnet) instead of mainnet')
    .option('--backend <url>', 'Override backend URL')
    .option('--no-open', 'Do not auto-open the browser')
    .action(async (opts) => {
      const port = Number(opts.port)
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        console.log(chalk.red('\nError: Invalid port number.\n'))
        process.exitCode = 1
        return
      }

      const wallet = loadWalletRef()
      if (!wallet) {
        const err = new WalletNotConfiguredError()
        console.log(chalk.red(`\n${err.message}\n`))
        process.exitCode = 1
        return
      }

      const startOpts = {
        port,
        isChipnet: Boolean(opts.chipnet),
        backendUrl: opts.backend,
      }

      let webServer
      try {
        webServer = await startWebServer(startOpts)
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') {
          const killed = reclaimPort(port)
          if (killed.length === 0) {
            console.log(chalk.red(`\nError: Port ${port} is already in use. Try a different port:\n`))
            console.log(chalk.dim(`  paytaca web --port ${port + 1}\n`))
            process.exitCode = 1
            return
          }
          console.log(chalk.dim(`\n   Port ${port} was in use by another paytaca web (pid ${killed.join(', ')}). Restarting it…`))
          let lastErr = err
          for (let i = 0; i < 25; i++) {
            await sleep(150)
            try {
              webServer = await startWebServer(startOpts)
              break
            } catch (retryErr: any) {
              lastErr = retryErr
              if (retryErr?.code !== 'EADDRINUSE') break
            }
          }
          if (!webServer) {
            console.log(chalk.red(`\nError: ${lastErr?.message || lastErr}\n`))
            process.exitCode = 1
            return
          }
        } else {
          console.log(chalk.red(`\nError: ${err?.message || err}\n`))
          process.exitCode = 1
          return
        }
      }

      console.log(chalk.bold('\n   Paytaca Web\n'))
      console.log(chalk.dim(`   Network: ${opts.chipnet ? 'chipnet' : 'mainnet'}`))
      console.log(`   URL: ${chalk.cyan(`http://127.0.0.1:${webServer.port}`)}`)
      console.log(chalk.dim('   A session link with the access token was opened in your browser.'))
      console.log(chalk.dim('   To reopen later, run `paytaca web` again.'))
      console.log(chalk.dim('   Press Ctrl+C to stop.\n'))

      if (opts.open !== false) {
        const cmd =
          platform() === 'darwin' ? 'open' :
          platform() === 'win32' ? 'start' :
          'xdg-open'
        try {
          spawn(cmd, [webServer.url], { detached: true, stdio: 'ignore' }).unref()
        } catch {}
      }

      const shutdown = async () => {
        console.log(chalk.dim('\n   Shutting down…\n'))
        await webServer.close()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
}
