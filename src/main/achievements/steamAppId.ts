import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

type CacheFile = {
  version: 1
  byGameUrl: Record<
    string,
    {
      titleNorm?: string
      steamAppId?: string
      resolvedAt?: number
      notFoundAt?: number
    }
  >
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'achievement-schemas')
}

function cachePath(): string {
  return path.join(cacheDir(), 'appid-map.json')
}

function safeReadJson(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function safeWriteJson(filePath: string, value: any) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  } catch {
    // ignore
  }
}

function normalizeTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (s: string) => {
    const out = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      out.set(bg, (out.get(bg) || 0) + 1)
    }
    return out
  }

  const a2 = bigrams(a)
  const b2 = bigrams(b)

  let intersect = 0
  for (const [bg, n] of a2.entries()) {
    const m = b2.get(bg) || 0
    intersect += Math.min(n, m)
  }

  return (2 * intersect) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1))
}

function scoreTitleMatch(queryTitle: string, candidateTitle: string): number {
  const q = normalizeTitle(queryTitle)
  const c = normalizeTitle(candidateTitle)
  if (!q || !c) return 0
  if (q === c) return 1

  // Penalize obvious non-game entries
  const badWords = ['soundtrack', 'ost', 'dlc', 'demo', 'tool', 'editor', 'pack']
  const hasBad = badWords.some((w) => c.includes(` ${w} `) || c.endsWith(` ${w}`) || c.startsWith(`${w} `))

  let s = diceCoefficient(q, c)
  if (c.includes(q)) s = Math.max(s, 0.92)
  if (q.includes(c)) s = Math.max(s, 0.9)
  if (hasBad) s -= 0.18
  return Math.max(0, Math.min(1, s))
}

function loadCache(): CacheFile {
  const raw = safeReadJson(cachePath())
  if (raw && raw.version === 1 && typeof raw.byGameUrl === 'object' && raw.byGameUrl) {
    return raw as CacheFile
  }
  return { version: 1, byGameUrl: {} }
}

function saveCache(cache: CacheFile) {
  safeWriteJson(cachePath(), cache)
}

function cacheKeyForGameUrl(gameUrl: string): string {
  // Keep URLs as keys, but bound size by hashing if extremely long.
  const u = String(gameUrl || '').trim()
  if (!u) return ''
  if (u.length <= 300) return u
  return `sha1:${crypto.createHash('sha1').update(u).digest('hex')}`
}

export async function resolveSteamAppIdByTitle(opts: {
  gameUrl: string
  title?: string | null
  maxAgeMs?: number
}): Promise<string | null> {
  const title = String(opts.title || '').trim()
  if (!title) return null

  const maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : 30 * 24 * 60 * 60 * 1000

  const key = cacheKeyForGameUrl(opts.gameUrl)
  if (!key) return null

  const cache = loadCache()
  const entry = cache.byGameUrl[key] || {}
  const now = Date.now()

  const titleNorm = normalizeTitle(title)

  // Use cached success if still fresh and same title
  if (entry.steamAppId && entry.resolvedAt && now - entry.resolvedAt < maxAgeMs && entry.titleNorm === titleNorm) {
    return String(entry.steamAppId)
  }

  // Avoid hammering when we already failed recently for this title
  if (entry.notFoundAt && now - entry.notFoundAt < 7 * 24 * 60 * 60 * 1000 && entry.titleNorm === titleNorm) {
    return null
  }

  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=us`

  let json: any = null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`Steam storesearch HTTP ${res.status}`)
      json = await res.json()
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }

  const items = Array.isArray(json?.items) ? json.items : []
  const scored = items
    .filter((it: any) => it && (it.type === 'app' || !it.type) && typeof it.id === 'number' && (it.name || it.title))
    .map((it: any) => {
      const name = String(it.name || it.title || '').trim()
      return { id: String(it.id), name, score: scoreTitleMatch(title, name) }
    })
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]

  // Conservative acceptance: high score, or clear winner.
  const ok =
    !!best &&
    ((best.score >= 0.88 && best.score >= (second?.score || 0) + 0.08) ||
      best.score >= 0.93 ||
      normalizeTitle(best.name) === titleNorm)

  if (!ok) {
    cache.byGameUrl[key] = { titleNorm, notFoundAt: now }
    saveCache(cache)
    return null
  }

  cache.byGameUrl[key] = { titleNorm, steamAppId: best.id, resolvedAt: now }
  saveCache(cache)
  return best.id
}
