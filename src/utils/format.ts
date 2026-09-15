/**
 * Shared display/formatting helpers.
 *
 * Pure functions only — no chalk, no I/O — so both the CLI renderers
 * and the core layer can use them.
 */

/** Convert BCH to satoshis (1 BCH = 100,000,000 sats). */
export function bchToSats(bch: number): number {
  return Math.round(bch * 1e8)
}

/** Convert satoshis to BCH. */
export function satsToBch(sats: number): number {
  return sats / 1e8
}

/** Format a number with thousands separators. */
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US')
}

/** Format a token amount (base units) using its decimals. */
export function formatTokenAmount(rawAmount: number, decimals: number): string {
  if (decimals === 0) return rawAmount.toLocaleString('en-US')
  const scaled = rawAmount / Math.pow(10, decimals)
  return scaled.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

/** Format an ISO date string to a concise local representation. */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return isoDate
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Truncate a txid for display. */
export function shortTxid(txid: string): string {
  if (txid.length <= 20) return txid
  return txid.slice(0, 10) + '...' + txid.slice(-10)
}

/** Truncate a hex string for display. */
export function shortHex(hex: string, len: number = 8): string {
  if (hex.length <= len * 2 + 3) return hex
  return hex.slice(0, len) + '...' + hex.slice(-len)
}

/** Block explorer transaction URL for the given network. */
export function explorerTxUrl(txid: string, isChipnet: boolean): string {
  const base = isChipnet
    ? 'https://chipnet.bchexplorer.info/tx/'
    : 'https://bchexplorer.info/tx/'
  return `${base}${txid}`
}
