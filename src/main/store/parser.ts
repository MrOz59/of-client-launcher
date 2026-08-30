import * as cheerio from 'cheerio'

/**
 * Parser for the store's HTML.
 *
 * Keyed on structure that survives a template change: article URLs on DLE are
 * always `/<id>-<slug>.html`, so links are found by URL shape and the title,
 * cover and date are read from around them. The existing scraper and the
 * injected store script instead walk positional chains such as
 * `div:nth-child(21) > a:nth-child(13)` — one extra wrapper in the template and
 * they silently find nothing.
 *
 * No Electron imports here: this module is plain Node so it can be tested
 * against saved fixtures.
 */

const ARTICLE_PATH = /\/(\d+)-[^/]*\.html$/i

/** Blocks whose links are never catalogue entries. */
const IGNORED_CONTAINERS = [
  '#dle-comments',
  '.comments',
  '.speedbar',
  'nav',
  'footer',
  '.footer',
  '.related',
  '.sidebar'
].join(', ')

export type StoreListingItem = {
  id: string
  url: string
  title: string
  imageUrl?: string
  publishedAt?: string
}

export type StoreListing = {
  items: StoreListingItem[]
  nextPageUrl?: string
}

export type StoreGameDetails = {
  url: string
  title: string
  version?: string
  imageUrl?: string
  description?: string
}

function absoluteUrl(href: string | undefined, baseUrl: string): string | null {
  const value = String(href || '').trim()
  if (!value || value.startsWith('#') || value.startsWith('javascript:')) return null
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}

function cleanText(value: string | undefined | null): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/** Lazy-loading templates keep the real cover in a data attribute. */
function imageFrom($: cheerio.CheerioAPI, el: any, baseUrl: string): string | undefined {
  const img = $(el).is('img') ? $(el) : $(el).find('img').first()
  if (img.length === 0) return undefined

  const candidates = [
    img.attr('data-src'),
    img.attr('data-original'),
    img.attr('data-lazy-src'),
    img.attr('src'),
    (img.attr('srcset') || '').split(',')[0]?.trim().split(' ')[0]
  ]

  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, baseUrl)
    if (url && !/^data:/i.test(url)) return url
  }

  return undefined
}

function dateFrom($: cheerio.CheerioAPI, container: any): string | undefined {
  const time = $(container).find('time[datetime]').first().attr('datetime')
  if (time) return cleanText(time)

  const text = cleanText($(container).find('.date, .short-date, .news-date').first().text())
  return text || undefined
}

/**
 * Catalogue entries on a listing page. Anchors pointing at the same article are
 * merged: DLE renders the cover and the title as separate links.
 */
export function parseListing(html: string, baseUrl: string): StoreListing {
  const $ = cheerio.load(html)
  const items = new Map<string, StoreListingItem>()

  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    if (anchor.closest(IGNORED_CONTAINERS).length > 0) return

    const url = absoluteUrl(anchor.attr('href'), baseUrl)
    if (!url) return

    let pathname: string
    try {
      pathname = new URL(url).pathname
    } catch {
      return
    }

    const match = pathname.match(ARTICLE_PATH)
    if (!match) return

    const id = match[1]
    const existing = items.get(id)

    // The cover link has no text, the title link has no image: merge both.
    const title = cleanText(anchor.attr('title') || anchor.text() || anchor.find('img').attr('alt'))
    const container = anchor.closest('article, .short-story, .shortstory, li, .item').get(0) || anchor.get(0)
    const imageUrl = imageFrom($, anchor.get(0), baseUrl) || imageFrom($, container, baseUrl)
    const publishedAt = container ? dateFrom($, container) : undefined

    if (!existing) {
      items.set(id, { id, url, title, imageUrl, publishedAt })
      return
    }

    if (title.length > existing.title.length) existing.title = title
    if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl
    if (!existing.publishedAt && publishedAt) existing.publishedAt = publishedAt
  })

  return {
    items: Array.from(items.values()).filter((item) => item.title.length > 1),
    nextPageUrl: findNextPage($, baseUrl)
  }
}

function findNextPage($: cheerio.CheerioAPI, baseUrl: string): string | undefined {
  const explicit = $('a[rel="next"], .pnext a, a.pnext, .next a, a.next').first().attr('href')
  const fromExplicit = absoluteUrl(explicit, baseUrl)
  if (fromExplicit) return fromExplicit

  // Otherwise take the nearest /page/N/ link above the current page.
  const currentPage = pageNumberOf(baseUrl) ?? 1
  const candidates: Array<{ page: number; url: string }> = []

  $('a[href*="/page/"]').each((_index, element) => {
    const url = absoluteUrl($(element).attr('href'), baseUrl)
    const page = url ? pageNumberOf(url) : null
    if (!url || page === null || page <= currentPage) return
    candidates.push({ page, url })
  })

  candidates.sort((a, b) => a.page - b.page)
  return candidates[0]?.url
}

function pageNumberOf(url: string): number | null {
  const match = String(url).match(/\/page\/(\d+)/)
  return match ? Number(match[1]) : null
}

/** Details for a single game page. Version labels are matched by text. */
export function parseGamePage(html: string, url: string): StoreGameDetails {
  const $ = cheerio.load(html)

  const title = cleanText(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text()
  )

  const imageUrl =
    absoluteUrl($('meta[property="og:image"]').attr('content'), url) ||
    imageFrom($, $('.full-story-content, article, #dle-content').get(0), url)

  const description = cleanText($('meta[property="og:description"]').attr('content')).slice(0, 600) || undefined

  return { url, title, version: findVersion($), imageUrl, description }
}

/**
 * The page states the version as a labelled line ("Версия игры: 1.0.266"), which
 * is far more stable than the element it happens to sit in.
 */
export function findVersion($: cheerio.CheerioAPI): string | undefined {
  const labels = [/Версия\s+игры\s*:?\s*([^\s<,;]+)/i, /Game\s+version\s*:?\s*([^\s<,;]+)/i, /\bv?(\d+\.\d+[\w.\-]*)\b/]

  const scopeText = cleanText($('.full-story-content, article, #dle-content').first().text())
  for (const label of labels.slice(0, 2)) {
    const match = scopeText.match(label)
    if (match?.[1]) return match[1].trim()
  }

  // Last resort: a version-looking token next to a "version" word.
  const near = scopeText.match(/(верси|version)[^\d]{0,20}(\d+\.[\w.\-]+)/i)
  return near?.[2]
}
