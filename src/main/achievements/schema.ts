import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { load } from 'cheerio'
import crypto from 'crypto'
import { getSetting } from '../db'

export type AchievementSchemaItem = {
  id: string
  name: string
  description?: string
  iconUrl?: string
  percent?: number
  hidden?: boolean
}

type CachedSchema = {
  steamAppId: string
  fetchedAt: number
  items: AchievementSchemaItem[]
}

type CachedCustomSchema = {
  gameUrl: string
  fetchedAt: number
  items: AchievementSchemaItem[]
}

// ========================================
// Utility helpers
// ========================================

function schemasDir(): string {
  return path.join(app.getPath('userData'), 'achievement-schemas')
}

function communitySchemasDir(): string {
  return path.join(schemasDir(), 'community')
}

function communitySchemaPath(steamAppId: string): string {
  return path.join(communitySchemasDir(), `${steamAppId}.json`)
}

function schemaPath(steamAppId: string): string {
  return path.join(schemasDir(), `${steamAppId}.json`)
}

function customSchemaPathForGameUrl(gameUrl: string): string {
  const hash = crypto.createHash('sha1').update(String(gameUrl || '')).digest('hex')
  return path.join(schemasDir(), `custom-${hash}.json`)
}

function safeReadJson(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readCommunitySchema(steamAppId: string): AchievementSchemaItem[] {
  const clean = String(steamAppId || '').trim()
  if (!clean) return []
  const raw = safeReadJson(communitySchemaPath(clean))
  if (!raw) return []
  return normalizeSchemaItems(raw)
}

async function fetchCommunitySchemaRemote(steamAppId: string): Promise<AchievementSchemaItem[]> {
  const base = String(getSetting('achievement_schema_base_url') || process.env.ACHIEVEMENTS_SCHEMA_BASE_URL || '').trim()
  const clean = String(steamAppId || '').trim()
  if (!base || !clean) return []

  const url = `${base.replace(/\/+$/,'')}/${encodeURIComponent(clean)}.json`
  try {
    const res = await fetchWithTimeout(url, 12000)
    if (!res.ok) return []
    const json: any = await res.json()
    return normalizeSchemaItems(json)
  } catch {
    return []
  }
}

function normalizeId(id: string): string {
  return String(id || '')
    .trim()
    .replace(/^ACH[._-]/i, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase()
}

export function matchAchievementId(unlockedIdRaw: string, schemaIdRaw: string): boolean {
  const a = normalizeId(unlockedIdRaw)
  const b = normalizeId(schemaIdRaw)
  if (!a || !b) return false
  if (a === b) return true
  if (a.startsWith('ACH_') && a.slice(4) === b) return true
  if (b.startsWith('ACH_') && b.slice(4) === a) return true
  return false
}

// ========================================
// Steam Web API Key
// ========================================

function steamWebApiKey(): string {
  const fromSetting = getSetting('steam_web_api_key')
  const fromEnv = process.env.STEAM_WEB_API_KEY
  return String(fromSetting || fromEnv || '').trim()
}

// ========================================
// Steam Web API fetch (preferred)
// ========================================

function formatSteamCdnIconUrl(appId: string, iconHash: string): string {
  const v = String(iconHash || '').trim()
  if (!v) return ''
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  return `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${encodeURIComponent(appId)}/${v}.jpg`
}

async function fetchWithTimeout(url: string, timeoutMs: number = 12000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
      }
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchSteamWebApiSchemaForLanguage(
  steamAppId: string,
  apiKey: string,
  language: string
): Promise<Map<string, any>> {
  const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(apiKey)}&appid=${encodeURIComponent(steamAppId)}&l=${encodeURIComponent(language)}`

  try {
    const res = await fetchWithTimeout(url, 12000)
    if (!res.ok) {
      console.warn(`[Schema] Steam Web API returned ${res.status} for ${language}`)
      return new Map()
    }
    const json: any = await res.json()
    const achievements = json?.game?.availableGameStats?.achievements
    if (!Array.isArray(achievements)) return new Map()

    const out = new Map<string, any>()
    for (const a of achievements) {
      const name = String(a?.name || '').trim()
      if (!name) continue
      out.set(name, a)
    }
    return out
  } catch (err) {
    console.warn(`[Schema] Steam Web API fetch error (${language}):`, err)
    return new Map()
  }
}

async function fetchGlobalAchievementPercentages(steamAppId: string): Promise<Map<string, number>> {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${encodeURIComponent(steamAppId)}`

  try {
    const res = await fetchWithTimeout(url, 10000)
    if (!res.ok) return new Map()
    const json: any = await res.json()
    const arr = json?.achievementpercentages?.achievements
    if (!Array.isArray(arr)) return new Map()

    const out = new Map<string, number>()
    for (const it of arr) {
      const name = String(it?.name || '').trim()
      const percent = Number(it?.percent)
      if (name && Number.isFinite(percent)) {
        out.set(name, percent)
      }
    }
    return out
  } catch {
    return new Map()
  }
}

async function fetchSteamWebApiSchema(steamAppId: string, apiKey: string): Promise<AchievementSchemaItem[]> {
  console.log(`[Schema] Fetching Steam Web API schema for appid=${steamAppId}`)

  const [ptBr, en, percentages] = await Promise.all([
    fetchSteamWebApiSchemaForLanguage(steamAppId, apiKey, 'brazilian'),
    fetchSteamWebApiSchemaForLanguage(steamAppId, apiKey, 'english'),
    fetchGlobalAchievementPercentages(steamAppId)
  ])

  console.log(`[Schema] Steam Web API results: PT-BR=${ptBr.size}, EN=${en.size}, percentages=${percentages.size}`)

  // Merge: prefer PT-BR, fallback to EN
  const merged = new Map<string, AchievementSchemaItem>()

  const processEntry = (apiName: string, entry: any, isPrimary: boolean) => {
    const id = String(apiName || '').trim()
    if (!id) return

    const displayName = String(entry?.displayName || '').trim()
    const description = String(entry?.description || '').trim()
    const icon = entry?.icon ? formatSteamCdnIconUrl(steamAppId, String(entry.icon)) : ''
    const percent = percentages.get(id)
    const hidden = entry?.hidden != null ? Boolean(entry.hidden) : undefined

    const existing = merged.get(id)
    if (!existing) {
      merged.set(id, {
        id,
        name: displayName || id,
        description: description || undefined,
        iconUrl: icon || undefined,
        percent: Number.isFinite(percent) ? percent : undefined,
        hidden
      })
    } else if (!isPrimary) {
      // Fill missing from secondary language
      merged.set(id, {
        ...existing,
        name: existing.name || displayName || id,
        description: existing.description || description || undefined,
        iconUrl: existing.iconUrl || icon || undefined,
        percent: existing.percent ?? (Number.isFinite(percent) ? percent : undefined),
        hidden: existing.hidden ?? hidden
      })
    }
  }

  // Process PT-BR first (primary), then EN (secondary)
  for (const [name, entry] of ptBr) processEntry(name, entry, true)
  for (const [name, entry] of en) processEntry(name, entry, false)

  return Array.from(merged.values())
}

// ========================================
// Steam Community scraping (fallback)
// ========================================

async function fetchSteamCommunitySchema(steamAppId: string): Promise<AchievementSchemaItem[]> {
  const url = `https://steamcommunity.com/stats/${encodeURIComponent(steamAppId)}/achievements/`
  console.log(`[Schema] Scraping Steam Community for appid=${steamAppId}`)

  try {
    const res = await fetchWithTimeout(url, 15000)
    if (!res.ok) {
      console.warn(`[Schema] Steam Community returned ${res.status}`)
      return []
    }

    const html = await res.text()
    const $ = load(html)
    const items: AchievementSchemaItem[] = []

    $('.achieveRow').each((_, row) => {
      const img = $(row).find('.achieveImgHolder img').attr('src') || $(row).find('img').attr('src')
      const title = $(row).find('.achieveTxt h3').first().text().trim() || $(row).find('h3').first().text().trim()
      const desc = $(row).find('.achieveTxt h5').first().text().trim() || $(row).find('h5').first().text().trim()

      let id = ''
      if (img) {
        try {
          const u = new URL(img)
          id = path.posix.parse(u.pathname).name
        } catch {
          id = path.parse(img).name
        }
      }

      if (!id || !title) return

      items.push({
        id,
        name: title,
        description: desc || undefined,
        iconUrl: img || undefined
      })
    })

    // Dedupe
    const seen = new Set<string>()
    const dedupe = items.filter((it) => {
      const key = normalizeId(it.id)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    console.log(`[Schema] Steam Community scraped ${dedupe.length} achievements`)
    return dedupe
  } catch (err) {
    console.warn('[Schema] Steam Community scrape error:', err)
    return []
  }
}

// ========================================
// Main schema getter
// ========================================

export async function getAchievementSchema(
  steamAppId: string,
  opts?: { maxAgeMs?: number; forceRefresh?: boolean }
): Promise<AchievementSchemaItem[]> {
  const clean = String(steamAppId || '').trim()
  if (!clean) {
    console.log('[Schema] getAchievementSchema called with empty steamAppId')
    return []
  }

  const apiKeyNow = steamWebApiKey()

  // 0. Community schema (local/remote), if available.
  // This allows providing hidden achievement descriptions outside of Steam.
  const communityLocal = readCommunitySchema(clean)
  if (communityLocal.length) {
    console.log(`[Schema] Using community schema (local) for appid=${clean} (${communityLocal.length} items)`) 
    return communityLocal
  }
  const communityRemote = await fetchCommunitySchemaRemote(clean)
  if (communityRemote.length) {
    console.log(`[Schema] Using community schema (remote) for appid=${clean} (${communityRemote.length} items)`) 
    return communityRemote
  }

  const maxAgeMs = typeof opts?.maxAgeMs === 'number' ? opts.maxAgeMs : 1000 * 60 * 60 * 24 * 7 // 7 days
  const p = schemaPath(clean)

  // Check cache first (unless forceRefresh)
  if (!opts?.forceRefresh) {
    try {
      const cached = safeReadJson(p) as CachedSchema | null
      if (cached?.steamAppId === clean && Array.isArray(cached.items) && cached.items.length > 0) {
        // If we currently have an API key, but the cached schema looks like a low-fidelity scrape
        // (often missing descriptions/percent/hidden), bypass cache and refetch via Web API.
        if (apiKeyNow) {
          const hasAnyDesc = cached.items.some((it) => typeof it?.description === 'string' && String(it.description).trim())
          const hasAnyPercent = cached.items.some((it) => typeof it?.percent === 'number' && Number.isFinite(it.percent as any))
          const hasAnyHidden = cached.items.some((it) => typeof it?.hidden === 'boolean')
          if (!hasAnyDesc && !hasAnyPercent && !hasAnyHidden) {
            console.log(`[Schema] Cached schema looks low-fidelity; refetching with Web API for appid=${clean}`)
          } else {
            if (Date.now() - (cached.fetchedAt || 0) <= maxAgeMs) {
              console.log(`[Schema] Using cached schema for appid=${clean} (${cached.items.length} items)`) 
              return cached.items
            }
          }
        } else {
        if (Date.now() - (cached.fetchedAt || 0) <= maxAgeMs) {
          console.log(`[Schema] Using cached schema for appid=${clean} (${cached.items.length} items)`)
          return cached.items
        }
        }
      }
    } catch {
      // ignore
    }
  }

  // Fetch fresh
  const apiKey = apiKeyNow
  console.log(`[Schema] API key present: ${apiKey ? 'YES' : 'NO'} (length=${apiKey.length})`)

  let items: AchievementSchemaItem[] = []

  // Try Steam Web API first if we have a key
  if (apiKey) {
    items = await fetchSteamWebApiSchema(clean, apiKey)
  }

  // Fallback to Steam Community scraping
  if (!items.length) {
    console.log('[Schema] Steam Web API returned no items, trying Steam Community...')
    items = await fetchSteamCommunitySchema(clean)
  }

  // Save to cache if we got results
  if (items.length > 0) {
    try {
      fs.mkdirSync(schemasDir(), { recursive: true })
      const payload: CachedSchema = {
        steamAppId: clean,
        fetchedAt: Date.now(),
        items
      }
      fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
      console.log(`[Schema] Saved ${items.length} items to cache for appid=${clean}`)
    } catch (err) {
      console.warn('[Schema] Failed to save cache:', err)
    }
  } else {
    console.log(`[Schema] No achievements found for appid=${clean}`)
  }

  return items
}

// ========================================
// Custom schema (user-imported)
// ========================================

function normalizeSchemaItems(raw: any): AchievementSchemaItem[] {
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []
  if (!Array.isArray(items)) return []

  const out: AchievementSchemaItem[] = []
  for (const it of items) {
    const id = String(it?.id || it?.apiName || it?.apiname || '').trim()
    const name = String(it?.name || it?.displayName || it?.title || '').trim()
    if (!id || !name) continue
    out.push({
      id,
      name,
      description: it?.description ? String(it.description).trim() : undefined,
      iconUrl: it?.iconUrl || it?.icon ? String(it.iconUrl || it.icon).trim() : undefined,
      percent: typeof it?.percent === 'number' ? it.percent : undefined,
      hidden: typeof it?.hidden === 'boolean' ? it.hidden : undefined
    })
  }

  const seen = new Set<string>()
  return out.filter((it) => {
    const key = normalizeId(it.id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getCustomAchievementSchemaForGame(gameUrl: string): AchievementSchemaItem[] | null {
  const url = String(gameUrl || '').trim()
  if (!url) return null

  const p = customSchemaPathForGameUrl(url)
  const cached = safeReadJson(p) as CachedCustomSchema | null
  if (!cached || cached.gameUrl !== url || !Array.isArray(cached.items)) return null
  return normalizeSchemaItems(cached.items)
}

export function setCustomAchievementSchemaForGame(
  gameUrl: string,
  raw: any
): { success: boolean; error?: string; count?: number } {
  const url = String(gameUrl || '').trim()
  if (!url) return { success: false, error: 'gameUrl ausente' }

  const items = normalizeSchemaItems(raw)
  if (!items.length) return { success: false, error: 'Schema inválido (nenhuma conquista válida encontrada)' }

  try {
    fs.mkdirSync(schemasDir(), { recursive: true })
    const p = customSchemaPathForGameUrl(url)
    const payload: CachedCustomSchema = { gameUrl: url, fetchedAt: Date.now(), items }
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
    return { success: true, count: items.length }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Falha ao salvar schema' }
  }
}

export function clearCustomAchievementSchemaForGame(gameUrl: string): { success: boolean; error?: string } {
  const url = String(gameUrl || '').trim()
  if (!url) return { success: false, error: 'gameUrl ausente' }
  try {
    const p = customSchemaPathForGameUrl(url)
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Falha ao remover schema' }
  }
}

// Clear cached schema for a specific appid (force refresh on next request)
export function clearCachedSchema(steamAppId: string): boolean {
  const clean = String(steamAppId || '').trim()
  if (!clean) return false
  try {
    const p = schemaPath(clean)
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true })
      return true
    }
  } catch {
    // ignore
  }
  return false
}
