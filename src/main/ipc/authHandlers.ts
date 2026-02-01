/**
 * IPC Handlers for Authentication and Cookies
 */
import { ipcMain, session } from 'electron'
import { fetchUserProfile, fetchGameUpdateInfo } from '../scraper'
import { updateGameInfo } from '../db'
import type { IpcContext, IpcHandlerRegistrar } from './types'

const TORRENT_PARTITION = 'persist:online-fix'

export const registerAuthHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  // Note: open-auth-window handler needs to be registered in main.ts
  // because it requires access to createAuthWindow function

  ipcMain.handle('get-user-profile', async () => {
    const profile = await fetchUserProfile()
    if (profile.name || profile.avatar) return { success: true, ...profile }
    return { success: false, error: 'Perfil não encontrado', ...profile }
  })

  ipcMain.handle('get-cookie-header', async (_event, url: string) => {
    const cookieHeader = await import('../cookieManager').then(m => m.getCookieHeaderForUrl(url))
    return cookieHeader
  })

  ipcMain.handle('export-cookies', async (_event, url?: string) => {
    const cookies = await import('../cookieManager').then(m => m.exportCookies(url))
    return cookies
  })

  ipcMain.handle('clear-cookies', async () => {
    try {
      const cm = await import('../cookieManager')
      await cm.clearCookiesAndFile()

      // Reset webview storage as well (best effort)
      try {
        await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] as any })
      } catch {}
      try {
        const ses = session.fromPartition(TORRENT_PARTITION)
        await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] as any })
      } catch {}

      ctx.getMainWindow()?.webContents.send('cookies-cleared')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao limpar cookies' }
    }
  })

  ipcMain.handle('check-game-version', async (_event, url: string) => {
    try {
      const info = await fetchGameUpdateInfo(url)
      if (!info.version) throw new Error('Versao nao encontrada na pagina')
      return { success: true, version: info.version, torrentUrl: info.torrentUrl }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fetch-game-update-info', async (_event, url: string) => {
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
}
