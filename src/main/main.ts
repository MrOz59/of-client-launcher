// Configure sandbox for Linux AppImage/packaged environments
// The SUID sandbox requires chrome-sandbox to have setuid permissions (owned by root with 4755)
// which is not possible in AppImage. We use user namespace sandbox as fallback.
// IMPORTANT: This must run before any Electron initialization
import { app } from 'electron'
import fs from 'fs'

// Windows workaround: some environments show a white screen unless Chromium sandbox is disabled.
// Default to disabling sandbox on Windows builds; allow opting back in via OF_ENABLE_SANDBOX=1.
if (process.platform === 'win32') {
  const enableSandbox = String(process.env.OF_ENABLE_SANDBOX || '').trim() === '1'
  if (!enableSandbox) {
    console.warn('[Sandbox] Windows: disabling sandbox (OF_ENABLE_SANDBOX=1 to re-enable)')
    app.commandLine.appendSwitch('no-sandbox')
  }
}

// Configure Linux sandbox EARLY - before app is ready
// This must happen before Chromium initializes
if (process.platform === 'linux') {
  // Check if user namespaces are available (required for namespace sandbox)
  let userNamespacesAvailable = false
  try {
    const unprivUserns = fs.readFileSync('/proc/sys/kernel/unprivileged_userns_clone', 'utf8').trim()
    userNamespacesAvailable = unprivUserns === '1'
  } catch {
    // File doesn't exist on some systems (e.g., newer kernels where it's always enabled)
    // Try to detect by checking if we can access user namespace
    try {
      fs.accessSync('/proc/self/ns/user', fs.constants.R_OK)
      userNamespacesAvailable = true
    } catch {
      userNamespacesAvailable = false
    }
  }

  if (userNamespacesAvailable) {
    // User namespace sandbox is available - disable SUID sandbox and let Chromium use namespace sandbox
    console.log('[Sandbox] Using user namespace sandbox (SUID sandbox disabled)')
    app.commandLine.appendSwitch('disable-setuid-sandbox')
    // Do NOT disable namespace sandbox - this is what we want to use!
  } else {
    // No user namespaces available - must disable sandbox entirely (last resort)
    console.warn('[Sandbox] User namespaces not available - disabling sandbox (security reduced)')
    app.commandLine.appendSwitch('no-sandbox')
  }
  
  // Check /dev/shm availability for shared memory
  try {
    fs.accessSync('/dev/shm', fs.constants.W_OK | fs.constants.X_OK)
  } catch {
    console.log('[Sandbox] /dev/shm not writable, disabling dev-shm-usage')
    app.commandLine.appendSwitch('disable-dev-shm-usage')
  }
}

import * as drive from './drive'
import * as cloudSaves from './cloudSaves'
import { appendCloudSavesHistory, listCloudSavesHistory, type CloudSavesHistoryEntry } from './cloudSavesHistory'
import { ensureLudusaviAvailable } from './ludusavi'
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

import { BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { importCookies, exportCookies } from './cookieManager.js'
import { fetchGameUpdateInfo, fetchUserProfile, scrapeGameInfo } from './scraper.js'
import { downloadFile, downloadTorrent } from './downloader.js'
import { addOrUpdateGame, updateGameVersion, getSetting, getActiveDownloads, getDownloadByUrl, getCompletedDownloads, getDownloadById, markGameInstalled, setSetting, getAllGames, updateGameInfo, deleteGame, deleteDownload, getGame, getGameByGameId, extractGameIdFromUrl, updateDownloadProgress, updateDownloadStatus, updateDownloadInstallPath, setGameFavorite, toggleGameFavorite, updateGamePlayTime } from './db.js'
import { shouldBlockRequest } from './easylist-filters.js'
import { startGameDownload, pauseDownloadByTorrentId, resumeDownloadByTorrentId, cancelDownloadByTorrentId, parseVersionFromName, processUpdateExtraction, readOnlineFixIni, writeOnlineFixIni, normalizeGameInstallDir } from './downloadManager.js'
import axios from 'axios'
import { resolveTorrentFileUrl, deriveTitleFromTorrentUrl } from './torrentResolver.js'
// fs is already imported at the top for early sandbox configuration
import { isLinux, findProtonRuntime, setSavedProtonRuntime, buildProtonLaunch, getPrefixPath, getDefaultPrefixPath, listProtonRuntimes, setCustomProtonRoot, setCustomProtonRoots, ensurePrefixDefaults, ensureGamePrefixFromDefault, getPrefixRootDir, ensureDefaultPrefix, getExpectedDefaultPrefixPath, ensureGameCommonRedists } from './protonManager.js'
import { spawn } from 'child_process'
import { vpnControllerCreateRoom, vpnControllerJoinRoom, vpnControllerListPeers, vpnControllerStatus } from './vpnControllerClient.js'
import { vpnCheckInstalled, vpnConnectFromConfig, vpnDisconnect, vpnInstallBestEffort } from './ofVpnManager.js'
import { AchievementsManager } from './achievements/manager.js'
import { AchievementOverlay } from './achievements/overlay.js'
import { monitorEventLoopDelay } from 'perf_hooks'
import { registerAllIpcHandlers } from './ipc/index.js'
import type { IpcContext } from './ipc/types.js'
import {
  isPidAlive,
  killProcessTreeBestEffort,
  readFileTailBytes,
  trimToMaxChars,
  extractInterestingProtonLog,
  configureLinuxTempDir,
  isDirWritableAndExecutable,
  findArchive,
  findExecutableInDir,
  slugify,
  getDirectorySizeBytes
} from './utils/index.js'

const DEFAULT_LAN_CONTROLLER_URL = 'https://vpn.mroz.dev.br'

function resolveLauncherUserDataPath(): string | null {
  try {
    if (process.platform === 'linux') {
      const home = os.homedir()
      if (home) return path.join(home, '.local', 'share', 'VoidLauncher')
      return null
    }

    if (process.platform === 'win32' || process.platform === 'darwin') {
      const appData = app.getPath('appData')
      if (appData) return path.join(appData, 'VoidLauncher')
    }
  } catch {
    // ignore
  }
  return null
}

try {
  const userDataPath = resolveLauncherUserDataPath()
  if (userDataPath) app.setPath('userData', userDataPath)
} catch {
  // ignore
}

/**
 * Resolve game version using multiple strategies in order of preference:
 * 1. Provided version (if not 'unknown' or empty)
 * 2. Parse from filename/path
 * 3. Parse from game title
 * 4. Scrape from game page (if gameUrl provided)
 * 5. Check existing game record
 * Returns 'unknown' only as last resort
 */
async function resolveGameVersion(options: {
  providedVersion?: string | null
  filename?: string | null
  title?: string | null
  gameUrl?: string | null
}): Promise<string> {
  const { providedVersion, filename, title, gameUrl } = options

  // 1. Use provided version if valid
  if (providedVersion && providedVersion !== 'unknown' && providedVersion.trim()) {
    return providedVersion.trim()
  }

  // 2. Try to parse from filename
  if (filename) {
    const fromFilename = parseVersionFromName(filename)
    if (fromFilename) {
      console.log('[resolveGameVersion] Found version from filename:', fromFilename)
      return fromFilename
    }
  }

  // 3. Try to parse from title
  if (title) {
    const fromTitle = parseVersionFromName(title)
    if (fromTitle) {
      console.log('[resolveGameVersion] Found version from title:', fromTitle)
      return fromTitle
    }
  }

  // 4. Try to scrape from game page
  if (gameUrl && gameUrl.includes('online-fix.me')) {
    try {
      console.log('[resolveGameVersion] Attempting to scrape version from:', gameUrl)
      const info = await fetchGameUpdateInfo(gameUrl)
      if (info?.version) {
        console.log('[resolveGameVersion] Scraped version from page:', info.version)
        return info.version
      }
    } catch (e: any) {
      console.warn('[resolveGameVersion] Failed to scrape version:', e?.message || e)
    }
  }

  // 5. Check existing game record for latest_version
  if (gameUrl) {
    try {
      const game = getGame(gameUrl)
      if (game?.latest_version && game.latest_version !== 'unknown') {
        console.log('[resolveGameVersion] Using existing latest_version:', game.latest_version)
        return game.latest_version
      }
    } catch {}
  }

  console.log('[resolveGameVersion] Could not determine version, returning unknown')
  return 'unknown'
}

let mainWindow: BrowserWindow | null = null
const TORRENT_PARTITION = 'persist:online-fix'

// Prevent renderer/main stalls caused by very frequent progress events (torrents can emit a lot).
const downloadProgressThrottle = new Map<string, number>()
function sendDownloadProgress(payload: any) {
  try {
    const key = String(payload?.infoHash || payload?.magnet || payload?.url || '')
    const now = Date.now()
    if (key) {
      const last = downloadProgressThrottle.get(key) || 0
      if (now - last < 200) return
      downloadProgressThrottle.set(key, now)
    }
    mainWindow?.webContents.send('download-progress', payload)
  } catch {
    // ignore
  }
}

type UpdateQueueStatusPayload = {
  running: boolean
  queued: number
  currentGameUrl?: string | null
  lastError?: string | null
  updatedAt: number
}

let updateQueue: string[] = []
let updateQueueRunning = false
let updateQueueCurrent: string | null = null
let updateQueueLastError: string | null = null

function sendUpdateQueueStatus() {
  const payload: UpdateQueueStatusPayload = {
    running: updateQueueRunning,
    queued: updateQueue.length,
    currentGameUrl: updateQueueCurrent,
    lastError: updateQueueLastError,
    updatedAt: Date.now()
  }
  try {
    mainWindow?.webContents.send('update-queue-status', payload)
  } catch {
    // ignore
  }
}

function isGameActivelyDownloading(gameUrl: string): boolean {
  try {
    const active = (getActiveDownloads() as any[]) || []
    return active.some((d: any) => {
      const st = String(d?.status || '').toLowerCase()
      if (st !== 'pending' && st !== 'downloading' && st !== 'extracting') return false
      return String(d?.game_url || '') === gameUrl
    })
  } catch {
    return false
  }
}

async function runQueuedUpdate(gameUrl: string) {
  const url = String(gameUrl || '').trim()
  if (!url) throw new Error('gameUrl ausente')
  if (!/^https?:\/\//.test(url)) throw new Error('Jogo local não suporta update automático')
  if (isGameActivelyDownloading(url)) throw new Error('Download já está em andamento para este jogo')

  const existing = (() => { try { return getGame(url) as any } catch { return null } })()
  const title = String(existing?.title || url)

  const info = await fetchGameUpdateInfo(url)
  if (!info?.version) throw new Error('Versao nao encontrada na pagina')
  if (!info?.torrentUrl) throw new Error('Link do torrent não encontrado')

  // Keep DB up to date with the latest version + magnet.
  try {
    updateGameInfo(url, { latest_version: info.version, torrent_magnet: info.torrentUrl, download_url: info.torrentUrl })
  } catch {}
  try {
    mainWindow?.webContents.send('game-version-update', { url, latest: info.version })
  } catch {}

  const torrentUrl = String(info.torrentUrl)

  const result = await startGameDownload({
    gameUrl: url,
    torrentMagnet: torrentUrl,
    gameTitle: title,
    gameVersion: info.version
  }, (progress, details) => {
    sendDownloadProgress({
      magnet: torrentUrl,
      progress,
      speed: (details as any)?.downloadSpeed || 0,
      downloaded: (details as any)?.downloaded || 0,
      total: (details as any)?.total || 0,
      eta: (details as any)?.timeRemaining || 0,
        peers: (details as any)?.peers,
        seeds: (details as any)?.seeds,
      infoHash: (details as any)?.infoHash || torrentUrl,
      stage: (details as any)?.stage || 'download',
      extractProgress: (details as any)?.extractProgress,
      destPath: (details as any)?.destPath
    })
  })

  if (!result.success) throw new Error(result.error || 'Falha ao atualizar')

  // Auto-fetch banner after successful install
  fetchAndPersistBanner(url, title).catch(() => {})
}

async function pumpUpdateQueue() {
  if (updateQueueRunning) return
  const next = updateQueue.shift()
  if (!next) {
    updateQueueCurrent = null
    updateQueueLastError = null
    sendUpdateQueueStatus()
    return
  }

  updateQueueRunning = true
  updateQueueCurrent = next
  updateQueueLastError = null
  sendUpdateQueueStatus()

  try {
    await runQueuedUpdate(next)
  } catch (err: any) {
    updateQueueLastError = err?.message || String(err)
  } finally {
    updateQueueRunning = false
    updateQueueCurrent = null
    sendUpdateQueueStatus()
    setTimeout(() => { pumpUpdateQueue().catch(() => {}) }, 100)
  }
}

// Dev-only watchdog to confirm event-loop stalls (helps pinpoint freezing sources).
try {
  const isDev = process.env.NODE_ENV === 'development' || !!require('electron-is-dev')
  if (isDev) {
    const h = monitorEventLoopDelay({ resolution: 20 })
    h.enable()
    setInterval(() => {
      const meanMs = Math.round(h.mean / 1e6)
      const maxMs = Math.round(h.max / 1e6)
      if (maxMs >= 250) {
        console.warn(`[Perf] Event loop lag detected: max=${maxMs}ms mean=${meanMs}ms`)
      }
      h.reset()
    }, 5000).unref()
  }
} catch {
  // ignore
}

const achievementsManager = new AchievementsManager()
const achievementOverlay = new AchievementOverlay()

type RunningGameProc = {
  pid: number
  child: any
  protonLogPath?: string
  startedAt?: number
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
  startedAt?: number
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

type CloudSavesStatusPayload = {
  at: number
  gameUrl?: string
  gameKey?: string
  stage: 'restore' | 'backup'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  conflict?: boolean
}

function sendCloudSavesStatus(payload: CloudSavesStatusPayload) {
  try {
    mainWindow?.webContents.send('cloud-saves-status', payload)
  } catch {
    // ignore
  }
}

function recordCloudSaves(entry: CloudSavesHistoryEntry) {
  try {
    appendCloudSavesHistory(entry)
  } catch {
    // ignore
  }
}

// NOTE: isPidAlive, killProcessTreeBestEffort, readFileTailBytes, trimToMaxChars,
// extractInterestingProtonLog, configureLinuxTempDir, isDirWritableAndExecutable
// moved to src/main/utils/

async function ensureOfVpnBeforeLaunch(gameUrl: string, roomCode: string) {
  const configuredDefault = String(getSetting('lan_default_network_id') || '').trim()
  const code = String(roomCode || configuredDefault || '').trim()
  if (!code) {
    sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'VPN: sala não configurada' })
    return
  }

  sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'VPN: conectando…' })

  const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
  const join = await vpnControllerJoinRoom({ controllerUrl, code, name: '' })
  if (!join.success) {
    sendGameLaunchStatus({ gameUrl, status: 'starting', message: `VPN: ${join.error || 'falha ao entrar'} (continuando)` })
    return
  }

  const userDataDir = app.getPath('userData')
  const cfg = String((join as any).config || '').trim()
  if (!cfg) {
    sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'VPN: resposta inválida do servidor (continuando)' })
    return
  }
  const conn = await vpnConnectFromConfig({ configText: cfg, userDataDir })
  if (!conn.success) {
    const msg = conn.needsInstall ? 'VPN: WireGuard não instalado' : `VPN: ${conn.error || 'falha ao conectar'}`
    sendGameLaunchStatus({ gameUrl, status: 'starting', message: `${msg} (continuando)` })
    return
  }

  const ip = String(join.vpnIp || '').trim()
  sendGameLaunchStatus({ gameUrl, status: 'starting', message: `VPN: conectado${ip ? ` (${ip})` : ''}` })
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

// NOTE: Drive/CloudSaves handlers moved to src/main/ipc/driveHandlers.ts

process.on('unhandledRejection', (reason: any) => {
  if (reason && typeof (reason as any).message === 'string' && (reason as any).message.includes('UTP_ECONNRESET')) {
    handleUtpConnReset('promise', (reason as any).message)
    return
  }
  console.error('Unhandled rejection:', reason)
})

const fetchSteamBanner = async (title: string): Promise<string | null> => {
  const normalizeKey = (s: string) => String(s || '').trim().toLowerCase().slice(0, 240)
  const cacheKey = normalizeKey(title)
  const TTL_MS = 24 * 60 * 60 * 1000
  if (!(globalThis as any).__of_steamBannerCache) (globalThis as any).__of_steamBannerCache = new Map()
  if (!(globalThis as any).__of_steamBannerInFlight) (globalThis as any).__of_steamBannerInFlight = new Map()
  const cache: Map<string, { at: number; url: string | null }> = (globalThis as any).__of_steamBannerCache
  const inFlight: Map<string, Promise<string | null>> = (globalThis as any).__of_steamBannerInFlight

  try {
    if (cacheKey) {
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < TTL_MS) return hit.url
      const pending = inFlight.get(cacheKey)
      if (pending) return await pending
    }

    const work = (async () => {
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

    const parseImageDimensions = (buf: Buffer): { width: number; height: number } | null => {
      try {
        if (!buf || buf.length < 24) return null

        // PNG
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
          const width = buf.readUInt32BE(16)
          const height = buf.readUInt32BE(20)
          if (width > 0 && height > 0) return { width, height }
        }

        // GIF
        const sig = buf.toString('ascii', 0, 6)
        if (sig === 'GIF87a' || sig === 'GIF89a') {
          const width = buf.readUInt16LE(6)
          const height = buf.readUInt16LE(8)
          if (width > 0 && height > 0) return { width, height }
        }

        // JPEG (scan SOF markers)
        if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
          let offset = 2
          while (offset + 4 < buf.length) {
            if (buf[offset] !== 0xff) {
              offset += 1
              continue
            }

            let marker = buf[offset + 1]
            offset += 2

            // Standalone markers
            if (marker === 0xd9 || marker === 0xda) break // EOI/SOS
            if (offset + 2 > buf.length) break

            const size = buf.readUInt16BE(offset)
            if (size < 2) break

            const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
            if (isSOF) {
              if (offset + 7 <= buf.length) {
                const height = buf.readUInt16BE(offset + 3)
                const width = buf.readUInt16BE(offset + 5)
                if (width > 0 && height > 0) return { width, height }
              }
              break
            }

            offset += size
          }
        }
      } catch {
        // ignore
      }
      return null
    }

    const fetchImageProbe = async (url: string): Promise<{ ok: boolean; width?: number; height?: number }> => {
      try {
        const resp = await axios.get(url, {
          timeout: 8000,
          responseType: 'arraybuffer',
          headers: { Range: 'bytes=0-131071' },
          validateStatus: (s) => s === 200 || s === 206
        })
        const ct = String(resp.headers?.['content-type'] || '')
        if (!ct.startsWith('image/')) return { ok: false }

        const buf = Buffer.from(resp.data)
        const dim = parseImageDimensions(buf)
        if (dim) return { ok: true, width: dim.width, height: dim.height }
        return { ok: true }
      } catch {
        return { ok: false }
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

    // Priority 1: Vertical covers (3:4 aspect ratio) - best for library cards
    // library_600x900 is the ideal format for our 3:4 card aspect ratio
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_capsule.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_capsule_2x.jpg`
    )

    // Priority 2: Other library assets (still good quality)
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`
    )

    // Priority 3: Horizontal covers (fallback - will be cropped to fit)
    candidates.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`
    )

    // appdetails-provided URLs (append as fallbacks, don't override vertical covers)
    if (appDetails?.header_image) candidates.push(String(appDetails.header_image))
    if (appDetails?.capsule_image) candidates.push(String(appDetails.capsule_image))
    if (appDetails?.capsule_imagev5) candidates.push(String(appDetails.capsule_imagev5))

    // storesearch-provided tiny_image as last resort
    if (best?.tiny_image) candidates.push(String(best.tiny_image))

    // Prefer assets closest to the library card aspect ratio (3/4) when available.
    // This prevents heavy cropping when we fall back to wide header/hero art.
    const targetAspect = 3 / 4

    const seen = new Set<string>()
    const valid: Array<{ url: string; width?: number; height?: number; diff?: number; area?: number }> = []

    for (const url of candidates) {
      if (!url) continue
      if (seen.has(url)) continue
      seen.add(url)

      // eslint-disable-next-line no-await-in-loop
      const probe = await fetchImageProbe(url)
      if (!probe.ok) continue

      const width = probe.width
      const height = probe.height
      const area = width && height ? width * height : undefined
      const diff = width && height ? Math.abs(width / height - targetAspect) : undefined
      valid.push({ url, width, height, diff, area })

      // Early stop: we already have a near-perfect match
      if (diff != null && diff <= 0.08 && (area || 0) >= 200 * 260) {
        if (valid.length >= 4) break
      }
    }

    const withDims = valid.filter(v => typeof v.diff === 'number' && typeof v.area === 'number') as Array<{ url: string; diff: number; area: number }>
    if (withDims.length > 0) {
      withDims.sort((a, b) => (a.diff - b.diff) || (b.area - a.area))
      return withDims[0].url
    }

    // Fallback: any image that returns image/*
    if (valid[0]?.url) return valid[0].url

    return null
    })()

    if (cacheKey) inFlight.set(cacheKey, work)
    const result = await work
    if (cacheKey) {
      inFlight.delete(cacheKey)
      cache.set(cacheKey, { at: Date.now(), url: result })
    }
    return result
  } catch (err) {
    if (cacheKey) {
      try { (globalThis as any).__of_steamBannerInFlight?.delete?.(cacheKey) } catch {}
    }
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

    const readFirstDigitsFile = (filePath: string): string | null => {
      try {
        if (!fs.existsSync(filePath)) return null
        const raw = fs.readFileSync(filePath, 'utf8').trim()
        const id = raw.match(/\d+/)?.[0]
        return id || null
      } catch {
        return null
      }
    }

    const parseIniForSteamAppId = (filePath: string): string | null => {
      try {
        if (!fs.existsSync(filePath)) return null
        const content = fs.readFileSync(filePath, 'utf8')

        const allowedKeys = new Set([
          'realappid',
          'real_appid',
          'appid',
          'app_id',
          'steamappid',
          'steam_appid'
        ])

        for (const rawLine of content.split(/\r?\n/)) {
          const line = rawLine.trim()
          if (!line) continue
          if (line.startsWith(';') || line.startsWith('#')) continue
          if (line.startsWith('[') && line.endsWith(']')) continue

          const m = line.match(/^([A-Za-z0-9_.-]+)\s*[:=]\s*(\d+)\b/)
          if (!m) continue
          const key = m[1].toLowerCase()
          const value = m[2]
          if (allowedKeys.has(key) && value) return value
        }
      } catch {
        // ignore
      }
      return null
    }

    // Common locations for AppID markers
    const steamAppIdCandidates = [
      path.join(installDir, 'steam_appid.txt'),
      path.join(installDir, 'steam_settings', 'steam_appid.txt')
    ]
    for (const filePath of steamAppIdCandidates) {
      const id = readFirstDigitsFile(filePath)
      if (id) return id
    }

    // OnlineFix often stores the "real" Steam AppID in ini configs.
    const onlineFixIniCandidates = [
      path.join(installDir, 'OnlineFix.ini'),
      path.join(installDir, 'of_config.ini'),
      path.join(installDir, 'onlinefix.ini')
    ]
    for (const filePath of onlineFixIniCandidates) {
      const id = parseIniForSteamAppId(filePath)
      if (id) return id
    }
  } catch {
    // ignore
  }
  return null
}

async function prepareGamePrefixAfterInstall(gameUrl: string, title: string, installPath: string) {
  if (!isLinux()) return
  if (!installPath || !fs.existsSync(installPath)) return

  try {
    const game = getGame(gameUrl) as any

    // Se já tem prefixo, não precisa criar
    if (game?.proton_prefix) return

    const stableId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
    const slug = stableId ? `game_${stableId}` : slugify(title || game?.title || gameUrl || 'game')
    const runtime = (game?.proton_runtime as string | null) || findProtonRuntime() || undefined

    // Evitar jobs duplicados
    if (inFlightPrefixJobs.has(gameUrl)) return
    inFlightPrefixJobs.set(gameUrl, { startedAt: Date.now() })

    // Enviar feedback visual para o usuário
    sendPrefixJobStatus({ gameUrl, status: 'starting', message: 'Preparando prefixo do Proton...' })

    const prefix = await ensureGamePrefixFromDefault(slug, runtime, undefined, true, (msg) => {
      sendPrefixJobStatus({ gameUrl, status: 'progress', message: msg })
    })
    updateGameInfo(gameUrl, { proton_prefix: prefix })

    // Notificar que terminou
    sendPrefixJobStatus({ gameUrl, status: 'done', message: 'Prefixo pronto', prefix })
    inFlightPrefixJobs.delete(gameUrl)
  } catch (err: any) {
    console.warn('[Proton] Failed to prepare prefix after install:', err)
    try { inFlightPrefixJobs.delete(gameUrl) } catch {}
    sendPrefixJobStatus({ gameUrl, status: 'error', message: err?.message || String(err) })
  }
}

// Must run before Chromium initializes temp/shared-memory files (AppImage/container environments may have broken /tmp or /dev/shm).
configureLinuxTempDir()

// Proton runtime cache (Linux only). Scanning can be slow; keep a cached list and rescan only when asked.
let protonRuntimesCache: { at: number; runtimes: any[] } | null = null
let protonRuntimesInFlight: Promise<any[]> | null = null

async function getCachedProtonRuntimes(force = false): Promise<any[]> {
  if (!isLinux()) return []
  if (!force && protonRuntimesCache?.runtimes) return protonRuntimesCache.runtimes
  if (!force && protonRuntimesInFlight) return protonRuntimesInFlight

  protonRuntimesInFlight = Promise.resolve().then(() => listProtonRuntimes() as any[])
  try {
    const runtimes = await protonRuntimesInFlight
    protonRuntimesCache = { at: Date.now(), runtimes: Array.isArray(runtimes) ? runtimes : [] }
    return protonRuntimesCache.runtimes
  } finally {
    protonRuntimesInFlight = null
  }
}

// ============================================================================
// IPC Context and Modular Handlers Registration
// ============================================================================
const ipcContext: IpcContext = {
  getMainWindow: () => mainWindow,
  runningGames,
  inFlightPrefixJobs,
  updateQueue,
  get updateQueueRunning() { return updateQueueRunning },
  get updateQueueCurrent() { return updateQueueCurrent },
  get updateQueueLastError() { return updateQueueLastError },
  setUpdateQueueRunning: (v: boolean) => { updateQueueRunning = v },
  setUpdateQueueCurrent: (v: string | null) => { updateQueueCurrent = v },
  setUpdateQueueLastError: (v: string | null) => { updateQueueLastError = v },
  achievementsManager,
  achievementOverlay,
  sendDownloadProgress,
  sendUpdateQueueStatus,
  sendGameLaunchStatus,
  sendPrefixJobStatus,
  sendCloudSavesStatus,
  fetchAndPersistBanner,
  prepareGamePrefixAfterInstall
}

// Register all modular IPC handlers
registerAllIpcHandlers(ipcContext)

// Sandbox configuration moved to top of file (before Chromium initialization)

const WEBVIEW_ALLOWED_HOSTS = new Set([
  'online-fix.me',
  'accounts.google.com',
  'accounts.google.com.br',
  'discord.com'
])
const WEBVIEW_ALLOWED_SUFFIXES = ['.online-fix.me', '.discord.com', '.discordapp.com']

function isAllowedWebviewHost(host: string) {
  const h = String(host || '').toLowerCase()
  if (!h) return false
  if (WEBVIEW_ALLOWED_HOSTS.has(h)) return true
  return WEBVIEW_ALLOWED_SUFFIXES.some(suffix => h.endsWith(suffix))
}

function isAllowedWebviewUrl(raw?: string | null) {
  const url = String(raw || '').trim()
  if (!url) return false
  if (url.startsWith('about:')) return true
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return false
    return isAllowedWebviewHost(parsed.hostname)
  } catch {
    return false
  }
}

function isAllowedTorrentUrl(raw?: string | null) {
  const url = String(raw || '').trim()
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return false
    const host = String(parsed.hostname || '').toLowerCase()
    if (!(host === 'online-fix.me' || host.endsWith('.online-fix.me'))) return false
    return parsed.pathname.includes('/torrents/') || parsed.pathname.endsWith('.torrent')
  } catch {
    return false
  }
}

function isTorrentListing(url: string) {
  return isAllowedTorrentUrl(url)
}

// NOTE: start-torrent-download handler moved to src/main/ipc/torrentHandlers.ts

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
      sendDownloadProgress({
        magnet: torrentUrl,
        progress,
        speed: details?.downloadSpeed || 0,
        downloaded: details?.downloaded || 0,
        total: details?.total || 0,
        eta: details?.timeRemaining || 0,
        peers: (details as any)?.peers,
        seeds: (details as any)?.seeds,
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
      // Auto-fetch banner once installed
      fetchAndPersistBanner(referer, title).catch(() => {})
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
      sandbox: false,
      webviewTag: true // Enable webview tag for embedded browser
    }
  })

  // Log renderer errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Renderer] Failed to load:', errorCode, errorDescription, validatedURL)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] Process gone:', details)
  })
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log('[Renderer Console]', message)
  })

  if (process.env.NODE_ENV === 'development' || require('electron-is-dev')) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools() // Open DevTools in development
  } else {
    const htmlPath = path.join(__dirname, '../renderer/index.html')
    console.log('[Main] Loading renderer from:', htmlPath)
    mainWindow.loadFile(htmlPath)
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
      sandbox: false,
      partition: TORRENT_PARTITION // Use same partition as webview!
    }
  })

  console.log('[Auth] Opening store window with partition:', TORRENT_PARTITION)
  authWin.loadURL('https://online-fix.me/')

  authWin.on('close', async () => {
    console.log('[Auth] Auth window closed, checking for cookies...')
    // Get cookies from the torrent partition session
    const ses = session.fromPartition(TORRENT_PARTITION)
    const cookies = await ses.cookies.get({ url: 'https://online-fix.me' })
    console.log('[Auth] Found cookies after login:', cookies.map(c => c.name))
    mainWindow?.webContents.send('cookies-saved', cookies)
    try {
      await exportCookies('https://online-fix.me')
    } catch (err) {
      console.warn('[Auth] Failed to persist cookies', err)
    }
  })
}

app.whenReady().then(async () => {
  await importCookies('https://online-fix.me')

  // Initialize cloud saves setting
  const cloudSavesEnabled = getSetting('cloud_saves_enabled') !== 'false'
  drive.setCloudSavesEnabled(cloudSavesEnabled)

  // Warm Proton runtimes cache at startup (Linux only).
  if (process.platform === 'linux') {
    setTimeout(() => {
      void getCachedProtonRuntimes(false).catch(() => {})
    }, 250)
  }

  // Proactively prepare Ludusavi in the background so Cloud Saves can work
  // immediately after the user connects Google Drive.
  // This should never block app startup.
  setTimeout(() => {
    void ensureLudusaviAvailable({ allowDownload: true, timeoutMs: 120_000 })
      .then((r) => {
        if (!r.ok) console.warn('[LUDUSAVI] Startup prepare failed:', r.message)
        else console.log('[LUDUSAVI] Ready at startup:', r.path, r.downloaded ? '(downloaded)' : '')
      })
      .catch((e: any) => console.warn('[LUDUSAVI] Startup prepare error:', e?.message || String(e)))
  }, 1200)

  // IMPORTANT: resuming downloads can be heavy (torrent init, IO, IPC). Running it
  // before the UI is up makes the app feel frozen, especially in dev.
  // Allow disabling via env for troubleshooting.
  const disableAutoResume = ['1', 'true', 'yes'].includes(String(process.env.OF_DISABLE_AUTO_RESUME_DOWNLOADS || '').toLowerCase())

  // Lightweight popup blocker - blocks popups/popunders but allows banner ads
  // This is fair to the website while protecting users from annoying redirects
  console.log('[PopupBlocker] Initializing lightweight popup blocker...')

  const filter = {
    urls: ['<all_urls>']
  }

  let blockedCount = 0
  const webviewSession = session.fromPartition(TORRENT_PARTITION)
  webviewSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    // Deny notification permission prompts to prevent spam
    callback(false)
  })

  // Network-level blocking - only for popup/redirect domains
  webviewSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const shouldBlock = shouldBlockRequest(details.url)
    if (shouldBlock) {
      blockedCount++
      console.log(`[PopupBlocker] Network Block #${blockedCount}:`, details.url.substring(0, 80))
      callback({ cancel: true })
    } else {
      callback({ cancel: false })
    }
  })

  console.log('[PopupBlocker] Network-level popup blocking enabled')

  // Block popunders at BrowserWindow level (but allow normal new windows)
  app.on('web-contents-created', (_event, contents) => {
    // Handle new window requests
    contents.setWindowOpenHandler(({ url }) => {
      // Always allow torrent URLs
      if (isTorrentListing(url)) {
        console.log('[PopupBlocker] Allowing torrent download:', url.substring(0, 80))
        handleExternalDownload(url).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return { action: 'deny' } // Deny window but handle download ourselves
      }

      // Block known popup domains
      if (shouldBlockRequest(url)) {
        console.log('[PopupBlocker] Blocked popup:', url.substring(0, 80))
        return { action: 'deny' }
      }

      // Allow other popups (login windows, etc) - be fair to the site
      console.log('[PopupBlocker] Allowing popup:', url.substring(0, 80))
      return { action: 'deny' } // Still deny to prevent external browser, but log it
    })

    contents.on('new-window' as any, (event: Electron.Event, url: string) => {
      // Only block known popup URLs
      if (shouldBlockRequest(url)) {
        event.preventDefault()
        console.log('[PopupBlocker] Blocked new-window popup:', url)
      }
    })

    // Block navigation only to known popup/redirect URLs
    contents.on('will-navigate', (event, navigationUrl) => {
      // Always allow torrent links
      if (isTorrentListing(navigationUrl)) {
        console.log('[PopupBlocker] Allowing torrent navigation:', navigationUrl.substring(0, 80))
        event.preventDefault()
        handleExternalDownload(navigationUrl).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return
      }

      // Only block known popup/redirect domains
      if (shouldBlockRequest(navigationUrl)) {
        console.log('[PopupBlocker] Blocked navigation to popup domain:', navigationUrl.substring(0, 80))
        event.preventDefault()
        return
      }
      // Allow all other navigation
    })

    // Block redirects only to known popup/redirect URLs
    contents.on('will-redirect', (event, navigationUrl) => {
      // Always allow torrent links
      if (isTorrentListing(navigationUrl)) {
        console.log('[PopupBlocker] Allowing torrent redirect:', navigationUrl.substring(0, 80))
        event.preventDefault()
        handleExternalDownload(navigationUrl).catch((err) => {
          console.warn('Failed to auto-handle external download', err)
        })
        return
      }

      // Only block known popup/redirect domains
      if (shouldBlockRequest(navigationUrl)) {
        console.log('[PopupBlocker] Blocked redirect to popup domain:', navigationUrl.substring(0, 80))
        event.preventDefault()
      }
      // Allow all other redirects
    })
  })

  console.log('[PopupBlocker] Popup blocking enabled - banner ads allowed')
  console.log('[PopupBlocker] Fair mode active!')

  createMainWindow()

  if (!disableAutoResume) {
    let resumed = false
    const runResumeOnce = () => {
      if (resumed) return
      resumed = true
      // Small delay to keep first paint snappy.
      setTimeout(() => {
        // First, clean up orphaned downloads before resuming
        cleanupOrphanedDownloads().catch((err) => {
          console.warn('Failed to cleanup orphaned downloads', err)
        })
        resumeActiveDownloads().catch((err) => {
          console.warn('Failed to resume active downloads', err)
        })
        resumeInterruptedExtractions().catch((err) => {
          console.warn('Failed to resume interrupted extractions', err)
        })
        reconcileInstalledGamesFromCompletedDownloads().catch((err) => {
          console.warn('Failed to reconcile installed games', err)
        })
        scanInstalledGamesFromDisk().catch((err) => {
          console.warn('Failed to scan installed games from disk', err)
        })

        refreshInstalledGameSizesBestEffort().catch((err) => {
          console.warn('Failed to refresh installed game sizes', err)
        })
      }, 1500)
    }

    // Prefer after UI finishes loading, but also keep a safety timer.
    try {
      mainWindow?.webContents.once('did-finish-load', runResumeOnce)
    } catch {}
    setTimeout(runResumeOnce, 8000)
  }

  // open-auth-window must remain here as it depends on createAuthWindow defined in this file
  ipcMain.handle('open-auth-window', async () => {
    await createAuthWindow()
    return true
  })

  // NOTE: Auth handlers (get-user-profile, get-cookie-header, export-cookies, clear-cookies,
  // check-game-version, fetch-game-update-info) moved to src/main/ipc/authHandlers.ts

  // NOTE: Download handlers (download-http, download-torrent, pause-download, resume-download,
  // cancel-download, get-active-downloads, get-completed-downloads, delete-download,
  // get-onlinefix-ini, save-onlinefix-ini) moved to src/main/ipc/downloadHandlers.ts

  // NOTE: Game handlers (get-games, delete-game, open-game-folder, configure-game-exe,
  // set-game-version, set-game-title, set-game-favorite, toggle-game-favorite, check-all-updates,
  // set-game-proton-options, set-game-proton-prefix, set-game-steam-appid, set-game-lan-settings,
  // set-game-image-url, pick-game-banner-file, open-external, open-path, select-directory)
  // moved to src/main/ipc/gameHandlers.ts

  // The handlers below remain in main.ts as they have complex dependencies on local functions

  ipcMain.handle('scan-installed-games', async () => {
    try {
      const res = await scanInstalledGamesFromDisk()
      return { success: true, ...res }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('queue-game-updates', async (_event, gameUrls: string[]) => {
    try {
      const urls = Array.isArray(gameUrls) ? gameUrls.map(u => String(u || '').trim()).filter(Boolean) : []
      if (!urls.length) return { success: true, queuedAdded: 0 }

      const inQueue = new Set(updateQueue)
      let queuedAdded = 0

      for (const url of urls) {
        if (!/^https?:\/\//.test(url)) continue
        if (updateQueueCurrent === url) continue
        if (inQueue.has(url)) continue
        if (isGameActivelyDownloading(url)) continue
        updateQueue.push(url)
        inQueue.add(url)
        queuedAdded += 1
      }

      sendUpdateQueueStatus()
      pumpUpdateQueue().catch(() => {})
      return { success: true, queuedAdded }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('clear-update-queue', async () => {
    try {
      updateQueue = []
      sendUpdateQueueStatus()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('get-update-queue-status', async () => {
    try {
      const payload = {
        running: updateQueueRunning,
        queued: updateQueue.length,
        currentGameUrl: updateQueueCurrent,
        lastError: updateQueueLastError,
        updatedAt: Date.now()
      }
      return { success: true, status: payload }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

// NOTE: achievements-set-steam-web-api-key, achievements-get, achievements-import-schema,
// achievements-save-schema, achievements-clear-schema, achievements-force-refresh handlers
// moved to src/main/ipc/achievementsHandlers.ts

// NOTE: fetch-game-image handler moved to src/main/ipc/torrentHandlers.ts
// NOTE: set-game-image-url, pick-game-banner-file, delete-game, open-game-folder,
// configure-game-exe, set-game-version, set-game-title, set-game-favorite,
// toggle-game-favorite, check-all-updates, set-game-proton-options, set-game-proton-prefix,
// set-game-steam-appid, set-game-lan-settings, open-external, select-directory handlers
// moved to src/main/ipc/gameHandlers.ts

// NOTE: get-settings, save-settings handlers moved to src/main/ipc/settingsHandlers.ts

// NOTE: vpn-status, vpn-install, vpn-room-create, vpn-room-join, vpn-room-peers,
// vpn-connect, vpn-disconnect handlers moved to src/main/ipc/vpnHandlers.ts

// NOTE: launch-game, stop-game, is-game-running handlers moved to
// src/main/ipc/launchHandlers.ts

// NOTE: proton-ensure-runtime, proton-list-runtimes, proton-set-root, proton-default-prefix,
// proton-prepare-prefix, proton-create-game-prefix, proton-build-launch handlers moved to
// src/main/ipc/protonHandlers.ts

// NOTE: extract-download handler moved to src/main/ipc/downloadHandlers.ts

// NOTE: open-path handler moved to src/main/ipc/gameHandlers.ts

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

async function resumeActiveDownloads() {
  try {
    const active = (getActiveDownloads() as any[]).filter(d => {
      const st = String(d?.status || '').toLowerCase()
      return st !== 'paused' && st !== 'extracting' && st !== 'error'
    })
    if (!active.length) return
    console.log(`[Launcher] Resuming ${active.length} downloads from previous session`)

    const looksInstalled = (installPath: string): boolean => {
      const p = String(installPath || '').trim()
      if (!p) return false
      const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
      try {
        if (!fs.existsSync(abs)) return false
        const st = fs.statSync(abs)
        if (!st.isDirectory()) return false
      } catch {
        return false
      }

      // Prefer sentinel markers written by our extraction flows.
      const sentinels = ['.of_extracted', '.of_update_extracted', '.of_game.json']
      for (const s of sentinels) {
        try {
          if (fs.existsSync(path.join(abs, s))) return true
        } catch {
          // ignore
        }
      }

      // Fallback heuristic: at least one .exe inside the install dir.
      try {
        return !!findExecutableInDir(abs)
      } catch {
        return false
      }
    }

    const finalizeAsCompleted = (d: any, gameUrl: string, installPath: string) => {
      const downloadId = Number(d?.id)
      const idKey = String(d?.info_hash || d?.download_url || d?.id || '')

      try { updateDownloadInstallPath(downloadId, installPath) } catch {}
      try { updateDownloadProgress(downloadId, 100) } catch {}
      try { updateDownloadStatus(downloadId, 'completed') } catch {}

      try {
        mainWindow?.webContents.send('download-complete', {
          magnet: idKey,
          infoHash: d?.info_hash || undefined,
          destPath: installPath
        })
      } catch {
        // ignore
      }

      // Best-effort: ensure the game is marked installed.
      try {
        const existing = getGame(gameUrl) as any
        if (!existing?.install_path) {
          const version = parseVersionFromName(String(d?.download_url || '')) || parseVersionFromName(String(d?.title || '')) || null
          const exePath = findExecutableInDir(installPath)
          addOrUpdateGame(gameUrl, d?.title)
          markGameInstalled(gameUrl, installPath, version, exePath || undefined)
        }
      } catch {
        // ignore
      }
    }

    const seen = new Set<string>()
    for (const d of active) {
      const dedupeKey = String(d.info_hash || d.download_url || d.id)
      if (seen.has(dedupeKey)) {
        console.log('[Launcher] Skipping duplicate active download:', dedupeKey)
        continue
      }
      seen.add(dedupeKey)

      const gameUrl = String(d.game_url || d.download_url || '').trim()
      if (gameUrl) {
        // If the game is already installed, do NOT resume the download (prevents re-downloading after a successful extract/install).
        try {
          const g = getGame(gameUrl) as any
          const ip = String(g?.install_path || d?.install_path || '').trim()
          if (ip && looksInstalled(ip)) {
            const abs = path.isAbsolute(ip) ? ip : path.resolve(process.cwd(), ip)
            console.log('[Launcher] Download row is active but game looks installed; marking completed and skipping resume:', dedupeKey)
            finalizeAsCompleted(d, gameUrl, abs)
            continue
          }
        } catch {
          // ignore
        }

        // If we have an install_path on the download row and it looks installed, also skip.
        try {
          const ip = String(d?.install_path || '').trim()
          if (ip && looksInstalled(ip)) {
            const abs = path.isAbsolute(ip) ? ip : path.resolve(process.cwd(), ip)
            console.log('[Launcher] Active download has completed install markers; marking completed and skipping resume:', dedupeKey)
            finalizeAsCompleted(d, gameUrl, abs)
            continue
          }
        } catch {
          // ignore
        }
      }

      const isTorrent = d.type === 'torrent'

      // dest_path for HTTP is usually the archive file path; startGameDownload expects a directory override.
      let destPathOverride: string | undefined = d.dest_path || undefined
      if (!isTorrent && destPathOverride && /\.(zip|rar|7z)$/i.test(destPathOverride)) {
        try { destPathOverride = path.dirname(destPathOverride) } catch {}
      }

      startGameDownload({
        gameUrl: d.game_url || d.download_url,
        torrentMagnet: isTorrent ? d.download_url : undefined,
        downloadUrl: isTorrent ? undefined : d.download_url,
        gameTitle: d.title || 'Download',
        gameVersion: 'unknown',
        existingDownloadId: Number(d.id),
        destPathOverride,
        autoExtract: false
      }, (progress, details) => {
        const id = d.info_hash || d.download_url
        sendDownloadProgress({
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
          const resolvedGameUrl = String(d.game_url || d.download_url)
          const title = String(d.title || resolvedGameUrl)
          // Auto-fetch banner once installed
          fetchAndPersistBanner(resolvedGameUrl, title).catch(() => {})
          prepareGamePrefixAfterInstall(resolvedGameUrl, title, res.installPath).catch(() => {})
        }
      }).catch((err) => {
        console.warn('[Launcher] Failed to resume download', dedupeKey, err)
      })
    }
  } catch (err) {
    console.warn('Failed to resume active downloads', err)
  }
}

async function reconcileInstalledGamesFromCompletedDownloads() {
  try {
    const downloads = getCompletedDownloads() as any[]
    for (const d of downloads) {
      const gameUrl = String(d?.game_url || '').trim()
      const installPath = String(d?.install_path || '').trim()
      if (!gameUrl || !installPath) continue
      try {
        if (!fs.existsSync(installPath)) continue
      } catch {
        continue
      }

      let existing: any = null
      try {
        existing = getGame(gameUrl)
      } catch {}

      // If it's already in the library with an install path, nothing to do.
      if (existing?.install_path) continue

      const version = parseVersionFromName(String(d?.download_url || '')) || parseVersionFromName(String(d?.title || '')) || null
      const exePath = findExecutableInDir(installPath)

      try {
        markGameInstalled(gameUrl, installPath, version, exePath || undefined)

        // Best-effort: persist size for "Ordenar por tamanho"
        try {
          const bytes = await getDirectorySizeBytes(installPath)
          if (bytes > 0) updateGameInfo(gameUrl, { file_size: String(bytes) })
        } catch {}
      } catch {}
    }
  } catch (err) {
    console.warn('Failed to reconcile installed games from completed downloads', err)
  }
}

/**
 * Clean up orphaned downloads on startup.
 * - Removes completed downloads whose files no longer exist
 * - Removes old error downloads (older than 7 days)
 * - Removes downloads with invalid/missing paths
 */
async function cleanupOrphanedDownloads() {
  try {
    const activeDownloads = (getActiveDownloads() as any[]) || []
    const completedDownloads = (getCompletedDownloads() as any[]) || []
    const allDownloads = [...activeDownloads, ...completedDownloads]

    let cleaned = 0
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)

    for (const d of allDownloads) {
      const downloadId = Number(d?.id)
      if (!downloadId) continue

      const status = String(d?.status || '').toLowerCase()
      const destPath = String(d?.dest_path || '').trim()
      const installPath = String(d?.install_path || '').trim()
      const updatedAt = d?.updated_at ? new Date(d.updated_at).getTime() : 0

      let shouldDelete = false
      let reason = ''

      // Case 1: Completed downloads with no existing files
      if (status === 'completed') {
        const pathToCheck = installPath || destPath
        if (!pathToCheck) {
          shouldDelete = true
          reason = 'completed download with no path'
        } else {
          try {
            const absPath = path.isAbsolute(pathToCheck) ? pathToCheck : path.resolve(process.cwd(), pathToCheck)
            if (!fs.existsSync(absPath)) {
              shouldDelete = true
              reason = `completed download with missing path: ${absPath}`
            }
          } catch {
            shouldDelete = true
            reason = 'completed download with invalid path'
          }
        }
      }

      // Case 2: Error downloads - clean up old ones or ones with missing files
      if (status === 'error') {
        // Old errors (>7 days) get cleaned
        if (updatedAt && updatedAt < sevenDaysAgo) {
          shouldDelete = true
          reason = 'old error download (>7 days)'
        }
        // Error downloads with no valid dest_path or missing files get cleaned
        else if (!destPath) {
          shouldDelete = true
          reason = 'error download with no dest_path'
        }
      }

      // Case 3: Pending/downloading with no dest_path and no download_url
      if ((status === 'pending' || status === 'downloading') && !destPath && !d?.download_url) {
        shouldDelete = true
        reason = 'pending/downloading with no valid download info'
      }

      if (shouldDelete) {
        try {
          deleteDownload(downloadId)
          cleaned++
          console.log(`[Launcher] Cleaned up orphaned download #${downloadId}: ${reason}`)
        } catch (err) {
          console.warn(`[Launcher] Failed to delete orphaned download #${downloadId}:`, err)
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Launcher] Cleaned up ${cleaned} orphaned download(s)`)
    }
  } catch (err) {
    console.warn('Failed to cleanup orphaned downloads', err)
  }
}

function resolveDefaultGamesPath(): string {
  const configured = String(getSetting('games_path') || '').trim()
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)

  const home = os.homedir()
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      const docs = app.getPath('documents')
      if (docs) return path.join(docs, 'VoidLauncher')
    } catch {
      // ignore
    }
  }

  if (home) return path.join(home, 'Games', 'VoidLauncher')
  return path.join(process.cwd(), 'games')
}

function resolveGamesRootDir(): string {
  const gamesPath = resolveDefaultGamesPath()
  try { fs.mkdirSync(gamesPath, { recursive: true }) } catch {}
  return gamesPath
}

async function scanInstalledGamesFromDisk(): Promise<{ scanned: number; added: number; skipped: number }> {
  const normalizePath = (p: string): string => {
    const raw = String(p || '').trim()
    if (!raw) return ''
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  }

  const activeInstallPaths = new Set<string>()
  try {
    const active = (getActiveDownloads() as any[]) || []
    for (const d of active) {
      const ip = normalizePath(String(d?.install_path || ''))
      if (ip) activeInstallPaths.add(ip)
    }
  } catch {
    // ignore
  }

  const hasExtractingMarker = (installPath: string): boolean => {
    const base = normalizePath(installPath)
    if (!base) return false
    const markers = ['.of_extracting.json', '.of_update_extracting.json', '.extracting']
    for (const m of markers) {
      try {
        if (fs.existsSync(path.join(base, m))) return true
      } catch {
        // ignore
      }
    }
    return false
  }

  const looksInstalled = (installPath: string): boolean => {
    const base = normalizePath(installPath)
    if (!base) return false
    try {
      if (!fs.existsSync(base)) return false
      const st = fs.statSync(base)
      if (!st.isDirectory()) return false
    } catch {
      return false
    }

    const sentinels = ['.of_extracted', '.of_update_extracted', '.of_game.json']
    for (const s of sentinels) {
      try {
        if (fs.existsSync(path.join(base, s))) return true
      } catch {
        // ignore
      }
    }

    try {
      return !!findExecutableInDir(base)
    } catch {
      return false
    }
  }

  const readLauncherMarker = (installPath: string): any | null => {
    try {
      const base = normalizePath(installPath)
      if (!base) return null
      const markerPath = path.join(base, '.of_game.json')
      if (!fs.existsSync(markerPath)) return null
      const raw = fs.readFileSync(markerPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return parsed || null
    } catch {
      return null
    }
  }

  const gamesRoot = resolveGamesRootDir()
  const existing = (getAllGames() as any[]) || []

  const existingByInstall = new Map<string, any>()
  for (const g of existing) {
    const raw = String(g?.install_path || '').trim()
    if (!raw) continue
    const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
    existingByInstall.set(abs, g)
  }

  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(gamesRoot, { withFileTypes: true })
  } catch {
    return { scanned: 0, added: 0, skipped: 0 }
  }

  let scanned = 0
  let added = 0
  let skipped = 0

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const folderName = ent.name
    if (!folderName || folderName.startsWith('.')) continue

    const installPath = path.join(gamesRoot, folderName)
    scanned += 1

    const normalizedInstall = normalizePath(installPath)
    if (normalizedInstall && activeInstallPaths.has(normalizedInstall)) {
      skipped += 1
      continue
    }
    if (hasExtractingMarker(installPath)) {
      skipped += 1
      continue
    }

    if (existingByInstall.has(installPath)) {
      skipped += 1
      continue
    }

    // Best-effort normalize for nested-folder releases.
    try { normalizeGameInstallDir(installPath) } catch {}

    const marker = readLauncherMarker(installPath)
    if (marker) {
      const show = marker?.showInLibrary
      const status = String(marker?.status || '').toLowerCase()
      if (show === false || (status && status !== 'installed')) {
        skipped += 1
        continue
      }
    }

    if (!looksInstalled(installPath)) {
      skipped += 1
      continue
    }

    let gameUrl: string | null = null
    let title: string | null = null

    // Marker-based (preferred) if present.
    try {
      const markerPath = path.join(installPath, '.of_game.json')
      if (fs.existsSync(markerPath)) {
        const raw = fs.readFileSync(markerPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed?.url) gameUrl = String(parsed.url)
        if (parsed?.title) title = String(parsed.title)
      }
    } catch {}

    // If folder looks like an Online-Fix game_id, try mapping it.
    if (!gameUrl && /^\d{3,}$/.test(folderName)) {
      try {
        const g = getGameByGameId(folderName) as any
        if (g?.url) {
          gameUrl = String(g.url)
          title = title || (g.title ? String(g.title) : null)
        }
      } catch {}
    }

    if (!gameUrl) {
      gameUrl = `local://${encodeURIComponent(folderName)}`
      title = title || folderName
    }

    const exePath = findExecutableInDir(installPath)

    try {
      addOrUpdateGame(gameUrl, title || undefined)
      markGameInstalled(gameUrl, installPath, null, exePath || undefined)

      // Best-effort: persist size for "Ordenar por tamanho"
      try {
        const bytes = await getDirectorySizeBytes(installPath)
        if (bytes > 0) updateGameInfo(gameUrl, { file_size: String(bytes) })
      } catch {}

      // Write marker for future scans (best-effort).
      try {
        const markerPath = path.join(installPath, '.of_game.json')
        if (!fs.existsSync(markerPath)) {
          fs.writeFileSync(markerPath, JSON.stringify({ url: gameUrl, title: title || undefined, scannedAt: Date.now() }, null, 2))
        }
      } catch {}

      added += 1
    } catch {
      skipped += 1
    }
  }

  return { scanned, added, skipped }
}

// NOTE: getDirectorySizeBytes moved to src/main/utils/fileUtils.ts

async function refreshInstalledGameSizesBestEffort() {
  try {
    const games = (getAllGames() as any[]) || []
    const installed = games.filter((g) => {
      const raw = String(g?.install_path || '').trim()
      if (!raw) return false
      const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
      if (!fs.existsSync(abs)) return false
      return true
    })

    // Compute only if missing/invalid, and stagger work to avoid UI stalls.
    let idx = 0
    const step = async () => {
      const g = installed[idx++] as any
      if (!g) return

      try {
        const cur = String(g?.file_size || '').trim()
        const needs = !(cur && /^\d+$/.test(cur) && Number(cur) > 0)
        if (needs) {
          const raw = String(g?.install_path || '').trim()
          const installPath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
          const bytes = await getDirectorySizeBytes(installPath, { maxMs: 3500 })
          if (bytes > 0) updateGameInfo(String(g.url), { file_size: String(bytes) })
        }
      } catch {
        // ignore
      }

      setTimeout(() => {
        void step()
      }, 150)
    }

    // Start a bit after first paint.
    setTimeout(() => {
      void step()
    }, 2500)
  } catch {
    // ignore
  }
}

function resolveInstallPathForDownloadRow(d: any): string {
  const existing = String(d?.install_path || '').trim()
  if (existing) {
    return path.isAbsolute(existing) ? existing : path.resolve(process.cwd(), existing)
  }

  const gamesPath = resolveDefaultGamesPath()
  try { fs.mkdirSync(gamesPath, { recursive: true }) } catch {}

  const gameUrl = String(d?.game_url || d?.download_url || '')
  const gameId = extractGameIdFromUrl(gameUrl)
  const title = String(d?.title || 'game')
  const safeName = title.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const folder = gameId || safeName || 'game'
  return path.join(gamesPath, folder)
}

async function resumeInterruptedExtractions() {
  try {
    const extracting = (getActiveDownloads() as any[]).filter(d => String(d?.status || '').toLowerCase() === 'extracting')
    if (!extracting.length) return

    console.log(`[Launcher] Resuming ${extracting.length} interrupted extraction(s) from previous session`)

    for (const d of extracting) {
      const downloadId = Number(d?.id)
      const idKey = String(d?.info_hash || d?.download_url || d?.id || '')
      const gameUrl = String(d?.game_url || d?.download_url || idKey)

      const installPath = resolveInstallPathForDownloadRow(d)
      try {
        updateDownloadInstallPath(downloadId, installPath)
      } catch {
        // ignore
      }

      // Always make sure the target dir exists.
      try { fs.mkdirSync(installPath, { recursive: true }) } catch {}

      // Torrent: extraction here means "update RAR extraction" over installPath
      if (String(d?.type || '').toLowerCase() === 'torrent') {
        const marker = path.join(installPath, '.of_update_extracting.json')
        try {
          fs.writeFileSync(marker, JSON.stringify({ downloadId, gameUrl, startedAt: Date.now() }, null, 2))
        } catch {}

        sendDownloadProgress({
          magnet: idKey,
          url: idKey,
          progress: 0,
          stage: 'extract',
          extractProgress: 0,
          destPath: installPath
        })

        const res = await processUpdateExtraction(installPath, gameUrl, (percent, details) => {
          const p = Number(percent) || 0
          try { updateDownloadProgress(downloadId, p) } catch {}
          sendDownloadProgress({
            magnet: idKey,
            url: idKey,
            progress: p,
            stage: 'extract',
            extractProgress: p,
            eta: details?.etaSeconds,
            destPath: installPath
          })
        })

        if (!res.success) {
          updateDownloadStatus(downloadId, 'error', res.error || 'Extraction failed')
          continue
        }

        try { fs.unlinkSync(marker) } catch {}
        try { fs.writeFileSync(path.join(installPath, '.of_update_extracted'), String(Date.now())) } catch {}

        // Best-effort: normalize and mark installed.
        try { normalizeGameInstallDir(installPath) } catch {}
        try {
          const version = await resolveGameVersion({
            filename: d?.download_url,
            title: d?.title,
            gameUrl
          })
          addOrUpdateGame(gameUrl, d?.title)
          const exePath = findExecutableInDir(installPath)
          markGameInstalled(gameUrl, installPath, version, exePath || undefined)
        } catch {}

        updateDownloadStatus(downloadId, 'completed')
        mainWindow?.webContents.send('download-complete', { magnet: idKey, infoHash: d?.info_hash || undefined, destPath: installPath })
        continue
      }

      // HTTP: extraction means archive -> installPath
      const candidate = String(d?.dest_path || '').trim()
      const { archivePath } = findArchive(candidate || installPath)
      if (!archivePath || !fs.existsSync(archivePath)) {
        updateDownloadStatus(downloadId, 'error', 'Arquivo do download não encontrado para extrair')
        continue
      }

      const marker = path.join(installPath, '.of_extracting.json')
      try {
        fs.writeFileSync(marker, JSON.stringify({ downloadId, gameUrl, archivePath, startedAt: Date.now() }, null, 2))
      } catch {}

      sendDownloadProgress({
        magnet: idKey,
        url: idKey,
        progress: 0,
        stage: 'extract',
        extractProgress: 0,
        destPath: installPath
      })

      try {
        const extractStart = Date.now()
        await import('./zip.js').then(m => m.extractZipWithPassword(
          archivePath,
          installPath,
          undefined,
          (percent) => {
            const p = Number(percent) || 0
            const elapsed = (Date.now() - extractStart) / 1000
            const eta = p > 0 ? ((100 - p) * elapsed) / p : undefined
            try { updateDownloadProgress(downloadId, p) } catch {}
            sendDownloadProgress({
              magnet: idKey,
              url: idKey,
              progress: p,
              stage: 'extract',
              extractProgress: p,
              eta: eta,
              destPath: installPath
            })
          }
        ))
      } catch (err: any) {
        updateDownloadStatus(downloadId, 'error', err?.message || String(err))
        continue
      }

      try { normalizeGameInstallDir(installPath) } catch {}
      try { fs.unlinkSync(marker) } catch {}
      try { fs.writeFileSync(path.join(installPath, '.of_extracted'), String(Date.now())) } catch {}

      // Remove archive after successful extraction (best effort)
      try { fs.unlinkSync(archivePath) } catch {}

      try {
        const version = await resolveGameVersion({
          filename: archivePath,
          title: d?.title,
          gameUrl
        })
        addOrUpdateGame(gameUrl, d?.title)
        const exePath = findExecutableInDir(installPath)
        markGameInstalled(gameUrl, installPath, version, exePath || undefined)
      } catch {}

      updateDownloadStatus(downloadId, 'completed')
      mainWindow?.webContents.send('download-complete', { magnet: idKey, infoHash: d?.info_hash || undefined, destPath: installPath })
    }
  } catch (err) {
    console.warn('Failed to resume interrupted extractions', err)
  }
}

// NOTE: findExecutableInDir, slugify, findArchive moved to src/main/utils/fileUtils.ts
