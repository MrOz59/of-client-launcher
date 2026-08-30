import * as cheerio from 'cheerio'
import { isOnlineFixHost } from '../../shared/allowedHosts'

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
  '.sidebar',
  // Live chat widget: it quotes article links that are not catalogue entries.
  '.lc_area',
  '#lc_chat',
  '.lc_chat_list_area',
  // "Top games" widget: its links carry the date glued to the title.
  '.game-rating',
  '.games-cont'
].join(', ')

/** Cards of the main listing, newest first. */
const CARD_SELECTOR = 'div.article, article.article, .short-story, .shortstory'

const DATE_LINK = /\/\d{4}\/\d{2}\/\d{2}\//

export type StoreListingItem = {
  id: string
  url: string
  title: string
  imageUrl?: string
  publishedAt?: string
  /** The site marks re-uploads ("Обновлено …"), which matter more than the original date. */
  updatedAt?: string
}

export type StoreListing = {
  items: StoreListingItem[]
  nextPageUrl?: string
}

export type StoreGameDetails = {
  url: string
  title: string
  version?: string
  /** The article has no poster of its own — this is the trailer thumbnail. */
  imageUrl?: string
  videoUrl?: string
  releaseDate?: string
  /** Ready for the existing download flow. */
  torrentUrl?: string
  /** "Fix from the server": a direct file, not a torrent. */
  directUrl?: string
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

/**
 * Catalogue entries on a listing page.
 *
 * Cards first: the listing renders each game as a block holding the cover, an
 * `h2.title` and a date link, which gives clean fields. Pages that do not use
 * that shape (search results, category pages of other templates) fall back to
 * scanning links by URL shape and merging the anchors that point at the same
 * article.
 */
export function parseListing(html: string, baseUrl: string): StoreListing {
  const $ = cheerio.load(html)
  const fromCards = parseCards($, baseUrl)
  const items = fromCards.length > 0 ? fromCards : parseLooseLinks($, baseUrl)

  return {
    items: items.filter((item) => item.title.length > 1),
    nextPageUrl: findNextPage($, baseUrl)
  }
}

function articleUrlWithin($: cheerio.CheerioAPI, card: any, baseUrl: string): { id: string; url: string } | null {
  let found: { id: string; url: string } | null = null

  $(card).find('a[href]').each((_index, element) => {
    if (found) return
    const url = absoluteUrl($(element).attr('href'), baseUrl)
    if (!url) return
    try {
      const match = new URL(url).pathname.match(ARTICLE_PATH)
      if (match) found = { id: match[1], url }
    } catch {
      // Not a usable URL.
    }
  })

  return found
}

function parseCards($: cheerio.CheerioAPI, baseUrl: string): StoreListingItem[] {
  const items = new Map<string, StoreListingItem>()

  $(CARD_SELECTOR).each((_index, card) => {
    if ($(card).closest(IGNORED_CONTAINERS).length > 0) return

    const article = articleUrlWithin($, card, baseUrl)
    if (!article || items.has(article.id)) return

    // The heading is the reliable source; when a template has none, take the
    // fullest of what is left instead of dropping the card.
    const heading = cleanText($(card).find('h1, h2, h3, .title').first().text())
    const fallbacks = [
      cleanText($(card).find('a[title]').first().attr('title')),
      cleanText($(card).find('img[alt]').first().attr('alt')),
      cleanText($(card).find('a[href]').filter((_i, a) => cleanText($(a).text()).length > 1).first().text())
    ].sort((a, b) => b.length - a.length)
    const title = heading || fallbacks[0] || ''

    items.set(article.id, {
      id: article.id,
      url: article.url,
      title,
      imageUrl: imageFrom($, card, baseUrl),
      publishedAt: publishedFrom($, card),
      updatedAt: updatedFrom($, card)
    })
  })

  return Array.from(items.values())
}

/**
 * The date sits in a link to the day's archive (/YYYY/MM/DD/). The panel around
 * it also holds view and comment counters, so read the link rather than the
 * whole panel text.
 */
function publishedFrom($: cheerio.CheerioAPI, card: any): string | undefined {
  const timeAttr = $(card).find('time[datetime]').first().attr('datetime')
  if (timeAttr) return cleanText(timeAttr)

  let fromLink: string | undefined
  $(card).find('a[href]').each((_index, element) => {
    if (fromLink) return
    const href = String($(element).attr('href') || '')
    if (DATE_LINK.test(href)) fromLink = cleanText($(element).text())
  })
  if (fromLink) return fromLink

  const panel = cleanText($(card).find('.info-date, .date, .short-date, .news-date').first().text())
  // Strip the counters that follow the date in the same element.
  const trimmed = panel.match(/^(.*?\d{1,2}:\d{2})/)?.[1] || panel.split(/\s{2,}/)[0]
  return trimmed || undefined
}

function updatedFrom($: cheerio.CheerioAPI, card: any): string | undefined {
  const text = cleanText($(card).find('.edit, .updated').first().text())
  if (!text) return undefined
  // "Обновлено 15 августа 2026, 12:35. Игра о…" — keep the date, drop the prose.
  const match = text.match(/^([^.]*?\d{1,2}:\d{2})/)
  return (match?.[1] || text).slice(0, 80)
}

function parseLooseLinks($: cheerio.CheerioAPI, baseUrl: string): StoreListingItem[] {
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
    const title = cleanText(anchor.attr('title') || anchor.find('img').attr('alt') || anchor.text())
    const container = anchor.closest('article, .short-story, .shortstory, li, .item').get(0) || anchor.get(0)
    const imageUrl = imageFrom($, anchor.get(0), baseUrl) || imageFrom($, container, baseUrl)
    const publishedAt = container ? publishedFrom($, container) : undefined

    if (!existing) {
      items.set(id, { id, url, title, imageUrl, publishedAt })
      return
    }

    if (title.length > existing.title.length) existing.title = title
    if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl
    if (!existing.publishedAt && publishedAt) existing.publishedAt = publishedAt
  })

  return Array.from(items.values())
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

/** Details for a single game page. Everything is matched by label or URL shape. */
export function parseGamePage(html: string, url: string): StoreGameDetails {
  const $ = cheerio.load(html)
  const canonical = absoluteUrl($('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content'), url)
  const downloads = findDownloads($, url)

  return {
    url: canonical || url,
    title: cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text()),
    version: findVersion($),
    imageUrl: absoluteUrl($('meta[property="og:image"]').attr('content'), url) || undefined,
    videoUrl: findVideo($),
    releaseDate: findLabelled($, ['Релиз игры', 'Release date']),
    torrentUrl: downloads.torrentUrl,
    directUrl: downloads.directUrl,
    description: cleanText($('meta[property="og:description"]').attr('content')).slice(0, 600) || undefined
  }
}

/**
 * Download buttons point at the upload host: `/torrents/…` is the torrent the
 * launcher can hand to the download flow, `/uploads/…` is the plain file.
 */
function findDownloads($: cheerio.CheerioAPI, baseUrl: string): { torrentUrl?: string; directUrl?: string } {
  let torrentUrl: string | undefined
  let directUrl: string | undefined

  $('a[href]').each((_index, element) => {
    if (torrentUrl && directUrl) return

    const url = absoluteUrl($(element).attr('href'), baseUrl)
    if (!url) return

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }

    if (!isOnlineFixHost(parsed.hostname)) return

    const isTorrent = parsed.pathname.includes('/torrents/') || parsed.pathname.endsWith('.torrent')
    if (isTorrent && !torrentUrl) torrentUrl = url
    else if (!isTorrent && parsed.pathname.includes('/uploads/') && !directUrl) directUrl = url
  })

  return { torrentUrl, directUrl }
}

/** The article's media is a YouTube trailer; there is no poster to read. */
function findVideo($: cheerio.CheerioAPI): string | undefined {
  const iframe = $('iframe[src*="youtube"], iframe[data-src*="youtube"]').first()
  const fromIframe = iframe.attr('src') || iframe.attr('data-src')
  if (fromIframe) return fromIframe.startsWith('//') ? `https:${fromIframe}` : fromIframe

  const thumb = $('meta[property="og:image"]').attr('content') || ''
  const id = /img\.youtube\.com\/vi\/([\w-]{6,})\//.exec(thumb)?.[1]
  return id ? `https://www.youtube.com/watch?v=${id}` : undefined
}

/** Reads "<label>: <value>" lines, which survive layout changes. */
function findLabelled($: cheerio.CheerioAPI, labels: string[]): string | undefined {
  const text = cleanText($('.full-story-content, article, #dle-content').first().text())

  for (const label of labels) {
    const match = new RegExp(`${label}\\s*:?\\s*([0-9][0-9A-Za-z._/\\-]*)`, 'i').exec(text)
    if (match?.[1]) return match[1]
  }

  return undefined
}

/**
 * The page states the version as a labelled line ("Версия игры: 1.0.266"), which
 * is far more stable than the element it happens to sit in.
 */
export function findVersion($: cheerio.CheerioAPI): string | undefined {
  // Stop at the first character that cannot be part of a version: the page
  // often runs the next word straight into it ("1.0.0Скачать").
  const labels = [/Версия\s+игры\s*:?\s*v?([0-9][0-9A-Za-z._\-]*)/i, /Game\s+version\s*:?\s*v?([0-9][0-9A-Za-z._\-]*)/i]

  const scopeText = cleanText($('.full-story-content, article, #dle-content').first().text())
  for (const label of labels) {
    const match = scopeText.match(label)
    if (match?.[1]) return match[1].trim()
  }

  // Last resort: a version-looking token next to a "version" word.
  const near = scopeText.match(/(верси|version)[^\d]{0,20}(\d+\.[\w.\-]+)/i)
  return near?.[2]
}
