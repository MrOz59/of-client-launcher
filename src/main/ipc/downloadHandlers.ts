/**
 * IPC Handlers for Downloads
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import { downloadFile, downloadTorrent } from '../downloader'
import {
  getActiveDownloads,
  getCompletedDownloads,
  getDownloadById,
  getDownloadByUrl,
  deleteDownload,
  addOrUpdateGame,
  markGameInstalled
} from '../db'
import {
  pauseDownloadByTorrentId,
  resumeDownloadByTorrentId,
  cancelDownloadByTorrentId,
  readOnlineFixIni,
  writeOnlineFixIni,
  processUpdateExtraction,
  normalizeGameInstallDir
} from '../downloadManager'
import { extractZipWithPassword } from '../zip'
import { findArchive, findExecutableInDir } from '../utils'
import type { IpcContext, IpcHandlerRegistrar } from './types'

// Helper to resolve game version
async function resolveGameVersion(options: {
  providedVersion?: string | null
  filename?: string | null
  title?: string | null
  gameUrl?: string | null
}): Promise<string> {
  const { providedVersion, filename, title } = options
  const { parseVersionFromName } = await import('../downloadManager')

  if (providedVersion && providedVersion !== 'unknown' && providedVersion.trim()) {
    return providedVersion.trim()
  }

  if (filename) {
    const fromFilename = parseVersionFromName(filename)
    if (fromFilename) return fromFilename
  }

  if (title) {
    const fromTitle = parseVersionFromName(title)
    if (fromTitle) return fromTitle
  }

  return 'unknown'
}

export const registerDownloadHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('download-http', async (_event: IpcMainInvokeEvent, url: string, destPath: string) => {
    try {
      await downloadFile(url, destPath, (p) => {
        ctx.sendDownloadProgress({ url, progress: p })
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-torrent', async (_event: IpcMainInvokeEvent, magnet: string, destPath: string) => {
    try {
      await downloadTorrent(magnet, destPath, (p) => {
        ctx.sendDownloadProgress({ magnet, progress: p })
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pause-download', async (_event: IpcMainInvokeEvent, torrentId: string) => {
    try {
      const success = await pauseDownloadByTorrentId(torrentId)
      return { success }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('resume-download', async (_event: IpcMainInvokeEvent, torrentId: string) => {
    try {
      const success = await resumeDownloadByTorrentId(torrentId)
      return { success }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('cancel-download', async (_event: IpcMainInvokeEvent, torrentId: string) => {
    try {
      const success = await cancelDownloadByTorrentId(torrentId)
      return { success }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-active-downloads', async () => {
    try {
      const downloads = getActiveDownloads()
      return { success: true, downloads }
    } catch (err: any) {
      return { success: false, error: err.message, downloads: [] }
    }
  })

  ipcMain.handle('get-completed-downloads', async () => {
    try {
      const downloads = getCompletedDownloads()
      return { success: true, downloads }
    } catch (err: any) {
      return { success: false, error: err.message, downloads: [] }
    }
  })

  ipcMain.handle('delete-download', async (_event, downloadId: number) => {
    try {
      deleteDownload(downloadId)
      ctx.getMainWindow()?.webContents.send('download-deleted')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-onlinefix-ini', async (_event, gameUrl: string) => {
    try {
      return await readOnlineFixIni(gameUrl)
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao ler OnlineFix.ini' }
    }
  })

  ipcMain.handle('save-onlinefix-ini', async (_event, gameUrl: string, content: string) => {
    try {
      return await writeOnlineFixIni(gameUrl, content)
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao salvar OnlineFix.ini' }
    }
  })

  ipcMain.handle('extract-download', async (_event, downloadId: number | string, providedPath?: string) => {
    try {
      const asNumber = Number(downloadId)
      const record = !Number.isNaN(asNumber) ? getDownloadById(asNumber) as any : getDownloadByUrl(String(downloadId)) as any
      const candidatePath = providedPath || record?.install_path || record?.dest_path
      if (!candidatePath) return { success: false, error: 'Path not provided' }

      const infoHash = record?.info_hash
      const idKey = infoHash || record?.download_url || String(downloadId)
      const gameUrl = record?.game_url || record?.download_url || idKey

      // Resolve base dir/filename
      const target = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(process.cwd(), candidatePath)

      // For torrent downloads (type === 'torrent'), use processUpdateExtraction
      if (record?.type === 'torrent') {
        console.log('[Extract] Using processUpdateExtraction for torrent:', target)

        // Notify start
        ctx.sendDownloadProgress({
          magnet: idKey,
          url: idKey,
          progress: 0,
          stage: 'extract',
          extractProgress: 0,
          destPath: target
        })

        const result = await processUpdateExtraction(target, gameUrl, (percent, details) => {
          ctx.sendDownloadProgress({
            magnet: idKey,
            url: idKey,
            progress: percent,
            stage: 'extract',
            extractProgress: percent,
            eta: details?.etaSeconds,
            destPath: target
          })
        })

        if (!result.success) {
          return { success: false, error: result.error || 'Extraction failed' }
        }

        ctx.getMainWindow()?.webContents.send('download-complete', {
          magnet: idKey,
          infoHash: infoHash || undefined,
          destPath: target
        })

        // Update game info
        if (gameUrl) {
          const version = await resolveGameVersion({
            filename: candidatePath,
            title: record?.title,
            gameUrl
          })
          addOrUpdateGame(gameUrl, record?.title)
          markGameInstalled(gameUrl, target, version, result.executablePath || undefined)
          try {
            const markerPath = path.join(target, '.of_game.json')
            const next = {
              url: gameUrl,
              title: record?.title || undefined,
              status: 'installed',
              showInLibrary: true,
              installPath: target,
              version,
              executablePath: result.executablePath || null,
              updatedAt: Date.now()
            }
            fs.writeFileSync(markerPath, JSON.stringify(next, null, 2))
          } catch {
            // ignore
          }
          // Auto-fetch banner once installed
          ctx.fetchAndPersistBanner(gameUrl, String(record?.title || gameUrl)).catch(() => {})
          ctx.prepareGamePrefixAfterInstall(gameUrl, String(record?.title || gameUrl), target).catch(() => {})
        }

        // Clean up download record from database
        if (record?.id) {
          try {
            deleteDownload(Number(record.id))
            ctx.getMainWindow()?.webContents.send('download-deleted')
            console.log('[Extract] Cleaned up download record after successful torrent extraction')
          } catch {}
        }

        return { success: true, destPath: target }
      }

      // For HTTP downloads, use the standard extraction flow
      const { archivePath, destDir } = findArchive(target)
      if (!archivePath) {
        return { success: false, error: 'Nenhum arquivo .zip/.rar/.7z encontrado para extrair' }
      }

      // Prevent deletion while extracting
      const extractionLockFile = path.join(destDir, '.extracting')
      try { fs.writeFileSync(extractionLockFile, 'extracting') } catch {}

      // Notify start
      ctx.sendDownloadProgress({
        magnet: idKey,
        url: idKey,
        progress: 0,
        stage: 'extract',
        extractProgress: 0,
        destPath: destDir
      })

      console.log('[Extract] Dispatching extraction for', archivePath, '->', destDir)

      try {
        await extractZipWithPassword(
          archivePath,
          destDir,
          undefined,
          (percent) => {
            ctx.sendDownloadProgress({
              magnet: idKey,
              url: idKey,
              progress: percent,
              stage: 'extract',
              extractProgress: percent,
              destPath: destDir
            })
          }
        )
      } catch (extractErr: any) {
        console.error('[Extract] Failed extraction', extractErr)
        try { fs.unlinkSync(extractionLockFile) } catch {}
        return { success: false, error: extractErr?.message || String(extractErr) }
      }

      console.log('[Extract] Extraction finished, deleting archive')
      // Delete archive after extraction
      try {
        fs.unlinkSync(archivePath)
      } catch {
        // ignore
      }

      // Normalize extracted content
      try {
        normalizeGameInstallDir(destDir)
      } catch {
        // ignore
      }

      try { fs.unlinkSync(extractionLockFile) } catch {}

      ctx.getMainWindow()?.webContents.send('download-complete', {
        magnet: idKey,
        infoHash: infoHash || undefined,
        destPath: destDir
      })

      // Add to library after extraction
      if (gameUrl) {
        const exePath = findExecutableInDir(destDir)
        const version = await resolveGameVersion({
          filename: archivePath,
          title: record?.title,
          gameUrl
        })
        addOrUpdateGame(gameUrl, record?.title)
        markGameInstalled(gameUrl, destDir, version, exePath || undefined)
        try {
          const markerPath = path.join(destDir, '.of_game.json')
          const next = {
            url: gameUrl,
            title: record?.title || undefined,
            status: 'installed',
            showInLibrary: true,
            installPath: destDir,
            version,
            executablePath: exePath || null,
            updatedAt: Date.now()
          }
          fs.writeFileSync(markerPath, JSON.stringify(next, null, 2))
        } catch {
          // ignore
        }
        // Auto-fetch banner once installed
        ctx.fetchAndPersistBanner(gameUrl, String(record?.title || gameUrl)).catch(() => {})
        ctx.prepareGamePrefixAfterInstall(gameUrl, String(record?.title || gameUrl), destDir).catch(() => {})
      }

      // Clean up download record from database
      if (record?.id) {
        try {
          deleteDownload(Number(record.id))
          ctx.getMainWindow()?.webContents.send('download-deleted')
          console.log('[Extract] Cleaned up download record after successful HTTP extraction')
        } catch {}
      }

      return { success: true, destPath: destDir }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
