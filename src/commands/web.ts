import { Command } from 'commander'
import chalk from 'chalk'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { loadWalletRef } from '../wallet/index.js'
import { WalletNotConfiguredError } from '../core/context.js'
import { startWebServer } from '../web/server.js'

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

      let webServer
      try {
        webServer = await startWebServer({
          port,
          isChipnet: Boolean(opts.chipnet),
          backendUrl: opts.backend,
        })
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') {
          console.log(chalk.red(`\nError: Port ${port} is already in use. Try a different port:\n`))
          console.log(chalk.dim(`  paytaca web --port ${port + 1}\n`))
        } else {
          console.log(chalk.red(`\nError: ${err?.message || err}\n`))
        }
        process.exitCode = 1
        return
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
