import * as drive from './drive'
import * as cloudSaves from './cloudSaves'
import { appendCloudSavesHistory, listCloudSavesHistory, type CloudSavesHistoryEntry } from './cloudSavesHistory'
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
import { addOrUpdateGame, updateGameVersion, getSetting, getActiveDownloads, getDownloadByUrl, getCompletedDownloads, getDownloadById, markGameInstalled, setSetting, getAllGames, updateGameInfo, deleteGame, deleteDownload, getGame, getGameByGameId, extractGameIdFromUrl, updateDownloadProgress, updateDownloadStatus, updateDownloadInstallPath, setGameFavorite, toggleGameFavorite, updateGamePlayTime } from './db.js'
import { shouldBlockRequest } from './easylist-filters.js'
import { startGameDownload, pauseDownloadByTorrentId, resumeDownloadByTorrentId, cancelDownloadByTorrentId, parseVersionFromName, processUpdateExtraction, readOnlineFixIni, writeOnlineFixIni, normalizeGameInstallDir } from './downloadManager.js'
import axios from 'axios'
import { resolveTorrentFileUrl, deriveTitleFromTorrentUrl } from './torrentResolver.js'
import fs from 'fs'
import { isLinux, findProtonRuntime, setSavedProtonRuntime, buildProtonLaunch, getPrefixPath, getDefaultPrefixPath, listProtonRuntimes, setCustomProtonRoot, setCustomProtonRoots, ensurePrefixDefaults, ensureGamePrefixFromDefault, getPrefixRootDir, ensureDefaultPrefix, getExpectedDefaultPrefixPath, ensureGameCommonRedists } from './protonManager.js'
import { spawn } from 'child_process'
import { vpnControllerCreateRoom, vpnControllerJoinRoom, vpnControllerListPeers, vpnControllerStatus } from './vpnControllerClient.js'
import { vpnCheckInstalled, vpnConnectFromConfig, vpnDisconnect, vpnInstallBestEffort } from './ofVpnManager.js'
import { AchievementsManager } from './achievements/manager.js'
import { AchievementOverlay } from './achievements/overlay.js'
import { monitorEventLoopDelay } from 'perf_hooks'

const DEFAULT_LAN_CONTROLLER_URL = 'https://vpn.mroz.dev.br'

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
  
  ipcMain.handle('drive-auth', async () => {
    const res = await drive.authenticateWithDrive()
    return res
  })
  
  ipcMain.handle('drive-list-saves', async () => {
    const res = await drive.listSaves()
    return res
  })

  ipcMain.handle('drive-list-saves-for-game', async (_event, realAppId?: string) => {
    const res = await drive.listSaves(realAppId)
    return res
  })

  ipcMain.handle('drive-get-credentials', async () => {
    try {
      const credPath = drive.getCredentialsPath()
      if (!credPath || !fs.existsSync(credPath)) return { success: false, message: 'Credenciais não encontradas' }
      const raw = fs.readFileSync(credPath, 'utf-8')
      return { success: true, content: raw }
    } catch (e: any) {
      return { success: false, message: e?.message || String(e) }
    }
  })

  ipcMain.handle('drive-open-credentials', async () => {
    try {
      const credPath = drive.getCredentialsPath()
      if (!credPath || !fs.existsSync(credPath)) return { success: false, message: 'Arquivo de credenciais não encontrado' }
      const res = await shell.openPath(credPath)
      if (res) return { success: false, message: res }
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e?.message || String(e) }
    }
  })
  
  ipcMain.handle('drive-upload-save', async (event, localPath: string, remoteName?: string) => {
    const res = await drive.uploadSave(localPath, remoteName)
    return res
  })
  
  ipcMain.handle('drive-download-save', async (event, fileId: string, destPath: string) => {
    const res = await drive.downloadSave(fileId, destPath)
    return res
  })

  ipcMain.handle('drive-backup-saves', async (event, options: any) => {
    try {
      const gameUrl = String(options?.gameUrl || '').trim()
      const game = gameUrl ? (getGame(gameUrl) as any) : null
      const res = await cloudSaves.backupCloudSavesAfterExit({
        gameUrl: gameUrl || undefined,
        title: String(options?.title || game?.title || ''),
        steamAppId: (options?.steamAppId || game?.steam_app_id || null) as any,
        protonPrefix: (options?.protonPrefix || game?.proton_prefix || null) as any
      })
      if (res?.success && !(res as any)?.skipped) return { success: true }

      // Fallback: legacy OnlineFix folder backup
      return await drive.backupLocalSavesToDrive(options || {})
    } catch (e: any) {
      return { success: false, message: e?.message || String(e) }
    }
  })

  ipcMain.handle('drive-sync-saves-on-playstart', async (event, options: any) => {
    try {
      const gameUrl = String(options?.gameUrl || '').trim()
      const game = gameUrl ? (getGame(gameUrl) as any) : null
      const gameKey = cloudSaves.computeCloudSavesGameKey({
        gameUrl: gameUrl || undefined,
        title: String(options?.title || game?.title || ''),
        steamAppId: (options?.steamAppId || game?.steam_app_id || null) as any,
        protonPrefix: (options?.protonPrefix || game?.proton_prefix || null) as any
      })
      sendCloudSavesStatus({ at: Date.now(), gameUrl: gameUrl || undefined, gameKey, stage: 'restore', level: 'info', message: 'Verificando saves na nuvem...' })
      const restoreRes = await cloudSaves.restoreCloudSavesBeforeLaunch({
        gameUrl: gameUrl || undefined,
        title: String(options?.title || game?.title || ''),
        steamAppId: (options?.steamAppId || game?.steam_app_id || null) as any,
        protonPrefix: (options?.protonPrefix || game?.proton_prefix || null) as any
      })
      if (restoreRes?.success && !(restoreRes as any)?.skipped) {
        const msg = String(restoreRes?.message || 'Saves restaurados da nuvem.')
        recordCloudSaves({ at: Date.now(), gameKey, gameUrl: gameUrl || undefined, stage: 'restore', level: 'success', message: msg })
        sendCloudSavesStatus({ at: Date.now(), gameUrl: gameUrl || undefined, gameKey, stage: 'restore', level: 'success', message: msg })
        return { success: true, message: restoreRes.message }
      }

      if (restoreRes?.success && (restoreRes as any)?.skipped) {
        const msg = String(restoreRes?.message || 'Saves locais já estão atualizados.')
        recordCloudSaves({ at: Date.now(), gameKey, gameUrl: gameUrl || undefined, stage: 'restore', level: 'info', message: msg })
        sendCloudSavesStatus({ at: Date.now(), gameUrl: gameUrl || undefined, gameKey, stage: 'restore', level: 'info', message: msg })
      }

      // Fallback: legacy OnlineFix folder sync
      return await drive.syncSavesOnPlayStart(options || {})
    } catch (e: any) {
      return { success: false, message: e?.message || String(e) }
    }
  })

  ipcMain.handle('cloud-saves-get-history', async (_event, payload?: { gameUrl?: string; limit?: number }) => {
    try {
      const gameUrl = String(payload?.gameUrl || '').trim()
      const game = gameUrl ? (getGame(gameUrl) as any) : null
      const gameKey = cloudSaves.computeCloudSavesGameKey({
        gameUrl: gameUrl || undefined,
        title: String(game?.title || ''),
        steamAppId: (game?.steam_app_id || null) as any,
        protonPrefix: (game?.proton_prefix || null) as any
      })
      const list = listCloudSavesHistory({ gameKey, limit: payload?.limit })
      return { success: true, gameKey, history: list }
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) }
    }
  })

  ipcMain.handle('cloud-saves-open-backups', async (_event, payload?: { gameUrl?: string }) => {
    try {
      const gameUrl = String(payload?.gameUrl || '').trim()
      const game = gameUrl ? (getGame(gameUrl) as any) : null
      const dir = cloudSaves.getLocalLudusaviBackupDir({
        gameUrl: gameUrl || undefined,
        title: String(game?.title || ''),
        steamAppId: (game?.steam_app_id || null) as any,
        protonPrefix: (game?.proton_prefix || null) as any
      })
      try { fs.mkdirSync(dir, { recursive: true }) } catch {}
      const r = await shell.openPath(dir)
      if (r) return { success: false, error: r }
      return { success: true, path: dir }
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) }
    }
  })

// Synchronous trigger for a manual per-game save sync (compare remote vs local and download/upload)
  ipcMain.handle('drive-sync-game-saves', async (event, arg: any) => {
    console.log('[DRIVE-SYNC] Chamada recebida. Argumento:', arg)
    try {
      let options = arg

      // Se o frontend enviou apenas a URL (string), hidratamos os dados
      if (typeof arg === 'string') {
        const gameUrl = arg
        console.log(`[DRIVE-SYNC] Argumento é URL. Buscando jogo: ${gameUrl}`)
        
        // Assume-se que 'getGame' está definido e retorna o objeto do DB
        const game = getGame(gameUrl) as any 
        
        if (!game) {
          console.error(`[DRIVE-SYNC] Jogo não encontrado para URL: ${gameUrl}`)
          return { success: false, message: 'Jogo não encontrado no banco de dados.' }
        }

        // Resolve o caminho absoluto se necessário
        let installPath = game.install_path
        if (installPath && !path.isAbsolute(installPath)) {
          installPath = path.resolve(process.cwd(), installPath)
        }

        // Monta o objeto que o drive.ts espera
        options = {
          installPath: installPath,
          protonPrefix: game.proton_prefix,
          // ✅ CORREÇÃO CRÍTICA AQUI: Usamos o 'steam_app_id'. 
          // Se for null/undefined no DB, o valor será 'undefined', 
          // o que forçará o drive.ts a buscar o ID real no OnlineFix.ini.
          // Antes estava: 'realAppId: game.game_id'
          realAppId: game.steam_app_id || undefined
        }

        console.log('[DRIVE-SYNC] Dados do jogo resolvidos (RealAppId agora é steam_app_id ou undefined):', options)
      }

      // Prefer Ludusavi-based sync; fallback to legacy OnlineFix sync.
      try {
        const gameUrl = typeof arg === 'string' ? arg : String(options?.gameUrl || '').trim()
        const game = gameUrl ? (getGame(gameUrl) as any) : null
        const res = await cloudSaves.syncCloudSavesManual({
          gameUrl: gameUrl || undefined,
          title: String(options?.title || game?.title || ''),
          steamAppId: (options?.steamAppId || game?.steam_app_id || null) as any,
          protonPrefix: (options?.protonPrefix || game?.proton_prefix || null) as any
        })
        console.log('[DRIVE-SYNC] Resultado final (Ludusavi):', res)
        if (res?.success) return res
      } catch (e) {
        console.warn('[DRIVE-SYNC] Ludusavi sync failed; falling back:', e)
      }

      const legacy = await drive.syncSavesOnPlayStart(options || {})
      console.log('[DRIVE-SYNC] Resultado final (legacy):', legacy)
      return legacy
    } catch (e: any) {
      console.error('[DRIVE-SYNC] Erro inesperado na chamada principal:', e)
      return { success: false, message: e?.message || String(e) }
    }
  })
  
  ipcMain.handle('drive-save-credentials', async (event, rawJson: string) => {
    const res = await drive.saveClientCredentials(rawJson)
    return res
  })

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
      sendDownloadProgress({
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

  // Warm Proton runtimes cache at startup (Linux only).
  if (process.platform === 'linux') {
    setTimeout(() => {
      void getCachedProtonRuntimes(false).catch(() => {})
    }, 250)
  }

  // IMPORTANT: resuming downloads can be heavy (torrent init, IO, IPC). Running it
  // before the UI is up makes the app feel frozen, especially in dev.
  // Allow disabling via env for troubleshooting.
  const disableAutoResume = ['1', 'true', 'yes'].includes(String(process.env.OF_DISABLE_AUTO_RESUME_DOWNLOADS || '').toLowerCase())

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

  if (!disableAutoResume) {
    let resumed = false
    const runResumeOnce = () => {
      if (resumed) return
      resumed = true
      // Small delay to keep first paint snappy.
      setTimeout(() => {
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
        sendDownloadProgress({ url, progress: p })
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-torrent', async (_event: IpcMainInvokeEvent, magnet: string, destPath: string) => {
    try {
      await downloadTorrent(magnet, destPath, (p) => {
        sendDownloadProgress({ magnet, progress: p })
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

  ipcMain.handle('achievements-set-steam-web-api-key', async (_event, apiKey: string) => {
    try {
      const key = String(apiKey || '').trim()
      // Allow clearing by sending empty.
      setSetting('steam_web_api_key', key)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-get', async (_event, gameUrl: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }

      const game = getAllGames().find((g: any) => g.url === url) as any
      if (!game) return { success: false, error: 'Jogo não encontrado' }

      // Resolve install dir similarly to launch-game
      let exePath = (game.executable_path as string | null) || null
      let installDir: string = process.cwd()
      if (game.install_path) {
        installDir = path.isAbsolute(game.install_path) ? game.install_path : path.resolve(process.cwd(), game.install_path)
      } else if (exePath) {
        installDir = path.dirname(exePath)
      }

      if (exePath) exePath = path.isAbsolute(exePath) ? exePath : path.join(installDir, exePath)

      const detectedSteamAppId = detectSteamAppIdFromInstall(installDir)

      const meta = {
        gameUrl: url,
        title: game.title || undefined,
        installPath: installDir,
        executablePath: exePath,
        steamAppId: game.steam_app_id || null,
        schemaSteamAppId: detectedSteamAppId || game.steam_app_id || null,
        protonPrefix: game.proton_prefix || null
      }

      const sources = achievementsManager.getSources(meta)
      const achievements = await achievementsManager.getAchievements(meta)
      return { success: true, sources, achievements }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-import-schema', async (_event, gameUrl: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }

      const { dialog } = require('electron')
      const res = await dialog.showOpenDialog({
        title: 'Selecione um schema de conquistas (JSON)',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (res.canceled || !res.filePaths?.length) return { success: false, error: 'Nenhum arquivo selecionado' }
      const filePath = String(res.filePaths[0] || '').trim()
      if (!filePath) return { success: false, error: 'Arquivo inválido' }

      const raw = fs.readFileSync(filePath, 'utf8')
      const json = JSON.parse(raw)

      const { setCustomAchievementSchemaForGame } = require('./achievements/schema.js') as typeof import('./achievements/schema.js')
      const out = setCustomAchievementSchemaForGame(url, json)
      if (!out.success) return { success: false, error: out.error || 'Falha ao salvar schema' }
      return { success: true, count: out.count }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-clear-schema', async (_event, gameUrl: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }
      const { clearCustomAchievementSchemaForGame } = require('./achievements/schema.js') as typeof import('./achievements/schema.js')
      const out = clearCustomAchievementSchemaForGame(url)
      if (!out.success) return { success: false, error: out.error || 'Falha ao remover schema' }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-force-refresh', async (_event, gameUrl: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }

      const game = getAllGames().find((g: any) => g.url === url) as any
      if (!game) return { success: false, error: 'Jogo não encontrado' }

      let exePath = (game.executable_path as string | null) || null
      let installDir: string = process.cwd()
      if (game.install_path) {
        installDir = path.isAbsolute(game.install_path) ? game.install_path : path.resolve(process.cwd(), game.install_path)
      } else if (exePath) {
        installDir = path.dirname(exePath)
      }

      if (exePath) exePath = path.isAbsolute(exePath) ? exePath : path.join(installDir, exePath)

      const detectedSteamAppId = detectSteamAppIdFromInstall(installDir)
      const steamAppId = String(detectedSteamAppId || game.steam_app_id || '').trim()
      if (!steamAppId) return { success: false, error: 'Steam AppID não detectado/configurado' }

      const { clearCachedSchema } = require('./achievements/schema.js') as typeof import('./achievements/schema.js')
      clearCachedSchema(steamAppId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
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
        const rawPath = String(game.install_path)
        let installPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)

        try {
          if (fs.existsSync(installPath)) {
            const st = fs.statSync(installPath)
            if (st.isFile()) installPath = path.dirname(installPath)
          }
        } catch {}

        // Basic safety guard: never delete filesystem root.
        if (installPath && path.parse(installPath).root === installPath) {
          console.warn('[DeleteGame] Refusing to delete root path:', installPath)
        } else if (fs.existsSync(installPath)) {
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

  ipcMain.handle('set-game-favorite', async (_event, gameUrl: string, isFavorite: boolean) => {
    try {
      setGameFavorite(gameUrl, !!isFavorite)
      return { success: true, isFavorite: !!isFavorite }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('toggle-game-favorite', async (_event, gameUrl: string) => {
    try {
      const res = toggleGameFavorite(gameUrl)
      return { success: true, isFavorite: !!res?.isFavorite }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('check-all-updates', async () => {
    try {
      const games = (getAllGames() as any[])
        .filter((g: any) => g?.url)
        .filter((g: any) => /^https?:\/\//.test(String(g.url || '')))
      const results: Array<{ url: string; latest?: string; torrentUrl?: string; error?: string }> = []

      const queue = [...games]
      const concurrency = 4
      const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }).map(async () => {
        while (queue.length) {
          const g: any = queue.shift()
          if (!g?.url) continue
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
      })

      await Promise.all(workers)

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

  ipcMain.handle('set-game-lan-settings', async (_event, gameUrl: string, payload: { mode?: string | null; networkId?: string | null; autoconnect?: boolean }) => {
    try {
      const mode = payload?.mode ? String(payload.mode) : null
      const networkId = payload?.networkId ? String(payload.networkId) : null
      const autoconnect = payload?.autoconnect ? 1 : 0
      updateGameInfo(gameUrl, { lan_mode: mode, lan_network_id: networkId, lan_autoconnect: autoconnect })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open-external', async (_event, target: string) => {
    try {
      const url = String(target || '').trim()
      if (!/^https?:\/\//i.test(url)) return { success: false, error: 'URL inválida' }
      await shell.openExternal(url)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao abrir URL' }
    }
  })

  ipcMain.handle('get-settings', async () => {
    try {
      const downloadPath = getSetting('download_path') || app.getPath('downloads')
      const autoExtract = getSetting('auto_extract') !== 'false'
      const autoUpdate = getSetting('auto_update') === 'true'
      const parallelDownloads = Number(getSetting('parallel_downloads') || 3)
      const steamWebApiKey = String(getSetting('steam_web_api_key') || '').trim()
      const achievementSchemaBaseUrl = String(getSetting('achievement_schema_base_url') || '').trim()
      const isLinuxPlatform = process.platform === 'linux'
      const protonDefaultRuntimePath = isLinuxPlatform ? String(getSetting('proton_runtime_path') || '').trim() : ''
      let protonExtraPaths: string[] = []
      if (isLinuxPlatform) {
        const legacy = String(getSetting('proton_runtime_root') || '').trim()
        if (legacy) protonExtraPaths.push(legacy)
        const raw = getSetting('proton_runtime_roots')
        if (raw) {
          try {
            const parsed = JSON.parse(String(raw))
            if (Array.isArray(parsed)) {
              for (const p of parsed) {
                if (typeof p === 'string' && p.trim()) protonExtraPaths.push(p.trim())
              }
            }
          } catch {
            // ignore
          }
        }
        protonExtraPaths = Array.from(new Set(protonExtraPaths)).filter(Boolean)
      }
      let lanDefaultNetworkId = String(getSetting('lan_default_network_id') || '').trim()
      const lanControllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()

      return {
        success: true,
        platform: process.platform,
        isLinux: isLinuxPlatform,
        settings: {
          downloadPath,
          autoExtract,
          autoUpdate,
          parallelDownloads,
          steamWebApiKey,
          achievementSchemaBaseUrl,
          protonDefaultRuntimePath,
          protonExtraPaths,
          lanDefaultNetworkId,
          lanControllerUrl
        }
      }
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
      if (typeof settings.steamWebApiKey === 'string') setSetting('steam_web_api_key', settings.steamWebApiKey.trim())
      if (typeof settings.achievementSchemaBaseUrl === 'string') setSetting('achievement_schema_base_url', settings.achievementSchemaBaseUrl.trim())
      if (process.platform === 'linux') {
        // Proton é comportamento padrão no Linux (não faz sentido desativar).
        setSetting('use_proton', 'true')

        if (typeof settings.protonDefaultRuntimePath === 'string') {
          const v = settings.protonDefaultRuntimePath.trim()
          if (v) setSavedProtonRuntime(v)
          else setSetting('proton_runtime_path', '')
        }

        if (Array.isArray(settings.protonExtraPaths)) {
          setCustomProtonRoots(settings.protonExtraPaths)
        } else if (typeof settings.protonExtraPaths === 'string' && settings.protonExtraPaths.trim()) {
          // tolera payload antigo
          setCustomProtonRoot(settings.protonExtraPaths.trim())
        }
      }
      if (typeof settings.lanDefaultNetworkId === 'string') setSetting('lan_default_network_id', settings.lanDefaultNetworkId.trim())
      if (typeof settings.lanControllerUrl === 'string') setSetting('lan_controller_url', settings.lanControllerUrl.trim())
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('vpn-status', async () => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const ctrl = await vpnControllerStatus({ controllerUrl })
      const installed = await vpnCheckInstalled()
      return { success: true, controller: ctrl.success ? ctrl.data : null, installed: installed.installed, installError: installed.error }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao consultar VPN' }
    }
  })

  ipcMain.handle('vpn-install', async () => {
    try {
      const res = await vpnInstallBestEffort()
      if (!res.success) {
        if (process.platform === 'win32') {
          return {
            success: false,
            error: res.error || 'Windows: instale WireGuard e tente novamente',
            url: 'https://www.wireguard.com/install/'
          }
        }
        return { success: false, error: res.error || 'Falha ao instalar' }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao instalar' }
    }
  })

  ipcMain.handle('vpn-room-create', async (_event, payload?: { name?: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const name = String(payload?.name || '').trim()
      const res = await vpnControllerCreateRoom({ controllerUrl, name })
      if (!res.success) return { success: false, error: res.error || 'Falha ao criar sala' }
      return { success: true, code: res.code, config: res.config, vpnIp: res.vpnIp }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao criar sala' }
    }
  })

  ipcMain.handle('vpn-room-join', async (_event, payload: { code: string; name?: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const code = String(payload?.code || '').trim()
      const name = String(payload?.name || '').trim()
      if (!code) return { success: false, error: 'Código ausente' }
      const res = await vpnControllerJoinRoom({ controllerUrl, code, name })
      if (!res.success) return { success: false, error: res.error || 'Falha ao entrar na sala' }
      return { success: true, config: res.config, vpnIp: res.vpnIp, hostIp: res.hostIp }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao entrar na sala' }
    }
  })

  ipcMain.handle('vpn-room-peers', async (_event, payload: { code: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const code = String(payload?.code || '').trim()
      if (!code) return { success: false, error: 'Código ausente' }
      const res = await vpnControllerListPeers({ controllerUrl, code })
      if (!res.success) return { success: false, error: res.error || 'Falha ao listar peers' }
      return { success: true, peers: res.peers || [] }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao listar peers' }
    }
  })

  ipcMain.handle('vpn-connect', async (_event, payload: { config: string }) => {
    try {
      const cfg = String(payload?.config || '').trim()
      if (!cfg) return { success: false, error: 'Config ausente' }
      const userDataDir = app.getPath('userData')
      const res = await vpnConnectFromConfig({ configText: cfg, userDataDir })
      if (!res.success) {
        return {
          success: false,
          error: res.error || 'Falha ao conectar',
          needsInstall: !!(res as any).needsInstall,
          needsAdmin: !!(res as any).needsAdmin
        }
      }
      return { success: true, tunnelName: res.tunnelName, configPath: res.configPath }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao conectar' }
    }
  })

  ipcMain.handle('vpn-disconnect', async () => {
    try {
      const userDataDir = app.getPath('userData')
      const res = await vpnDisconnect({ userDataDir })
      if (!res.success) return { success: false, error: res.error || 'Falha ao desconectar', needsAdmin: !!(res as any).needsAdmin }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao desconectar' }
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

        // Plug&play: if LAN mode is enabled for this game, try to auto-connect before launching.
        try {
          const lanMode = String(game.lan_mode || 'steam')
          const lanNetworkId = String(game.lan_network_id || '').trim()
          const lanAutoconnect = Number(game.lan_autoconnect || 0) === 1
          if (lanMode === 'ofvpn' && lanAutoconnect) {
            await ensureOfVpnBeforeLaunch(gameUrl, lanNetworkId)
          }
        } catch (err: any) {
          console.warn('[LAN] Failed to ensure LAN/VPN connectivity:', err?.message || err)
        }

      // Before launching, sync saves between local and Drive (if Drive creds are configured)
      try {
        sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'Sincronizando saves...' })
        const gameKey = cloudSaves.computeCloudSavesGameKey({
          gameUrl,
          title: game.title,
          steamAppId: game.steam_app_id || null,
          protonPrefix: game.proton_prefix || null
        })
        sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'restore', level: 'info', message: 'Verificando saves na nuvem...' })
        const restoreRes = await cloudSaves.restoreCloudSavesBeforeLaunch({
          gameUrl,
          title: game.title,
          steamAppId: game.steam_app_id || null,
          protonPrefix: game.proton_prefix || null
        })
        if (!restoreRes?.success || (restoreRes as any)?.skipped) {
          console.warn('[CloudSaves] restore reported non-success:', restoreRes)
          const msg = String(restoreRes?.message || 'Sem restore (usando saves locais).')
          recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'restore', level: 'info', message: msg })
          sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'restore', level: 'info', message: msg })
          const syncRes = await drive.syncSavesOnPlayStart({
            protonPrefix: game.proton_prefix,
            installPath: installDir,
            realAppId: game.steam_app_id || undefined
          })
          if (syncRes && !(syncRes as any).success) {
            console.warn('[DriveSync] sync reported non-success:', syncRes)
          }
        } else {
          const msg = String(restoreRes?.message || 'Saves restaurados da nuvem.')
          recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'restore', level: 'success', message: msg })
          sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'restore', level: 'success', message: msg })
        }
      } catch (e: any) {
        console.warn('[DriveSync] Failed to sync saves before launch:', e?.message || e)
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
          let storedExists = !!(storedPrefix && fs.existsSync(storedPrefix))
          if (storedPrefix && !storedExists) {
            console.warn('[Launch] ⚠️ Configured prefix path does not exist:', storedPrefix)
          }

          // Prefer using a configured prefix if it exists (even if it's managed), and ensure
          // prefix defaults on that path so runtime mismatch or missing deps are handled.
          let prefixPath: string
          // If the stored prefix points to the default-managed prefix, treat it as not a per-game prefix.
          let defaultPrefixPath: string | null = null
          try {
            // compute expected default prefix path without creating it
            defaultPrefixPath = getExpectedDefaultPrefixPath(game.proton_runtime || undefined)
          } catch (e) {
            // ignore
          }
          if (storedExists && defaultPrefixPath && path.resolve(storedPrefix) === path.resolve(defaultPrefixPath)) {
            console.warn('[Launch] ⚠️ Game configured prefix points to default prefix; creating per-game prefix instead')
            // force creation of game-specific prefix below
            storedExists = false
          }
          if (storedExists) {
            prefixPath = storedPrefix
            try {
              // Ensure prefix defaults (this is a no-op if already applied)
              await ensurePrefixDefaults(prefixPath, game.proton_runtime || undefined, undefined, (msg) => {
                sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
              })
            } catch (err: any) {
              console.warn('[Launch] ensurePrefixDefaults failed for stored prefix:', err)
            }
          } else {
            // Create/ensure a per-game managed prefix from the default
            prefixPath = await ensureGamePrefixFromDefault(slug, game.proton_runtime || undefined, undefined, false)
            if (game.proton_prefix !== prefixPath) {
              updateGameInfo(gameUrl, { proton_prefix: prefixPath })
            }
          }
          console.log('[Launch] 📂 Prefix path:', prefixPath)
          console.log('[Launch] 📂 Prefix exists:', fs.existsSync(prefixPath))
          // Diagnostics: check basic prefix layout and ensure prefix defaults if something looks wrong
          try {
            const { compatDataPath, winePrefix } = (await Promise.resolve(require('./protonManager.js'))).resolveCompatDataPaths(prefixPath, true)
            console.log('[Launch] 🔍 Prefix compatDataPath:', compatDataPath)
            console.log('[Launch] 🔍 Prefix winePrefix:', winePrefix)
            const steamExe = path.join(winePrefix, 'drive_c', 'windows', 'system32', 'steam.exe')
            const wineboot = path.join(winePrefix, 'drive_c', 'windows', 'system32', 'wineboot.exe')
            console.log('[Launch] 🔍 steam.exe exists:', fs.existsSync(steamExe))
            console.log('[Launch] 🔍 wineboot exists:', fs.existsSync(wineboot))
            // Try ensuring prefix defaults again if wineboot missing
            if (!fs.existsSync(wineboot)) {
              console.log('[Launch] ⚙️ wineboot missing in prefix, running ensurePrefixDefaults to initialize...')
              try {
                const ok = await ensurePrefixDefaults(prefixPath, game.proton_runtime || undefined, undefined, (msg) => {
                  sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
                })
                console.log('[Launch] ⚙️ ensurePrefixDefaults result:', ok)
              } catch (e) {
                console.warn('[Launch] ensurePrefixDefaults failed in diagnostic step:', e)
              }
            }
          } catch (diagErr) {
            // ignore diagnostic failures
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
          // Note: `ensurePrefixDefaults` is called earlier for stored prefixes or during prefix creation,
          // so no additional call is required here.

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
	      
			      child.on('exit', async (code: number, signal: string) => {
			        console.log('[Launch] 🏁 Process exited with code:', code, 'signal:', signal)
            try { runningGames.delete(gameUrl) } catch {}
              try { achievementsManager.stopWatching(gameUrl) } catch {}
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

              // After game exits (Proton/Linux), attempt to backup saves to Drive via Ludusavi (fallback to legacy OnlineFix)
            try {
                console.log('[CloudSaves] Backing up saves after Proton game exit...')
                const gameKey = cloudSaves.computeCloudSavesGameKey({
                  gameUrl,
                  title: game.title,
                  steamAppId: game.steam_app_id || null,
                  protonPrefix: prefixPath || game.proton_prefix || null
                })
                sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'info', message: 'Salvando na nuvem...' })
                const backupRes = await cloudSaves.backupCloudSavesAfterExit({
                  gameUrl,
                  title: game.title,
                  steamAppId: game.steam_app_id || null,
                  protonPrefix: prefixPath || game.proton_prefix || null
                })
                if (!backupRes?.success || (backupRes as any)?.skipped) {
                  console.warn('[CloudSaves] backup reported non-success:', backupRes)
                  const msg = String(backupRes?.message || 'Falha ao salvar com Ludusavi; usando método legado.')
                  recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'backup', level: 'warning', message: msg })
                  sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'warning', message: msg })
                  await drive.backupLocalSavesToDrive({
                    protonPrefix: prefixPath || game.proton_prefix,
                    installPath: installDir,
                    realAppId: game.steam_app_id || undefined
                  })
                  sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'success', message: 'Backup na nuvem atualizado (método legado).' })
                }
                if (backupRes?.success && !(backupRes as any)?.skipped) {
                  const isConflict = /conflito/i.test(String(backupRes?.message || ''))
                  const msg = String(backupRes?.message || 'Backup na nuvem atualizado.')
                  recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'backup', level: isConflict ? 'warning' : 'success', message: msg })
                  sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: isConflict ? 'warning' : 'success', message: msg, conflict: isConflict })
                }
                console.log('[CloudSaves] Backup finished (Proton/Linux).')
            } catch (e: any) {
                console.warn('[CloudSaves] Failed to backup saves after Proton exit:', e?.message || e)
            }
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
	      
          child.on('exit', async (code: number, signal: string) => {
            console.log('[Launch] 🏁 Process exited with code:', code, 'signal:', signal)
            try { runningGames.delete(gameUrl) } catch {}
            try { achievementsManager.stopWatching(gameUrl) } catch {}
            sendGameLaunchStatus({ gameUrl, status: 'exited', code, signal, stderrTail })
            // After game exits, attempt to backup local saves to Drive
            try {
              sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'Fazendo backup de saves...' })
              await drive.backupLocalSavesToDrive({ protonPrefix: game.proton_prefix, installPath: installDir, realAppId: game.steam_app_id || undefined })
            } catch (e: any) {
              console.warn('[DriveBackup] Failed to backup saves after exit:', e?.message || e)
            }
          })
		    }
		    
        if (child?.pid) {
          runningGames.set(gameUrl, { pid: child.pid, child, protonLogPath, startedAt: Date.now() })
              // Atualiza "jogado recentemente" / tempo de jogo para a ordenação do launcher
              try {
                const startedAt = runningGames.get(gameUrl)?.startedAt
                const elapsedMs = startedAt ? (Date.now() - startedAt) : 0
                const minutes = Math.max(0, Math.round(elapsedMs / 60000))
                updateGamePlayTime(gameUrl, minutes)
              } catch {}
            // Atualiza "jogado recentemente" / tempo de jogo para a ordenação do launcher
            try {
              const startedAt = runningGames.get(gameUrl)?.startedAt
              const elapsedMs = startedAt ? (Date.now() - startedAt) : 0
              const minutes = Math.max(0, Math.round(elapsedMs / 60000))
              updateGamePlayTime(gameUrl, minutes)
            } catch {}

          try {
            const detectedSteamAppId = detectSteamAppIdFromInstall(installDir)
            achievementsManager.startWatching(
              {
                gameUrl,
                title: game.title || undefined,
                installPath: installDir,
                executablePath: exePath,
                steamAppId: game.steam_app_id || null,
                schemaSteamAppId: detectedSteamAppId || game.steam_app_id || null,
                protonPrefix: game.proton_prefix || null
              },
              (ev: any) => {
                try {
                  mainWindow?.webContents.send('achievement-unlocked', ev)
                } catch {}
                try {
                  void achievementOverlay.show({ title: ev.title, description: ev.description, unlockedAt: ev.unlockedAt })
                } catch {}
              }
            )
          } catch (err) {
            console.warn('[Achievements] Failed to start watcher:', err)
          }
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
          try { achievementsManager.stopWatching(gameUrl) } catch {}
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
          try { achievementsManager.stopWatching(gameUrl) } catch {}
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

  ipcMain.handle('proton-list-runtimes', async (_event, force?: boolean) => {
    try {
      const runtimes = await getCachedProtonRuntimes(Boolean(force))
      return { success: true, runtimes }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('proton-set-root', async (_event, rootPath: string) => {
    try {
      setCustomProtonRoot(rootPath)
      const runtimes = await getCachedProtonRuntimes(true)
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
      const candidatePath = providedPath || record?.install_path || record?.dest_path
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
        sendDownloadProgress({
          magnet: idKey,
          url: idKey,
          progress: 0,
          stage: 'extract',
          extractProgress: 0,
          destPath: target
        })

        const result = await processUpdateExtraction(target, gameUrl, (percent) => {
          sendDownloadProgress({
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
      sendDownloadProgress({
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
            sendDownloadProgress({
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

function resolveGamesRootDir(): string {
  const basePath = getSetting('launcher_path') || process.cwd()
  const gamesPath = path.join(basePath, 'games')
  try { fs.mkdirSync(gamesPath, { recursive: true }) } catch {}
  return gamesPath
}

async function scanInstalledGamesFromDisk(): Promise<{ scanned: number; added: number; skipped: number }> {
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

    if (existingByInstall.has(installPath)) {
      skipped += 1
      continue
    }

    // Best-effort normalize for nested-folder releases.
    try { normalizeGameInstallDir(installPath) } catch {}

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

async function getDirectorySizeBytes(rootDir: string, opts?: { maxEntries?: number; maxMs?: number }): Promise<number> {
  const maxEntries = Math.max(10_000, Number(opts?.maxEntries || 120_000))
  const maxMs = Math.max(250, Number(opts?.maxMs || 2500))
  const startedAt = Date.now()

  let total = 0
  let entriesSeen = 0
  const queue: string[] = [rootDir]

  while (queue.length) {
    if (Date.now() - startedAt > maxMs) break
    if (entriesSeen > maxEntries) break

    const dir = queue.pop() as string
    let items: fs.Dirent[] = []
    try {
      items = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const ent of items) {
      entriesSeen += 1
      if (Date.now() - startedAt > maxMs) break
      if (entriesSeen > maxEntries) break

      const full = path.join(dir, ent.name)
      try {
        if (ent.isDirectory()) {
          queue.push(full)
        } else if (ent.isFile()) {
          const st = await fs.promises.stat(full)
          total += Number(st.size || 0)
        }
      } catch {
        // ignore
      }
    }
  }

  return total
}

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

  const basePath = getSetting('launcher_path') || process.cwd()
  const gamesPath = path.join(basePath, 'games')
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

        const res = await processUpdateExtraction(installPath, gameUrl, (percent) => {
          const p = Number(percent) || 0
          try { updateDownloadProgress(downloadId, p) } catch {}
          sendDownloadProgress({
            magnet: idKey,
            url: idKey,
            progress: p,
            stage: 'extract',
            extractProgress: p,
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
          const version = parseVersionFromName(String(d?.download_url || '')) || parseVersionFromName(String(d?.title || '')) || 'unknown'
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
        const version = parseVersionFromName(String(archivePath)) || parseVersionFromName(String(d?.title || '')) || 'unknown'
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
