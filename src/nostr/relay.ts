import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { NostrEvent } from './chat.js'

let _pool: SimplePool | null = null
let _subs: any[] = []
let _authSigner: ((event: any) => Promise<any>) | null = null
let _pollInterval: ReturnType<typeof setInterval> | null = null
let _keepaliveInterval: ReturnType<typeof setInterval> | null = null
let _seenEventIds = new Set<string>()
let _resubscribeTimer: ReturnType<typeof setTimeout> | null = null
let _subscriptionCallbacks: { onEvent?: (event: NostrEvent) => void } | null = null

let _isSubscribed = false
let _lastSubscribeTime = 0
let _subscribedRelays: string[] = []
let _subscribedPubKey: string | null = null
let _subscribing = false
let _activeSubRelays = new Set<string>()

const KEEPALIVE_INTERVAL_MS = 30000

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function getPool(): SimplePool {
  if (!_pool) {
    _pool = new SimplePool({
      maxWaitForConnection: 30000,
      enableReconnect: true,
      enablePing: true,
      automaticallyAuth: (_relayURL: string) => {
        if (!_authSigner) return null
        return _authSigner
      },
    } as any)
  }
  return _pool!
}

export function setAuthKey(privKeyHex: string): void {
  const privKeyBytes = hexToBytes(privKeyHex)
  _authSigner = (eventTemplate: any) => Promise.resolve(finalizeEvent(eventTemplate, privKeyBytes))
}

export function disconnect(): void {
  if (_resubscribeTimer) {
    clearTimeout(_resubscribeTimer)
    _resubscribeTimer = null
  }
  if (_pool) {
    for (const sub of _subs) {
      try { sub.close() } catch (_) {}
    }
    _subs = []
    _pool = null
  }
  if (_pollInterval) {
    clearInterval(_pollInterval)
    _pollInterval = null
  }
  if (_keepaliveInterval) {
    clearInterval(_keepaliveInterval)
    _keepaliveInterval = null
  }
  _isSubscribed = false
  _lastSubscribeTime = 0
  _subscribedRelays = []
  _subscribedPubKey = null
  _subscribing = false
  _subscriptionCallbacks = null
  _activeSubRelays.clear()
}

export function isSubscribed(): boolean {
  return _isSubscribed && _subs.length > 0
}

function scheduleResubscribe(): void {
  if (_resubscribeTimer) return
  const RESUBSCRIBE_MAX_MS = 60000
  _resubscribeTimer = setTimeout(() => {
    _resubscribeTimer = null
    if (
      !_isSubscribed &&
      _subscribedRelays.length > 0 &&
      _subscribedPubKey &&
      _subscriptionCallbacks
    ) {
      subscribeGiftWraps(_subscribedRelays, _subscribedPubKey, _subscriptionCallbacks, { force: true })
    }
  }, RESUBSCRIBE_MAX_MS)
}

export function subscribeGiftWraps(
  relays: string[],
  myPubKey: string,
  callbacks: { onEvent?: (event: NostrEvent) => void } = {},
  options: { force?: boolean } = {}
): { close(): void } {
  const now = Date.now()

  if (
    !options.force &&
    _isSubscribed &&
    _subs.length > 0 &&
    _subscribedPubKey === myPubKey &&
    arraysEqual(_subscribedRelays, relays)
  ) {
    return { close() {} }
  }

  if (_subscribing && !options.force) {
    return { close() {} }
  }

  if (_resubscribeTimer) {
    clearTimeout(_resubscribeTimer)
    _resubscribeTimer = null
  }

  for (const sub of _subs) {
    try { sub.close() } catch (_) {}
  }
  _subs = []

  _subscriptionCallbacks = callbacks

  const pool = getPool()
  const filter = { kinds: [1059], '#p': [myPubKey] }

  try {
    _subscribing = true

    for (const relayUrl of relays) {
      try {
        const sub = pool.subscribeMany(
          [relayUrl],
          filter,
          {
            onevent(event: any) {
              if (_seenEventIds.has(event.id as string)) return
              _seenEventIds.add(event.id as string)
              if (_seenEventIds.size > 5000) {
                const toDelete = Array.from(_seenEventIds).slice(0, _seenEventIds.size - 5000)
                toDelete.forEach(id => _seenEventIds.delete(id))
              }
              if (callbacks.onEvent) callbacks.onEvent(event as NostrEvent)
            },
            oneose() {
            },
            onclose(reasons: string[]) {
              if (!reasons.includes('closed by caller')) {
                _activeSubRelays.delete(relayUrl)
                if (_activeSubRelays.size === 0) {
                  _isSubscribed = false
                  scheduleResubscribe()
                }
              }
            },
          }
        )
        _subs.push(sub)
        _activeSubRelays.add(relayUrl)
      } catch (err) {
        console.error('[relay] subscribeMany failed:', err)
      }
    }
  } finally {
    _subscribing = false
  }

  if (!_pollInterval) {
    _pollInterval = setInterval(async () => {
      try {
        const events = await pool.querySync(relays, {
          kinds: [1059],
          '#p': [myPubKey],
          limit: 500,
        }, { maxWait: 10000 })
        if (!events || !events.length) return
        const newEvents = (events as any[]).filter(e => !_seenEventIds.has(e.id))
        if (!newEvents.length) return
        for (const event of newEvents) {
          _seenEventIds.add(event.id)
          if (_seenEventIds.size > 5000) {
            const toDelete = Array.from(_seenEventIds).slice(0, _seenEventIds.size - 5000)
            toDelete.forEach(id => _seenEventIds.delete(id))
          }
          if (callbacks.onEvent) callbacks.onEvent(event as NostrEvent)
        }
      } catch (err) {
        console.error('[relay] poll querySync failed:', err)
      }
    }, 30000)
  }

  if (!_keepaliveInterval) {
    _keepaliveInterval = setInterval(() => {
      if (!_isSubscribed && _subscribedRelays.length > 0 && _subscribedPubKey && _subscriptionCallbacks) {
        subscribeGiftWraps(_subscribedRelays, _subscribedPubKey, _subscriptionCallbacks, { force: true })
      }
    }, KEEPALIVE_INTERVAL_MS)
  }

  _isSubscribed = _subs.length > 0
  _lastSubscribeTime = now
  _subscribedRelays = [...relays]
  _subscribedPubKey = myPubKey

  return {
    close() {
      if (_resubscribeTimer) {
        clearTimeout(_resubscribeTimer)
        _resubscribeTimer = null
      }
      for (const sub of _subs) {
        try { sub.close() } catch (_) {}
      }
      _subs = []
      if (_pollInterval) {
        clearInterval(_pollInterval)
        _pollInterval = null
      }
      if (_keepaliveInterval) {
        clearInterval(_keepaliveInterval)
        _keepaliveInterval = null
      }
      _isSubscribed = false
      _subscriptionCallbacks = null
      _activeSubRelays.clear()
    },
  }
}

export async function publish(relays: string[], events: NostrEvent[]): Promise<{ event: string; relay: string; ok: boolean; reason?: string }[]> {
  const pool = getPool()
  const results: { event: string; relay: string; ok: boolean; reason?: string }[] = []
  for (const event of events) {
    try {
      const promises = pool.publish(relays, event as any, { maxWait: 30000 })
      const settled = await Promise.allSettled(promises as Promise<any>[])
      settled.forEach((r, i) => {
        results.push({
          event: event.id.slice(0, 16),
          relay: relays[i] || 'unknown',
          ok: r.status === 'fulfilled',
          reason: r.status === 'rejected' ? r.reason?.message || String(r.reason) : undefined,
        })
      })
    } catch (err) {
      for (const relay of relays) {
        results.push({
          event: event.id.slice(0, 16),
          relay,
          ok: false,
          reason: String(err),
        })
      }
    }
  }
  return results
}

export async function publishEvent(
  relays: string[],
  event: NostrEvent
): Promise<{ accepted: string[]; errors: { relay: string; reason: string }[] }> {
  const pool = getPool()
  const accepted: string[] = []
  const errors: { relay: string; reason: string }[] = []
  try {
    const promises = pool.publish(relays, event as any, { maxWait: 30000 })
    const results = await Promise.allSettled(promises as Promise<any>[])
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        accepted.push(relays[i])
      } else {
        errors.push({ relay: relays[i], reason: result.reason?.message || String(result.reason) })
      }
    })
  } catch (err) {
    errors.push({ relay: 'all', reason: String(err) })
  }
  return { accepted, errors }
}

export async function fetchKind10050(relays: string[], pubKey: string): Promise<NostrEvent | null> {
  const pool = getPool()
  try {
    const events = await pool.querySync(relays, { kinds: [10050], authors: [pubKey] })
    return (events?.[0] as NostrEvent) || null
  } catch (err) {
    console.error('[relay] fetchKind10050 failed:', err)
    return null
  }
}

export function cleanup(): void {
  for (const sub of _subs) {
    try { sub.close() } catch (_) {}
  }
  _subs = []
  if (_pollInterval) {
    clearInterval(_pollInterval)
    _pollInterval = null
  }
  if (_keepaliveInterval) {
    clearInterval(_keepaliveInterval)
    _keepaliveInterval = null
  }
  if (_resubscribeTimer) {
    clearTimeout(_resubscribeTimer)
    _resubscribeTimer = null
  }
  if (_pool) {
    try { _pool.destroy() } catch (_) {}
    _pool = null
  }
  _isSubscribed = false
  _lastSubscribeTime = 0
  _subscribedRelays = []
  _subscribedPubKey = null
  _subscribing = false
  _subscriptionCallbacks = null
  _authSigner = null
  _activeSubRelays.clear()
}

export async function fetchDisplayName(relays: string[], pubKey: string): Promise<string | null> {
  const pool = getPool()
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

export async function fetchBchAddress(relays: string[], pubKey: string): Promise<string | null> {
  const pool = getPool()
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

export async function fetchHistoricalGiftWraps(
  relays: string[],
  myPubKey: string,
  callbacks: { onEvent?: (event: NostrEvent) => void } = {}
): Promise<void> {
  const pool = getPool()
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
