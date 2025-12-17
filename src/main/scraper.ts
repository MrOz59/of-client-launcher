import axios from 'axios'
import * as cheerio from 'cheerio'
import { session } from 'electron'
import { getCookieHeaderForUrl } from './cookieManager'

function cookiesToHeader(cookies: Electron.Cookie[]) {
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return header
}

function decodeHtmlResponse(resp: any): string {
  const buffer = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || '')

  // Default decode as UTF-8
  let html = buffer.toString('utf8')

  // Try to detect charset from headers or meta tags
  const contentType = resp?.headers?.['content-type'] as string | undefined
  let charset: string | null = null
  if (contentType) {
    const match = contentType.match(/charset=([^;]+)/i)
    if (match) charset = match[1].trim().toLowerCase()
  }
  if (!charset) {
    const metaMatch = html.match(/charset=["']?([\w-]+)["']?/i)
    if (metaMatch) charset = metaMatch[1].toLowerCase()
  }

  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      html = new TextDecoder(charset as any).decode(buffer)
    } catch (err) {
      console.warn('[Scraper] Failed to decode with charset', charset, err)
    }
  }

  return html
}

/**
 * Clean game title by removing unwanted suffixes like "по сети"
 */
function cleanGameTitle(title: string): string {
  return title
    .replace(/\s*по сети\s*/gi, '')  // Remove "по сети" (Russian for "online")
    .replace(/\s*online\s*$/gi, '')   // Remove trailing "online"
    .replace(/\uFFFD/g, '')           // Remove replacement characters from bad decoding
    .replace(/\s+/g, ' ')             // Normalize spaces
    .trim()
}

/**
 * Extract game title from HTML
 * Tries multiple selectors in order of preference
 */
export function extractTitleFromHtml(html: string): string | null {
  const $ = cheerio.load(html)

  // Try #news-title first (main title element)
  const newsTitle = $('#news-title').text().trim()
  if (newsTitle) {
    const cleaned = cleanGameTitle(newsTitle)
    if (cleaned) {
      console.log('[Scraper] Found title from #news-title:', cleaned)
      return cleaned
    }
  }

  // Try alternative selector: game name link
  const altSelector = '#dle-content > div > article > div.full-story-content > div:nth-child(3) > a:nth-child(9)'
  const altTitle = $(altSelector).text().trim()
  if (altTitle) {
    const cleaned = cleanGameTitle(altTitle)
    if (cleaned) {
      console.log('[Scraper] Found title from alternative selector:', cleaned)
      return cleaned
    }
  }

  // Try the article title
  const articleTitle = $('article h1').first().text().trim()
  if (articleTitle) {
    const cleaned = cleanGameTitle(articleTitle)
    if (cleaned) {
      console.log('[Scraper] Found title from article h1:', cleaned)
      return cleaned
    }
  }

  // Try meta title
  const metaTitle = $('meta[property="og:title"]').attr('content')
  if (metaTitle) {
    const cleaned = cleanGameTitle(metaTitle)
    if (cleaned) {
      console.log('[Scraper] Found title from og:title:', cleaned)
      return cleaned
    }
  }

  return null
}

export function extractVersionFromHtml(html: string): string | null {
  const $ = cheerio.load(html)

  // Strategy 1: Find elements containing version labels and extract the value
  // This is more robust than fixed CSS selectors since it searches by content
  const versionLabels = [
    'Версия игры',      // Russian original
    'Game version',     // English translation
    'Versão do jogo',   // Portuguese translation
    'Versión del juego', // Spanish translation
    'Version du jeu',   // French translation
  ]

  // Search for elements containing version labels
  const allText = $('body').text()
  for (const label of versionLabels) {
    // Pattern: "Label: Value" where Value can be Build XXXXX, vX.X.X, X.X.X, etc.
    const labelPattern = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + // escape special chars
      '[:\\s]+' + // colon or whitespace
      '((?:Build\\s*)?[vV]?[0-9][0-9a-zA-Z._-]*)', // version value
      'i'
    )
    const match = allText.match(labelPattern)
    if (match && match[1]) {
      const version = match[1].trim()
      console.log(`[Scraper] Found version via label "${label}":`, version)
      return version
    }
  }

  // Strategy 2: Look for common version patterns in the page
  const patterns = [
    // Build format: Build 04122025, Build.04122025
    /\b(Build[.\s]*\d{6,10})\b/i,
    // Semantic versioning: v1.2.3, 1.2.3.4
    /\bv?([0-9]+\.[0-9]+(?:\.[0-9]+){1,3})\b/i,
    // Date-based: 2024.12.04, 04.12.2024
    /\b(\d{2,4}[.-]\d{2}[.-]\d{2,4})\b/,
  ]

  for (const p of patterns) {
    const m = allText.match(p)
    if (m && m[1]) {
      console.log('[Scraper] Found version via pattern:', m[1])
      return m[1]
    }
  }

  return null
}

/**
 * Scrape game info (title and version) from a game page URL
 */
export async function scrapeGameInfo(url: string): Promise<{ title: string | null; version: string | null }> {
  console.log('[Scraper] Scraping game info from:', url)
  try {
    const cookieHeader = await getCookieHeaderForUrl(url)

    const resp = await axios.get(url, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      responseType: 'arraybuffer'
    })

    const html = decodeHtmlResponse(resp)
    const title = extractTitleFromHtml(html)
    const version = extractVersionFromHtml(html)

    console.log('[Scraper] Scraped title:', title)
    console.log('[Scraper] Scraped version:', version)

    return { title, version }
  } catch (err: any) {
    console.warn('[Scraper] Failed to scrape game info:', err.message)
    return { title: null, version: null }
  }
}

function absolutizeUrl(href: string, base: string): string {
  try {
    // Handle protocol-relative
    if (href.startsWith('//')) return `https:${href}`
    const u = new URL(href, base)
    return u.toString()
  } catch {
    return href
  }
}

function extractTorrentLink($: cheerio.CheerioAPI, pageUrl: string): string | null {
  // Prefer direct torrent links
  const candidates = $('a[href$=".torrent"], a[href*="/torrents/"]')
  for (let i = 0; i < candidates.length; i++) {
    const href = candidates.eq(i).attr('href')
    if (href) {
      return absolutizeUrl(href, pageUrl)
    }
  }
  return null
}

export async function fetchGameUpdateInfo(url: string): Promise<{ version: string | null; torrentUrl: string | null }> {
  const cookieHeader = await getCookieHeaderForUrl(url)

  // Retrieve page with cookies to authorize
  const resp = await axios.get(url, {
    headers: {
      Cookie: cookieHeader,
      'User-Agent': 'OF-Client/0.1'
    },
    responseType: 'arraybuffer'
  })

  const html = decodeHtmlResponse(resp)
  const $ = cheerio.load(html)
  const parsed = extractVersionFromHtml(html)
  const torrentUrl = extractTorrentLink($, url)
  return { version: parsed, torrentUrl }
}

export async function checkGameVersion(url: string): Promise<string> {
  const info = await fetchGameUpdateInfo(url)
  if (info.version) return info.version
  throw new Error('Versao nao encontrada na pagina')
}

function absolutize(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

async function fetchImageData(url: string, cookieHeader: string): Promise<string | null> {
  try {
    const resp = await axios.get(url, {
      headers: { Cookie: cookieHeader, 'User-Agent': 'OF-Client/0.1' },
      responseType: 'arraybuffer'
    })
    const mime = resp.headers['content-type'] || 'image/jpeg'
    const base64 = Buffer.from(resp.data as any).toString('base64')
    return `data:${mime};base64,${base64}`
  } catch (err) {
    console.warn('[Scraper] Failed to fetch avatar image', err)
    return null
  }
}

export async function fetchUserProfile(): Promise<{ name: string | null; avatar: string | null; avatarData?: string | null; profileUrl?: string | null }> {
  try {
    const url = 'https://online-fix.me/'
    const cookieHeader = await getCookieHeaderForUrl(url)
    const resp = await axios.get(url, {
      headers: { Cookie: cookieHeader, 'User-Agent': 'OF-Client/0.1' },
      responseType: 'arraybuffer'
    })
    const html = decodeHtmlResponse(resp)
    const $ = cheerio.load(html)
    const linkSel = 'body > header > div.top-panel-wrapper > div > div.user-panel.right.clr > div > a'
    const name = $(linkSel).text().trim() || null
    const avatarSel = 'body > header > div.top-panel-wrapper > div > div.user-panel.right.clr > div > a > img'
    const avatarRaw = $(avatarSel).attr('src') || null
    const avatar = absolutize(avatarRaw, url)
    const avatarData = avatar ? await fetchImageData(avatar, cookieHeader) : null
    const profileUrl = absolutize($(linkSel).attr('href'), url)
    return { name, avatar, avatarData, profileUrl }
  } catch (err) {
    console.warn('[Scraper] Failed to fetch user profile', err)
    return { name: null, avatar: null, avatarData: null, profileUrl: null }
  }
}
