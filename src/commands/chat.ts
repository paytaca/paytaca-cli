import { Command } from 'commander'
import chalk from 'chalk'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { decode as nip19Decode } from 'nostr-tools/nip19'
import { loadMnemonic } from '../wallet/index.js'
import { ChatStore } from '../nostr/store.js'
import { relayService } from '../nostr/relay.js'

function toPubKeyHex(value: string): string {
  const trimmed = value.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  const decoded = nip19Decode(trimmed)
  if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
    throw new Error(`Invalid npub: ${value}`)
  }
  return decoded.data
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

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
      await store.initializeMls()

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
        const groupBadge = room.type === 'mls-group' ? chalk.magenta(' (group)') : ''
        console.log(`  ${chalk.bold(displayName)}${groupBadge}${unreadBadge}`)
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
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room) {
        console.log(chalk.red(`\nRoom not found: ${roomId}\n`))
        process.exit(1)
      }

      const allMsgs = store.getMessages(room.id)
      const tail = Number.isNaN(parseInt(opts.tail, 10)) ? 20 : parseInt(opts.tail, 10)
      const msgs = tail === 0 ? [] : allMsgs.slice(-tail)

      // Resolve display names for all unique message senders
      const senderPubKeys = [...new Set(msgs.map(m => m.sender).filter(Boolean))]
      await Promise.allSettled(
        senderPubKeys.map(pk => store.resolveDisplayName(pk))
      )

      // Mark viewed messages as read (do this before JSON exit too)
      store.readMessageIds[room.id] = store.readMessageIds[room.id] || {}
      for (const msg of msgs) {
        store.readMessageIds[room.id][msg.id] = true
      }
      store.saveState()

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
      if (room.type === 'mls-group') {
        const memberNames = room.members.map(m => store.getContactName(m)).join(', ')
        console.log(chalk.dim(`   Members (${room.members.length}): ${memberNames}`))
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
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room) {
        console.log(chalk.red(`\nRoom not found: ${roomId}\n`))
        process.exit(1)
      }

      let accepted: string[] = []
      let errors: { relay: string; reason: string }[] = []
      try {
        const result = await store.sendMessage(room.id, text)
        const publish = result.publish ?? await store.publishGiftWraps(result.giftWraps)
        accepted = publish.accepted
        errors = publish.errors
      } catch (err: any) {
        store.cleanup()
        console.log(chalk.red(`\n   Send failed: ${err.message || err}\n`))
        process.exit(1)
      }

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
    .command('start')
    .description('Start a new 1:1 conversation with a contact')
    .argument('<npub>', "Contact's npub (e.g., npub1...)")
    .action(async (npub: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      try {
        const room = store.startConversation(npub)
        await store.resolveDisplayName(store.getOtherMember(room)!)
        console.log(chalk.green(`\n   Conversation started: ${room.name}\n`))
        console.log(chalk.dim(`   Room ID: ${room.id}\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exit(1)
      } finally {
        store.cleanup()
      }
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
    .command('profile')
    .description("Show your profile (display name, BCH address)")
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
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

      const [displayName, bchAddress] = await Promise.all([
        store.resolveDisplayName(store.keys.pubKeyHex),
        store.resolveBchAddress(store.keys.pubKeyHex),
      ])
      store.saveState()

      if (opts.json) {
        console.log(JSON.stringify({
          npub: store.keys.npub,
          pubKeyHex: store.keys.pubKeyHex,
          displayName: displayName || null,
          bchAddress: bchAddress || null,
        }))
        store.cleanup()
        process.exit(0)
      }

      console.log()
      console.log(`  ${chalk.bold('displayName:')}  ${displayName || chalk.dim('(not set)')}`)
      console.log(`  ${chalk.bold('bchAddress:')}   ${bchAddress || chalk.dim('(not set)')}`)
      console.log(`  ${chalk.bold('npub:')}         ${store.keys.npub}`)
      console.log(`  ${chalk.bold('hex:')}          ${store.keys.pubKeyHex}`)
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
      const trimmed = address.trim().toLowerCase()
      if (!/^(bitcoincash|bchtest|bchreg):[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/.test(trimmed)) {
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
      await store.initializeMls()

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
            console.log(chalk.red(`\n   Invalid npub: ${opts.contact}\n`))
            process.exit(1)
          }
        } else {
          console.log(chalk.yellow(`\n   Contact not found: ${opts.contact}. Watching all conversations.\n`))
          filterPubKey = null
        }
      }

      const isJson = Boolean(opts.json)

      if (!isJson) {
        const target = !filterPubKey
          ? 'all conversations'
          : filterPubKey === store.keys?.pubKeyHex
            ? 'your conversations'
            : `conversations with ${store.getContactName(filterPubKey)}`
        console.log(chalk.dim(`\n   Listening for new messages in ${target}... (Ctrl+C to stop)\n`))
      }

      store.setOnNewMessage((room, message) => {
        if (filterPubKey && !room.members.includes(filterPubKey)) return

        if (isJson) {
          console.log(JSON.stringify({
            type: 'message',
            room: { id: room.id, name: room.name, members: room.members },
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

      const shutdown = () => {
        store.unsubscribe()
        if (!isJson) {
          console.log(chalk.dim('\n   Stopped.\n'))
        }
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      await new Promise(() => {})
    })

  const group = chat
    .command('group')
    .description('Manage MLS group chats')

  group
    .command('create')
    .description('Create a new MLS group')
    .argument('<name>', 'Group name')
    .option('--member <npub>', 'Invite a member (repeatable)', collectOption, [])
    .action(async (name: string, opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      try {
        const members = (opts.member as string[]).map(toPubKeyHex)
        const room = await store.createMlsGroup(name, members)
        console.log(chalk.green(`\n   Group created: ${room.name}\n`))
        console.log(chalk.dim(`   Room ID: ${room.id}\n`))
        if (members.length > 0) {
          console.log(chalk.dim(`   Invited ${members.length} member(s).\n`))
        }
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('add-member')
    .description('Add a member to an MLS group')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<npub>', "Member's npub")
    .action(async (roomId: string, npub: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        await store.addMlsGroupMember(room.id, toPubKeyHex(npub))
        console.log(chalk.green(`\n   Member added to ${room.name}.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('remove-member')
    .description('Remove a member from an MLS group')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<npub>', "Member's npub")
    .action(async (roomId: string, npub: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        await store.removeMlsGroupMember(room.id, toPubKeyHex(npub))
        console.log(chalk.green(`\n   Member removed from ${room.name}.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('leave')
    .description('Leave an MLS group')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .option('--successor <npub>', 'New owner (required when the owner leaves)')
    .action(async (roomId: string, opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        const successor = opts.successor ? toPubKeyHex(opts.successor) : undefined
        await store.leaveMlsGroup(room.id, successor)
        console.log(chalk.green(`\n   Left ${room.name}.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('info')
    .description('Show MLS group details')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .option('--json', 'Output as JSON')
    .action(async (roomId: string, opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      const info = await store.getMlsGroupInfo(room.id)
      if (!info) {
        console.log(chalk.red(`\nMLS group state not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(info))
        store.cleanup()
        process.exit(0)
      }

      console.log()
      console.log(`  ${chalk.bold(info.name)}`)
      console.log(chalk.dim(`   Room ID:   ${info.roomId}`))
      console.log(chalk.dim(`   MLS group: ${info.mlsGroupIdHex}`))
      console.log(chalk.dim(`   Members (${info.members.length}):`))
      for (const member of info.members) {
        const role = member === info.owner
          ? chalk.yellow(' (owner)')
          : info.admins.includes(member)
            ? chalk.cyan(' (admin)')
            : ''
        console.log(`     ${store.getContactName(member)}${role}`)
        console.log(chalk.dim(`       ${member}`))
      }
      if (info.pendingInvitees.length > 0) {
        console.log(chalk.dim(`   Pending invitations (${info.pendingInvitees.length}):`))
        for (const member of info.pendingInvitees) {
          console.log(`     ${store.getContactName(member)}`)
        }
      }
      console.log()
      store.cleanup()
      process.exit(0)
    })

  group
    .command('rename')
    .description('Rename an MLS group')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<name>', 'New group name')
    .action(async (roomId: string, name: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        await store.renameMlsGroup(room.id, name)
        console.log(chalk.green(`\n   Group renamed to ${name}.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('set-admin')
    .description('Grant or revoke admin rights in an MLS group')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<npub>', "Member's npub")
    .option('--remove', 'Revoke admin rights instead of granting them')
    .action(async (roomId: string, npub: string, opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        await store.setMlsAdmin(room.id, toPubKeyHex(npub), !opts.remove)
        console.log(chalk.green(`\n   Admin role ${opts.remove ? 'revoked' : 'granted'}.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  group
    .command('transfer-owner')
    .description('Transfer MLS group ownership')
    .argument('<room-id>', 'Room ID (full or prefix)')
    .argument('<npub>', "New owner's npub")
    .action(async (roomId: string, npub: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      const room = store.getRoom(roomId)
      if (!room || room.type !== 'mls-group') {
        console.log(chalk.red(`\nMLS group not found: ${roomId}\n`))
        store.cleanup()
        process.exit(1)
      }

      try {
        await store.transferMlsOwnership(room.id, toPubKeyHex(npub))
        console.log(chalk.green(`\n   Ownership transferred.\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  const invites = chat
    .command('invites')
    .description('Manage MLS group invitations')

  invites
    .command('list')
    .description('List pending MLS group invitations')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      const pending = store.getInvitations()
      if (opts.json) {
        console.log(JSON.stringify(pending.map(i => ({
          roomId: i.roomId,
          name: i.name,
          inviter: i.inviterPubKey,
          inviterName: store.getContactName(i.inviterPubKey),
          createdAt: i.createdAt,
        }))))
        store.cleanup()
        process.exit(0)
      }

      if (pending.length === 0) {
        console.log(chalk.dim('\n   No pending invitations.\n'))
        store.cleanup()
        process.exit(0)
      }

      await Promise.allSettled(
        pending.map(i => store.resolveDisplayName(i.inviterPubKey))
      )

      console.log()
      for (const invite of pending) {
        console.log(`  ${chalk.bold(invite.name)}`)
        console.log(chalk.dim(`   Invited by ${store.getContactName(invite.inviterPubKey)}`))
        console.log(chalk.dim(`   Room ID: ${invite.roomId}`))
        console.log()
      }
      store.cleanup()
      process.exit(0)
    })

  invites
    .command('accept')
    .description('Accept an MLS group invitation')
    .argument('<room-id>', 'Invitation room ID (full or prefix)')
    .action(async (roomId: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)
      await store.initializeMls()

      try {
        const room = await store.acceptInvitation(roomId)
        console.log(chalk.green(`\n   Joined ${room.name}.\n`))
        console.log(chalk.dim(`   Room ID: ${room.id}\n`))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })

  invites
    .command('decline')
    .description('Decline an MLS group invitation')
    .argument('<room-id>', 'Invitation room ID (full or prefix)')
    .action(async (roomId: string) => {
      const data = loadMnemonic()
      if (!data) {
        console.log(chalk.red('\nNo wallet found.\n'))
        process.exit(1)
      }

      const store = new ChatStore()
      await store.initialize(data.mnemonic)

      try {
        await store.declineInvitation(roomId)
        console.log(chalk.green('\n   Invitation declined.\n'))
      } catch (err: any) {
        console.log(chalk.red(`\n   Error: ${err.message || err}\n`))
        process.exitCode = 1
      } finally {
        store.cleanup()
      }
    })
}
