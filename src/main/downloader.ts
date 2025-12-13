import fs from 'fs'
import path from 'path'
import axios from 'axios'
import WebTorrent, { type Torrent as WebTorrentTorrent } from 'webtorrent'
import * as cheerio from 'cheerio'

// Extended Torrent interface with runtime properties
interface Torrent extends WebTorrentTorrent {
  infoHash: string
  downloadSpeed: number
  timeRemaining: number
  pause(): void
  resume(): void
  destroy(): void
}

export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void,
  headers?: Record<string, string>
) {
  const writer = fs.createWriteStream(destPath)
  const res = await axios.get(url, {
    responseType: 'stream',
    headers: headers || {}
  })
  const total = parseInt(res.headers['content-length'] || '0', 10)

  let loaded = 0
  res.data.on('data', (chunk: any) => {
    loaded += chunk.length
    if (onProgress && total > 0) {
      onProgress((loaded / total) * 100)
    }
  })

  await new Promise<void>((resolve, reject) => {
    res.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

/**
 * Scrapes torrent directory page and downloads the .torrent file
 * Example URL: https://uploads.online-fix.me:2053/torrents/Ultimate%20Sheep%20Raccoon/
 */
export async function downloadTorrentFromDirectory(directoryUrl: string, cookieHeader?: string): Promise<string> {
  console.log('[Torrent Downloader] Scraping directory:', directoryUrl)

  // Fetch the directory listing HTML
  const response = await axios.get(directoryUrl, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {}
  })

  const $ = cheerio.load(response.data)

  // Find .torrent file link in the directory listing
  let torrentFileName: string | null = null

  // Try to find <a> tag with .torrent extension
  $('a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && href.endsWith('.torrent')) {
      torrentFileName = href
      return false // break
    }
  })

  if (!torrentFileName) {
    throw new Error('No .torrent file found in directory')
  }

  // Construct full torrent URL
  const torrentUrl = new URL(torrentFileName, directoryUrl).toString()
  console.log('[Torrent Downloader] Found torrent file:', torrentUrl)

  // Download .torrent file to temp directory
  const tempDir = path.join(process.cwd(), 'temp-torrents')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const torrentFilePath = path.join(tempDir, path.basename(torrentFileName))

  await downloadFile(torrentUrl, torrentFilePath)
  console.log('[Torrent Downloader] Downloaded .torrent file to:', torrentFilePath)

  return torrentFilePath
}

export interface TorrentProgress {
  progress: number
  downloadSpeed: number // bytes per second
  downloaded: number
  total: number
  timeRemaining: number // seconds
  infoHash?: string
}

type ActiveTorrent = {
  client: WebTorrent
  torrent?: Torrent
  aliases: Set<string>
  finish?: (err?: Error) => void
}

// Keep track of active torrents for pause/resume/dedupe
const activeTorrents = new Map<string, ActiveTorrent>()

function registerActive(record: ActiveTorrent) {
  for (const key of record.aliases) {
    activeTorrents.set(key, record)
  }
}

function unregisterActive(record: ActiveTorrent) {
  for (const key of record.aliases) {
    activeTorrents.delete(key)
  }
}

function hasActiveAlias(ids: string[]): boolean {
  return ids.some(id => activeTorrents.has(id))
}

export function isTorrentActive(torrentId: string): boolean {
  return activeTorrents.has(torrentId)
}

export function downloadTorrent(
  magnetOrTorrent: string,
  destPath: string,
  onProgress?: (progress: number, details?: TorrentProgress & { infoHash: string }) => void,
  aliases: string[] = [],
  shouldCancel?: () => boolean
) {
  const lookupIds = Array.from(new Set([magnetOrTorrent, ...aliases].filter(Boolean)))
  if (hasActiveAlias(lookupIds)) {
    return Promise.reject(new Error('Torrent already in progress'))
  }

  return new Promise<void>((resolve, reject) => {
    const client = new WebTorrent()
    const record: ActiveTorrent = { client, aliases: new Set(lookupIds) }

    let cleaned = false
    let finished = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      unregisterActive(record)
      record.torrent?.destroy?.()
      client.destroy()
    }
    const finish = (err?: Error) => {
      if (finished) return
      finished = true
      cleanup()
      if (err) reject(err)
      else resolve()
    }
    record.finish = finish

    // Register immediately so parallel starts get blocked even before metadata is ready
    registerActive(record)

    const rejectIfCancelled = () => {
      if (shouldCancel && shouldCancel()) {
        finish(new Error('cancelled'))
        return true
      }
      return false
    }

    client.add(magnetOrTorrent, { path: destPath }, (torrent: WebTorrentTorrent) => {
      // Cast to our extended interface for type safety
      const extendedTorrent = torrent as Torrent
      record.torrent = extendedTorrent

      // Track both infoHash and original aliases to prevent duplicate starts
      record.aliases.add(extendedTorrent.infoHash || magnetOrTorrent)
      registerActive(record)

      torrent.on('download', () => {
        if (rejectIfCancelled()) return
        const progress = (extendedTorrent.downloaded / extendedTorrent.length) * 100
        const details = {
          progress,
          downloadSpeed: extendedTorrent.downloadSpeed,
          downloaded: extendedTorrent.downloaded,
          total: extendedTorrent.length,
          timeRemaining: extendedTorrent.timeRemaining / 1000, // Convert ms to seconds
          infoHash: extendedTorrent.infoHash
        }
        onProgress && onProgress(progress, details)
      })

      torrent.on('done', () => {
        finish()
      })

      torrent.on('error', (err: Error) => {
        finish(err)
      })
    })

    client.on('error', (err: Error) => {
      finish(err)
    })

    // If a cancellation is requested before metadata is ready, stop immediately
    if (rejectIfCancelled()) return
  })
}

export function pauseTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (active?.torrent) {
    active.torrent.pause()
    return true
  }
  return false
}

export function resumeTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (active?.torrent) {
    active.torrent.resume()
    return true
  }
  return false
}

export function cancelTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (active) {
    if (active.finish) {
      active.finish(new Error('cancelled'))
    } else {
      active.torrent?.destroy()
      active.client.destroy()
      unregisterActive(active)
    }
    return true
  }
  return false
}

export function getActiveTorrentIds(): string[] {
  return Array.from(new Set([...activeTorrents.values()].flatMap(record => Array.from(record.aliases))))
}
