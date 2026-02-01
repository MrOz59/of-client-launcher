/**
 * Steam Banner Fetching Utilities
 */
import axios from 'axios'
import { updateGameInfo } from './db'

// Global cache for banner fetching
const getBannerCache = (): Map<string, { at: number; url: string | null }> => {
  if (!(globalThis as any).__of_steamBannerCache) {
    (globalThis as any).__of_steamBannerCache = new Map()
  }
  return (globalThis as any).__of_steamBannerCache
}

const getBannerInFlight = (): Map<string, Promise<string | null>> => {
  if (!(globalThis as any).__of_steamBannerInFlight) {
    (globalThis as any).__of_steamBannerInFlight = new Map()
  }
  return (globalThis as any).__of_steamBannerInFlight
}

function parseImageDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    if (!buf || buf.length < 24) return null

    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      if (width > 0 && height > 0) return { width, height }
    }

    // GIF
    const sig = buf.toString('ascii', 0, 6)
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      const width = buf.readUInt16LE(6)
      const height = buf.readUInt16LE(8)
      if (width > 0 && height > 0) return { width, height }
    }

    // JPEG (scan SOF markers)
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2
      while (offset + 4 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1
          continue
        }

        let marker = buf[offset + 1]
        offset += 2

        // Standalone markers
        if (marker === 0xd9 || marker === 0xda) break // EOI/SOS
        if (offset + 2 > buf.length) break

        const size = buf.readUInt16BE(offset)
        if (size < 2) break

        const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
        if (isSOF) {
          if (offset + 7 <= buf.length) {
            const height = buf.readUInt16BE(offset + 3)
            const width = buf.readUInt16BE(offset + 5)
            if (width > 0 && height > 0) return { width, height }
          }
          break
        }

        offset += size
      }
    }
  } catch {
    // ignore
  }
  return null
}

async function fetchImageProbe(url: string): Promise<{ ok: boolean; width?: number; height?: number }> {
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      responseType: 'arraybuffer',
      headers: { Range: 'bytes=0-131071' },
      validateStatus: (s) => s === 200 || s === 206
    })
    const ct = String(resp.headers?.['content-type'] || '')
    if (!ct.startsWith('image/')) return { ok: false }

    const buf = Buffer.from(resp.data)
    const dim = parseImageDimensions(buf)
    if (dim) return { ok: true, width: dim.width, height: dim.height }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/**
 * Fetch game banner from Steam store
 */
export async function fetchSteamBanner(title: string): Promise<string | null> {
  const normalizeKey = (s: string) => String(s || '').trim().toLowerCase().slice(0, 240)
  const cacheKey = normalizeKey(title)
  const TTL_MS = 24 * 60 * 60 * 1000
  const cache = getBannerCache()
  const inFlight = getBannerInFlight()

  try {
    if (cacheKey) {
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < TTL_MS) return hit.url
      const pending = inFlight.get(cacheKey)
      if (pending) return await pending
    }

    const work = (async () => {
      const normalize = (s: string) =>
        (s || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[^a-z0-9 ]/g, '')
          .trim()

      const scoreNameMatch = (candidate: string, query: string) => {
        const a = normalize(candidate)
        const b = normalize(query)
        if (!a || !b) return 0
        if (a === b) return 1000
        if (a.includes(b)) return 700
        if (b.includes(a)) return 650
        const aTokens = new Set(a.split(' ').filter(Boolean))
        const bTokens = new Set(b.split(' ').filter(Boolean))
        let overlap = 0
        for (const t of aTokens) if (bTokens.has(t)) overlap++
        return overlap * 50
      }

      const query = encodeURIComponent(title)
      const searchUrl = `https://store.steampowered.com/api/storesearch?term=${query}&l=english&cc=us`
      const resp = await axios.get(searchUrl, { timeout: 8000 })
      const items = (resp.data?.items || []) as Array<{ id: number; name?: string; tiny_image?: string }>
      const best = items
        .map((it) => ({ it, score: scoreNameMatch(it.name || String(it.id), title) }))
        .sort((a, b) => b.score - a.score)[0]?.it
      const appid = best?.id ?? null
      if (!appid) return null

      // Prefer Steam's appdetails for known-good image URLs when available
      let appDetails: any = null
      try {
        const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
        const d = await axios.get(detailsUrl, { timeout: 8000 })
        appDetails = d.data?.[String(appid)]?.data || null
      } catch {
        // ignore
      }

      const candidates: string[] = []

      // Priority 1: Vertical covers (3:4 aspect ratio) - best for library cards
      candidates.push(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_capsule.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_capsule_2x.jpg`
      )

      // Priority 2: Other library assets
      candidates.push(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`
      )

      // Priority 3: Horizontal covers (fallback)
      candidates.push(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
      )

      // appdetails-provided URLs
      if (appDetails?.header_image) candidates.push(String(appDetails.header_image))
      if (appDetails?.capsule_image) candidates.push(String(appDetails.capsule_image))
      if (appDetails?.capsule_imagev5) candidates.push(String(appDetails.capsule_imagev5))

      // storesearch-provided tiny_image as last resort
      if (best?.tiny_image) candidates.push(String(best.tiny_image))

      const targetAspect = 3 / 4

      const seen = new Set<string>()
      const valid: Array<{ url: string; width?: number; height?: number; diff?: number; area?: number }> = []

      for (const url of candidates) {
        if (!url) continue
        if (seen.has(url)) continue
        seen.add(url)

        const probe = await fetchImageProbe(url)
        if (!probe.ok) continue

        const width = probe.width
        const height = probe.height
        const area = width && height ? width * height : undefined
        const diff = width && height ? Math.abs(width / height - targetAspect) : undefined
        valid.push({ url, width, height, diff, area })

        // Early stop: we already have a near-perfect match
        if (diff != null && diff <= 0.08 && (area || 0) >= 200 * 260) {
          if (valid.length >= 4) break
        }
      }

      const withDims = valid.filter(v => typeof v.diff === 'number' && typeof v.area === 'number') as Array<{ url: string; diff: number; area: number }>
      if (withDims.length > 0) {
        withDims.sort((a, b) => (a.diff - b.diff) || (b.area - a.area))
        return withDims[0].url
      }

      // Fallback: any image that returns image/*
      if (valid[0]?.url) return valid[0].url

      return null
    })()

    if (cacheKey) inFlight.set(cacheKey, work)
    const result = await work
    if (cacheKey) {
      inFlight.delete(cacheKey)
      cache.set(cacheKey, { at: Date.now(), url: result })
    }
    return result
  } catch (err) {
    if (cacheKey) {
      try { inFlight.delete(cacheKey) } catch {}
    }
    console.warn('[Artwork] Failed to fetch banner from Steam:', err)
    return null
  }
}

/**
 * Fetch and persist banner for a game
 */
export async function fetchAndPersistBanner(gameUrl: string, title: string): Promise<void> {
  try {
    const banner = await fetchSteamBanner(title || gameUrl)
    if (banner) {
      updateGameInfo(gameUrl, { image_url: banner })
    }
  } catch (err) {
    console.warn('[Artwork] Failed to auto-fetch banner:', err)
  }
}
