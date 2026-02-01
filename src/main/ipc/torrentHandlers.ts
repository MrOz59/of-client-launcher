/**
 * IPC Handlers for Torrent Downloads
 * These need to be registered separately because they depend on main.ts functions
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { scrapeGameInfo } from '../scraper'
import { startGameDownload, parseVersionFromName } from '../downloadManager'
import { resolveTorrentFileUrl, deriveTitleFromTorrentUrl } from '../torrentResolver'
import { updateGameInfo, getDownloadByUrl } from '../db'
import type { IpcContext, IpcHandlerRegistrar } from './types'

const TORRENT_PARTITION = 'persist:online-fix'

// URL validation helpers (same as main.ts)
function isAllowedTorrentUrl(url: string): boolean {
  if (!url) return false
  const allowedDomains = ['online-fix.me', 'online.one-fix.ru', 'online.one-fix.net']
  try {
    const parsed = new URL(url)
    return allowedDomains.some(d => parsed.hostname.endsWith(d))
  } catch {
    return false
  }
}

function isAllowedWebviewUrl(url: string): boolean {
  if (!url) return false
  const allowedDomains = ['online-fix.me', 'online.one-fix.ru', 'online.one-fix.net']
  try {
    const parsed = new URL(url)
    return allowedDomains.some(d => parsed.hostname.endsWith(d))
  } catch {
    return false
  }
}

export const registerTorrentHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('start-torrent-download', async (_event: IpcMainInvokeEvent, torrentUrl: string, referer?: string) => {
    console.log('[Main] 🎯 start-torrent-download called!')
    console.log('[Main] Torrent URL:', torrentUrl)
    console.log('[Main] Referer:', referer)

    try {
      const requestedUrl = String(torrentUrl || '').trim()
      if (!isAllowedTorrentUrl(requestedUrl)) {
        return { success: false, error: 'URL de torrent não permitida' }
      }
      if (referer && !isAllowedWebviewUrl(referer)) {
        return { success: false, error: 'Referer não permitido' }
      }

      // Check if it's a torrent directory URL or direct .torrent file
      let actualTorrentUrl = requestedUrl

      if (requestedUrl.includes('/torrents/') && !requestedUrl.endsWith('.torrent')) {
        console.log('[Main] This is a torrent directory, need to scrape for .torrent file')
        actualTorrentUrl = await resolveTorrentFileUrl(requestedUrl, TORRENT_PARTITION)
        console.log('[Main] Resolved torrent file URL:', actualTorrentUrl)
      }
      if (!isAllowedTorrentUrl(actualTorrentUrl)) {
        return { success: false, error: 'URL de torrent não permitida' }
      }

      // Try to get the proper title and version from the game page
      const gamePageUrl = referer || torrentUrl
      let title = deriveTitleFromTorrentUrl(actualTorrentUrl)
      let version = 'unknown'

      // Scrape game info from the referer page (the game page)
      if (gamePageUrl && gamePageUrl.includes('online-fix.me') && !gamePageUrl.includes('/torrents/')) {
        console.log('[Main] Scraping game info from page:', gamePageUrl)
        const gameInfo = await scrapeGameInfo(gamePageUrl)
        if (gameInfo.title) {
          title = gameInfo.title
          console.log('[Main] Using scraped title:', title)
        }
        if (gameInfo.version) {
          version = gameInfo.version
          console.log('[Main] Using scraped version:', version)
        }
      }

      console.log('[Main] Game title:', title)
      console.log('[Main] Game version:', version)
      console.log('[Main] Starting download...')

      const result = await startGameDownload({
        gameUrl: gamePageUrl,
        torrentMagnet: actualTorrentUrl,
        gameTitle: title,
        gameVersion: version
      }, (progress, details) => {
        ctx.sendDownloadProgress({
          magnet: actualTorrentUrl,
          progress,
          speed: details?.downloadSpeed || 0,
          downloaded: details?.downloaded || 0,
          total: details?.total || 0,
          eta: details?.timeRemaining || 0,
          peers: (details as any)?.peers,
          seeds: (details as any)?.seeds,
          infoHash: details?.infoHash || actualTorrentUrl,
          stage: details?.stage || 'download',
          extractProgress: details?.extractProgress,
          destPath: (details as any)?.destPath
        })
      })

      if (!result.success) {
        console.warn('[Main] Download did not start/was cancelled:', result.error)
        return { success: false, error: result.error }
      }

      const completed = getDownloadByUrl(actualTorrentUrl) as { info_hash?: string; dest_path?: string | null } | undefined
      if (completed || result.installPath) {
        ctx.getMainWindow()?.webContents.send('download-complete', {
          magnet: actualTorrentUrl,
          infoHash: completed?.info_hash || undefined,
          destPath: result.installPath || completed?.dest_path
        })
        // Auto-fetch banner once installed
        ctx.fetchAndPersistBanner(gamePageUrl, title).catch(() => {})
        if (result.installPath) {
          ctx.prepareGamePrefixAfterInstall(gamePageUrl, title, result.installPath).catch(() => {})
        }
      }

      console.log('[Main] ✅ Download started successfully!')
      return { success: true }
    } catch (err: any) {
      console.error('[Main] Error starting torrent download:', err)
      return { success: false, error: err.message || 'Erro desconhecido' }
    }
  })

  ipcMain.handle('fetch-game-image', async (_event, gameUrl: string, title: string) => {
    try {
      const { fetchSteamBanner } = await import('../steamBanner')
      const banner = await fetchSteamBanner(title || gameUrl)
      if (banner) {
        updateGameInfo(gameUrl, { image_url: banner })
        return { success: true, imageUrl: banner }
      }
      return { success: false, error: 'Nenhuma imagem encontrada' }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao buscar imagem' }
    }
  })
}
