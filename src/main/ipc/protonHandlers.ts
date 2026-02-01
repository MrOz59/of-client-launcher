/**
 * IPC Handlers for Proton (Linux game compatibility layer)
 */
import { ipcMain } from 'electron'
import fs from 'fs'
import { getGame, updateGameInfo, extractGameIdFromUrl } from '../db'
import {
  isLinux,
  findProtonRuntime,
  setSavedProtonRuntime,
  buildProtonLaunch,
  getPrefixPath,
  ensureDefaultPrefix,
  ensureGamePrefixFromDefault,
  setCustomProtonRoot,
  listProtonRuntimes,
  type ProtonRuntime
} from '../protonManager'
import type { IpcContext, IpcHandlerRegistrar } from './types'

// Helper to slugify strings
function slugify(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'game'
}

// Cache for Proton runtimes
let cachedProtonRuntimes: ProtonRuntime[] | null = null
let cachedProtonRuntimesAt = 0
const PROTON_CACHE_TTL_MS = 30_000

async function getCachedProtonRuntimes(force = false): Promise<ProtonRuntime[]> {
  const now = Date.now()
  if (!force && cachedProtonRuntimes && now - cachedProtonRuntimesAt < PROTON_CACHE_TTL_MS) {
    return cachedProtonRuntimes
  }
  const runtimes = await listProtonRuntimes()
  cachedProtonRuntimes = runtimes
  cachedProtonRuntimesAt = now
  return runtimes
}

export const registerProtonHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
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
      if (ctx.inFlightPrefixJobs.has(gameUrl)) return { success: false, error: 'Prefixo já está sendo preparado' }

      const existing = getGame(gameUrl) as any
      const stableId = (existing?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
      const slug = stableId ? `game_${stableId}` : slugify(title || existing?.title || gameUrl || 'game')
      const runtime = ((existing?.proton_runtime as string | null) || findProtonRuntime() || undefined)

      ctx.inFlightPrefixJobs.set(gameUrl, { startedAt: Date.now() })
      ctx.sendPrefixJobStatus({ gameUrl, status: 'starting', message: 'Preparando prefixo...' })
      const prefix = await ensureGamePrefixFromDefault(slug, runtime, undefined, true, (msg) => {
        ctx.sendPrefixJobStatus({ gameUrl, status: 'progress', message: msg })
      })
      updateGameInfo(gameUrl, { proton_prefix: prefix })
      ctx.sendPrefixJobStatus({ gameUrl, status: 'done', message: 'Prefixo pronto', prefix })
      ctx.inFlightPrefixJobs.delete(gameUrl)
      return { success: true, prefix }
    } catch (err: any) {
      try { ctx.inFlightPrefixJobs.delete(gameUrl) } catch {}
      ctx.sendPrefixJobStatus({ gameUrl, status: 'error', message: err?.message || String(err) })
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
}

// Export helper for use in main.ts
export { getCachedProtonRuntimes }
