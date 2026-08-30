import { app, session } from 'electron'
import fs from 'fs'
import path from 'path'
import { STORE_HOME_URL, isOnlineFixHost } from '../../shared/allowedHosts'
import { parseGamePage, parseListing, type StoreGameDetails, type StoreListing } from './parser'
import { toStoreImageUrl } from './imageProxy'

/**
 * Data layer for the native store.
 *
 * Requests go through the same session partition as the store webview, so the
 * user's login cookies apply and pages that require an account come back
 * complete. Responses are cached briefly: a grid must never turn one scroll
 * into a burst of requests against the site.
 */

const STORE_PARTITION = 'persist:online-fix'
const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20000
const MAX_CACHE_ENTRIES = 60

type CacheEntry = { html: string; fetchedAt: number }

const cache = new Map<string, CacheEntry>()

function storeSession() {
  return session.fromPartition(STORE_PARTITION)
}

function decodeBody(buffer: Buffer, contentType: string | null): string {
  const declared = /charset=([^;]+)/i.exec(String(contentType || ''))?.[1]?.trim().toLowerCase()
  const utf8 = buffer.toString('utf8')
  const meta = /charset=["']?([\w-]+)/i.exec(utf8.slice(0, 2048))?.[1]?.toLowerCase()
  const charset = declared || meta

  if (!charset || charset === 'utf-8' || charset === 'utf8') return utf8

  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return utf8
  }
}

export async function fetchStoreHtml(url: string, options?: { force?: boolean }): Promise<string> {
  const target = new URL(url, STORE_HOME_URL).toString()
  if (!isOnlineFixHost(new URL(target).hostname)) {
    throw new Error(`Refusing to fetch a host outside the store: ${target}`)
  }

  const cached = cache.get(target)
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.html
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    // Session.fetch (not net.fetch) so the store's cookies ride along.
    const response = await storeSession().fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' }
    })

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

    const html = decodeBody(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'))

    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
    cache.set(target, { html, fetchedAt: Date.now() })

    return html
  } finally {
    clearTimeout(timer)
  }
}

function listingUrl(page: number, query?: string): string {
  const trimmed = String(query || '').trim()
  if (trimmed) {
    // DLE search; results reuse the listing markup.
    const search = new URL('/index.php', STORE_HOME_URL)
    search.searchParams.set('do', 'search')
    search.searchParams.set('subaction', 'search')
    search.searchParams.set('story', trimmed)
    if (page > 1) search.searchParams.set('search_start', String(page))
    return search.toString()
  }

  return page > 1 ? new URL(`/page/${page}/`, STORE_HOME_URL).toString() : STORE_HOME_URL
}

export type StoreListingResult = StoreListing & {
  page: number
  query?: string
  sourceUrl: string
}

export async function getStoreListing(options?: {
  page?: number
  query?: string
  force?: boolean
}): Promise<StoreListingResult> {
  const page = Math.max(1, Number(options?.page) || 1)
  const query = String(options?.query || '').trim() || undefined
  const sourceUrl = listingUrl(page, query)

  const html = await fetchStoreHtml(sourceUrl, { force: options?.force })
  const listing = parseListing(html, sourceUrl)

  // The renderer cannot load these directly (see store/imageProxy).
  const items = listing.items.map((item) => ({ ...item, imageUrl: toStoreImageUrl(item.imageUrl) }))

  return { ...listing, items, page, query, sourceUrl }
}

export async function getStoreGame(url: string, options?: { force?: boolean }): Promise<StoreGameDetails> {
  const html = await fetchStoreHtml(url, { force: options?.force })
  return parseGamePage(html, new URL(url, STORE_HOME_URL).toString())
}

/**
 * Saves a page exactly as the site served it, so the parser can be developed
 * and tested against real markup. In development it lands in scripts/fixtures
 * (where the test script reads from); in a packaged build it goes to userData.
 */
export async function captureStoreFixture(url: string, name?: string): Promise<{ path: string; bytes: number }> {
  const html = await fetchStoreHtml(url, { force: true })

  const safeName = String(name || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  const fileName = `${safeName || `capture-${Date.now()}`}.html`
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'store-fixtures')
    : path.join(app.getAppPath(), 'scripts', 'fixtures')

  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, fileName)
  fs.writeFileSync(target, html, 'utf8')

  return { path: target, bytes: Buffer.byteLength(html, 'utf8') }
}

export function clearStoreCache() {
  cache.clear()
}
