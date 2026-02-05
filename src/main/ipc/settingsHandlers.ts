/**
 * IPC Handlers for Settings
 */
import { ipcMain, app } from 'electron'
import os from 'os'
import path from 'path'
import { getSetting, setSetting } from '../db'
import * as drive from '../drive'
import { setSavedProtonRuntime, setCustomProtonRoot, setCustomProtonRoots } from '../protonManager'
import type { IpcContext, IpcHandlerRegistrar } from './types'
import { 
  notifyAchievementUnlocked, 
  notifyDownloadComplete, 
  notifyDownloadError,
  notifyInfo 
} from '../desktopNotifications'

const DEFAULT_LAN_CONTROLLER_URL = 'https://vpn.mroz.dev.br'

function resolveDefaultGamesPath(): string {
  try {
    const saved = getSetting('games_path')
    if (saved && typeof saved === 'string' && saved.trim()) return saved.trim()
  } catch {}

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

export const registerSettingsHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('get-settings', async () => {
    try {
      const downloadPath = getSetting('download_path') || app.getPath('downloads')
      const downloadPathDefault = app.getPath('downloads')
      const gamesPath = resolveDefaultGamesPath()
      const gamesPathDefault = resolveDefaultGamesPath()
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
      if (settings.downloadPath) setSetting('download_path', settings.downloadPath)
      if (typeof settings.gamesPath === 'string') setSetting('games_path', settings.gamesPath.trim())
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
      if (typeof settings.cloudSavesEnabled === 'boolean') {
        setSetting('cloud_saves_enabled', settings.cloudSavesEnabled ? 'true' : 'false')
        drive.setCloudSavesEnabled(settings.cloudSavesEnabled)
      }
      if (typeof settings.notificationsEnabled === 'boolean') {
        setSetting('notifications_enabled', settings.notificationsEnabled ? 'true' : 'false')
      }
      if (typeof settings.notificationPosition === 'string') {
        setSetting('notification_position', settings.notificationPosition.trim())
      }
      if (typeof settings.minimizeToTray === 'boolean') {
        setSetting('minimize_to_tray', settings.minimizeToTray ? 'true' : 'false')
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
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
