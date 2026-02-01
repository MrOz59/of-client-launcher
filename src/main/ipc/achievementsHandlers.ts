/**
 * IPC Handlers for Achievements
 */
import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { getAllGames, getSetting, setSetting, updateGameInfo } from '../db'
import type { IpcContext, IpcHandlerRegistrar } from './types'

// Helper to detect Steam AppID from install directory
function detectSteamAppIdFromInstall(installDir: string): string | null {
  // Look for OnlineFix.ini first
  const patterns = [
    'OnlineFix.ini',
    'OnlineFix64.ini',
    'steam_api.ini',
    'steam_api64.ini'
  ]

  for (const pattern of patterns) {
    try {
      const files = findFilesRecursive(installDir, pattern, 3)
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8')
        // Look for AppId= or SteamAppId=
        const match = content.match(/(?:AppId|SteamAppId)\s*=\s*(\d+)/i)
        if (match && match[1]) {
          return match[1]
        }
      }
    } catch {
      // ignore
    }
  }

  // Also check steam_appid.txt
  try {
    const appIdFile = path.join(installDir, 'steam_appid.txt')
    if (fs.existsSync(appIdFile)) {
      const content = fs.readFileSync(appIdFile, 'utf8').trim()
      if (/^\d+$/.test(content)) {
        return content
      }
    }
  } catch {
    // ignore
  }

  return null
}

// Helper to find files recursively with depth limit
function findFilesRecursive(dir: string, filename: string, maxDepth: number, currentDepth = 0): string[] {
  const results: string[] = []
  if (currentDepth > maxDepth) return results

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        results.push(fullPath)
      } else if (entry.isDirectory() && currentDepth < maxDepth) {
        results.push(...findFilesRecursive(fullPath, filename, maxDepth, currentDepth + 1))
      }
    }
  } catch {
    // ignore
  }

  return results
}

export const registerAchievementsHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('achievements-set-steam-web-api-key', async (_event, apiKey: string) => {
    try {
      const key = String(apiKey || '').trim()
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

      const sources = ctx.achievementsManager.getSources(meta)
      const achievements = await ctx.achievementsManager.getAchievements(meta)
      return { success: true, sources, achievements }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-import-schema', async (_event, gameUrl: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }

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

      const { setCustomAchievementSchemaForGame } = require('../achievements/schema.js') as typeof import('../achievements/schema')
      const out = setCustomAchievementSchemaForGame(url, json)
      if (!out.success) return { success: false, error: out.error || 'Falha ao salvar schema' }
      return { success: true, count: out.count }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('achievements-save-schema', async (_event, gameUrl: string, rawJson: string) => {
    try {
      const url = String(gameUrl || '').trim()
      if (!url) return { success: false, error: 'gameUrl ausente' }
      const raw = typeof rawJson === 'string' ? rawJson : JSON.stringify(rawJson)
      if (!raw || !raw.trim()) return { success: false, error: 'JSON vazio' }
      let json: any
      try {
        json = JSON.parse(raw)
      } catch (e: any) {
        return { success: false, error: e?.message || 'JSON inválido' }
      }

      const { setCustomAchievementSchemaForGame } = require('../achievements/schema.js') as typeof import('../achievements/schema')
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
      const { clearCustomAchievementSchemaForGame } = require('../achievements/schema.js') as typeof import('../achievements/schema')
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

      const { clearCachedSchema } = require('../achievements/schema.js') as typeof import('../achievements/schema')
      clearCachedSchema(steamAppId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

// Export helper for use elsewhere
export { detectSteamAppIdFromInstall }
