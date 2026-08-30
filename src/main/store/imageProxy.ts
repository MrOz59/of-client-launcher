import { protocol, session } from 'electron'
import { isOnlineFixHost, STORE_HOME_URL } from '../../shared/allowedHosts'

/**
 * Serves store artwork through the main process.
 *
 * The renderer runs from file://, so an <img> pointing straight at the site
 * sends a cross-site, referer-less request that hotlink protection drops — the
 * grid ends up with broken covers even though the same URL answers fine from a
 * plain request. Fetching here instead lets the launcher send a proper referer
 * and reuse the store session, and keeps the artwork on one code path.
 */

const SCHEME = 'ofimg'
const STORE_PARTITION = 'persist:online-fix'
const REQUEST_TIMEOUT_MS = 20000

/** Must run before the app is ready. */
export function registerStoreImageScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

/** Wraps a store image URL so the renderer can load it. */
export function toStoreImageUrl(url: string | undefined | null): string | undefined {
  const value = String(url || '').trim()
  if (!value) return undefined

  try {
    if (!isOnlineFixHost(new URL(value).hostname)) return value
  } catch {
    return value
  }

  return `${SCHEME}://i/${Buffer.from(value, 'utf8').toString('base64url')}`
}

function decodeTarget(requestUrl: string): string | null {
  try {
    const encoded = new URL(requestUrl).pathname.replace(/^\/+/, '')
    if (!encoded) return null

    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    return isOnlineFixHost(new URL(decoded).hostname) ? decoded : null
  } catch {
    return null
  }
}

export function registerStoreImageProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const target = decodeTarget(request.url)
    if (!target) return new Response('bad image request', { status: 400 })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await session.fromPartition(STORE_PARTITION).fetch(target, {
        signal: controller.signal,
        headers: { Referer: STORE_HOME_URL, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }
      })

      if (!response.ok) return new Response('upstream error', { status: response.status })

      return new Response(await response.arrayBuffer(), {
        status: 200,
        headers: {
          'content-type': response.headers.get('content-type') || 'image/jpeg',
          // Artwork barely changes; let the renderer keep it around.
          'cache-control': 'public, max-age=86400'
        }
      })
    } catch (err: any) {
      console.warn('[Store] Image proxy failed:', err?.message || err)
      return new Response('image fetch failed', { status: 502 })
    } finally {
      clearTimeout(timer)
    }
  })
}
