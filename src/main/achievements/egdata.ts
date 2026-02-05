/**
 * Epic Games achievements importer via egdata.app web scraping
 * Based on the Python implementation from the old launcher
 */

import { load } from 'cheerio'
import type { AchievementSchemaItem } from './schema'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const EGDATA_REQUEST_TIMEOUT = 20000 // 20 seconds

interface RawAchievement {
  title: string
  description?: string
  percent?: number
  locked?: boolean
}

/**
 * Resolve Epic Offer ID from various possible IDs
 * Heuristic scoring system to find the most likely Offer ID
 */
function resolveEpicOfferId(candidates: string[]): string | null {
  const scored: Array<[number, string]> = []

  for (const c of candidates) {
    if (!c || c.length < 8) continue
    if (c.includes(' ')) continue

    let score = 0

    // Hexadecimal hash (likely offer ID)
    if (/^[0-9a-f]{32,}$/i.test(c)) {
      score += 3
    }

    // Has uppercase letters
    if (/[A-Z]/.test(c)) {
      score += 1
    }

    // Has dashes (could be UUID)
    if (c.includes('-')) {
      score += 1
    }

    scored.push([score, c])
  }

  if (scored.length === 0) return null

  // Sort by score descending
  scored.sort((a, b) => b[0] - a[0])
  return scored[0][1]
}

/**
 * Extract text content from HTML string, removing tags
 */
function extractText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Try to extract achievements from embedded JSON in script tags
 */
function extractJsonEmbedded(html: string): RawAchievement[] {
  const results: RawAchievement[] = []
  const scriptMatches = html.matchAll(/<script[^>]*>(.*?)<\/script>/gis)

  for (const match of scriptMatches) {
    const content = match[1]
    if (!/achievement/i.test(content)) continue

    // Find JSON arrays
    const jsonArrays = content.match(/\[\s*\{.*?\}\s*\]/gs)
    if (!jsonArrays) continue

    for (const jsonStr of jsonArrays) {
      try {
        const data = JSON.parse(jsonStr)
        if (!Array.isArray(data)) continue

        for (const obj of data) {
          const title = obj.title || obj.name
          const desc = obj.description
          const percent = obj.percent

          if (title && typeof title === 'string') {
            results.push({
              title: String(title).trim(),
              description: desc ? String(desc).trim() : undefined,
              percent: percent != null ? Number(percent) : undefined
            })
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  return results
}

/**
 * Split HTML into blocks starting with h3/h4 headers
 */
function* iterH3Blocks(html: string): Generator<string> {
  const parts = html.split(/(<h[34][^>]*>.*?<\/h[34]>)/i)

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]
    const after = i + 1 < parts.length ? parts[i + 1] : ''
    yield header + after
  }
}

/**
 * Heuristic parsing of achievements from HTML structure
 */
function parseAchievementsHeuristic(html: string): RawAchievement[] {
  const results: RawAchievement[] = []

  for (const block of iterH3Blocks(html)) {
    // Extract title from h3/h4
    const headerMatch = block.match(/<h[34][^>]*>(.*?)<\/h[34]>/i)
    if (!headerMatch) continue

    const title = extractText(headerMatch[1])
    if (!title) continue

    // Get text after header
    const afterHeader = block.slice(headerMatch[0].length)
    const tailText = extractText(afterHeader)

    // Extract description (sentence before percentage)
    let description: string | undefined
    const candidates = tailText.split(/[.;]\s+|\n+/)
    for (const c of candidates) {
      const clean = c.trim()
      if (clean && !clean.includes('%') && !/locked/i.test(clean)) {
        description = clean
        break
      }
    }

    // Extract percentage: "89.5% unlocked"
    let percent: number | undefined
    const percentMatch = tailText.match(/(\d+(?:[.,]\d+)?)\s*%\s*unlocked/i)
    if (percentMatch) {
      percent = parseFloat(percentMatch[1].replace(',', '.'))
    }

    // Detect if locked
    const locked = /\blocked\b/i.test(tailText)

    results.push({
      title,
      description,
      percent,
      locked
    })
  }

  return results
}

/**
 * Filter out garbage from scraped achievements
 */
function filterAchievements(raws: RawAchievement[]): RawAchievement[] {
  const skipPatterns = [
    /^deep silver/i,
    /^base game achievements$/i,
    /^offer id /i,
    /^overview$/i,
    /^cookie preferences/i,
    /^filter /i,
    /^sort by /i,
    /^page \d+/i
  ]

  return raws.filter((r) => {
    // Skip garbage patterns
    if (skipPatterns.some((p) => p.test(r.title))) {
      return false
    }

    // Skip very long titles without percentage
    if (r.title.length > 80 && r.percent == null) {
      return false
    }

    // Skip very long descriptions without percentage (likely page text)
    if (r.description && r.description.length > 220 && r.percent == null) {
      return false
    }

    return true
  })
}

/**
 * Deduplicate achievements by title
 */
function deduplicateAchievements(items: RawAchievement[]): RawAchievement[] {
  const seen = new Map<string, RawAchievement>()

  for (const item of items) {
    const key = item.title.toLowerCase().trim()
    const existing = seen.get(key)

    // Prefer entries with more data
    if (!existing || (existing.percent == null && item.percent != null)) {
      seen.set(key, item)
    }
  }

  return Array.from(seen.values())
}

/**
 * Convert raw achievement to schema item
 */
function rawToSchemaItem(raw: RawAchievement): AchievementSchemaItem {
  // Generate ID from title
  const id = raw.title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return {
    id: id || crypto.randomBytes(8).toString('hex').toUpperCase(),
    name: raw.title,
    description: raw.description,
    percent: raw.percent,
    hidden: raw.locked
  }
}

/**
 * Fetch achievements from egdata.app by Offer ID
 */
export async function fetchEgdataAchievements(offerId: string): Promise<AchievementSchemaItem[]> {
  const cleanId = String(offerId || '').trim()
  if (!cleanId) {
    throw new Error('Offer ID is required')
  }

  const url = `https://egdata.app/offers/${encodeURIComponent(cleanId)}/achievements`

  console.log(`[egdata] Fetching achievements for offer: ${cleanId}`)
  console.log(`[egdata] URL: ${url}`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), EGDATA_REQUEST_TIMEOUT)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VoidLauncher/1.0 (+linux; achievements module)'
      }
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()

    console.log(`[egdata] Downloaded ${html.length} bytes`)

    // Try JSON extraction first
    let raws = extractJsonEmbedded(html)
    console.log(`[egdata] JSON extraction found ${raws.length} achievements`)

    // Fallback to heuristic parsing
    if (raws.length === 0) {
      console.log('[egdata] Falling back to heuristic HTML parsing')
      raws = parseAchievementsHeuristic(html)
      console.log(`[egdata] Heuristic parsing found ${raws.length} achievements`)
    }

    // Filter garbage
    const filtered = filterAchievements(raws)
    console.log(`[egdata] After filtering: ${filtered.length} achievements`)

    // Deduplicate
    const deduped = deduplicateAchievements(filtered)
    console.log(`[egdata] After deduplication: ${deduped.length} achievements`)

    // Save HTML for debugging if no achievements found
    if (deduped.length === 0) {
      try {
        const debugPath = path.join(app.getPath('temp'), 'egdata_last_raw.html')
        fs.writeFileSync(debugPath, html, 'utf8')
        console.log(`[egdata] No achievements found. Saved HTML to: ${debugPath}`)
      } catch (err) {
        console.warn('[egdata] Failed to save debug HTML:', err)
      }
    }

    // Convert to schema items
    return deduped.map(rawToSchemaItem)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${EGDATA_REQUEST_TIMEOUT}ms`)
    }
    throw err
  }
}

/**
 * Import Epic achievements for a game
 * Tries to resolve Offer ID from various external IDs
 */
export async function importEpicAchievements(externalIds: Record<string, string>): Promise<AchievementSchemaItem[]> {
  // Priority order for resolution
  const manualId = externalIds.epic_manual
  if (manualId) {
    console.log(`[egdata] Using manual Epic ID: ${manualId}`)
    return fetchEgdataAchievements(manualId)
  }

  // Try direct offer ID
  let offerId = externalIds.epic || externalIds.epic_offer
  if (offerId) {
    console.log(`[egdata] Using direct Offer ID: ${offerId}`)
    return fetchEgdataAchievements(offerId)
  }

  // Try to resolve from other IDs
  const candidates = [
    externalIds.epic_product,
    externalIds.epic_sandbox,
    externalIds.epic_namespace,
    externalIds.epic_catalog_item
  ].filter((id): id is string => Boolean(id))

  if (candidates.length > 0) {
    console.log(`[egdata] Attempting to resolve Offer ID from candidates:`, candidates)
    const resolved = resolveEpicOfferId(candidates)

    if (resolved) {
      console.log(`[egdata] Resolved Offer ID: ${resolved}`)
      return fetchEgdataAchievements(resolved)
    }
  }

  throw new Error('No Epic Offer ID found. Please provide epic_manual, epic, or epic_offer ID.')
}
