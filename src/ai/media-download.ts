/**
 * Shared media download helper.
 *
 * Generated media is no longer returned inline as base64 in the status JSON.
 * The backend exposes a dedicated streaming endpoint
 * (`GET /v1/<kind>/<order>/content`) that returns the raw bytes with a real
 * Content-Length, so large images/videos/audio download without the timeout
 * and payload-size problems of inline base64.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { apiUrl } from './config.js'
import { AiApiError } from './client.js'

export function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';')[0].trim().toLowerCase()
}

export interface DownloadMediaOptions {
  baseUrl: string
  token: string
  /** Backend content path (from the status `content_path`), or a fallback. */
  contentPath: string
  /** Media type reported by the status response; preferred over the HTTP header. */
  mediaType?: string
  orderId: string
  dir: string
  allowedMediaTypes: Set<string>
  extensionByMediaType: Record<string, string>
  defaultExtension: string
  timeoutMs: number
}

export interface DownloadedMedia {
  path: string
  mediaType: string
}

/**
 * Stream a generated media file from the backend content endpoint to disk.
 * Validates the media type before and after the request, then writes the raw
 * bytes to `<dir>/<safeOrderId>.<ext>` with 0600 permissions.
 */
export async function downloadMedia(
  opts: DownloadMediaOptions
): Promise<DownloadedMedia> {
  const declaredType = normalizeMediaType(opts.mediaType || '')
  if (declaredType && !opts.allowedMediaTypes.has(declaredType)) {
    throw new Error(
      `Backend returned an unsupported media type: ${declaredType}`
    )
  }

  let response: Response
  try {
    response = await fetch(apiUrl(opts.baseUrl, opts.contentPath), {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (err: any) {
    throw new AiApiError(`Backend unreachable: ${err?.message || err}`)
  }

  if (!response.ok) {
    const text = await response.text()
    let body: any = text
    try {
      body = JSON.parse(text)
    } catch {
      // keep raw text
    }
    const message =
      (body && typeof body === 'object' && (body.error || body.detail)) ||
      (typeof body === 'string' && body) ||
      response.statusText
    throw new AiApiError(
      `GET ${opts.contentPath} failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      body
    )
  }

  const headerType = normalizeMediaType(response.headers.get('content-type') || '')
  const mediaType = declaredType || headerType
  if (!mediaType || !opts.allowedMediaTypes.has(mediaType)) {
    throw new Error(
      `Backend returned an unsupported media type: ${mediaType || '(none)'}`
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) {
    throw new Error('Backend returned an empty media payload.')
  }

  const ext = opts.extensionByMediaType[mediaType] ?? opts.defaultExtension
  mkdirSync(opts.dir, { recursive: true })
  const safeId = opts.orderId.replace(/[^a-zA-Z0-9_-]/g, '')
  const filePath = path.join(opts.dir, `${safeId}.${ext}`)
  writeFileSync(filePath, buffer)
  chmodSync(filePath, 0o600)
  return { path: filePath, mediaType }
}
