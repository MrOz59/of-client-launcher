/**
 * IPC Handlers for Game Launch/Stop
 */
import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import {
  getAllGames,
  updateGameInfo,
  updateGamePlayTime,
  extractGameIdFromUrl
} from '../db'
import {
  isLinux,
  findProtonRuntime,
  buildProtonLaunch,
  getPrefixPath,
  getPrefixRootDir,
  ensurePrefixDefaults,
  ensureGamePrefixFromDefault,
  getExpectedDefaultPrefixPath,
  ensureGameCommonRedists
} from '../protonManager'
import * as drive from '../drive'
import * as cloudSaves from '../cloudSaves'
import { appendCloudSavesHistory, type CloudSavesHistoryEntry } from '../cloudSavesHistory'
import { detectSteamAppIdFromInstall } from './achievementsHandlers'
import type { IpcContext, IpcHandlerRegistrar, RunningGameProc } from './types'
import {
  slugify,
  isPidAlive,
  killProcessTreeBestEffort,
  readFileTailBytes,
  trimToMaxChars,
  extractInterestingProtonLog,
  findExecutableInDir
} from '../utils'

// ============================================================================
// Local Helpers
// ============================================================================

function recordCloudSaves(entry: CloudSavesHistoryEntry) {
  try {
    appendCloudSavesHistory(entry)
  } catch {
    // ignore
  }
}

// ============================================================================
// Handler Registration
// ============================================================================

export const registerLaunchHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  const {
    getMainWindow,
    runningGames,
    inFlightPrefixJobs,
    achievementsManager,
    achievementOverlay,
    sendGameLaunchStatus,
    sendCloudSavesStatus
  } = ctx

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

      const allGames = getAllGames()
      console.log('[Launch] All games in DB:', allGames.map((g: any) => ({ url: g.url, title: g.title, install_path: g.install_path })))

      const game = allGames.find((g: any) => g.url === gameUrl) as any
      if (!game) {
        console.error('[Launch] ❌ Game not found in database. Looking for URL:', gameUrl)
        console.error('[Launch] Available game URLs:', allGames.map((g: any) => g.url))
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

      // Before launching, sync saves between local and Drive
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
          if (drive.isCloudSavesEnabled()) {
            const syncRes = await drive.syncSavesOnPlayStart({
              protonPrefix: game.proton_prefix,
              installPath: installDir,
              realAppId: game.steam_app_id || undefined
            })
            if (syncRes && !(syncRes as any).success) {
              console.warn('[DriveSync] sync reported non-success:', syncRes)
            }
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
        // Linux + Windows exe = use Proton
        console.log('[Launch] 🐧 Linux detected, using Proton...')

        const stableId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
        const slug = stableId ? `game_${stableId}` : slugify(game.title || gameUrl)
        console.log('[Launch] 🏷️ Game slug:', slug)

        const protonOpts = game.proton_options ? JSON.parse(game.proton_options) : {}
        console.log('[Launch] ⚙️ Proton options:', protonOpts)

        const managedRoot = getPrefixRootDir()
        const storedPrefix = typeof game.proton_prefix === 'string' ? String(game.proton_prefix) : ''
        let storedExists = !!(storedPrefix && fs.existsSync(storedPrefix))

        let prefixPath: string
        let defaultPrefixPath: string | null = null
        try {
          defaultPrefixPath = getExpectedDefaultPrefixPath(game.proton_runtime || undefined)
        } catch {}

        if (storedExists && defaultPrefixPath && path.resolve(storedPrefix) === path.resolve(defaultPrefixPath)) {
          console.warn('[Launch] ⚠️ Game configured prefix points to default prefix; creating per-game prefix instead')
          storedExists = false
        }

        if (storedExists) {
          prefixPath = storedPrefix
          try {
            await ensurePrefixDefaults(prefixPath, game.proton_runtime || undefined, undefined, (msg) => {
              sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
            })
          } catch (err: any) {
            console.warn('[Launch] ensurePrefixDefaults failed for stored prefix:', err)
          }
        } else {
          prefixPath = await ensureGamePrefixFromDefault(slug, game.proton_runtime || undefined, undefined, false)
          if (game.proton_prefix !== prefixPath) {
            updateGameInfo(gameUrl, { proton_prefix: prefixPath })
          }
        }

        console.log('[Launch] 📂 Prefix path:', prefixPath)
        console.log('[Launch] 📂 Prefix exists:', fs.existsSync(prefixPath))

        const stableNumericId = (game?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
        const derivedAppId = stableNumericId && /^\d+$/.test(stableNumericId) ? stableNumericId : '480'
        const steamAppId = (game?.steam_app_id as string | null) || detectSteamAppIdFromInstall(installDir) || derivedAppId

        // Run known redistributables
        try {
          sendGameLaunchStatus({ gameUrl, status: 'starting', message: 'Verificando dependências...' })
          const redistRes = await ensureGameCommonRedists(installDir, prefixPath, game.proton_runtime || undefined, (msg) => {
            sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
          })
          if (redistRes.ran) {
            sendGameLaunchStatus({ gameUrl, status: 'starting', message: redistRes.ok ? 'Dependências instaladas' : 'Dependências: alguns installers falharam' })
          }
        } catch (err: any) {
          console.warn('[Launch] Failed to run common redists:', err)
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

        child = spawn(launch.cmd, launch.args, {
          env: { ...process.env, ...launch.env },
          cwd: installDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        try {
          const logDir = String((launch.env as any)?.PROTON_LOG_DIR || '')
          const appId = String((launch.env as any)?.SteamAppId || (launch.env as any)?.STEAM_COMPAT_APP_ID || '')
          if (logDir && appId) protonLogPath = path.join(logDir, `steam-${appId}.log`)
        } catch {}

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
            }
          }
          sendGameLaunchStatus({ gameUrl, status: 'exited', code, signal, stderrTail: mergedTail, protonLogPath })

          // Backup saves after exit
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
              if (drive.isCloudSavesEnabled()) {
                await drive.backupLocalSavesToDrive({
                  protonPrefix: prefixPath || game.proton_prefix,
                  installPath: installDir,
                  realAppId: game.steam_app_id || undefined
                })
                sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'success', message: 'Backup na nuvem atualizado (método legado).' })
              }
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
        // Native exe (Windows or non-.exe on Linux)
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

          // Backup saves after exit
          try {
            const gameKey = cloudSaves.computeCloudSavesGameKey({
              gameUrl,
              title: game.title,
              steamAppId: game.steam_app_id || null,
              protonPrefix: game.proton_prefix || null
            })
            sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'info', message: 'Salvando na nuvem...' })
            const backupRes = await cloudSaves.backupCloudSavesAfterExit({
              gameUrl,
              title: game.title,
              steamAppId: game.steam_app_id || null,
              protonPrefix: game.proton_prefix || null
            })
            if (!backupRes?.success || (backupRes as any)?.skipped) {
              console.warn('[CloudSaves] backup reported non-success:', backupRes)
              const msg = String(backupRes?.message || 'Falha ao salvar com Ludusavi; usando método legado.')
              recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'backup', level: 'warning', message: msg })
              sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'warning', message: msg })
              if (drive.isCloudSavesEnabled()) {
                await drive.backupLocalSavesToDrive({
                  protonPrefix: game.proton_prefix,
                  installPath: installDir,
                  realAppId: game.steam_app_id || undefined
                })
                sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: 'success', message: 'Backup na nuvem atualizado (método legado).' })
              }
            }
            if (backupRes?.success && !(backupRes as any)?.skipped) {
              const isConflict = /conflito/i.test(String(backupRes?.message || ''))
              const msg = String(backupRes?.message || 'Backup na nuvem atualizado.')
              recordCloudSaves({ at: Date.now(), gameKey, gameUrl, stage: 'backup', level: isConflict ? 'warning' : 'success', message: msg })
              sendCloudSavesStatus({ at: Date.now(), gameUrl, gameKey, stage: 'backup', level: isConflict ? 'warning' : 'success', message: msg, conflict: isConflict })
            }
          } catch (e: any) {
            console.warn('[CloudSaves] Failed to backup saves after exit:', e?.message || e)
          }
        })
      }

      if (child?.pid) {
        runningGames.set(gameUrl, { pid: child.pid, child, protonLogPath, startedAt: Date.now() })

        // Update play time
        try {
          const startedAt = runningGames.get(gameUrl)?.startedAt
          const elapsedMs = startedAt ? (Date.now() - startedAt) : 0
          const minutes = Math.max(0, Math.round(elapsedMs / 60000))
          updateGamePlayTime(gameUrl, minutes)
        } catch {}

        // Start achievement watcher
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
                getMainWindow()?.webContents.send('achievement-unlocked', ev)
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

      // First try a graceful stop
      killProcessTreeBestEffort(pid, 'SIGTERM')

      const waitMs = async (ms: number) => await new Promise<void>(r => setTimeout(r, ms))
      await waitMs(2500)

      if (force === true && isPidAlive(pid)) {
        killProcessTreeBestEffort(pid, 'SIGKILL')
        await waitMs(800)
      } else if (isPidAlive(pid)) {
        killProcessTreeBestEffort(pid, 'SIGKILL')
        await waitMs(800)
      }

      if (!isPidAlive(pid)) {
        try { runningGames.delete(gameUrl) } catch {}
        try { achievementsManager.stopWatching(gameUrl) } catch {}
        return { success: true }
      }

      return { success: false, error: `Falha ao encerrar processo (PID ${pid})` }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('is-game-running', async (_event, gameUrl: string) => {
    try {
      const entry = runningGames.get(gameUrl)
      const pid = entry?.pid
      if (!pid) return { running: false }
      return { running: isPidAlive(pid), pid, startedAt: entry?.startedAt }
    } catch {
      return { running: false }
    }
  })
}
