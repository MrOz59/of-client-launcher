import fs from 'fs'
import path from 'path'
import axios from 'axios'
import * as cheerio from 'cheerio'

export {
  downloadTorrent,
  pauseTorrent,
  resumeTorrent,
  cancelTorrent,
  isTorrentActive,
  getActiveTorrentIds,
  type TorrentProgress
} from './torrentLibtorrentRpc'

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
