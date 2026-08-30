import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { resolveSteamAppIdByTitle } from '../achievements/steamAppId'
import { getUiLanguage } from '../i18nMain'
import { cleanStoreTitle } from './title'

/**
 * Everything the store page shows that the site itself does not provide.
 *
 * The site gives a version, a torrent and instructions; artwork, description,
 * screenshots and genres come from Steam's public store API, matched by title
 * (or by an AppID the launcher already knows for that game).
 *
 * Steam rate-limits this endpoint, so answers are cached on disk for a week and
 * a miss is remembered too — a game that is not on Steam must not be looked up
 * on every visit.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MISS_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15000

export type StoreGameMetadata = {
  source: 'steam' | 'none'
  steamAppId?: string
  name?: string
  description?: string
  headerImage?: string
  backgroundImage?: string
  screenshots?: string[]
  genres?: string[]
  categories?: string[]
  developers?: string[]
  publishers?: string[]
  releaseDate?: string
}

type CachedMetadata = { fetchedAt: number; metadata: StoreGameMetadata }

/** Steam names its languages; the launcher uses locale codes. */
function steamLanguage(): string {
  const language = getUiLanguage().toLowerCase()
  if (language.startsWith('pt')) return 'brazilian'
  if (language.startsWith('ru')) return 'russian'
  if (language.startsWith('es')) return 'spanish'
  return 'english'
}

function cacheFile(appId: string, language: string): string {
  const dir = path.join(app.getPath('userData'), 'cache', 'steam-appdetails')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${appId}-${language}.json`)
}

function readCache(file: string, ttl: number): StoreGameMetadata | null {
  try {
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedMetadata
    if (!parsed?.fetchedAt || Date.now() - parsed.fetchedAt > ttl) return null
    return parsed.metadata
  } catch {
    return null
  }
}

function writeCache(file: string, metadata: StoreGameMetadata) {
  try {
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), metadata } satisfies CachedMetadata, null, 2))
  } catch (err) {
    console.warn('[Store] Failed to cache game metadata:', err)
  }
}

function mapAppDetails(appId: string, data: any): StoreGameMetadata {
  const screenshots = Array.isArray(data?.screenshots)
    ? data.screenshots
        .map((shot: any) => String(shot?.path_full || shot?.path_thumbnail || ''))
        .filter(Boolean)
        .slice(0, 8)
    : []

  const names = (list: any) =>
    Array.isArray(list) ? list.map((entry: any) => String(entry?.description || entry || '')).filter(Boolean) : []

  return {
    source: 'steam',
    steamAppId: appId,
    name: String(data?.name || '') || undefined,
    description: String(data?.short_description || '') || undefined,
    headerImage: String(data?.header_image || '') || undefined,
    backgroundImage: String(data?.background_raw || data?.background || '') || undefined,
    screenshots,
    genres: names(data?.genres).slice(0, 6),
    categories: names(data?.categories).slice(0, 8),
    developers: Array.isArray(data?.developers) ? data.developers.slice(0, 3) : [],
    publishers: Array.isArray(data?.publishers) ? data.publishers.slice(0, 3) : [],
    releaseDate: String(data?.release_date?.date || '') || undefined
  }
}

async function fetchAppDetails(appId: string, language: string): Promise<StoreGameMetadata> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=${language}`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

    const payload = (await response.json()) as Record<string, { success?: boolean; data?: any }>
    const entry = payload?.[appId]
    if (!entry?.success || !entry.data) return { source: 'none' }

    return mapAppDetails(appId, entry.data)
  } finally {
    clearTimeout(timer)
  }
}

export async function getStoreGameMetadata(options: {
  gameUrl: string
  title: string
  steamAppId?: string | null
}): Promise<StoreGameMetadata> {
  const language = steamLanguage()

  let appId = String(options.steamAppId || '').trim()
  if (!appId) {
    const cleaned = cleanStoreTitle(options.title)
    appId = (await resolveSteamAppIdByTitle({ gameUrl: options.gameUrl, title: cleaned })) || ''
  }

  if (!appId) return { source: 'none' }

  const file = cacheFile(appId, language)
  const cached = readCache(file, CACHE_TTL_MS)
  if (cached) return cached

  try {
    const metadata = await fetchAppDetails(appId, language)
    writeCache(file, metadata)
    return metadata
  } catch (err: any) {
    console.warn('[Store] Steam metadata lookup failed:', err?.message || err)

    // Remember the miss briefly so a broken lookup is not retried on every open.
    const stale = readCache(file, MISS_TTL_MS)
    return stale || { source: 'none' }
  }
}
