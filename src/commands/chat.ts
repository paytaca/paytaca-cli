import { Command } from 'commander'
import chalk from 'chalk'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { decode as nip19Decode } from 'nostr-tools/nip19'
import { loadMnemonic } from '../wallet/index.js'
import { ChatStore } from '../nostr/store.js'
import { relayService } from '../nostr/relay.js'

function formatTimestamp(unix: number): string {
  const d = new Date(unix * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function registerChatCommands(program: Command): void {
  const chat = program
    .command('chat')
    .description('Nostr-based chat')

  chat
    .command('list')
    .description('List conversations')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found. Run `paytaca wallet create` or `paytaca wallet import` first.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      const rooms = store.getRooms()

      if (rooms.length === 0) {
        console.log(chalk.dim('\n   No conversations yet.\n'))
        store.cleanup()
        process.exit(0)
      }

      // Resolve display names and BCH addresses for all rooms' other members
      const otherPubKeys = [...new Set(
        rooms.map(r => store.getOtherMember(r)).filter(Boolean) as string[]
      )]
      await Promise.allSettled(
        otherPubKeys.map(async (pk) => {
          await store.resolveDisplayName(pk)
          await store.resolveBchAddress(pk)
        })
      )

      if (opts.json) {
        console.log(JSON.stringify(rooms.map(r => {
          const otherPk = store.getOtherMember(r)
          const msgs = store.getMessages(r.id)
          const readIds = store.readMessageIds[r.id] || {}
          const unreadCount = msgs.filter(m => {
            return m.sender !== store.keys?.pubKeyHex && !readIds[m.id]
          }).length
          return {
            id: r.id,
            name: otherPk ? store.getContactName(otherPk) : r.name,
            displayName: otherPk ? (store.displayNameCache[otherPk] || null) : null,
            bchAddress: otherPk ? (store.bchAddressCache[otherPk] || null) : null,
            type: r.type,
            members: r.members,
            subject: r.subject,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            messageCount: msgs.length,
            unreadCount,
          }
        })))
        store.cleanup()
        process.exit(0)
      }

      console.log()
      for (const room of rooms) {
        const otherPubKey = store.getOtherMember(room)
        const displayName = otherPubKey
          ? store.getContactName(otherPubKey)
          : room.name
        const msgs = store.getMessages(room.id)
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null
        const preview = lastMsg
          ? (lastMsg.content.length > 50 ? lastMsg.content.slice(0, 50) + '...' : lastMsg.content)
          : chalk.dim('(no messages)')
        const time = lastMsg ? formatTimestamp(lastMsg.created_at) : ''
        const unread = msgs.filter(m => {
          const readIds = store.readMessageIds[room.id] || {}
          return m.sender !== store.keys?.pubKeyHex && !readIds[m.id]
        }).length

        const unreadBadge = unread > 0 ? ` [${unread}]` : ''
        console.log(`  ${chalk.bold(displayName)}${unreadBadge}`)
        console.log(`  ${room.id}`)
        console.log(`  ${preview}  ${chalk.dim(time)}`)
        console.log()
      }
      store.cleanup()
      process.exit(0)
    })

  chat
    .command('open')
    .description('Open a conversation and show messages')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .option('--tail <count>', 'Show only last N messages', '20')
    .option('--json', 'Output as JSON')
    .action(async (roomId: string, opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      const room = store.getRoom(roomId)
      if (!room) {
        console.log(chalk.red(`\nRoom not found: ${roomId}\n`))
        process.exit(1)
      }

      const allMsgs = store.getMessages(room.id)
      const tail = Number.isNaN(parseInt(opts.tail, 10)) ? 20 : parseInt(opts.tail, 10)
      const msgs = allMsgs.slice(-tail)

      // Resolve display names for all unique message senders
      const senderPubKeys = [...new Set(msgs.map(m => m.sender).filter(Boolean))]
      await Promise.allSettled(
        senderPubKeys.map(pk => store.resolveDisplayName(pk))
      )

      if (opts.json) {
        console.log(JSON.stringify({
          room: {
            id: room.id,
            name: room.name,
            type: room.type,
            members: room.members,
          },
          messages: msgs.map(m => ({
            id: m.id,
            content: m.content,
            sender: m.sender,
            senderName: store.getContactName(m.sender),
            created_at: m.created_at,
            replyTo: m.replyTo,
            editOf: m.editOf,
          })),
        }))
        store.cleanup()
        process.exit(0)
      }

      const otherPubKey = store.getOtherMember(room)
      const roomDisplayName = otherPubKey
        ? store.getContactName(otherPubKey)
        : room.name
      console.log(chalk.bold(`\n   ${roomDisplayName}`))
      console.log(chalk.dim(`   ${room.id}  (${room.type})`))
      if (room.subject) {
        console.log(chalk.dim(`   Subject: ${room.subject}`))
      }
      console.log()

      for (const msg of msgs) {
        const isMine = msg.sender === store.keys?.pubKeyHex
        const sender = isMine
          ? chalk.cyan('me')
          : chalk.yellow(store.getContactName(msg.sender))
        const time = chalk.dim(formatTimestamp(msg.created_at))
        console.log(`  ${sender} ${time}`)
        console.log(`  ${msg.content}`)
        if (msg.editOf) {
          console.log(chalk.dim('   (edited)'))
        }
        console.log()
      }

      if (msgs.length < allMsgs.length) {
        console.log(chalk.dim(`   Showing last ${msgs.length} of ${allMsgs.length} messages.\n`))
      }

      store.readMessageIds[room.id] = store.readMessageIds[room.id] || {}
      for (const msg of msgs) {
        store.readMessageIds[room.id][msg.id] = true
      }
      store.saveState()
      store.cleanup()
      process.exit(0)
    })

  chat
    .command('send')
    .description('Send a message to a conversation')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<text>', 'Message text')
    .action(async (roomId: string, text: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      const room = store.getRoom(roomId)
      if (!room) {
        console.log(chalk.red(`\nRoom not found: ${roomId}\n`))
        process.exit(1)
      }

      const { giftWraps, message } = await store.sendMessage(room.id, text)
      const { accepted, errors } = await store.publishGiftWraps(giftWraps)

      store.saveState()
      store.cleanup()

      if (accepted.length === 0 && errors.length > 0) {
        console.log(chalk.red('\n   Publish failed: no relay accepted the event.\n'))
        for (const e of errors) {
          console.log(chalk.dim(`   ${e.relay}: ${e.reason || 'unknown error'}`))
        }
        console.log()
        process.exit(1)
      }

      console.log(chalk.green(`\n   Message sent! (accepted by ${accepted.length}/${accepted.length + errors.length} relays)\n`))
      process.exit(0)
    })

  chat
    .command('add-contact')
    .description('Add a contact by npub')
    .argument('<npub>', "Contact's npub (e.g., npub1...)")
    .argument('[name]', 'Optional display name')
    .action(async (npub: string, name: string | undefined) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      if (!npub.startsWith('npub1')) {
        console.log(chalk.red('\nInvalid npub. Must start with npub1.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      try {
        const contact = store.addContact(npub, name)

        // Try to resolve display name and BCH address from relays
        const [resolvedName, bchAddr] = await Promise.all([
          store.resolveDisplayName(contact.pubKeyHex),
          store.resolveBchAddress(contact.pubKeyHex),
        ])
        if (resolvedName) {
          contact.name = resolvedName
          store.saveState()
        }

        store.cleanup()
        console.log(chalk.green(`\n   Added contact: ${contact.name}\n`))
        console.log(chalk.dim(`   npub:  ${contact.npub}`))
        console.log(chalk.dim(`   hex:   ${contact.pubKeyHex}`))
        if (bchAddr) {
          console.log(chalk.dim(`   bch:   ${bchAddr}`))
        }
        console.log()
        process.exit(0)
      } catch (err: any) {
        store.cleanup()
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      }
    })

  chat
    .command('contacts')
    .description('List contacts')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      if (store.contacts.length === 0) {
        console.log(chalk.dim('\n   No contacts. Use `paytaca chat add-contact <npub>` to add one.\n'))
        store.cleanup()
        process.exit(0)
      }

      // Resolve display names and BCH addresses for all contacts
      await Promise.allSettled(
        store.contacts.map(async (c) => {
          const name = await store.resolveDisplayName(c.pubKeyHex)
          if (name) c.name = name
          await store.resolveBchAddress(c.pubKeyHex)
        })
      )
      store.saveState()

      if (opts.json) {
        console.log(JSON.stringify(store.contacts.map(c => ({
          ...c,
          bchAddress: store.bchAddressCache[c.pubKeyHex] || null,
        }))))
        store.cleanup()
        process.exit(0)
      }

      console.log()
      for (const c of store.contacts) {
        const bchAddr = store.bchAddressCache[c.pubKeyHex] || null
        console.log(`  ${chalk.bold(c.name)}`)
        console.log(chalk.dim(`   npub: ${c.npub}`))
        console.log(chalk.dim(`   hex:  ${c.pubKeyHex}`))
        if (bchAddr) {
          console.log(chalk.dim(`   bch:  ${bchAddr}`))
        }
        console.log()
      }
      store.cleanup()
      process.exit(0)
    })

  chat
    .command('identity')
    .description("Show your Nostr identity (npub, pubkey)")
    .action(async () => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      if (!store.keys) {
        console.log(chalk.red('\nFailed to derive Nostr keys.\n'))
        process.exit(1)
      }

      console.log()
      console.log(`  ${chalk.bold('npub:')}    ${store.keys.npub}`)
      console.log(`  ${chalk.bold('hex:')}     ${store.keys.pubKeyHex}`)
      console.log()
      store.cleanup()
      process.exit(0)
    })

  chat
    .command('set-display-name')
    .description('Publish your display name to relays (NIP-78)')
    .argument('<name>', 'Display name to publish')
    .action(async (name: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      if (!store.keys) {
        console.log(chalk.red('\nFailed to derive Nostr keys.\n'))
        process.exit(1)
      }

      const privKeyBytes = hexToBytes(store.keys.privKeyHex)
      const event = finalizeEvent({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'paytaca:display-name'],
          ['p', store.keys.pubKeyHex],
        ],
        content: JSON.stringify({ name: 'Paytaca Display Name', data: { displayName: name.trim() } }),
      }, privKeyBytes)

      const { accepted, errors } = await relayService.publish(store.relays, event as any)
      if (accepted.length === 0) {
        const errorDetails = errors.map(e => `${e.relay}: ${e.reason}`).join('; ')
        store.cleanup()
        console.log(chalk.red(`\n   Publish failed. ${errorDetails}\n`))
        process.exit(1)
      }

      store.displayNameCache[store.keys.pubKeyHex] = name.trim()
      store.saveState()
      store.cleanup()

      console.log(chalk.green(`\n   Display name published: ${name.trim()}\n`))
      process.exit(0)
    })

  chat
    .command('remove-display-name')
    .description('Remove your published display name from relays')
    .action(async () => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      if (!store.keys) {
        console.log(chalk.red('\nFailed to derive Nostr keys.\n'))
        process.exit(1)
      }

      const privKeyBytes = hexToBytes(store.keys.privKeyHex)
      const event = finalizeEvent({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'paytaca:display-name'],
          ['p', store.keys.pubKeyHex],
        ],
        content: JSON.stringify({ name: 'Paytaca Display Name', data: {} }),
      }, privKeyBytes)

      const { accepted, errors } = await relayService.publish(store.relays, event as any)
      if (accepted.length === 0) {
        const errorDetails = errors.map(e => `${e.relay}: ${e.reason}`).join('; ')
        store.cleanup()
        console.log(chalk.red(`\n   Remove failed. ${errorDetails}\n`))
        process.exit(1)
      }

      delete store.displayNameCache[store.keys.pubKeyHex]
      store.saveState()
      store.cleanup()

      console.log(chalk.green('\n   Display name removed.\n'))
      process.exit(0)
    })

  chat
    .command('set-bch-address')
    .description('Publish your BCH address to relays (NIP-78)')
    .argument('<address>', 'BCH address (cashaddr format)')
    .action(async (address: string) => {
      const trimmed = address.trim()
      if (!/^(bitcoincash|bchtest|bchreg):[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/i.test(trimmed)) {
        console.log(chalk.red('\nInvalid BCH address. Must be cashaddr format (e.g. bitcoincash:...).\n'))
        process.exit(1)
      }

      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      if (!store.keys) {
        console.log(chalk.red('\nFailed to derive Nostr keys.\n'))
        process.exit(1)
      }

      const privKeyBytes = hexToBytes(store.keys.privKeyHex)
      const event = finalizeEvent({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'paytaca:bch-address'],
          ['p', store.keys.pubKeyHex],
        ],
        content: JSON.stringify({ name: 'Paytaca BCH Address', data: { address: trimmed } }),
      }, privKeyBytes)

      const { accepted, errors } = await relayService.publish(store.relays, event as any)
      if (accepted.length === 0) {
        const errorDetails = errors.map(e => `${e.relay}: ${e.reason}`).join('; ')
        store.cleanup()
        console.log(chalk.red(`\n   Publish failed. ${errorDetails}\n`))
        process.exit(1)
      }

      store.bchAddressCache[store.keys.pubKeyHex] = trimmed
      store.saveState()
      store.cleanup()

      console.log(chalk.green(`\n   BCH address published: ${trimmed}\n`))
      process.exit(0)
    })

  chat
    .command('remove-bch-address')
    .description('Remove your published BCH address from relays')
    .action(async () => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      if (!store.keys) {
        console.log(chalk.red('\nFailed to derive Nostr keys.\n'))
        process.exit(1)
      }

      const privKeyBytes = hexToBytes(store.keys.privKeyHex)
      const event = finalizeEvent({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'paytaca:bch-address'],
          ['p', store.keys.pubKeyHex],
        ],
        content: JSON.stringify({ name: 'Paytaca BCH Address', data: {} }),
      }, privKeyBytes)

      const { accepted, errors } = await relayService.publish(store.relays, event as any)
      if (accepted.length === 0) {
        const errorDetails = errors.map(e => `${e.relay}: ${e.reason}`).join('; ')
        store.cleanup()
        console.log(chalk.red(`\n   Remove failed. ${errorDetails}\n`))
        process.exit(1)
      }

      delete store.bchAddressCache[store.keys.pubKeyHex]
      store.saveState()
      store.cleanup()

      console.log(chalk.green('\n   BCH address removed.\n'))
      process.exit(0)
    })

  chat
    .command('listen')
    .description('Subscribe to new messages (long-running)')
    .option('--contact <npub|name>', 'Filter to conversations involving this contact')
    .option('--json', 'Output new messages as JSON lines')
    .action(async (opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      let filterPubKey = store.keys?.pubKeyHex || null
      if (opts.contact) {
        const contact = store.contacts.find(c =>
          c.npub === opts.contact || c.name === opts.contact || c.pubKeyHex === opts.contact
        )
        if (contact) {
          filterPubKey = contact.pubKeyHex
        } else if (opts.contact.startsWith('npub1')) {
          try {
            const decoded = nip19Decode(opts.contact as `npub1${string}`)
            filterPubKey = decoded.data
          } catch {
          }
          if (!filterPubKey) console.log(chalk.yellow(`\n   Invalid npub: ${opts.contact}\n`))
        } else {
          console.log(chalk.yellow(`\n   Contact not found: ${opts.contact}. Watching all conversations.\n`))
        }
      }

      const isJson = Boolean(opts.json)

      if (!isJson) {
        const target = filterPubKey === store.keys?.pubKeyHex
          ? 'your conversations'
          : `conversations with ${store.getContactName(filterPubKey!)}`
        console.log(chalk.dim(`\n   Listening for new messages in ${target}... (Ctrl+C to stop)\n`))
      }

      store.setOnNewMessage((room, message) => {
        if (filterPubKey && !room.members.includes(filterPubKey)) return

        if (isJson) {
          console.log(JSON.stringify({
            type: 'message',
            room: { id: room.id, name: room.name },
            message: {
              id: message.id,
              content: message.content,
              sender: message.sender,
              created_at: message.created_at,
              replyTo: message.replyTo || null,
              editOf: message.editOf || null,
            },
            senderName: store.getContactName(message.sender),
          }))
          return
        }

        const isMine = message.sender === store.keys?.pubKeyHex
        const sender = isMine
          ? chalk.cyan('me')
          : chalk.yellow(store.getContactName(message.sender))
        const time = chalk.dim(formatTimestamp(message.created_at))
        const roomLabel = chalk.blue(room.name)

        console.log(`  [${roomLabel}] ${sender} ${time}`)
        console.log(`  ${message.content}`)
        if (message.editOf) {
          console.log(chalk.dim('   (edited)'))
        }
        console.log()
      })

      store.subscribe()
      if (!isJson) {
        console.log(chalk.dim('   Connected.\n'))
      }

      process.on('SIGINT', () => {
        store.unsubscribe()
        if (!isJson) {
          console.log(chalk.dim('\n   Stopped.\n'))
        }
        process.exit(0)
      })

      await new Promise(() => {})
    })
}
