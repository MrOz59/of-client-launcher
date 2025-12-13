import { downloadFile, downloadTorrent, pauseTorrent, resumeTorrent, cancelTorrent, type TorrentProgress, isTorrentActive } from './downloader'
import { extractZipWithPassword } from './zip'
import {
  getGame,
  createDownload,
  updateDownloadProgress,
  updateDownloadStatus,
  updateDownloadInfoHash,
  markGameInstalled,
  getSetting,
  getDownloadByInfoHash,
  getDownloadByUrl,
  getDownloadById,
  deleteDownload,
  extractGameIdFromUrl,
  updateGameInfo,
  addOrUpdateGame
} from './db'
import path from 'path'
import fs from 'fs'
import { Worker } from 'worker_threads'
import { session } from 'electron'

export interface DownloadOptions {
  gameUrl: string
  downloadUrl?: string
  torrentMagnet?: string
  gameTitle: string
  gameVersion: string
  gameId?: string  // ID from the game URL (e.g., 17973)
  autoExtract?: boolean
  existingDownloadId?: number
  destPathOverride?: string
}

type DownloadRow = {
  id: number
  dest_path?: string | null
  info_hash?: string | null
  download_url?: string | null
}

// If the game content is nested inside a single subfolder (common in torrents/zips),
// move everything up one level to avoid duplicated folder nesting.
function mergeMoveEntry(srcPath: string, destPath: string) {
  try {
    const srcStat = fs.existsSync(srcPath) ? fs.statSync(srcPath) : null
    if (!srcStat) return

    // Directory merge
    if (srcStat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      const entries = fs.readdirSync(srcPath, { withFileTypes: true })
      for (const entry of entries) {
        const s = path.join(srcPath, entry.name)
        const d = path.join(destPath, entry.name)
        mergeMoveEntry(s, d)
      }
      try { fs.rmSync(srcPath, { recursive: true, force: true }) } catch {}
      return
    }

    // File overwrite
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    try {
      if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { recursive: true, force: true })
      } else if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { force: true })
      }
    } catch {
      // ignore
    }

    try {
      fs.renameSync(srcPath, destPath)
    } catch {
      try {
        fs.cpSync(srcPath, destPath, { force: true })
        try { fs.rmSync(srcPath, { force: true }) } catch {}
      } catch (err) {
        console.warn('[mergeMoveEntry] Failed to move', srcPath, '->', destPath, err)
      }
    }
  } catch (err) {
    console.warn('[mergeMoveEntry] Error', srcPath, '->', destPath, err)
  }
}

function flattenSingleSubdir(basePath: string) {
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
      .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')

    if (entries.length !== 1 || !entries[0].isDirectory()) return

    const subDir = path.join(basePath, entries[0].name)
    const subEntries = fs.readdirSync(subDir, { withFileTypes: true })

    subEntries.forEach(entry => {
      const src = path.join(subDir, entry.name)
      const dest = path.join(basePath, entry.name)
      mergeMoveEntry(src, dest)
    })

    try {
      fs.rmdirSync(subDir)
    } catch (err) {
      console.warn('[flattenSingleSubdir] Failed to remove subdir', subDir, err)
    }

    console.log('[flattenSingleSubdir] Flattened nested folder:', subDir)
  } catch (err) {
    console.warn('[flattenSingleSubdir] Error while flattening', basePath, err)
  }
}

function removeFolderIfExists(target: string) {
  if (!target || target === '/' || target === '.' || target === '..') return
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
    }
  } catch (err) {
    console.warn('[removeFolderIfExists] Failed to remove', target, err)
  }
}

function removeFileIfExists(target: string) {
  try {
    if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.rmSync(target, { force: true })
    }
  } catch (err) {
    console.warn('[removeFileIfExists] Failed to remove file', target, err)
  }
}

function removeArchives(dir: string) {
  try {
    if (!dir || !fs.existsSync(dir)) return
    const archives = findFilesRecursive(dir, /\.(rar|zip|7z)$/i)
    archives.forEach(f => {
      try { fs.rmSync(f, { force: true }) } catch (err) { console.warn('[removeArchives] Failed to remove', f, err) }
    })
  } catch (err) {
    console.warn('[removeArchives] Failed in', dir, err)
  }
}

function countFilesRecursive(dir: string, max = 5000): number {
  let count = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop() as string
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          stack.push(path.join(current, entry.name))
        } else {
          count++
          if (count >= max) return count
        }
      }
    } catch {
      // ignore
    }
  }
  return count
}

// If there's a dominant subfolder (lots more files than the root), flatten it to avoid duplicate installs
function flattenDominantSubdir(basePath: string) {
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
      .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')
    const subdirs = entries.filter(e => e.isDirectory())
    if (!subdirs.length) return

    const filesAtRoot = entries.filter(e => e.isFile()).length
    let bestDir: string | null = null
    let bestCount = 0

    for (const dir of subdirs) {
      const full = path.join(basePath, dir.name)
      const count = countFilesRecursive(full, 10000)
      if (count > bestCount) {
        bestCount = count
        bestDir = full
      }
    }

    if (!bestDir) return

    // Heuristic: flatten if the dominant folder clearly has more files than the root itself
    if (bestCount < Math.max(5, filesAtRoot * 2)) return

    console.log('[flattenDominantSubdir] Flattening dominant folder:', bestDir, 'files:', bestCount, 'rootFiles:', filesAtRoot)

    const subEntries = fs.readdirSync(bestDir, { withFileTypes: true })
    subEntries.forEach(entry => {
      const src = path.join(bestDir, entry.name)
      const dest = path.join(basePath, entry.name)
      mergeMoveEntry(src, dest)
    })

    removeFolderIfExists(bestDir)
  } catch (err) {
    console.warn('[flattenDominantSubdir] Error while flattening', basePath, err)
  }
}

export function normalizeGameInstallDir(installPath: string) {
  try {
    if (!installPath || !fs.existsSync(installPath)) return

    // Flatten one or two levels of nesting (common in OF releases).
    flattenSingleSubdir(installPath)
    flattenDominantSubdir(installPath)
    flattenSingleSubdir(installPath)

    // Remove common junk folders that sometimes come with releases.
    removeFolderIfExists(path.join(installPath, 'Fix Repair'))

    // Basic integrity warnings (best-effort; does not fail the install).
    try {
      const fileCount = countFilesRecursive(installPath, 200)
      if (fileCount > 0 && fileCount < 20) {
        console.warn('[normalizeGameInstallDir] Low file count after extraction; install may be incomplete:', installPath, 'files:', fileCount)
      }

      const vorbisBase = path.join(installPath, 'Engine', 'Binaries', 'ThirdParty', 'Vorbis')
      if (fs.existsSync(vorbisBase)) {
        const candidates = [
          path.join(vorbisBase, 'Win64', 'VS2015'),
          path.join(vorbisBase, 'Win64', 'VS2017'),
          path.join(vorbisBase, 'Win64', 'VS2019'),
          path.join(vorbisBase, 'Win64', 'VS2022'),
          path.join(vorbisBase, 'Win64'),
        ]
        const found = candidates.some(dir => {
          try {
            if (!fs.existsSync(dir)) return false
            const entries = fs.readdirSync(dir)
            return entries.some(n => /^libvorbis(file)?_64\.dll$/i.test(n) || /^libvorbis(file)?\.dll$/i.test(n))
          } catch {
            return false
          }
        })
        if (!found) {
          console.warn('[normalizeGameInstallDir] Unreal Vorbis DLLs not found under Engine/ThirdParty/Vorbis; game may crash (incomplete files).')
          console.warn('[normalizeGameInstallDir] Expected something like libvorbis_64.dll/libvorbisfile_64.dll in:', vorbisBase)
        }
      }
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn('[normalizeGameInstallDir] Failed', installPath, err)
  }
}

/**
 * Start a download (HTTP or torrent) with automatic extraction
 */
interface ProgressDetails extends Partial<TorrentProgress> {
  stage?: 'download' | 'extract'
  extractProgress?: number
}

export async function startGameDownload(
  options: DownloadOptions,
  onProgress?: (progress: number, details?: ProgressDetails) => void
): Promise<{ success: boolean; error?: string; installPath?: string }> {
  const isCancelledError = (err: any) => err?.message === 'cancelled'

  const {
    gameUrl,
    downloadUrl,
    torrentMagnet,
    gameTitle,
    gameVersion,
    gameId: providedGameId,
    autoExtract = true,
    existingDownloadId,
    destPathOverride
  } = options

  // Determine download type
  const downloadType = torrentMagnet ? 'torrent' : 'http'
  const url = torrentMagnet || downloadUrl

  if (!url) {
    return { success: false, error: 'No download URL or torrent magnet provided' }
  }

  // Extract game ID from URL if not provided
  const gameId = providedGameId || extractGameIdFromUrl(gameUrl)
  console.log('[DownloadManager] Game ID:', gameId)

  // Get base launcher path from settings or use current directory
  const basePath = getSetting('launcher_path') || process.cwd()

// Downloads go to downloads/ folder, games go to games/ folder
const downloadsPath = path.join(basePath, 'downloads')
const gamesPath = path.join(basePath, 'games')
fs.mkdirSync(downloadsPath, { recursive: true })
fs.mkdirSync(gamesPath, { recursive: true })

  // Use game ID for folder name if available, otherwise use sanitized title
  const safeName = gameTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const gameFolderName = gameId || safeName

// Download path (temporary - downloads folder)
const downloadDestPath = destPathOverride || path.join(downloadsPath, gameFolderName)
fs.mkdirSync(downloadDestPath, { recursive: true })

// Install path (final - games folder)
  const installPath = path.join(gamesPath, gameFolderName)

  const ensureGameRecord = () => {
    addOrUpdateGame(gameUrl, gameTitle)
    if (gameId) {
      updateGameInfo(gameUrl, { game_id: gameId })
    }
  }

  // For HTTP downloads: download zip to downloads folder, extract to games folder
  // For torrents: download to downloads folder, then move contents to games folder after completion
  const fileName = `${safeName}.zip`
  const downloadFilePath = path.join(downloadDestPath, fileName)

  // Create download record in database
  const downloadId = existingDownloadId ?? createDownload({
    game_url: gameUrl,
    title: gameTitle,
    type: downloadType,
    download_url: url,
    dest_path: downloadType === 'torrent' ? downloadDestPath : downloadFilePath
  })

  try {
    let lastDetails: ProgressDetails | undefined

    // Update status to downloading
    updateDownloadStatus(Number(downloadId), 'downloading')

    // Start download
    if (downloadType === 'torrent') {
      if (isTorrentActive(url)) {
        console.log('[DownloadManager] Torrent already active, skipping duplicate start:', url)
        return { success: true, installPath }
      }
      const aliases = [url, String(downloadId)]

      // Create install directory for torrent
      fs.mkdirSync(installPath, { recursive: true })

      // If it's a .torrent URL, download the file first
      let torrentPath = url
      if (url.startsWith('http')) {
        console.log('[DownloadManager] Downloading .torrent file from:', url)
        const tempTorrentPath = path.join(downloadDestPath, 'temp.torrent')

        // Get cookies for authentication
        const ses = session.fromPartition('persist:online-fix')
        const urlObj = new URL(url)
        const cookies = await ses.cookies.get({ url: urlObj.origin })
        const mainCookies = await ses.cookies.get({ url: 'https://online-fix.me' })
        const allCookies = [...cookies, ...mainCookies]
        const uniqueCookies = Array.from(new Map(allCookies.map(c => [c.name, c])).values())
        const cookieHeader = uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ')

        console.log('[DownloadManager] Using cookies for .torrent download:', uniqueCookies.map(c => c.name))

        await downloadFile(url, tempTorrentPath, undefined, {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://online-fix.me/'
        })
        torrentPath = tempTorrentPath
        console.log('[DownloadManager] .torrent file saved to:', torrentPath)
      }

      // Now download the torrent content directly to games folder
      console.log('[DownloadManager] Starting torrent download to:', installPath)
      await downloadTorrent(torrentPath, installPath, (progress, details) => {
        lastDetails = details
        // Save infoHash on first progress update
        if (details?.infoHash) {
          updateDownloadInfoHash(Number(downloadId), details.infoHash)
        }
        updateDownloadProgress(Number(downloadId), progress)
        onProgress?.(progress, details)
      }, aliases)

      // Move downloaded content from temp download folder to final install folder
      moveDirContents(downloadDestPath, installPath)
      // Clean temp download folder (best effort)
      removeFolderIfExists(downloadDestPath)

      normalizeGameInstallDir(installPath)

      // Remove common junk folders/files (but keep archives for extraction step)
      removeFolderIfExists(path.join(installPath, 'Fix Repair'))
      removeFolderIfExists(path.join(downloadDestPath, 'Fix Repair'))
      removeFileIfExists(path.join(installPath, 'temp.torrent'))
      removeFileIfExists(path.join(downloadDestPath, 'temp.torrent'))

      // Clean up temp .torrent file if we downloaded it
      if (url.startsWith('http')) {
        try {
          fs.unlinkSync(path.join(downloadDestPath, 'temp.torrent'))
          // Try to remove the download folder if empty
          const files = fs.readdirSync(downloadDestPath)
          if (files.length === 0) {
            fs.rmdirSync(downloadDestPath)
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } else {
      // HTTP download - save to downloads folder
      console.log('[DownloadManager] Starting HTTP download to:', downloadFilePath)
      await downloadFile(url, downloadFilePath, (progress) => {
        updateDownloadProgress(Number(downloadId), progress)
        onProgress?.(progress, { stage: 'download', progress })
      })
    }

    // Download completed
    updateDownloadStatus(Number(downloadId), 'completed')

    // Auto-extract if enabled (only for HTTP downloads)
    let finalInstallPath = installPath
    if (autoExtract && downloadType === 'http') {
      updateDownloadStatus(Number(downloadId), 'extracting')
      const extractStart = Date.now()

      // Create install directory
      fs.mkdirSync(installPath, { recursive: true })

      try {
        console.log(`[DownloadManager] Extracting ${downloadFilePath} to ${installPath}`)
        await extractZipWithPassword(downloadFilePath, installPath, undefined, (percent) => {
          const elapsed = (Date.now() - extractStart) / 1000
          const eta = percent > 0 ? ((100 - percent) * elapsed) / percent : undefined
          updateDownloadProgress(Number(downloadId), percent)
          onProgress?.(percent, {
            stage: 'extract',
            extractProgress: percent,
            timeRemaining: eta
          })
        })
        console.log('[DownloadManager] Extraction completed')

        // Flatten/normalize extracted content (avoid nested installs)
        normalizeGameInstallDir(installPath)

        // Remove the zip file after extraction
        fs.unlinkSync(downloadFilePath)

        // Try to remove the download folder if empty
        try {
          const files = fs.readdirSync(downloadDestPath)
          if (files.length === 0) {
            fs.rmdirSync(downloadDestPath)
          }
        } catch (e) {
          // Ignore cleanup errors
        }

        // Try to find the executable
        const executablePath = findExecutable(installPath)

        // Mark game as installed with new version (only after extraction completed)
        ensureGameRecord()
        const version = (gameVersion && gameVersion !== 'unknown')
          ? gameVersion
          : (parseVersionFromName(url) || parseVersionFromName(gameTitle) || 'unknown')
        console.log('[DownloadManager] Marking game installed with version:', version)
        markGameInstalled(gameUrl, installPath, version, executablePath || undefined)

        finalInstallPath = installPath
      } catch (extractError: any) {
        console.error('Extraction failed:', extractError)
        return {
          success: false,
          error: `Download completed but extraction failed: ${extractError.message}`
        }
      }
    } else if (downloadType === 'torrent') {
      // For torrents, check if there are RAR files that need extraction (update scenario)
      console.log('[DownloadManager] Torrent completed, dispatching extraction worker...')

      updateDownloadStatus(Number(downloadId), 'extracting')

      const updateResult = await new Promise<{ success: boolean; error?: string; executablePath?: string }>((resolve, reject) => {
        const workerPath = path.join(__dirname, 'extractWorker.js')
        const worker = new Worker(workerPath, { workerData: { installPath, gameUrl } })
        worker.on('message', (msg: any) => {
          if (msg?.type === 'progress') {
            const percent = Number(msg.percent) || 0
            updateDownloadProgress(Number(downloadId), percent)
            onProgress?.(percent, { stage: 'extract', extractProgress: percent })
          } else if (msg?.type === 'done') {
            resolve(msg.result || { success: true })
          } else if (msg?.type === 'error') {
            reject(new Error(msg.error || 'Extraction error'))
          }
        })
        worker.on('error', reject)
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Extraction worker exited with code ${code}`))
          }
        })
      })

      // After extraction step, clean up archives left behind
      removeArchives(installPath)
      removeArchives(downloadDestPath)

      if (!updateResult.success) {
        console.error('[DownloadManager] Update extraction failed:', updateResult.error)
        return {
          success: false,
          error: `Torrent completed but update extraction failed: ${updateResult.error}`
        }
      }

      // Mark as installed after download (already in games folder)
      ensureGameRecord()
      const executablePath = updateResult.executablePath || findExecutable(installPath)
      const version = (gameVersion && gameVersion !== 'unknown')
        ? gameVersion
        : (parseVersionFromName(url) || parseVersionFromName(gameTitle) || 'unknown')
      console.log('[DownloadManager] Marking torrent game installed with version:', version)
      markGameInstalled(gameUrl, installPath, version, executablePath || undefined)
    }

    // Send a final progress update to 100% to ensure UI switches to completed
    onProgress?.(100, { ...lastDetails, stage: 'download' })

    return {
      success: true,
      installPath: finalInstallPath
    }
  } catch (error: any) {
    if (isCancelledError(error)) {
      console.log('[DownloadManager] Download cancelled:', url)
      updateDownloadStatus(Number(downloadId), 'cancelled')
      return { success: false, error: 'cancelled' }
    }

    const message = error?.message || String(error || 'Unknown error')
    console.error('Download failed:', message)
    updateDownloadStatus(Number(downloadId), 'error', message)
    return {
      success: false,
      error: message
    }
  }
}

/**
 * Find executable file in game directory
 * Looks for .exe files (Windows games) with smart prioritization
 */
function findExecutable(gameDir: string): string | null {
  console.log('[findExecutable] Searching in:', gameDir)
  try {
    // Collect all exe files with their paths
    const exeFiles: Array<{ name: string; path: string; depth: number }> = []

    function scanDir(dir: string, depth: number = 0) {
      if (depth > 4) return // Don't go too deep
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            // Skip common non-game directories
            const skipDirs = ['__macosx', 'redist', 'directx', '_commonredist', 'vcredist', 'support', 'dotnet']
            if (!skipDirs.includes(entry.name.toLowerCase())) {
              scanDir(fullPath, depth + 1)
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
            exeFiles.push({ name: entry.name, path: fullPath, depth })
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    }

    scanDir(gameDir)

    if (exeFiles.length === 0) {
      console.log('[findExecutable] No exe files found')
      return null
    }

    console.log('[findExecutable] Found', exeFiles.length, 'exe files')

    // Scoring system for prioritization
    const scoreExe = (exe: { name: string; path: string; depth: number }): number => {
      const nameLower = exe.name.toLowerCase()
      let score = 0

      // Negative scores - files to avoid
      if (nameLower.includes('uninstall')) score -= 100
      if (nameLower.includes('uninst')) score -= 100
      if (nameLower.includes('setup')) score -= 50
      if (nameLower.includes('install')) score -= 50
      if (nameLower.includes('redist')) score -= 50
      if (nameLower.includes('vcredist')) score -= 100
      if (nameLower.includes('dxsetup')) score -= 100
      if (nameLower.includes('directx')) score -= 100
      if (nameLower.includes('dotnet')) score -= 100
      if (nameLower.includes('crash')) score -= 30
      if (nameLower.includes('report')) score -= 30
      if (nameLower.includes('helper')) score -= 20
      if (nameLower.includes('update')) score -= 20
      if (nameLower.includes('patch')) score -= 20

      // Positive scores - likely game executables
      if (nameLower.includes('game')) score += 30
      if (nameLower.includes('launcher')) score += 20
      if (nameLower.includes('play')) score += 20
      if (nameLower.includes('start')) score += 15

      // Files in root directory are more likely to be the main executable
      score += (4 - exe.depth) * 10

      // Larger file names (not just "game.exe") might be more specific
      if (exe.name.length > 10) score += 5

      return score
    }

    // Sort by score (highest first)
    exeFiles.sort((a, b) => scoreExe(b) - scoreExe(a))

    // Log top candidates
    console.log('[findExecutable] Top candidates:')
    exeFiles.slice(0, 5).forEach((exe, i) => {
      console.log(`  ${i + 1}. ${exe.name} (score: ${scoreExe(exe)}, depth: ${exe.depth})`)
    })

    // Return the highest scored executable
    const best = exeFiles[0]
    console.log('[findExecutable] Selected:', best.path)
    return best.path
  } catch (error) {
    console.error('[findExecutable] Error:', error)
    return null
  }
}

export function parseVersionFromName(name: string): string | null {
  const clean = name.toLowerCase().replace(/[_-]/g, ' ')
  const match = clean.match(/v?\s?(\d+\.\d+(?:\.\d+)?)/)
  return match ? match[1] : null
}

/**
 * Pause a download by torrent ID (only works for torrents)
 */
export async function pauseDownloadByTorrentId(torrentId: string): Promise<boolean> {
  const paused = pauseTorrent(torrentId)
  if (paused) {
    const existing = findDownloadRecord(torrentId)
    if (existing) updateDownloadStatus(Number(existing.id), 'paused')
    console.log('[DownloadManager] Paused torrent:', torrentId)
  }
  return paused
}

/**
 * Resume a download by torrent ID
 */
export async function resumeDownloadByTorrentId(torrentId: string): Promise<boolean> {
  const resumed = resumeTorrent(torrentId)
  if (resumed) {
    const existing = findDownloadRecord(torrentId)
    if (existing) updateDownloadStatus(Number(existing.id), 'downloading')
    console.log('[DownloadManager] Resumed torrent:', torrentId)
  }
  return resumed
}

/**
 * Cancel a download by torrent ID
 */
export async function cancelDownloadByTorrentId(torrentId: string): Promise<boolean> {
  const download = findDownloadRecord(torrentId)
  const cancelled = cancelTorrent(torrentId)

  if (download) {
    updateDownloadStatus(Number(download.id), 'cancelled')
    safelyRemoveDownloadData(download.dest_path)
    deleteDownload(Number(download.id))
    // Notify renderer to clear any stale cards
    try {
      const { BrowserWindow } = await import('electron')
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('download-deleted'))
    } catch {
      // ignore
    }
  }

  if (cancelled || download) {
    console.log('[DownloadManager] Cancelled torrent and cleaned up:', torrentId)
    return true
  }
  return false
}

function findDownloadRecord(torrentId: string) {
  const asNumber = Number(torrentId)
  return (
    (getDownloadByInfoHash(torrentId) as DownloadRow | undefined) ||
    (getDownloadByUrl(torrentId) as DownloadRow | undefined) ||
    (!Number.isNaN(asNumber) ? (getDownloadById(asNumber) as DownloadRow | undefined) : null) ||
    undefined
  )
}

function safelyRemoveDownloadData(destPath?: string | null) {
  if (!destPath) return
  try {
    // Remove the download/install path
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true })
    }

    // If parent is now empty, remove it too (best-effort)
    const parent = path.dirname(destPath)
    if (parent && parent !== '/' && parent !== '.' && parent !== destPath && fs.existsSync(parent)) {
      try {
        const remaining = fs.readdirSync(parent)
        if (remaining.length === 0) {
          fs.rmdirSync(parent)
        }
      } catch (err: any) {
        // ignore ENOTEMPTY, just log others
        if (err?.code !== 'ENOTEMPTY') {
          console.warn('[DownloadManager] Failed to clean parent dir', parent, err)
        }
      }
    }
  } catch (err) {
    console.warn('[DownloadManager] Failed to delete download data for', destPath, err)
  }
}

function moveDirContents(src: string, dest: string) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    try {
      if (entry.isDirectory()) {
        // If destination exists, merge; else move
        if (fs.existsSync(destPath)) {
          moveDirContents(srcPath, destPath)
          fs.rmSync(srcPath, { recursive: true, force: true })
        } else {
          fs.renameSync(srcPath, destPath)
        }
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.renameSync(srcPath, destPath)
      }
    } catch (err) {
      // Fallback to copy if rename fails (e.g., across devices)
      try {
        fs.cpSync(srcPath, destPath, { recursive: true, force: true })
        fs.rmSync(srcPath, { recursive: true, force: true })
      } catch (copyErr) {
        console.warn('[moveDirContents] Failed to move', srcPath, '->', destPath, copyErr)
      }
    }
  }
}

/**
 * Find all files matching a pattern recursively
 */
export function findFilesRecursive(dir: string, pattern: RegExp): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, pattern))
      } else if (pattern.test(entry.name)) {
        results.push(fullPath)
      }
    }
  } catch (err) {
    console.warn('[findFilesRecursive] Error reading directory:', dir, err)
  }
  return results
}

/**
 * Find OnlineFix.ini file in game directory
 */
function findOnlineFixIni(gameDir: string): string | null {
  const files = findFilesRecursive(gameDir, /^OnlineFix\.ini$/i)
  return files.length > 0 ? files[0] : null
}

export function readOnlineFixIni(gameUrl: string): { success: boolean; path?: string; content?: string; exists?: boolean; error?: string } {
  try {
    const game = getGame(gameUrl) as { install_path?: string } | undefined
    const installPath = game?.install_path
    if (!installPath || !fs.existsSync(installPath)) {
      return { success: false, error: 'Pasta do jogo não encontrada' }
    }

    const iniPath = findOnlineFixIni(installPath) || path.join(installPath, 'OnlineFix.ini')
    const exists = fs.existsSync(iniPath)
    const content = exists ? fs.readFileSync(iniPath, 'utf-8') : ''
    return { success: true, path: iniPath, content, exists }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao ler OnlineFix.ini' }
  }
}

export function writeOnlineFixIni(gameUrl: string, content: string): { success: boolean; path?: string; error?: string } {
  try {
    const game = getGame(gameUrl) as { install_path?: string } | undefined
    const installPath = game?.install_path
    if (!installPath || !fs.existsSync(installPath)) {
      return { success: false, error: 'Pasta do jogo não encontrada' }
    }

    const iniPath = findOnlineFixIni(installPath) || path.join(installPath, 'OnlineFix.ini')
    fs.writeFileSync(iniPath, content ?? '', 'utf-8')
    return { success: true, path: iniPath }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao salvar OnlineFix.ini' }
  }
}

/**
 * Process torrent update - extract RAR, cleanup, restore configs
 * This handles the case where a torrent downloads an update with a .rar file
 * that needs to be extracted over the existing game installation
 */
export async function processUpdateExtraction(
  installPath: string,
  gameUrl: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; error?: string; executablePath?: string }> {
  console.log('[UpdateProcessor] Starting update processing for:', installPath)

  // Step 1: Find any .rar files in the install path (recursively)
  const rarFiles = findFilesRecursive(installPath, /\.rar$/i)

  if (rarFiles.length === 0) {
    console.log('[UpdateProcessor] No RAR files found, skipping update processing')
    return { success: true }
  }

  console.log('[UpdateProcessor] Found RAR files:', rarFiles)

  // Step 2: Check if this is an update (game already has files/folders)
  const existingGame = getGame(gameUrl) as { executable_path?: string } | undefined
  const previousExePath = existingGame?.executable_path || null
  console.log('[UpdateProcessor] Previous executable path:', previousExePath)

  // Step 3: Backup OnlineFix.ini if it exists
  const onlineFixPath = findOnlineFixIni(installPath)
  let onlineFixBackup: string | null = null

  if (onlineFixPath) {
    console.log('[UpdateProcessor] Found OnlineFix.ini at:', onlineFixPath)
    try {
      onlineFixBackup = fs.readFileSync(onlineFixPath, 'utf-8')
      console.log('[UpdateProcessor] Backed up OnlineFix.ini')
    } catch (err) {
      console.warn('[UpdateProcessor] Failed to backup OnlineFix.ini:', err)
    }
  }

  // Step 4: Extract each RAR file to the game's root folder (installPath)
  for (const rarFile of rarFiles) {
    console.log('[UpdateProcessor] Extracting:', rarFile, 'to:', installPath)
    try {
      await extractZipWithPassword(rarFile, installPath, undefined, onProgress)
      console.log('[UpdateProcessor] Extraction completed for:', rarFile)

      // Flatten duplicated nested folder if the update archive was wrapped in a single directory
      flattenSingleSubdir(installPath)
      flattenDominantSubdir(installPath)
      flattenSingleSubdir(installPath)

      // Step 5: Remove the RAR file after successful extraction
      try {
        if (fs.existsSync(rarFile)) {
          fs.unlinkSync(rarFile)
          console.log('[UpdateProcessor] Removed RAR file:', rarFile)
        }
      } catch (err) {
        // Ignore missing file, warn on other errors
        if ((err as any)?.code !== 'ENOENT') {
          console.warn('[UpdateProcessor] Failed to remove RAR file:', rarFile, err)
        }
      }

      // Step 6: Remove "Fix Repair" folder if it exists in the same directory as the RAR
      const rarDir = path.dirname(rarFile)
      const fixRepairPath = path.join(rarDir, 'Fix Repair')
      if (fs.existsSync(fixRepairPath)) {
        try {
          fs.rmSync(fixRepairPath, { recursive: true, force: true })
          console.log('[UpdateProcessor] Removed Fix Repair folder:', fixRepairPath)
        } catch (err) {
          console.warn('[UpdateProcessor] Failed to remove Fix Repair folder:', err)
        }
      }

      // Also check for "Fix Repair" in installPath root
      const rootFixRepairPath = path.join(installPath, 'Fix Repair')
      if (fs.existsSync(rootFixRepairPath)) {
        try {
          fs.rmSync(rootFixRepairPath, { recursive: true, force: true })
          console.log('[UpdateProcessor] Removed root Fix Repair folder:', rootFixRepairPath)
        } catch (err) {
          console.warn('[UpdateProcessor] Failed to remove root Fix Repair folder:', err)
        }
      }

      // Step 7: Try to remove the empty subfolder that contained the RAR
      // (e.g., /games/17973/Section 13/ if it's now empty or only had the RAR)
      if (rarDir !== installPath) {
        try {
          const remainingFiles = fs.readdirSync(rarDir)
          if (remainingFiles.length === 0) {
            fs.rmdirSync(rarDir)
            console.log('[UpdateProcessor] Removed empty folder:', rarDir)
          } else {
            // If only Fix Repair or archives remain, force remove
            const onlyJunk = remainingFiles.every(f => f.toLowerCase().includes('fix repair') || /\.(rar|zip|7z)$/i.test(f))
            if (onlyJunk) {
              fs.rmSync(rarDir, { recursive: true, force: true })
              console.log('[UpdateProcessor] Force removed junk folder:', rarDir)
            }
          }
        } catch (err) {
          // Folder not empty or other error, ignore
        }
      }
    } catch (err: any) {
      console.error('[UpdateProcessor] Failed to extract:', rarFile, err)
      return { success: false, error: `Failed to extract ${path.basename(rarFile)}: ${err.message}` }
    }
  }

  // Step 8: Restore OnlineFix.ini if we had a backup
  if (onlineFixBackup) {
    // Find where OnlineFix.ini should be (might be in a new location after extraction)
    const newOnlineFixPath = findOnlineFixIni(installPath)
    if (newOnlineFixPath) {
      try {
        fs.writeFileSync(newOnlineFixPath, onlineFixBackup, 'utf-8')
        console.log('[UpdateProcessor] Restored OnlineFix.ini to:', newOnlineFixPath)
      } catch (err) {
        console.warn('[UpdateProcessor] Failed to restore OnlineFix.ini:', err)
      }
    } else if (onlineFixPath) {
      // Try to restore to original location
      try {
        fs.writeFileSync(onlineFixPath, onlineFixBackup, 'utf-8')
        console.log('[UpdateProcessor] Restored OnlineFix.ini to original location:', onlineFixPath)
      } catch (err) {
        console.warn('[UpdateProcessor] Failed to restore OnlineFix.ini:', err)
      }
    }
  }

  // Step 9: Find executable - first check previous location, then search
  let executablePath: string | null = null

  if (previousExePath && fs.existsSync(previousExePath)) {
    executablePath = previousExePath
    console.log('[UpdateProcessor] Using previous executable path:', executablePath)
  } else {
    executablePath = findExecutable(installPath)
    console.log('[UpdateProcessor] Found new executable path:', executablePath)
  }

  return { success: true, executablePath: executablePath || undefined }
}
