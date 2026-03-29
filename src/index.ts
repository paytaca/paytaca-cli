/**
 * Paytaca CLI — Entry point
 *
 * A command-line interface for the Paytaca Bitcoin Cash wallet.
 * Provides wallet management, address derivation, BCH sending,
 * and CashTokens support with the same core logic as the Paytaca mobile app.
 */

import { Command } from 'commander'
import { registerWalletCommands } from './commands/wallet.js'
import { registerAddressCommands } from './commands/address.js'
import { registerSendCommand } from './commands/send.js'
import { registerBalanceCommand } from './commands/balance.js'
import { registerReceiveCommand } from './commands/receive.js'
import { registerHistoryCommand } from './commands/history.js'
import { registerTokenCommands } from './commands/token.js'
import { registerPayCommand } from './commands/pay.js'
import { registerCheckCommand } from './commands/check.js'
import { registerOpencodeCommand } from './commands/opencode.js'

const program = new Command()

program
  .name('paytaca')
  .description('Paytaca — Bitcoin Cash wallet CLI')
  .version('0.2.0')

registerWalletCommands(program)
registerAddressCommands(program)
registerSendCommand(program)
registerBalanceCommand(program)
registerReceiveCommand(program)
registerHistoryCommand(program)
registerTokenCommands(program)
registerPayCommand(program)
registerCheckCommand(program)
registerOpencodeCommand(program)

program.parse()
