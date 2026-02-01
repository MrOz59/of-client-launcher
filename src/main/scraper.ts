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
    'Версия',           // Short Russian
    'Version',          // Short English
  ]

  // Get text from body for searching
  const allText = $('body').text()

  // Strategy 1a: Search for version labels with various separators
  for (const label of versionLabels) {
    // Pattern: "Label: Value" or "Label Value" where Value can be Build XXXXX, vX.X.X, X.X.X, etc.
    const labelPattern = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + // escape special chars
      '[:\\s]*' + // optional colon or whitespace
      '((?:Build[.\\s_]*)?[vV]?[0-9][0-9a-zA-Z._-]*)', // version value
      'i'
    )
    const match = allText.match(labelPattern)
    if (match && match[1]) {
      const version = match[1].trim()
      // Validate it looks like a version (has at least one digit and isn't too short)
      if (version.length >= 3 && /\d/.test(version)) {
        console.log(`[Scraper] Found version via label "${label}":`, version)
        return version
      }
    }
  }

  // Strategy 1b: Look for version info in specific HTML elements (more targeted)
  const versionSelectors = [
    '.game-info .version',
    '.game-version',
    '[class*="version"]',
    '.full-story-content b',
    '.full-story-content strong',
    '#dle-content b',
    '#dle-content strong'
  ]

  for (const selector of versionSelectors) {
    let foundVersion: string | null = null
    $(selector).each((_, el) => {
      const text = $(el).text().trim()
      // Check if this element contains version info
      for (const label of versionLabels) {
        if (text.toLowerCase().includes(label.toLowerCase())) {
          const pattern = new RegExp(
            label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '[:\\s]*([^\\s,;]+)',
            'i'
          )
          const m = text.match(pattern)
          if (m && m[1] && m[1].length >= 3 && /\d/.test(m[1])) {
            console.log(`[Scraper] Found version in element "${selector}":`, m[1])
            foundVersion = m[1]
            return false // break out of .each()
          }
        }
      }
    })
    if (foundVersion) return foundVersion
  }

  // Strategy 2: Look for common version patterns in the page text
  const patterns = [
    // Build format: Build 04122025, Build.04122025, Build_18012025
    /\b(Build[.\s_]*\d{6,10})\b/i,
    // Full semantic versioning: v1.2.3.4, 1.2.3.4567
    /\bv?(\d+\.\d+\.\d+(?:\.\d+)?)\b/,
    // Two-part with v prefix: v1.23
    /\b(v\d+\.\d+)\b/i,
    // Date-based versions: 2024.12.04, 2024-12-04
    /\b(20\d{2}[.\-]\d{2}[.\-]\d{2})\b/,
    // Date-based reversed: 04.12.2024
    /\b(\d{2}[.\-]\d{2}[.\-]20\d{2})\b/,
  ]

  for (const p of patterns) {
    const m = allText.match(p)
    if (m && m[1]) {
      const version = m[1].trim()
      // Extra validation to avoid false positives
      if (version.length >= 3) {
        console.log('[Scraper] Found version via pattern:', version)
        return version
      }
    }
  }

  // Strategy 3: Look for version in the torrent/download link text or filename
  const downloadLinks = $('a[href*=".torrent"], a[href*="download"], a[href*="magnet"]')
  let linkVersion: string | null = null
  downloadLinks.each((_, el) => {
    const href = $(el).attr('href') || ''
    const linkText = $(el).text().trim()

    // Try to extract version from link text or href
    for (const p of patterns) {
      const m = (linkText + ' ' + href).match(p)
      if (m && m[1] && m[1].length >= 3) {
        console.log('[Scraper] Found version in download link:', m[1])
        linkVersion = m[1]
        return false // break out of .each()
      }
    }
  })
  if (linkVersion) return linkVersion

  // Strategy 4: Check meta tags
  const metaDescription = $('meta[name="description"]').attr('content') || ''
  const ogDescription = $('meta[property="og:description"]').attr('content') || ''
  const metaContent = metaDescription + ' ' + ogDescription

  for (const p of patterns) {
    const m = metaContent.match(p)
    if (m && m[1] && m[1].length >= 3) {
      console.log('[Scraper] Found version in meta tags:', m[1])
      return m[1]
    }
  }

  console.log('[Scraper] No version found in page')
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
