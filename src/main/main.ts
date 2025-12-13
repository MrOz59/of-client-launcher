// Polyfill File API for undici (required by cheerio in Electron main process)
import { Blob } from 'buffer'
delete (process.env as any).ELECTRON_RUN_AS_NODE
if (typeof global.File === 'undefined') {
  // @ts-ignore - Polyfill for Electron main process
  global.File = class File extends Blob {
    constructor(chunks: any[], fileName: string, options?: any) {
      super(chunks, options)
      // @ts-ignore
      this.name = fileName
      // @ts-ignore
      this.lastModified = options?.lastModified || Date.now()
    }
  }
}

import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { importCookies } from './cookieManager.js'
import { fetchGameUpdateInfo, fetchUserProfile, scrapeGameInfo } from './scraper.js'
import { downloadFile, downloadTorrent } from './downloader.js'
import { addOrUpdateGame, updateGameVersion, getSetting, getActiveDownloads, getDownloadByUrl, getCompletedDownloads, getDownloadById, markGameInstalled, setSetting, getAllGames, updateGameInfo, deleteGame, deleteDownload, getGame, extractGameIdFromUrl } from './db.js'
import { shouldBlockRequest } from './easylist-filters.js'
import { startGameDownload, pauseDownloadByTorrentId, resumeDownloadByTorrentId, cancelDownloadByTorrentId, parseVersionFromName, processUpdateExtraction, readOnlineFixIni, writeOnlineFixIni, normalizeGameInstallDir } from './downloadManager.js'
import axios from 'axios'
import { resolveTorrentFileUrl, deriveTitleFromTorrentUrl } from './torrentResolver.js'
import fs from 'fs'
import { isLinux, findProtonRuntime, setSavedProtonRuntime, buildProtonLaunch, getPrefixPath, getDefaultPrefixPath, listProtonRuntimes, setCustomProtonRoot, ensurePrefixDefaults, ensureGamePrefixFromDefault, getPrefixRootDir, ensureDefaultPrefix, ensureGameCommonRedists } from './protonManager.js'
import { spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null
const TORRENT_PARTITION = 'persist:online-fix'

type RunningGameProc = {
  pid: number
  child: any
  protonLogPath?: string
}

const runningGames = new Map<string, RunningGameProc>()

type PrefixJobStatusPayload = {
  gameUrl: string
  status: 'starting' | 'progress' | 'done' | 'error'
  message?: string
  prefix?: string
}

const inFlightPrefixJobs = new Map<string, { startedAt: number }>()

type GameLaunchStatusPayload = {
  gameUrl: string
  status: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  code?: number | null
  signal?: string | null
  message?: string
  stderrTail?: string
  protonLogPath?: string
}

function sendGameLaunchStatus(payload: GameLaunchStatusPayload) {
  try {
    mainWindow?.webContents.send('game-launch-status', payload)
  } catch {
    // ignore
  }
}

function sendPrefixJobStatus(payload: PrefixJobStatusPayload) {
  try {
    mainWindow?.webContents.send('prefix-job-status', payload)
  } catch {
    // ignore
  }
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // EPERM means "exists but not permitted" – treat as alive
    return err?.code === 'EPERM'
  }
}

function killProcessTreeBestEffort(pid: number, signal: NodeJS.Signals): void {
  // On POSIX, kill the whole process group (Proton spawns children).
  if (process.platform !== 'win32') {
    try { process.kill(-pid, signal) } catch {}
  }
  try { process.kill(pid, signal) } catch {}
}

function readFileTailBytes(filePath: string, maxBytes: number): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    const size = stat.size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, start)
      return buf.toString('utf8')
    } finally {
      try { fs.closeSync(fd) } catch {}
    }
  } catch {
    return null
  }
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

function extractInterestingProtonLog(logText: string, maxLines: number): string | null {
  if (!logText) return null
  const lines = logText.split(/\r?\n/)

  const isNoise = (line: string) =>
    /trace:unwind|dump_unwind_info|RtlVirtualUnwind2|trace:seh:Rtl|unwind:Rtl/i.test(line)

  const interesting = (line: string) =>
    /(^|\s)(err:|warn:|fixme:)|fatal error|Unhandled Exception|EXCEPTION_|Assertion failed|wine: (err|unhandled)|err:module:|import_dll|d3d|dxgi|vulkan|vk_/i.test(
      line
    )

  const picked: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (isNoise(line)) continue
    if (interesting(line)) picked.push(line)
  }

  const src = picked.length ? picked : lines.filter(l => l && !isNoise(l))
  if (!src.length) return null

  const tail = src.slice(Math.max(0, src.length - maxLines))
  return tail.join('\n')
}

function configureLinuxTempDir() {
  if (process.platform !== 'linux') return
  const home = os.homedir()
  if (!home) return

  const tmpDir = path.join(home, '.local', 'share', 'of-launcher', 'tmp')
  try {
    fs.mkdirSync(tmpDir, { recursive: true })
  } catch (err) {
    console.warn('[TempDir] Failed to create tmp dir:', tmpDir, err)
    return
  }

  process.env.TMPDIR = tmpDir
  process.env.TMP = tmpDir
  process.env.TEMP = tmpDir

  try {
    app.setPath('temp', tmpDir)
  } catch (err) {
    console.warn('[TempDir] Failed to set Electron temp path:', err)
  }
}

function isDirWritableAndExecutable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK | fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// Suppress noisy UTP connection reset errors from utp-native (network transient)
const UTP_LOG_INTERVAL_MS = 5000
let lastUtpLogAt = 0
let suppressedUtpCount = 0

function handleUtpConnReset(source: 'exception' | 'promise', message: string) {
  suppressedUtpCount++
  const now = Date.now()
  if (now - lastUtpLogAt < UTP_LOG_INTERVAL_MS) return

  lastUtpLogAt = now
  const suppressed = suppressedUtpCount - 1
  suppressedUtpCount = 0

  const suffix = suppressed > 0 ? ` (+${suppressed} suppressed)` : ''
  const tag = source === 'promise' ? ' (promise)' : ''
  console.warn(`[UTP] Ignored UTP_ECONNRESET${tag}:${suffix}`, message)
}

process.on('uncaughtException', (err) => {
  if (err && typeof err.message === 'string' && err.message.includes('UTP_ECONNRESET')) {
    handleUtpConnReset('exception', err.message)
    return
  }
  throw err
})

process.on('unhandledRejection', (reason: any) => {
  if (reason && typeof (reason as any).message === 'string' && (reason as any).message.includes('UTP_ECONNRESET')) {
    handleUtpConnReset('promise', (reason as any).message)
    return
  }
  console.error('Unhandled rejection:', reason)
})

const fetchSteamBanner = async (title: string): Promise<string | null> => {
  try {
    const normalize = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .trim()

    const scoreNameMatch = (candidate: string, query: string) => {
      const a = normalize(candidate)
      const b = normalize(query)
      if (!a || !b) return 0
      if (a === b) return 1000
      if (a.includes(b)) return 700
      if (b.includes(a)) return 650
      const aTokens = new Set(a.split(' ').filter(Boolean))
      const bTokens = new Set(b.split(' ').filter(Boolean))
      let overlap = 0
      for (const t of aTokens) if (bTokens.has(t)) overlap++
      return overlap * 50
    }

    const isValidImageUrl = async (url: string) => {
      try {
        const resp = await axios.get(url, {
          timeout: 8000,
          responseType: 'arraybuffer',
          headers: { Range: 'bytes=0-1023' },
          validateStatus: (s) => s === 200 || s === 206
        })
        const ct = String(resp.headers?.['content-type'] || '')
        return ct.startsWith('image/')
      } catch {
        return false
      }
    }

    const query = encodeURIComponent(title)
    const searchUrl = `https://store.steampowered.com/api/storesearch?term=${query}&l=english&cc=us`
    const resp = await axios.get(searchUrl, { timeout: 8000 })
    const items = (resp.data?.items || []) as Array<{ id: number; name?: string; tiny_image?: string }>
    const best = items
      .map((it) => ({ it, score: scoreNameMatch(it.name || String(it.id), title) }))
      .sort((a, b) => b.score - a.score)[0]?.it
    const appid = best?.id ?? null
    if (!appid) return null

    // Prefer Steam's appdetails for known-good image URLs when available
    let appDetails: any = null
    try {
      const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
      const d = await axios.get(detailsUrl, { timeout: 8000 })
      appDetails = d.data?.[String(appid)]?.data || null
    } catch {
      // ignore
    }

    const candidates: string[] = []

    // Try library assets first (best quality for launcher library cards)
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`
    )

    // appdetails-provided URLs (often more reliable than guessing filenames)
    if (appDetails?.header_image) candidates.unshift(String(appDetails.header_image))
    if (appDetails?.capsule_image) candidates.push(String(appDetails.capsule_image))
    if (appDetails?.capsule_imagev5) candidates.push(String(appDetails.capsule_imagev5))

    // storesearch-provided tiny_image fallback
    if (best?.tiny_image) candidates.push(String(best.tiny_image))

    // Pick the first URL that actually returns an image
    for (const url of candidates) {
      if (!url) continue
      // avoid doing many requests if the first one already works
      // (we validate because storesearch can return wrong appid and many apps don't have library_600x900)
      // eslint-disable-next-line no-await-in-loop
      const ok = await isValidImageUrl(url)
      if (ok) return url
    }

    return null
  } catch (err) {
    console.warn('[Artwork] Failed to fetch banner from Steam:', err)
    return null
  }
}

const fetchAndPersistBanner = async (gameUrl: string, title: string) => {
  try {
    const banner = await fetchSteamBanner(title || gameUrl)
    if (banner) {
      updateGameInfo(gameUrl, { image_url: banner })
    }
  } catch (err) {
    console.warn('[Artwork] Failed to auto-fetch banner:', err)
  }
}

function detectSteamAppIdFromInstall(installDir: string): string | null {
  try {
    if (!installDir || !fs.existsSync(installDir)) return null

    const steamAppIdTxt = path.join(installDir, 'steam_appid.txt')
    if (fs.existsSync(steamAppIdTxt)) {
      const raw = fs.readFileSync(steamAppIdTxt, 'utf8').trim()
      const id = raw.match(/\d+/)?.[0]
      if (id) return id
    }
  } catch {
    // ignore
  }
  return null
}

async function prepareGamePrefixAfterInstall(gameUrl: string, title: string, installPath: string) {
  if (!isLinux()) return
  if (getSetting('use_proton') !== 'true') return
  if (!installPath || !fs.existsSync(installPath)) return

  try {
    const game = getGame(gameUrl) as any

    if (game?.proton_prefix) return

    const stableId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
    const slug = stableId ? `game_${stableId}` : slugify(title || game?.title || gameUrl || 'game')
    const runtime = (game?.proton_runtime as string | null) || findProtonRuntime() || undefined
    const prefix = await ensureGamePrefixFromDefault(slug, runtime, undefined, false)
    updateGameInfo(gameUrl, { proton_prefix: prefix })
  } catch (err) {
    console.warn('[Proton] Failed to prepare prefix after install:', err)
  }
}

// Must run before Chromium initializes temp/shared-memory files (AppImage/container environments may have broken /tmp or /dev/shm).
configureLinuxTempDir()

// Disable Chromium sandbox in constrained environments (CI/containers)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-setuid-sandbox')
app.commandLine.appendSwitch('disable-seccomp-filter-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
// Only disable /dev/shm usage if /dev/shm is missing/unusable (otherwise it may unnecessarily force /tmp).
if (process.platform === 'linux' && (!fs.existsSync('/dev/shm') || !isDirWritableAndExecutable('/dev/shm'))) {
  app.commandLine.appendSwitch('disable-dev-shm-usage')
}
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor')
app.commandLine.appendSwitch('disable-namespace-sandbox')
app.disableHardwareAcceleration()

function isTorrentListing(url: string) {
  return url.includes('/torrents/') || url.endsWith('.torrent')
}

ipcMain.handle('start-torrent-download', async (_event: IpcMainInvokeEvent, torrentUrl: string, referer?: string) => {
  console.log('[Main] 🎯 start-torrent-download called!')
  console.log('[Main] Torrent URL:', torrentUrl)
  console.log('[Main] Referer:', referer)

  try {
    // Check if it's a torrent directory URL or direct .torrent file
    let actualTorrentUrl = torrentUrl

    if (torrentUrl.includes('/torrents/') && !torrentUrl.endsWith('.torrent')) {
      console.log('[Main] This is a torrent directory, need to scrape for .torrent file')
      actualTorrentUrl = await resolveTorrentFileUrl(torrentUrl, TORRENT_PARTITION)
      console.log('[Main] Resolved torrent file URL:', actualTorrentUrl)
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
      console.log('[Main] Download progress:', progress.toFixed(2) + '%')
      mainWindow?.webContents.send('download-progress', {
        magnet: actualTorrentUrl,
        progress,
        speed: details?.downloadSpeed || 0,
        downloaded: details?.downloaded || 0,
        total: details?.total || 0,
        eta: details?.timeRemaining || 0,
        infoHash: details?.infoHash || actualTorrentUrl,
        stage: details?.stage || 'download',
        extractProgress: (details as any)?.extractProgress,
        destPath: (details as any)?.destPath
      })
    })

    if (!result.success) {
      console.warn('[Main] Download did not start/was cancelled:', result.error)
      return { success: false, error: result.error }
    }

    const completed = getDownloadByUrl(actualTorrentUrl) as { info_hash?: string; dest_path?: string | null } | undefined
    if (completed || result.installPath) {
      mainWindow?.webContents.send('download-complete', {
        magnet: actualTorrentUrl,
        infoHash: completed?.info_hash || undefined,
        destPath: result.installPath || completed?.dest_path
      })
      // Auto-fetch banner once installed
      fetchAndPersistBanner(gamePageUrl, title).catch(() => {})
      if (result.installPath) {
        prepareGamePrefixAfterInstall(gamePageUrl, title, result.installPath).catch(() => {})
      }
    }

    console.log('[Main] ✅ Download started successfully!')
    return { success: true }
  } catch (err: any) {
    console.error('[Main] ❌ Download failed:', err)
    return { success: false, error: err?.message || String(err) }
  }
})

async function handleExternalDownload(url: string) {
  if (!isTorrentListing(url)) return

  const referer = mainWindow?.webContents.getURL() || url
  try {
    const torrentUrl = url.endsWith('.torrent') ? url : await resolveTorrentFileUrl(url, TORRENT_PARTITION)
    let title = deriveTitleFromTorrentUrl(torrentUrl)
    let version = 'unknown'

    // Try to scrape title and version from the game page
    if (referer && referer.includes('online-fix.me') && !referer.includes('/torrents/')) {
      console.log('[Launcher] Scraping game info from referer:', referer)
      const gameInfo = await scrapeGameInfo(referer)
      if (gameInfo.title) title = gameInfo.title
      if (gameInfo.version) version = gameInfo.version
    }

    console.log('[Launcher] Auto-starting torrent download from external page:', torrentUrl)
    console.log('[Launcher] Title:', title, 'Version:', version)
    const result = await startGameDownload({
      gameUrl: referer,
      torrentMagnet: torrentUrl,
      gameTitle: title,
      gameVersion: version
    }, (progress, details) => {
      mainWindow?.webContents.send('download-progress', {
        magnet: torrentUrl,
        progress,
        speed: details?.downloadSpeed || 0,
        downloaded: details?.downloaded || 0,
        total: details?.total || 0,
        eta: details?.timeRemaining || 0,
        infoHash: details?.infoHash || torrentUrl,
        stage: details?.stage || 'download',
        extractProgress: (details as any)?.extractProgress,
        destPath: (details as any)?.destPath
      })
    })
    const completed = getDownloadByUrl(torrentUrl) as { info_hash?: string; dest_path?: string | null } | undefined
    if (completed || result.installPath) {
      mainWindow?.webContents.send('download-complete', {
        magnet: torrentUrl,
        infoHash: completed?.info_hash || undefined,
        destPath: result.installPath || completed?.dest_path
      })
      if (result.installPath) {
        prepareGamePrefixAfterInstall(referer, title, result.installPath).catch(() => {})
      }
    }
  } catch (err) {
    console.warn('Could not resolve torrent from external page', err)
  }
}

async function createMainWindow() {
  const preloadPath = process.env.NODE_ENV === 'development' || require('electron-is-dev')
    ? path.join(__dirname, '../../dist-preload/preload.js')
    : path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true // Enable webview tag for embedded browser
    }
  })

  if (process.env.NODE_ENV === 'development' || require('electron-is-dev')) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools() // Open DevTools in development
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function createAuthWindow() {
  const authWin = new BrowserWindow({
    width: 900,
    height: 700,
    parent: mainWindow || undefined,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: TORRENT_PARTITION // Use same partition as webview!
    }
  })

  console.log('[Auth] Opening auth window with partition:', TORRENT_PARTITION)
  authWin.loadURL('https://online-fix.me/login/')

  authWin.on('close', async () => {
    console.log('[Auth] Auth window closed, checking for cookies...')
    // Get cookies from the torrent partition session
    const ses = session.fromPartition(TORRENT_PARTITION)
    const cookies = await ses.cookies.get({ url: 'https://online-fix.me' })
    console.log('[Auth] Found cookies after login:', cookies.map(c => c.name))
    mainWindow?.webContents.send('cookies-saved', cookies)
  })
}

app.whenReady().then(async () => {
  await importCookies('https://online-fix.me')
  await resumeActiveDownloads()

  // Enhanced ad blocking - Network level + BrowserWindow level
  console.log('[AdBlock Pro] Initializing advanced ad blocker...')

  const filter = {
    urls: ['<all_urls>']
  }

  let blockedCount = 0
  const webviewSession = session.fromPartition(TORRENT_PARTITION)
  webviewSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    // Deny all permission prompts to prevent notification overlays/popups
    callback(false)
  })

  // Network-level blocking
  webviewSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const shouldBlock = shouldBlockRequest(details.url)
    if (shouldBlock) {
      blockedCount++
      console.log(`[AdBlock Pro] Network Block #${blockedCount}:`, details.url.substring(0, 80))
      callback({ cancel: true })
    } else {
      callback({ cancel: false })
    }
  })

  console.log('[AdBlock Pro] Network-level blocking enabled')

  // CRITICAL: Block ALL popunders at BrowserWindow level
  app.on('web-contents-created', (_event, contents) => {
    // Block ANY attempt to open new windows (but handle torrents specially)
    contents.setWindowOpenHandler(({ url }) => {
      // Check if it's a torrent URL
      if (isTorrentListing(url)) {
        console.log('[AdBlock Pro] New window is torrent download, handling:', url.substring(0, 80))
        handleExternalDownload(url).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return { action: 'deny' } // Still deny the window, but we handle it ourselves
      }

      // Block all other popunders
      console.log('[AdBlock Pro] BLOCKED popunder:', url.substring(0, 80))
      return { action: 'deny' }
    })

    contents.on('new-window' as any, (event: Electron.Event, url: string) => {
      event.preventDefault()
      console.log('[AdBlock Pro] Blocked new-window popunder:', url)
    })

    // Block navigation to ad URLs (but ALLOW torrent URLs)
    contents.on('will-navigate', (event, navigationUrl) => {
      // Check if it's a torrent link FIRST (priority)
      if (isTorrentListing(navigationUrl)) {
        console.log('[AdBlock Pro] Detected torrent navigation, allowing and handling:', navigationUrl.substring(0, 80))
        event.preventDefault()
        handleExternalDownload(navigationUrl).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return
      }

      // Then check if it's an ad URL to block
      const blocked = shouldBlockRequest(navigationUrl)
      if (blocked) {
        console.log('[AdBlock Pro] Blocked navigation:', navigationUrl.substring(0, 80))
        event.preventDefault()
        return
      }
    })

    // Block redirects to ad URLs (but ALLOW torrent URLs)
    contents.on('will-redirect', (event, navigationUrl) => {
      // Check if it's a torrent link FIRST (priority)
      if (isTorrentListing(navigationUrl)) {
        console.log('[AdBlock Pro] Detected torrent redirect, allowing and handling:', navigationUrl.substring(0, 80))
        event.preventDefault()
        handleExternalDownload(navigationUrl).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return
      }

      // Then check if it's an ad URL to block
      const shouldBlock = shouldBlockRequest(navigationUrl)
      if (shouldBlock) {
        console.log('[AdBlock Pro] Blocked redirect:', navigationUrl.substring(0, 80))
        event.preventDefault()
      }
    })
  })

  console.log('[AdBlock Pro] Popunder blocking enabled at BrowserWindow level')
  console.log('[AdBlock Pro] All protection layers active!')

  createMainWindow()

  ipcMain.handle('open-auth-window', async () => {
    await createAuthWindow()
    return true
  })

  ipcMain.handle('get-user-profile', async () => {
    const profile = await fetchUserProfile()
    if (profile.name || profile.avatar) return { success: true, ...profile }
    return { success: false, error: 'Perfil não encontrado', ...profile }
  })

  ipcMain.handle('get-cookie-header', async (event, url: string) => {
    const cookieHeader = await import('./cookieManager').then(m => m.getCookieHeaderForUrl(url))
    return cookieHeader
  })

  ipcMain.handle('export-cookies', async (event, url?: string) => {
    const cookies = await import('./cookieManager').then(m => m.exportCookies(url))
    return cookies
  })

  ipcMain.handle('check-game-version', async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const info = await fetchGameUpdateInfo(url)
      if (!info.version) throw new Error('Versao nao encontrada na pagina')
      // Return torrentUrl as an extra field for future use
      return { success: true, version: info.version, torrentUrl: info.torrentUrl }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fetch-game-update-info', async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const info = await fetchGameUpdateInfo(url)
      if (info.version) updateGameInfo(url, { latest_version: info.version })
      if (info.torrentUrl) {
        updateGameInfo(url, { torrent_magnet: info.torrentUrl, download_url: info.torrentUrl })
      }
      return { success: true, latest: info.version || null, torrentUrl: info.torrentUrl || null }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao obter dados de atualização' }
    }
  })

  ipcMain.handle('download-http', async (_event: IpcMainInvokeEvent, url: string, destPath: string) => {
    try {
      await downloadFile(url, destPath, (p) => {
        mainWindow?.webContents.send('download-progress', { url, progress: p })
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-torrent', async (_event: IpcMainInvokeEvent, magnet: string, destPath: string) => {
    try {
      await downloadTorrent(magnet, destPath, (p) => {
        mainWindow?.webContents.send('download-progress', { magnet, progress: p })
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
      mainWindow?.webContents.send('download-deleted')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-onlinefix-ini', async (_event, gameUrl: string) => {
    try {
      return readOnlineFixIni(gameUrl)
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao ler OnlineFix.ini' }
    }
  })

  ipcMain.handle('save-onlinefix-ini', async (_event, gameUrl: string, content: string) => {
    try {
      return writeOnlineFixIni(gameUrl, content)
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao salvar OnlineFix.ini' }
    }
  })

  ipcMain.handle('get-games', async () => {
    try {
      const games = getAllGames()
      return { success: true, games }
    } catch (err: any) {
      return { success: false, error: err.message, games: [] }
    }
  })

ipcMain.handle('fetch-game-image', async (_event, gameUrl: string, title: string) => {
  try {
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

  ipcMain.handle('set-game-image-url', async (_event, gameUrl: string, imageUrl: string | null) => {
    try {
      const value = (imageUrl || '').trim()
      if (!value) {
        updateGameInfo(gameUrl, { image_url: null })
        return { success: true, imageUrl: null }
      }

      if (value.length > 2048) return { success: false, error: 'URL muito longa' }

      const allowed = value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://')
      if (!allowed) {
        return { success: false, error: 'URL inválida (use http(s):// ou file://)' }
      }

      updateGameInfo(gameUrl, { image_url: value })
      return { success: true, imageUrl: value }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao definir banner' }
    }
  })

  ipcMain.handle('pick-game-banner-file', async (_event, gameUrl: string) => {
    try {
      const parent = BrowserWindow.getFocusedWindow() || mainWindow || undefined
      const options = {
        title: 'Selecionar banner (imagem)',
        properties: ['openFile'] as Array<'openFile'>,
        filters: [
          { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'Todos os arquivos', extensions: ['*'] }
        ]
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true }
      }

      const srcPath = result.filePaths[0]
      const ext = (path.extname(srcPath) || '.png').toLowerCase()
      const game = getGame(gameUrl) as any
      const stableId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
      const slug = stableId ? `game_${stableId}` : slugify(String(game?.title || gameUrl || 'game'))

      const imagesDir = path.join(app.getPath('userData'), 'images')
      fs.mkdirSync(imagesDir, { recursive: true })

      const destPath = path.join(imagesDir, `${slug}${ext}`)
      fs.copyFileSync(srcPath, destPath)

      const fileUrl = pathToFileURL(destPath).toString()
      updateGameInfo(gameUrl, { image_url: fileUrl })
      return { success: true, imageUrl: fileUrl, path: destPath }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao selecionar imagem' }
    }
  })


  ipcMain.handle('delete-game', async (_event, url: string) => {
    try {
      // Get game info before deleting to get install_path
      const game = await import('./db.js').then(m => m.getGame(url)) as { install_path?: string } | undefined

      // Delete game folder if it exists
      if (game?.install_path) {
        const installPath = path.isAbsolute(game.install_path)
          ? game.install_path
          : path.resolve(process.cwd(), game.install_path)

        if (fs.existsSync(installPath)) {
          console.log('[DeleteGame] Removing game folder:', installPath)
          try {
            fs.rmSync(installPath, { recursive: true, force: true })
            console.log('[DeleteGame] Game folder removed successfully')
          } catch (folderErr: any) {
            console.warn('[DeleteGame] Failed to remove game folder:', folderErr.message)
            // Continue to delete from DB even if folder deletion fails
          }
        }
      }

      // Delete from database
      deleteGame(url)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open-game-folder', async (_event, installPath?: string) => {
    try {
      if (!installPath) return { success: false, error: 'Path not provided' }
      const normalized = path.isAbsolute(installPath) ? installPath : path.resolve(process.cwd(), installPath)
      await shell.openPath(normalized)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('configure-game-exe', async (_event, gameUrl: string) => {
    try {
      const { dialog } = require('electron')
      const res = await dialog.showOpenDialog({
        title: 'Selecione o executável do jogo',
        properties: ['openFile'],
        filters: [{ name: 'Executáveis', extensions: ['exe'] }]
      })
      if (res.canceled || !res.filePaths.length) return { success: false, error: 'Nenhum arquivo selecionado' }
      const exePath = res.filePaths[0]
      updateGameInfo(gameUrl, { executable_path: exePath })
      return { success: true, exePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('set-game-version', async (_event, gameUrl: string, version: string) => {
    try {
      updateGameInfo(gameUrl, { installed_version: version })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('set-game-title', async (_event, gameUrl: string, title: string) => {
    try {
      updateGameInfo(gameUrl, { title })
      fetchAndPersistBanner(gameUrl, title).catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('check-all-updates', async () => {
    try {
      const games = (getAllGames() as any[]).filter((g: any) => g?.url)
      const results: Array<{ url: string; latest?: string; torrentUrl?: string; error?: string }> = []

      for (const g of games) {
        try {
          const info = await fetchGameUpdateInfo(String(g.url))
          if (!info.version) throw new Error('Versao nao encontrada na pagina')
          const payload: any = { latest_version: info.version }
          if (info.torrentUrl) {
            payload.torrent_magnet = info.torrentUrl
            payload.download_url = info.torrentUrl
          }
          updateGameInfo(g.url, payload)
          results.push({ url: g.url, latest: info.version, torrentUrl: info.torrentUrl || undefined })
          mainWindow?.webContents.send('game-version-update', { url: g.url, latest: info.version })
        } catch (err: any) {
          results.push({ url: String(g.url), error: err?.message || 'unknown error' })
        }
      }

      return { success: true, results }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao verificar atualizações' }
    }
  })

  ipcMain.handle('set-game-proton-options', async (_event, gameUrl: string, runtime: string, options: any) => {
    try {
      updateGameInfo(gameUrl, { proton_runtime: runtime || null })
      updateGameInfo(gameUrl, { proton_options: JSON.stringify(options || {}) })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('set-game-proton-prefix', async (_event, gameUrl: string, prefixPath: string | null) => {
    try {
      updateGameInfo(gameUrl, { proton_prefix: prefixPath || null })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('set-game-steam-appid', async (_event, gameUrl: string, steamAppId: string | null) => {
    try {
      const clean = steamAppId && String(steamAppId).trim() !== '' ? String(steamAppId).trim() : null
      updateGameInfo(gameUrl, { steam_app_id: clean })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-settings', async () => {
    try {
      const downloadPath = getSetting('download_path') || path.join(process.cwd(), 'downloads')
      const autoExtract = getSetting('auto_extract') !== 'false'
      const autoUpdate = getSetting('auto_update') === 'true'
      const parallelDownloads = Number(getSetting('parallel_downloads') || 3)
      const useProton = getSetting('use_proton') === 'true'
      const protonPath = getSetting('proton_runtime_root') || getSetting('proton_runtime_path') || ''
      return { success: true, settings: { downloadPath, autoExtract, autoUpdate, parallelDownloads, useProton, protonPath } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-settings', async (_event, settings: any) => {
    try {
      if (settings.downloadPath) setSetting('download_path', settings.downloadPath)
      setSetting('auto_extract', settings.autoExtract ? 'true' : 'false')
      setSetting('auto_update', settings.autoUpdate ? 'true' : 'false')
      setSetting('parallel_downloads', String(settings.parallelDownloads || 3))
      setSetting('use_proton', settings.useProton ? 'true' : 'false')
      if (settings.protonPath) {
        setCustomProtonRoot(settings.protonPath)
        setSavedProtonRuntime(settings.protonPath)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('select-directory', async () => {
    try {
      const { dialog } = require('electron')
      const res = await dialog.showOpenDialog({
        title: 'Selecione uma pasta',
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || !res.filePaths.length) return { success: false, error: 'Nenhuma pasta selecionada' }
      return { success: true, path: res.filePaths[0] }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

	  ipcMain.handle('launch-game', async (_event, gameUrl: string) => {
	  try {
      const existing = runningGames.get(gameUrl)
      if (existing?.pid && isPidAlive(existing.pid)) {
        sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Jogo já está em execução', pid: existing.pid })
        return { success: false, error: 'Jogo já está em execução' }
      }
      if (inFlightPrefixJobs.has(gameUrl)) {
        sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Prefixo está sendo preparado/atualizado. Aguarde.' })
        return { success: false, error: 'Prefixo está sendo preparado/atualizado. Aguarde.' }
      }
	    sendGameLaunchStatus({ gameUrl, status: 'starting' })
	    console.log('[Launch] ========================================')
	    console.log('[Launch] Requested launch for:', gameUrl)
	    
	    const game = getAllGames().find((g: any) => g.url === gameUrl) as any
	    if (!game) {
	      console.error('[Launch] ❌ Game not found in database')
	      sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Jogo não encontrado' })
	      return { success: false, error: 'Jogo não encontrado' }
	    }
    
    console.log('[Launch] 📋 Game data:', {
      title: game.title,
      install_path: game.install_path,
      executable_path: game.executable_path,
      proton_runtime: game.proton_runtime,
      proton_prefix: game.proton_prefix,
      proton_options: game.proton_options
    })
    
    let exePath = game.executable_path as string | null
    
    // Resolve install dir
    let installDir: string = process.cwd()
    if (game.install_path) {
      installDir = path.isAbsolute(game.install_path) 
        ? game.install_path 
        : path.resolve(process.cwd(), game.install_path)
    } else if (exePath) {
      installDir = path.dirname(exePath)
    }
    
    console.log('[Launch] 📁 Install directory:', installDir)
    console.log('[Launch] 📁 Directory exists:', fs.existsSync(installDir))

	    if (!fs.existsSync(installDir)) {
	      console.error('[Launch] ❌ Install dir not found:', installDir)
	      sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Pasta de instalação não encontrada' })
	      return { success: false, error: 'Pasta de instalação não encontrada' }
	    }

    // Try to auto-find executable if not configured or missing
    if (!exePath || !fs.existsSync(path.isAbsolute(exePath) ? exePath : path.join(installDir, exePath))) {
      console.log('[Launch] 🔍 Auto-searching for executable...')
      const autoExe = installDir ? findExecutableInDir(installDir) : null
      if (autoExe) {
        exePath = autoExe
        updateGameInfo(gameUrl, { executable_path: exePath })
        console.log('[Launch] ✅ Auto-detected executable:', exePath)
      } else {
        console.log('[Launch] ⚠️ No executable found automatically')
      }
    }

	    if (!exePath) {
	      console.error('[Launch] ❌ No executable configured')
	      sendGameLaunchStatus({ gameUrl, status: 'error', message: 'missing_exe' })
	      return { success: false, error: 'missing_exe' }
	    }

    // Resolve exe path relative to install dir if not absolute
    exePath = path.isAbsolute(exePath) ? exePath : path.join(installDir, exePath)
    
    console.log('[Launch] 🎮 Executable path:', exePath)
    console.log('[Launch] 🎮 Executable exists:', fs.existsSync(exePath))

	    if (!fs.existsSync(exePath)) {
	      console.error('[Launch] ❌ Executable not found at', exePath)
	      sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Executável não encontrado' })
	      return { success: false, error: 'Executável não encontrado' }
	    }

	    let child: any
	    let stderrTail = ''
	    let protonLogPath: string | undefined

		    if (isLinux() && exePath.toLowerCase().endsWith('.exe')) {
	      console.log('[Launch] 🐧 Linux detected, using Proton...')
	      
	      const stableId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
	      const slug = stableId ? `game_${stableId}` : slugify(game.title || gameUrl)
	      console.log('[Launch] 🏷️ Game slug:', slug)
	      
	      const protonOpts = game.proton_options ? JSON.parse(game.proton_options) : {}
	      console.log('[Launch] ⚙️ Proton options:', protonOpts)
	      
		      const managedRoot = getPrefixRootDir()
		      const storedPrefix = typeof game.proton_prefix === 'string' ? String(game.proton_prefix) : ''
		      const hasCustomPrefix = !!(storedPrefix && !storedPrefix.startsWith(managedRoot))
		      const storedExists = !!(storedPrefix && fs.existsSync(storedPrefix))
		      if (hasCustomPrefix && !storedExists) {
		        console.warn('[Launch] ⚠️ Custom prefix path does not exist:', storedPrefix)
		      }

		      // Managed prefixes must match the selected runtime; mixing runtimes inside the same prefix
		      // frequently breaks (wineserver version mismatch / invalid prefix version).
		      const prefixPath = hasCustomPrefix
		        ? storedPrefix
		        : await ensureGamePrefixFromDefault(slug, game.proton_runtime || undefined, undefined, false)
		      console.log('[Launch] 📂 Prefix path:', prefixPath)
		      console.log('[Launch] 📂 Prefix exists:', fs.existsSync(prefixPath))
		      if (!hasCustomPrefix && game.proton_prefix !== prefixPath) {
		        updateGameInfo(gameUrl, { proton_prefix: prefixPath })
		      }

		      const stableNumericId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
		      const derivedAppId = stableNumericId && /^\d+$/.test(stableNumericId) ? stableNumericId : '480'
		      const steamAppId = (game?.steam_app_id as string | null) || detectSteamAppIdFromInstall(installDir) || derivedAppId

          // Run known redistributables from _CommonRedist once per prefix (VC++/DirectX)
          let redistRes: { ran: boolean; ok: boolean; details?: string } = { ran: false, ok: true }
          try {
            sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'Verificando dependências...' })
            redistRes = await ensureGameCommonRedists(installDir, prefixPath, game.proton_runtime || undefined, (msg) => {
              sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
            })
            if (redistRes.ran) {
              sendGameLaunchStatus({ gameUrl, status: 'starting', message: redistRes.ok ? 'Dependências instaladas' : 'Dependências: alguns installers falharam' })
            }
          } catch (err: any) {
            console.warn('[Launch] Failed to run common redists:', err)
          }

          // Ensure prefix-level deps (VC++ etc) are satisfied for managed prefixes.
          // This is cheap when already done (fast no-op), and fixes games that don't ship _CommonRedist VC++.
          if (!hasCustomPrefix) {
            try {
              await ensurePrefixDefaults(prefixPath, game.proton_runtime || undefined, undefined, (msg) => {
                sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
              })
            } catch (err: any) {
              console.warn('[Launch] ensurePrefixDefaults failed:', err)
            }
          }

		      console.log('[Launch] 🔧 Building Proton launch command...')
		      const launch = buildProtonLaunch(
		        exePath, 
		        [], 
		        slug, 
		        game.proton_runtime || undefined, 
		        { ...protonOpts, steamAppId, installDir }, 
		        prefixPath
		      )
      
      console.log('[Launch] 🚀 Proton launch config:', {
        cmd: launch.cmd,
        args: launch.args,
        runner: launch.runner,
        env_keys: Object.keys(launch.env || {})
      })
      
	      if (!launch.runner) {
	        console.error('[Launch] ❌ Proton runner not found!')
	        console.error('[Launch] 💡 Dica: Configure um Proton válido nas configurações do jogo')
	        sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Proton não encontrado. Configure nas opções do jogo.' })
	        return { success: false, error: 'Proton não encontrado. Configure nas opções do jogo.' }
	      }
      
	      if (!launch.cmd) {
	        console.error('[Launch] ❌ Proton command is empty!')
	        sendGameLaunchStatus({ gameUrl, status: 'error', message: 'Comando Proton inválido' })
	        return { success: false, error: 'Comando Proton inválido' }
	      }
      
      console.log('[Launch] 🎯 Full command:', launch.cmd, launch.args?.join(' '))
      console.log('[Launch] 📁 Working directory:', installDir)
      console.log('[Launch] 🌍 Environment variables:')
      Object.entries(launch.env || {}).forEach(([k, v]) => {
        console.log(`  ${k}=${v}`)
      })
      
	      // IMPORTANTE: Não usar stdio: 'ignore' para poder ver erros
	      child = spawn(launch.cmd, launch.args, { 
	        env: { ...process.env, ...launch.env }, 
	        cwd: installDir, 
	        detached: true,
	        stdio: ['ignore', 'pipe', 'pipe'] // Capturar stdout e stderr
	      })
	      try {
	        const logDir = String((launch.env as any)?.PROTON_LOG_DIR || '')
	        const appId = String((launch.env as any)?.SteamAppId || (launch.env as any)?.STEAM_COMPAT_APP_ID || '')
	        if (logDir && appId) protonLogPath = path.join(logDir, `steam-${appId}.log`)
	      } catch {
	        // ignore
	      }
	      
	      // Capturar saída para debug
	      child.stdout?.on('data', (data: Buffer) => {
	        console.log('[Game stdout]', data.toString())
	      })
	      
	      child.stderr?.on('data', (data: Buffer) => {
	        console.error('[Game stderr]', data.toString())
	        stderrTail = (stderrTail + data.toString()).slice(-8192)
	      })
	      
	      child.on('error', (err: Error) => {
	        console.error('[Launch] ❌ Spawn error:', err)
	        sendGameLaunchStatus({ gameUrl, status: 'error', message: err.message || String(err), stderrTail, protonLogPath })
	      })
	      
			      child.on('exit', (code: number, signal: string) => {
			        console.log('[Launch] 🏁 Process exited with code:', code, 'signal:', signal)
            try { runningGames.delete(gameUrl) } catch {}
			        let mergedTail = stderrTail
			        const shouldAppendLog = (code != null && Number(code) !== 0) || !!signal
			        if (shouldAppendLog && protonLogPath) {
			          const logRawTail = readFileTailBytes(protonLogPath, 256 * 1024)
			          if (logRawTail) {
                  const filtered = extractInterestingProtonLog(logRawTail, 160) || logRawTail.split(/\r?\n/).slice(-120).join('\n')
                  mergedTail = trimToMaxChars(
                    mergedTail + '\n\n--- PROTON LOG (filtered) ---\n' + filtered,
                    8192
                  )
                  console.error('[Proton log]', protonLogPath)
                  console.error('[Proton log filtered tail]', filtered)
                } else {
                  console.error('[Proton log missing]', protonLogPath)
                }
		        }
		        sendGameLaunchStatus({ gameUrl, status: 'exited', code, signal, stderrTail: mergedTail, protonLogPath })
		      })
	      
	    } else {
      console.log('[Launch] 🪟 Starting native exe:', exePath)
      console.log('[Launch] 📁 Working directory:', installDir)
      
      child = spawn(exePath, [], { 
        cwd: installDir, 
        detached: true, 
        stdio: ['ignore', 'pipe', 'pipe']
      })
      
      child.stdout?.on('data', (data: Buffer) => {
        console.log('[Game stdout]', data.toString())
      })
      
	      child.stderr?.on('data', (data: Buffer) => {
	        console.error('[Game stderr]', data.toString())
	        stderrTail = (stderrTail + data.toString()).slice(-8192)
	      })
	      
	      child.on('error', (err: Error) => {
	        console.error('[Launch] ❌ Spawn error:', err)
	        sendGameLaunchStatus({ gameUrl, status: 'error', message: err.message || String(err), stderrTail })
	      })
	      
		      child.on('exit', (code: number, signal: string) => {
		        console.log('[Launch] 🏁 Process exited with code:', code, 'signal:', signal)
            try { runningGames.delete(gameUrl) } catch {}
		        sendGameLaunchStatus({ gameUrl, status: 'exited', code, signal, stderrTail })
		      })
		    }
		    
        if (child?.pid) {
          runningGames.set(gameUrl, { pid: child.pid, child, protonLogPath })
        }
		    child.unref()
		    console.log('[Launch] ✅ Game process started successfully (PID:', child.pid, ')')
		    console.log('[Launch] ========================================')
		    sendGameLaunchStatus({ gameUrl, status: 'running', pid: child.pid, protonLogPath })
	    
	    return { success: true }
	    
	  } catch (err: any) {
	    console.error('[Launch] 💥 Exception:', err)
	    console.error('[Launch] Stack:', err?.stack)
	    sendGameLaunchStatus({ gameUrl, status: 'error', message: err?.message || String(err) })
	    return { success: false, error: err.message }
	  }
		})

    ipcMain.handle('stop-game', async (_event, gameUrl: string, force?: boolean) => {
      try {
        const entry = runningGames.get(gameUrl)
        const pid = entry?.pid
        if (!pid || !isPidAlive(pid)) {
          try { runningGames.delete(gameUrl) } catch {}
          return { success: false, error: 'Jogo não está em execução' }
        }

        sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'Parando jogo...', pid })

        // First try a graceful stop.
        killProcessTreeBestEffort(pid, 'SIGTERM')

        const waitMs = async (ms: number) => await new Promise<void>(r => setTimeout(r, ms))
        await waitMs(2500)

        if (force === true && isPidAlive(pid)) {
          killProcessTreeBestEffort(pid, 'SIGKILL')
          await waitMs(800)
        } else if (isPidAlive(pid)) {
          // Escalate if it didn't stop.
          killProcessTreeBestEffort(pid, 'SIGKILL')
          await waitMs(800)
        }

        if (!isPidAlive(pid)) {
          try { runningGames.delete(gameUrl) } catch {}
          return { success: true }
        }

        // Still alive; report failure.
        return { success: false, error: `Falha ao encerrar processo (PID ${pid})` }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    })

  ipcMain.handle('proton-ensure-runtime', async (_event, customPath?: string) => {
    try {
      if (customPath) {
        setSavedProtonRuntime(customPath)
      }
      const runtime = findProtonRuntime()
      if (!runtime) return { success: false, error: 'Proton runtime not found. Configure a path manually.' }
      const runner = buildProtonLaunch('/bin/true', [], 'probe', runtime).runner
      if (!runner) return { success: false, error: 'Proton runner not found in runtime.' }
      return { success: true, runtime, runner }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('proton-list-runtimes', async () => {
    try {
      const runtimes = listProtonRuntimes()
      return { success: true, runtimes }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('proton-set-root', async (_event, rootPath: string) => {
    try {
      setCustomProtonRoot(rootPath)
      const runtimes = listProtonRuntimes()
      return { success: true, runtimes }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('proton-default-prefix', async (_event, forceRecreate?: boolean) => {
    try {
      if (!isLinux()) return { success: false, error: 'Proton only supported on Linux' }
      const runtime = findProtonRuntime() || undefined
      const prefix = await ensureDefaultPrefix(runtime)
      if (forceRecreate) {
        try { fs.rmSync(prefix, { recursive: true, force: true }) } catch {}
        await ensureDefaultPrefix(runtime)
      }
      return { success: true, prefix }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao criar prefixo default' }
    }
  })

  ipcMain.handle('proton-prepare-prefix', async (_event, slug: string) => {
    try {
      if (!isLinux()) return { success: false, error: 'Proton only supported on Linux' }
      const prefix = getPrefixPath(slug)
      return { success: true, prefix }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

	  ipcMain.handle('proton-create-game-prefix', async (_event, gameUrl: string, title?: string, _commonRedistPath?: string) => {
	    try {
	      if (!isLinux()) return { success: false, error: 'Proton only supported on Linux' }
        if (inFlightPrefixJobs.has(gameUrl)) return { success: false, error: 'Prefixo já está sendo preparado' }

	      const existing = getGame(gameUrl) as any
	      const stableId = (existing?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
	      const slug = stableId ? `game_${stableId}` : slugify(title || existing?.title || gameUrl || 'game')
	    const runtime = ((existing?.proton_runtime as string | null) || findProtonRuntime() || undefined)

        inFlightPrefixJobs.set(gameUrl, { startedAt: Date.now() })
        sendPrefixJobStatus({ gameUrl, status: 'starting', message: 'Preparando prefixo...' })
	      const prefix = await ensureGamePrefixFromDefault(slug, runtime, undefined, true, (msg) => {
          sendPrefixJobStatus({ gameUrl, status: 'progress', message: msg })
        })
	      updateGameInfo(gameUrl, { proton_prefix: prefix })
        sendPrefixJobStatus({ gameUrl, status: 'done', message: 'Prefixo pronto', prefix })
        inFlightPrefixJobs.delete(gameUrl)
	      return { success: true, prefix }
	    } catch (err: any) {
        try { inFlightPrefixJobs.delete(gameUrl) } catch {}
        sendPrefixJobStatus({ gameUrl, status: 'error', message: err?.message || String(err) })
	      return { success: false, error: err.message }
	    }
	  })

  ipcMain.handle('proton-build-launch', async (_event, exePath: string, args: string[] = [], slug: string, runtimePath?: string, prefixPath?: string) => {
    try {
      const launch = buildProtonLaunch(exePath, args, slug, runtimePath, undefined, prefixPath)
      if (!launch.runner) return { success: false, error: 'Proton runner not found' }
      return { success: true, launch }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('extract-download', async (_event, downloadId: number | string, providedPath?: string) => {
    try {
      const asNumber = Number(downloadId)
      const record = !Number.isNaN(asNumber) ? getDownloadById(asNumber) as any : getDownloadByUrl(String(downloadId)) as any
      const candidatePath = providedPath || record?.dest_path
      if (!candidatePath) return { success: false, error: 'Path not provided' }

      const infoHash = record?.info_hash
      const idKey = infoHash || record?.download_url || String(downloadId)
      const gameUrl = record?.game_url || record?.download_url || idKey

      // Resolve base dir/filename
      const target = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(process.cwd(), candidatePath)

      // For torrent downloads (type === 'torrent'), use processUpdateExtraction
      // This handles the case where RAR is in a subfolder and needs special processing
      if (record?.type === 'torrent') {
        console.log('[Extract] Using processUpdateExtraction for torrent:', target)

        // Notify start
        mainWindow?.webContents.send('download-progress', {
          magnet: idKey,
          url: idKey,
          progress: 0,
          stage: 'extract',
          extractProgress: 0,
          destPath: target
        })

        const result = await processUpdateExtraction(target, gameUrl, (percent) => {
          console.log('[Extract] Progress event', percent)
          mainWindow?.webContents.send('download-progress', {
            magnet: idKey,
            url: idKey,
            progress: percent,
            stage: 'extract',
            extractProgress: percent,
            destPath: target
          })
        })

        if (!result.success) {
          return { success: false, error: result.error || 'Extraction failed' }
        }

        mainWindow?.webContents.send('download-complete', {
          magnet: idKey,
          infoHash: infoHash || undefined,
          destPath: target
        })

        // Update game info
        if (gameUrl) {
          const version = parseVersionFromName(candidatePath) || parseVersionFromName(target) || 'unknown'
          addOrUpdateGame(gameUrl, record?.title)
          markGameInstalled(gameUrl, target, version, result.executablePath || undefined)
          prepareGamePrefixAfterInstall(gameUrl, String(record?.title || gameUrl), target).catch(() => {})
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
      mainWindow?.webContents.send('download-progress', {
        magnet: idKey,
        url: idKey,
        progress: 0,
        stage: 'extract',
        extractProgress: 0,
        destPath: destDir
      })

      console.log('[Extract] Dispatching extraction for', archivePath, '->', destDir)

      try {
        await import('./zip.js').then(m => m.extractZipWithPassword(
          archivePath,
          destDir,
          undefined,
          (percent) => {
            console.log('[Extract] Progress event', percent)
            mainWindow?.webContents.send('download-progress', {
              magnet: idKey,
              url: idKey,
              progress: percent,
              stage: 'extract',
              extractProgress: percent,
              destPath: destDir
            })
          }
        ))
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

      // Normalize extracted content (common nested-folder issue in OF archives)
      try {
        normalizeGameInstallDir(destDir)
      } catch {
        // ignore
      }

      try { fs.unlinkSync(extractionLockFile) } catch {}

      mainWindow?.webContents.send('download-complete', {
        magnet: idKey,
        infoHash: infoHash || undefined,
        destPath: destDir
      })

      // Add to library after extraction
      if (gameUrl) {
        const exePath = findExecutableInDir(destDir)
        const version = parseVersionFromName(archivePath) || parseVersionFromName(destDir) || 'unknown'
        addOrUpdateGame(gameUrl, record?.title)
        markGameInstalled(gameUrl, destDir, version, exePath || undefined)
        prepareGamePrefixAfterInstall(gameUrl, String(record?.title || gameUrl), destDir).catch(() => {})
      }

      return { success: true, destPath: destDir }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open-path', async (_event, targetPath: string) => {
    try {
      if (targetPath) {
        const normalized = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath)
        let finalPath = normalized
        if (fs.existsSync(normalized)) {
          const stats = fs.statSync(normalized)
          if (stats.isFile()) {
            finalPath = path.dirname(normalized)
          }
        } else {
          const parent = path.dirname(normalized)
          if (fs.existsSync(parent)) {
            finalPath = parent
          }
        }

        const result = await shell.openPath(finalPath)
        if (result) {
          return { success: false, error: result }
        }
        return { success: true, path: finalPath }
      }
      return { success: false, error: 'Invalid path' }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

async function resumeActiveDownloads() {
  try {
    const active = getActiveDownloads() as any[]
    if (!active.length) return
    console.log(`[Launcher] Resuming ${active.length} downloads from previous session`)

    const seen = new Set<string>()
    for (const d of active) {
      const dedupeKey = String(d.info_hash || d.download_url || d.id)
      if (seen.has(dedupeKey)) {
        console.log('[Launcher] Skipping duplicate active download:', dedupeKey)
        continue
      }
      seen.add(dedupeKey)

      const isTorrent = d.type === 'torrent'
      startGameDownload({
        gameUrl: d.game_url || d.download_url,
        torrentMagnet: isTorrent ? d.download_url : undefined,
        downloadUrl: isTorrent ? undefined : d.download_url,
        gameTitle: d.title || 'Download',
        gameVersion: 'unknown',
        existingDownloadId: Number(d.id),
        destPathOverride: d.dest_path || undefined,
        autoExtract: false
      }, (progress, details) => {
        const id = d.info_hash || d.download_url
        mainWindow?.webContents.send('download-progress', {
          magnet: id,
          url: id,
          progress,
          speed: details?.downloadSpeed || 0,
          downloaded: details?.downloaded || 0,
          total: details?.total || 0,
          eta: details?.timeRemaining || 0,
          infoHash: details?.infoHash || d.info_hash || d.download_url
        })
      }).then((res) => {
        if (!res.success) {
          console.warn('[Launcher] Resume download finished without success:', res.error)
          return
        }
        mainWindow?.webContents.send('download-complete', {
          magnet: d.download_url,
          infoHash: d.info_hash || undefined,
          destPath: res.installPath || d.dest_path
        })
        if (res.installPath) {
          const gameUrl = String(d.game_url || d.download_url)
          const title = String(d.title || gameUrl)
          prepareGamePrefixAfterInstall(gameUrl, title, res.installPath).catch(() => {})
        }
      }).catch((err) => {
        console.warn('[Launcher] Failed to resume download', dedupeKey, err)
      })
    }
  } catch (err) {
    console.warn('Failed to resume active downloads', err)
  }
}

function findExecutableInDir(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        return fullPath
      }
      if (entry.isDirectory()) {
        const nested = findExecutableInDir(fullPath)
        if (nested) return nested
      }
    }
  } catch (err) {
    console.warn('[findExecutableInDir] Failed to scan', dir, err)
  }
  return null
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function findArchive(startPath: string): { archivePath?: string; destDir: string } {
  const allowed = ['.zip', '.rar', '.7z']
  const resolveMaybe = (p: string) => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  const target = resolveMaybe(startPath)

  const isAllowedFile = (p: string) => {
    const ext = path.extname(p).toLowerCase()
    return allowed.includes(ext)
  }

  const statSafe = (p: string) => {
    try { return fs.statSync(p) } catch { return null }
  }

  const searchDir = (dir: string, depth = 0): string | undefined => {
    if (depth > 2) return undefined
    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir).map(f => path.join(dir, f))
    } catch {
      return undefined
    }
    for (const entry of entries) {
      const st = statSafe(entry)
      if (!st) continue
      if (st.isFile() && isAllowedFile(entry)) return entry
    }
    for (const entry of entries) {
      const st = statSafe(entry)
      if (st?.isDirectory()) {
        const found = searchDir(entry, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }

  const stat = statSafe(target)
  if (stat?.isFile() && isAllowedFile(target)) {
    return { archivePath: target, destDir: path.dirname(target) }
  }
  if (stat?.isDirectory()) {
    const found = searchDir(target)
    return { archivePath: found, destDir: target }
  }

  const parent = path.dirname(target)
  const parentStat = statSafe(parent)
  if (parentStat?.isDirectory()) {
    const found = searchDir(parent)
    return { archivePath: found, destDir: parent }
  }

  return { archivePath: undefined, destDir: path.dirname(target) }
}
