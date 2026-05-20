/**
 * IPC Handlers for Settings
 */
import { ipcMain, app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getSetting, setSetting } from '../db'
import * as drive from '../drive'
import {
  findProtonRuntime,
  listProtonRuntimes,
  protontricksAvailable,
  setSavedProtonRuntime,
  setCustomProtonRoot,
  setCustomProtonRoots,
  winetricksAvailable
} from '../protonManager'
import type { IpcContext, IpcHandlerRegistrar } from './types'
import { 
  notifyAchievementUnlocked, 
  notifyDownloadComplete, 
  notifyDownloadError,
  notifyInfo,
  setNotificationsEnabled
} from '../desktopNotifications'
import { findEosOverlayInstallPath, getDisplayCompatibilityInfo, isEosOverlayPathValid } from '../utils'
import { resolveLegendaryBinary } from '../legendary'
import { resolveLudusaviBinary } from '../ludusavi'

const DEFAULT_LAN_CONTROLLER_URL = 'https://vpn.mroz.dev.br'
const LANGUAGE_PACK_MAX_BYTES = 1024 * 1024
const LANGUAGE_PACK_FILE_RE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*\.json$/

type LanguagePack = {
  code: string
  label?: string
  nativeLabel?: string
  source: string
  translations: Record<string, string>
}

function resolveXdgDataHome(): string | null {
  const env = String(process.env.XDG_DATA_HOME || '').trim()
  if (env) return env
  const home = os.homedir()
  return home ? path.join(home, '.local', 'share') : null
}

function defaultGamesPath(): string {
  if (process.platform === 'linux') {
    const home = os.homedir()
    if (home) return path.join(home, 'Games', 'VoidLauncher')
    return path.join('/tmp', 'VoidLauncher', 'Games')
  }

  try {
    return path.join(app.getPath('documents'), 'VoidLauncher', 'Games')
  } catch {}

  return path.join(process.cwd(), 'Games')
}

function resolveGamesPath(): string {
  try {
    const saved = getSetting('games_path')
    if (saved && typeof saved === 'string' && saved.trim()) return saved.trim()
  } catch {}

  return defaultGamesPath()
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeOptionalHttpUrl(value: any, fallback = ''): string {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('URL deve começar com http:// ou https://')
    }
    return url.toString().replace(/\/$/, '')
  } catch (err: any) {
    throw new Error(err?.message || `URL invalida: ${raw}`)
  }
}

function normalizeLanguageCode(fileName: string): string | null {
  const base = path.basename(fileName)
  if (!LANGUAGE_PACK_FILE_RE.test(base)) return null
  return base.replace(/\.json$/i, '').replace(/_/g, '-')
}

function getLanguagePackDirs(): Array<{ dir: string; source: string }> {
  const dirs: Array<{ dir: string; source: string }> = []

  const add = (dir: string, source: string) => {
    if (!dir) return
    if (dirs.some(item => item.dir === dir)) return
    dirs.push({ dir, source })
  }

  add(path.join(process.cwd(), 'src', 'renderer', 'i18n', 'translations'), 'source')

  if (process.resourcesPath) {
    add(path.join(process.resourcesPath, 'i18n', 'translations'), 'resources')
  }

  const userDataDir = app.getPath('userData')
  add(path.join(userDataDir, 'i18n', 'translations'), 'user-data')
  add(path.join(userDataDir, 'languages'), 'user-data')

  const xdgDataHome = resolveXdgDataHome()
  if (xdgDataHome) {
    add(path.join(xdgDataHome, 'VoidLauncher', 'i18n', 'translations'), 'xdg-data')
    add(path.join(xdgDataHome, 'VoidLauncher', 'languages'), 'xdg-data')
    add(path.join(xdgDataHome, 'voidlauncher', 'i18n', 'translations'), 'xdg-data')
    add(path.join(xdgDataHome, 'voidlauncher', 'languages'), 'xdg-data')
    add(path.join(xdgDataHome, 'of-launcher', 'i18n', 'translations'), 'legacy')
  }

  return dirs
}

function readLanguagePacksFromDir(dir: string, source: string): LanguagePack[] {
  try {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const packs: LanguagePack[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const code = normalizeLanguageCode(entry.name)
      if (!code) continue

      const filePath = path.join(dir, entry.name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size <= 0 || stat.size > LANGUAGE_PACK_MAX_BYTES) continue

      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue

        const translations: Record<string, string> = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === 'string' && typeof value === 'string') translations[key] = value
        }

        if (!Object.keys(translations).length) continue
        packs.push({
          code,
          label: translations['language.label'],
          nativeLabel: translations['language.nativeLabel'],
          source,
          translations
        })
      } catch (err: any) {
        console.warn(`[i18n] Ignoring invalid language pack ${filePath}:`, err?.message || err)
      }
    }

    return packs
  } catch (err: any) {
    console.warn(`[i18n] Failed to read language pack directory ${dir}:`, err?.message || err)
    return []
  }
}

function collectLanguagePacks(): { languages: LanguagePack[]; directory: string; directories: string[] } {
  const userDir = path.join(app.getPath('userData'), 'languages')
  try {
    fs.mkdirSync(userDir, { recursive: true })
  } catch (err: any) {
    console.warn('[i18n] Failed to create user language directory:', err?.message || err)
  }

  const byCode = new Map<string, LanguagePack>()
  for (const { dir, source } of getLanguagePackDirs()) {
    for (const pack of readLanguagePacksFromDir(dir, source)) {
      byCode.set(pack.code, pack)
    }
  }

  return {
    languages: Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code)),
    directory: userDir,
    directories: getLanguagePackDirs().map(item => item.dir)
  }
}

function pathDiagnostic(target: string) {
  const p = String(target || '').trim()
  if (!p) return { path: '', exists: false, writable: false, type: 'missing' as const }
  try {
    const st = fs.existsSync(p) ? fs.statSync(p) : null
    let writable = false
    const probe = st ? p : path.dirname(p)
    try {
      fs.accessSync(probe, fs.constants.W_OK)
      writable = true
    } catch {
      writable = false
    }
    return {
      path: p,
      exists: Boolean(st),
      writable,
      type: st ? (st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other') : 'missing'
    }
  } catch {
    return { path: p, exists: false, writable: false, type: 'missing' as const }
  }
}

function commandPath(cmd: string): string | null {
  const paths = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const names = process.platform === 'win32' ? [`${cmd}.exe`, cmd] : [cmd]
  for (const dir of paths) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {}
    }
  }
  return null
}

function findTorrentAgentBinary(): string | null {
  const names = process.platform === 'win32' ? ['torrent-agent.exe', 'torrent-agent'] : ['torrent-agent']
  const roots = [
    app?.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, 'torrent-agent') : '',
    path.join(process.cwd(), 'services', 'torrent-agent', 'torrent-agent'),
    path.join(process.cwd(), 'services', 'torrent-agent', 'dist')
  ].filter(Boolean)
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {}
    }
  }
  return null
}

function steamRootCandidates() {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.steam', 'debian-installation'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    '/usr/share/steam'
  ].filter(p => {
    try { return fs.existsSync(p) } catch { return false }
  })
}

function firstExisting(paths: string[]) {
  return paths.find(p => {
    try { return fs.existsSync(p) } catch { return false }
  }) || null
}

async function collectLauncherDiagnostics(settings: any) {
  const isLinuxPlatform = process.platform === 'linux'
  const steamRoots = isLinuxPlatform ? steamRootCandidates() : []
  const steamOverlay64 = firstExisting(steamRoots.map(root => path.join(root, 'ubuntu12_64', 'gameoverlayrenderer.so')))
  const steamOverlay32 = firstExisting(steamRoots.map(root => path.join(root, 'ubuntu12_32', 'gameoverlayrenderer.so')))
  const steamVulkan64 = firstExisting(steamRoots.flatMap(root => [
    path.join(root, 'ubuntu12_64', 'steamoverlayvulkanlayer.so'),
    path.join(root, 'steamrt64', 'steamoverlayvulkanlayer.so')
  ]))
  const steamVulkan32 = firstExisting(steamRoots.flatMap(root => [
    path.join(root, 'ubuntu12_32', 'steamoverlayvulkanlayer.so'),
    path.join(root, 'steamrt32', 'steamoverlayvulkanlayer.so')
  ]))
  const eosOverlayPath = isLinuxPlatform ? findEosOverlayInstallPath(app.getPath('userData')) : null
  const legendaryPath = isLinuxPlatform ? await resolveLegendaryBinary() : null
  const ludusaviPath = await resolveLudusaviBinary()
  const protonRuntime = isLinuxPlatform ? findProtonRuntime() : null
  const protonRuntimes = isLinuxPlatform ? listProtonRuntimes() : []
  const torrentAgentPath = findTorrentAgentBinary()
  const display = getDisplayCompatibilityInfo()

  const checks = [
    {
      id: 'games-path',
      label: 'Pasta de jogos',
      status: pathDiagnostic(settings.gamesPath).writable ? 'ok' : 'warn',
      detail: `${settings.gamesPath || defaultGamesPath()}`
    },
    {
      id: 'download-path',
      label: 'Pasta de downloads',
      status: pathDiagnostic(settings.downloadPath).writable ? 'ok' : 'warn',
      detail: `${settings.downloadPath || app.getPath('downloads')}`
    },
    {
      id: 'torrent-agent',
      label: 'Torrent agent',
      status: torrentAgentPath ? 'ok' : 'warn',
      detail: torrentAgentPath || 'Binario standalone nao encontrado; fallback Python pode ser usado'
    },
    {
      id: 'ludusavi',
      label: 'Ludusavi',
      status: ludusaviPath ? 'ok' : 'warn',
      detail: ludusaviPath || 'Nao encontrado; necessario para Cloud Saves automatico'
    },
    {
      id: 'proton-runtime',
      label: 'Proton',
      status: !isLinuxPlatform ? 'info' : protonRuntime ? 'ok' : 'warn',
      detail: !isLinuxPlatform ? 'Nao necessario no Windows' : protonRuntime || 'Nenhum runtime Proton detectado'
    },
    {
      id: 'legendary',
      label: 'Legendary',
      status: !isLinuxPlatform ? 'info' : legendaryPath ? 'ok' : 'warn',
      detail: !isLinuxPlatform ? 'Nao necessario no Windows' : legendaryPath || 'Nao encontrado; necessario para instalar/ativar EOS overlay automaticamente'
    },
    {
      id: 'eos-overlay',
      label: 'EOS Overlay',
      status: !isLinuxPlatform ? 'info' : isEosOverlayPathValid(eosOverlayPath) ? 'ok' : 'warn',
      detail: !isLinuxPlatform ? 'Nao necessario no Windows' : eosOverlayPath || 'Nao instalado'
    },
    {
      id: 'steam-overlay',
      label: 'Steam Overlay',
      status: !isLinuxPlatform ? 'info' : steamOverlay64 || steamOverlay32 ? 'ok' : 'warn',
      detail: !isLinuxPlatform ? 'Nao necessario no Windows' : [steamOverlay64 ? '64-bit OK' : '64-bit ausente', steamOverlay32 ? '32-bit OK' : '32-bit ausente'].join(' / ')
    },
    {
      id: 'vulkan-layer',
      label: 'Vulkan layer Steam',
      status: !isLinuxPlatform ? 'info' : steamVulkan64 || steamVulkan32 ? 'ok' : 'warn',
      detail: !isLinuxPlatform ? 'Nao necessario no Windows' : [steamVulkan64 ? '64-bit OK' : '64-bit ausente', steamVulkan32 ? '32-bit OK' : '32-bit ausente'].join(' / ')
    },
    {
      id: 'display',
      label: 'Sessao grafica',
      status: display.isWayland || display.isGamescope ? 'warn' : 'ok',
      detail: display.warnings.length ? display.warnings.join(' ') : (display.sessionType || 'padrao')
    }
  ]

  return {
    generatedAt: Date.now(),
    app: {
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      userData: app.getPath('userData')
    },
    paths: {
      games: pathDiagnostic(settings.gamesPath),
      downloads: pathDiagnostic(settings.downloadPath)
    },
    linux: {
      isLinux: isLinuxPlatform,
      display,
      protonRuntime,
      protonRuntimeCount: protonRuntimes.length,
      steam: {
        command: commandPath('steam'),
        roots: steamRoots,
        overlay64: steamOverlay64,
        overlay32: steamOverlay32,
        vulkan64: steamVulkan64,
        vulkan32: steamVulkan32
      },
      legendaryPath,
      eosOverlayPath,
      eosOverlayValid: isEosOverlayPathValid(eosOverlayPath),
      winetricks: isLinuxPlatform ? winetricksAvailable() : false,
      protontricks: isLinuxPlatform ? protontricksAvailable() : false
    },
    tools: {
      torrentAgentPath,
      ludusaviPath
    },
    checks
  }
}

export const registerSettingsHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('i18n-list-language-packs', async () => {
    try {
      const { languages, directory, directories } = collectLanguagePacks()
      return { success: true, languages, directory, directories }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('get-settings', async () => {
    try {
      const downloadPath = getSetting('download_path') || app.getPath('downloads')
      const downloadPathDefault = app.getPath('downloads')
      const gamesPath = resolveGamesPath()
      const gamesPathDefault = defaultGamesPath()
      const autoExtract = getSetting('auto_extract') !== 'false'
      const autoUpdate = getSetting('auto_update') === 'true'
      const parallelDownloads = clampInt(getSetting('parallel_downloads'), 1, 10, 3)
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
      const lanDefaultNetworkId = String(getSetting('lan_default_network_id') || '').trim()
      const lanControllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const cloudSavesEnabled = getSetting('cloud_saves_enabled') !== 'false'
      const notificationsEnabled = getSetting('notifications_enabled') !== 'false'
      const notificationPosition = String(getSetting('notification_position') || 'bottom-right').trim()
      const minimizeToTray = getSetting('minimize_to_tray') === 'true'

      return {
        success: true,
        platform: process.platform,
        isLinux: isLinuxPlatform,
        settings: {
          downloadPath,
          downloadPathDefault,
          gamesPath,
          gamesPathDefault,
          autoExtract,
          autoUpdate,
          parallelDownloads,
          steamWebApiKey,
          achievementSchemaBaseUrl,
          protonDefaultRuntimePath,
          protonExtraPaths,
          lanDefaultNetworkId,
          lanControllerUrl,
          cloudSavesEnabled,
          notificationsEnabled,
          notificationPosition,
          minimizeToTray
        }
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-settings', async (_event, settings: any) => {
    try {
      if (typeof settings.downloadPath === 'string') setSetting('download_path', settings.downloadPath.trim())
      if (typeof settings.gamesPath === 'string') setSetting('games_path', settings.gamesPath.trim())
      setSetting('auto_extract', settings.autoExtract ? 'true' : 'false')
      setSetting('auto_update', settings.autoUpdate ? 'true' : 'false')
      setSetting('parallel_downloads', String(clampInt(settings.parallelDownloads, 1, 10, 3)))
      if (typeof settings.steamWebApiKey === 'string') setSetting('steam_web_api_key', settings.steamWebApiKey.trim())
      if (typeof settings.achievementSchemaBaseUrl === 'string') {
        setSetting('achievement_schema_base_url', normalizeOptionalHttpUrl(settings.achievementSchemaBaseUrl, ''))
      }
      if (process.platform === 'linux') {
        // Proton is the default behavior on Linux, so disabling it does not make sense.
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
      if (typeof settings.lanControllerUrl === 'string') setSetting('lan_controller_url', normalizeOptionalHttpUrl(settings.lanControllerUrl, DEFAULT_LAN_CONTROLLER_URL))
      if (typeof settings.cloudSavesEnabled === 'boolean') {
        setSetting('cloud_saves_enabled', settings.cloudSavesEnabled ? 'true' : 'false')
        drive.setCloudSavesEnabled(settings.cloudSavesEnabled)
      }
      if (typeof settings.notificationsEnabled === 'boolean') {
        setSetting('notifications_enabled', settings.notificationsEnabled ? 'true' : 'false')
        setNotificationsEnabled(settings.notificationsEnabled)
      }
      if (typeof settings.notificationPosition === 'string') {
        const pos = settings.notificationPosition.trim()
        setSetting('notification_position', ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(pos) ? pos : 'bottom-right')
      }
      if (typeof settings.minimizeToTray === 'boolean') {
        setSetting('minimize_to_tray', settings.minimizeToTray ? 'true' : 'false')
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-launcher-diagnostics', async () => {
    try {
      const currentSettings = {
        gamesPath: resolveGamesPath(),
        downloadPath: getSetting('download_path') || app.getPath('downloads')
      }
      return { success: true, diagnostics: await collectLauncherDiagnostics(currentSettings) }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao gerar diagnostico do launcher' }
    }
  })

  // Test notification handler (dev/debug)
  ipcMain.handle('test-notification', async (_event, type: string) => {
    try {
      console.log('[Notifications] Testing notification type:', type)

      switch (type) {
        case 'achievement':
          notifyAchievementUnlocked(
            'Conquista Desbloqueada!',
            'Você completou o tutorial do VoidLauncher'
          )
          break

        case 'download':
          notifyDownloadComplete('Cyberpunk 2077')
          break

        case 'error':
          notifyDownloadError('Elden Ring', 'Espaço em disco insuficiente')
          break

        case 'info':
          notifyInfo('Sistema de Notificações', 'As notificações estão funcionando corretamente!')
          break

        default:
          notifyInfo('Teste de Notificação', `Tipo: ${type}`)
      }

      return { success: true }
    } catch (error: any) {
      console.error('[Notifications] Test failed:', error)
      return { success: false, error: error?.message || String(error) }
    }
  })
}
