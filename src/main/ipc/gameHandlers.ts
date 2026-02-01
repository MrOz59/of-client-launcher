/**
 * IPC Handlers for Game Management
 */
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  getAllGames,
  getGame,
  deleteGame,
  updateGameInfo,
  setGameFavorite,
  toggleGameFavorite,
  extractGameIdFromUrl
} from '../db'
import { fetchGameUpdateInfo } from '../scraper'
import type { IpcContext, IpcHandlerRegistrar } from './types'

// Helper to slugify strings
function slugify(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'game'
}

export const registerGameHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('get-games', async () => {
    try {
      const games = getAllGames()
      return { success: true, games }
    } catch (err: any) {
      return { success: false, error: err.message, games: [] }
    }
  })

  ipcMain.handle('delete-game', async (_event, url: string) => {
    try {
      const game = getGame(url) as { install_path?: string } | undefined

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

        // Basic safety guard: never delete filesystem root
        if (installPath && path.parse(installPath).root === installPath) {
          console.warn('[DeleteGame] Refusing to delete root path:', installPath)
        } else if (fs.existsSync(installPath)) {
          console.log('[DeleteGame] Removing game folder:', installPath)
          try {
            fs.rmSync(installPath, { recursive: true, force: true })
            console.log('[DeleteGame] Game folder removed successfully')
          } catch (folderErr: any) {
            console.warn('[DeleteGame] Failed to remove game folder:', folderErr.message)
          }
        }
      }

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
      ctx.fetchAndPersistBanner(gameUrl, title).catch(() => {})
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
            ctx.getMainWindow()?.webContents.send('game-version-update', { url: g.url, latest: info.version })
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
      const parent = BrowserWindow.getFocusedWindow() || ctx.getMainWindow() || undefined
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

  ipcMain.handle('select-directory', async () => {
    try {
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
}
