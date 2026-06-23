import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { NostrEvent } from './chat.js'

export class RelayService {
  private pool: SimplePool | null = null
  private subs: any[] = []
  private authSigner: ((event: any) => Promise<any>) | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null
  private seenEventIds = new Set<string>()
  private resubscribeTimer: ReturnType<typeof setTimeout> | null = null
  private subscriptionCallbacks: { onEvent?: (event: NostrEvent) => void } | null = null
  private _isSubscribed = false
  private subscribedRelays: string[] = []
  private subscribedPubKey: string | null = null
  private subscribing = false
  private activeSubRelays = new Set<string>()

  private static readonly KEEPALIVE_INTERVAL_MS = 30000
  private static readonly MAX_SEEN_EVENT_IDS = 5000

  private trimSeenEventIds(): void {
    if (this.seenEventIds.size <= RelayService.MAX_SEEN_EVENT_IDS) return
    const toDelete = Array.from(this.seenEventIds).slice(0, this.seenEventIds.size - RelayService.MAX_SEEN_EVENT_IDS)
    for (const id of toDelete) this.seenEventIds.delete(id)
  }

  private getPool(): SimplePool {
    if (!this.pool) {
      this.pool = new SimplePool({
        maxWaitForConnection: 30000,
        enableReconnect: true,
        enablePing: true,
        automaticallyAuth: (_relayURL: string) => {
          if (!this.authSigner) return null
          return this.authSigner
        },
      } as any)
    }
    return this.pool
  }

  setAuthKey(privKeyHex: string): void {
    const privKeyBytes = hexToBytes(privKeyHex)
    this.authSigner = (eventTemplate: any) => Promise.resolve(finalizeEvent(eventTemplate, privKeyBytes))
  }

  disconnect(): void {
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer)
      this.resubscribeTimer = null
    }
    if (this.pool) {
      for (const sub of this.subs) {
        try { sub.close() } catch (_) {}
      }
      this.subs = []
      this.pool = null
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
    this._isSubscribed = false
    this.subscribedRelays = []
    this.subscribedPubKey = null
    this.subscribing = false
    this.subscriptionCallbacks = null
    this.activeSubRelays.clear()
  }

  isSubscribed(): boolean {
    return this._isSubscribed && this.subs.length > 0
  }

  private scheduleResubscribe(): void {
    if (this.resubscribeTimer) return
    const RESUBSCRIBE_MAX_MS = 60000
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = null
      if (
        !this._isSubscribed &&
        this.subscribedRelays.length > 0 &&
        this.subscribedPubKey &&
        this.subscriptionCallbacks
      ) {
        this.subscribeGiftWraps(this.subscribedRelays, this.subscribedPubKey, this.subscriptionCallbacks, { force: true })
      }
    }, RESUBSCRIBE_MAX_MS)
  }

  subscribeGiftWraps(
    relays: string[],
    myPubKey: string,
    callbacks: { onEvent?: (event: NostrEvent) => void } = {},
    options: { force?: boolean } = {}
  ): { close(): void } {
    const now = Date.now()

    if (
      !options.force &&
      this._isSubscribed &&
      this.subs.length > 0 &&
      this.subscribedPubKey === myPubKey &&
      arraysEqual(this.subscribedRelays, relays)
    ) {
      return { close() {} }
    }

    if (this.subscribing && !options.force) {
      return { close() {} }
    }

    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer)
      this.resubscribeTimer = null
    }

    for (const sub of this.subs) {
      try { sub.close() } catch (_) {}
    }
    this.subs = []

    this.subscriptionCallbacks = callbacks

    const pool = this.getPool()
    const filter = { kinds: [1059], '#p': [myPubKey] }

    try {
      this.subscribing = true

      for (const relayUrl of relays) {
        try {
          const sub = pool.subscribeMany(
            [relayUrl],
            filter,
            {
              onevent: (event: any) => {
                if (this.seenEventIds.has(event.id as string)) return
                this.seenEventIds.add(event.id as string)
                this.trimSeenEventIds()
                if (callbacks.onEvent) callbacks.onEvent(event as NostrEvent)
              },
              oneose() {
              },
              onclose: (reasons: string[]) => {
                if (!reasons || !reasons.includes('closed by caller')) {
                  this.activeSubRelays.delete(relayUrl)
                  if (this.activeSubRelays.size === 0) {
                    this._isSubscribed = false
                    this.scheduleResubscribe()
                  }
                }
              },
            }
          )
          this.subs.push(sub)
          this.activeSubRelays.add(relayUrl)
        } catch (err) {
          console.error('[relay] subscribeMany failed:', err)
        }
      }
    } finally {
      this.subscribing = false
    }

    if (!this.pollInterval) {
      this.pollInterval = setInterval(async () => {
        try {
          const events = await pool.querySync(relays, {
            kinds: [1059],
            '#p': [myPubKey],
            limit: 500,
          }, { maxWait: 10000 })
          if (!events || !events.length) return
          const newEvents = (events as any[]).filter(e => !this.seenEventIds.has(e.id))
          if (!newEvents.length) return
          for (const event of newEvents) {
            this.seenEventIds.add(event.id)
            this.trimSeenEventIds()
            if (callbacks.onEvent) callbacks.onEvent(event as NostrEvent)
          }
        } catch (err) {
          console.error('[relay] poll querySync failed:', err)
        }
      }, 30000)
    }

    if (!this.keepaliveInterval) {
      this.keepaliveInterval = setInterval(() => {
        if (!this._isSubscribed && this.subscribedRelays.length > 0 && this.subscribedPubKey && this.subscriptionCallbacks) {
          this.subscribeGiftWraps(this.subscribedRelays, this.subscribedPubKey, this.subscriptionCallbacks, { force: true })
        }
      }, RelayService.KEEPALIVE_INTERVAL_MS)
    }

    this._isSubscribed = this.subs.length > 0
    this.subscribedRelays = [...relays]
    this.subscribedPubKey = myPubKey

    return {
      close: () => {
        if (this.resubscribeTimer) {
          clearTimeout(this.resubscribeTimer)
          this.resubscribeTimer = null
        }
        for (const sub of this.subs) {
          try { sub.close() } catch (_) {}
        }
        this.subs = []
        if (this.pollInterval) {
          clearInterval(this.pollInterval)
          this.pollInterval = null
        }
        if (this.keepaliveInterval) {
          clearInterval(this.keepaliveInterval)
          this.keepaliveInterval = null
        }
        this._isSubscribed = false
        this.subscriptionCallbacks = null
        this.activeSubRelays.clear()
      },
    }
  }

  async publish(relays: string[], eventOrEvents: NostrEvent | NostrEvent[]): Promise<{ accepted: string[]; errors: { relay: string; reason: string }[] }> {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]
    const pool = this.getPool()
    const accepted: string[] = []
    const errors: { relay: string; reason: string }[] = []
    const resolvedRelays = new Set<string>()

    for (const event of events) {
      try {
        const promises = pool.publish(relays, event as any, { maxWait: 30000 })
        const settled = await Promise.allSettled(promises as Promise<any>[])
        settled.forEach((r, i) => {
          const relay = relays[i]
          if (!relay || resolvedRelays.has(relay)) return
          if (r.status === 'fulfilled') {
            resolvedRelays.add(relay)
            accepted.push(relay)
          } else {
            resolvedRelays.add(relay)
            errors.push({ relay, reason: r.reason?.message || String(r.reason) })
          }
        })
      } catch (err) {
        for (const relay of relays) {
          if (resolvedRelays.has(relay)) continue
          resolvedRelays.add(relay)
          errors.push({ relay, reason: String(err) })
        }
      }
    }
    return { accepted, errors }
  }

  async fetchKind10050(relays: string[], pubKey: string): Promise<NostrEvent | null> {
    const pool = this.getPool()
    try {
      const events = await pool.querySync(relays, { kinds: [10050], authors: [pubKey] }, { maxWait: 10000 })
      return (events?.[0] as NostrEvent) || null
    } catch (err) {
      console.error('[relay] fetchKind10050 failed:', err)
      return null
    }
  }

  cleanup(): void {
    for (const sub of this.subs) {
      try { sub.close() } catch (_) {}
    }
    this.subs = []
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer)
      this.resubscribeTimer = null
    }
    if (this.pool) {
      try { this.pool.destroy() } catch (_) {}
      this.pool = null
    }
    this._isSubscribed = false
    this.subscribedRelays = []
    this.subscribedPubKey = null
    this.subscribing = false
    this.subscriptionCallbacks = null
    this.authSigner = null
    this.activeSubRelays.clear()
  }

  async fetchDisplayName(relays: string[], pubKey: string): Promise<string | null> {
    const pool = this.getPool()
    try {
      const events = await pool.querySync(relays, { kinds: [30078], authors: [pubKey] }, { maxWait: 8000 })
      const match = (events as any[])?.find((e: any) => {
        const dTag = e.tags?.find((t: string[]) => t[0] === 'd')
        return dTag && dTag[1] === 'paytaca:display-name'
      })
      if (!match) return null
      const parsed = JSON.parse(match.content || '{}')
      return parsed?.data?.displayName?.trim() || null
    } catch (err) {
      console.error('[relay] fetchDisplayName failed:', err)
      return null
    }
  }

  async fetchBchAddress(relays: string[], pubKey: string): Promise<string | null> {
    const pool = this.getPool()
    try {
      const events = await pool.querySync(relays, { kinds: [30078], authors: [pubKey] }, { maxWait: 8000 })
      const match = (events as any[])?.find((e: any) => {
        const dTag = e.tags?.find((t: string[]) => t[0] === 'd')
        return dTag && dTag[1] === 'paytaca:bch-address'
      })
      if (!match) return null
      const parsed = JSON.parse(match.content || '{}')
      return parsed?.data?.address?.trim() || null
    } catch (err) {
      console.error('[relay] fetchBchAddress failed:', err)
      return null
    }
  }

  async fetchHistoricalGiftWraps(
    relays: string[],
    myPubKey: string,
    callbacks: { onEvent?: (event: NostrEvent) => void } = {}
  ): Promise<void> {
    const pool = this.getPool()
    try {
      const events = await pool.querySync(relays, { kinds: [1059], '#p': [myPubKey], limit: 200 }, { maxWait: 10000 })
      if (!events || !events.length) return
      for (const event of events as NostrEvent[]) {
        if (callbacks.onEvent) callbacks.onEvent(event)
      }
    } catch (err) {
      console.error('[relay] fetchHistoricalGiftWraps failed:', err)
    }
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export const relayService = new RelayService()
