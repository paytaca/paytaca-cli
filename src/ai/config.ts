import os from 'os'
import path from 'path'

export const DEFAULT_BACKEND_URL = 'https://api.paytaca.ai'

export const LIFT_TOKEN_ID =
  '5932b2fd4915d6a75d3ec53282cd49118149a2176ee67ed68b1111ff0786f7fc'

export const PAYTACA_DIR = path.join(os.homedir(), '.paytaca')
export const AUTO_REFILL_FILE = path.join(PAYTACA_DIR, 'auto-refill.json')
export const AUTO_REFILL_EVENTS_FILE = path.join(
  PAYTACA_DIR,
  'auto-refill-events.jsonl'
)

export function resolveBackendUrl(explicit?: string): string {
  const url = explicit || process.env.PAYTACA_BACKEND_URL || DEFAULT_BACKEND_URL
  return url.replace(/\/+$/, '')
}

export function apiUrl(baseUrl: string, apiPath: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  const suffix = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return `${normalized}${suffix}`
}