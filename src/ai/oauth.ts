/**
 * Bitcoin Cash OAuth (bitcoincash-oauth) client for the Paytaca AI backend.
 *
 * Flow: sign a challenge with a wallet-derived key, register the key's
 * address, exchange the signature for an access token, then mint an API key
 * bound to the wallet hash. The API key is an identity only — AI usage is
 * still metered against the wallet's credits.
 */

import { binToHex, secp256k1, sha256 } from '@bitauth/libauth'
import { LibauthHDWallet } from '../wallet/keys.js'
import { BCH_DERIVATION_PATH } from '../utils/network.js'
import { pubkeyToAddress } from '../utils/crypto.js'
import { resolveBackendUrl, apiUrl } from './config.js'
import { AiApiError } from './client.js'

export const OAUTH_DOMAIN = 'oauth'
export const OAUTH_AUTH_PATH = '2/0'

export interface WalletAuthMaterial {
  userId: string
  publicKey: string
  address: string
  timestamp: number
  domain: string
  signature: string
}

export interface CreatedApiKey {
  id: string
  key: string
  keyPrefix: string
  name: string
}

interface JsonResponse {
  ok: boolean
  status: number
  statusText: string
  body: any
}

export function buildAuthMessage(
  userId: string,
  timestamp: number,
  domain: string = OAUTH_DOMAIN
): string {
  return `bitcoincash-oauth|${domain}|${userId}|${timestamp}`
}

/** Raw DER ECDSA over sha256(message) — no Bitcoin Signed Message prefix. */
export function signAuthMessage(message: string, privateKey: Uint8Array): string {
  const digest = sha256.hash(new TextEncoder().encode(message))
  const signature = secp256k1.signMessageHashDER(privateKey, digest)
  return typeof signature === 'string' ? signature : binToHex(signature)
}

export function createAuthMaterial(
  mnemonic: string,
  walletHash: string,
  timestamp?: number
): WalletAuthMaterial {
  const hdWallet = new LibauthHDWallet(mnemonic, BCH_DERIVATION_PATH, 'mainnet')
  const node = hdWallet.getNodeAt(OAUTH_AUTH_PATH)
  const publicKey = hdWallet.getPubkeyAt(OAUTH_AUTH_PATH)
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const signature = signAuthMessage(buildAuthMessage(walletHash, ts), node.privateKey)
  return {
    userId: walletHash,
    publicKey,
    address: pubkeyToAddress(publicKey, false),
    timestamp: ts,
    domain: OAUTH_DOMAIN,
    signature,
  }
}

async function postJson(
  url: string,
  body: unknown,
  token?: string,
  timeoutMs = 15000
): Promise<JsonResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }

  const text = await response.text()
  let parsed: any = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: parsed,
  }
}

function errorMessage(response: JsonResponse): string {
  const body = response.body
  if (body && typeof body === 'object') {
    return body.error || body.detail || body.message || JSON.stringify(body)
  }
  if (typeof body === 'string' && body) return body
  return response.statusText
}

export async function registerOAuthUser(
  material: WalletAuthMaterial,
  opts: { backendUrl?: string } = {}
): Promise<void> {
  const url = apiUrl(resolveBackendUrl(opts.backendUrl), '/v1/auth/register')
  const response = await postJson(url, {
    bitcoincash_address: material.address,
    user_id: material.userId,
    timestamp: material.timestamp,
    domain: material.domain,
    public_key: material.publicKey,
    signature: material.signature,
  })

  if (!response.ok) {
    const message = errorMessage(response)
    if (response.status === 409 || /already|exists/i.test(message)) return
    throw new AiApiError(
      `OAuth register failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      response.body
    )
  }
}

export async function createAccessToken(
  material: WalletAuthMaterial,
  opts: { backendUrl?: string } = {}
): Promise<string> {
  const url = apiUrl(resolveBackendUrl(opts.backendUrl), '/v1/auth/token')
  const response = await postJson(url, {
    user_id: material.userId,
    timestamp: material.timestamp,
    domain: material.domain,
    public_key: material.publicKey,
    signature: material.signature,
    scopes: ['read'],
  })

  const token = response.body?.access_token
  if (!response.ok || typeof token !== 'string' || !token) {
    throw new AiApiError(
      `OAuth token request failed (${response.status} ${response.statusText}): ${errorMessage(response)}`,
      response.status,
      response.body
    )
  }
  return token
}

export async function createApiKey(
  accessToken: string,
  name: string,
  opts: { backendUrl?: string } = {}
): Promise<CreatedApiKey> {
  const url = apiUrl(resolveBackendUrl(opts.backendUrl), '/v1/api-keys')
  const response = await postJson(url, { name }, accessToken)

  const rawKey = response.body?.key
  if (!response.ok || typeof rawKey !== 'string' || !rawKey) {
    throw new AiApiError(
      `API key creation failed (${response.status} ${response.statusText}): ${errorMessage(response)}`,
      response.status,
      response.body
    )
  }

  return {
    id: String(response.body?.id ?? ''),
    key: rawKey,
    keyPrefix: String(response.body?.key_prefix ?? rawKey.slice(0, 12)),
    name,
  }
}

export async function provisionApiKey(options: {
  mnemonic: string
  walletHash: string
  backendUrl?: string
  name?: string
  timestamp?: number
}): Promise<CreatedApiKey> {
  const { mnemonic, walletHash, backendUrl, name = 'paytaca-cli', timestamp } = options
  const material = createAuthMaterial(mnemonic, walletHash, timestamp)
  await registerOAuthUser(material, { backendUrl })
  const accessToken = await createAccessToken(material, { backendUrl })
  return createApiKey(accessToken, name, { backendUrl })
}
