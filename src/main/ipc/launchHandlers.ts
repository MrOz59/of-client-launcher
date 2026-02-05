/**
 * IPC Handlers for Game Launch/Stop
 */
import { app, dialog, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
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
import { getOverlayIPC, removeOverlayIPC } from '../overlayIPC'
import { createOverlayServer, removeOverlayServer, getOverlayServer } from '../overlayIPCServer'
import { notifyAchievementUnlocked, setCurrentGamePid, NOTIFICATIONS_ENABLED } from '../desktopNotifications'
import {
  slugify,
  isPidAlive,
  killProcessTreeBestEffort,
  readFileTailBytes,
  trimToMaxChars,
  extractInterestingProtonLog,
  findExecutableInDir,
  waitMs
} from '../utils'
import { extractOnlineFixOverlayIds, findAndReadOnlineFixIni } from '../utils/onlinefixIni'
import { ensureLegendaryAvailable } from '../legendary'

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

function resolveWinePrefixPath(prefixPath: string): string {
  if (!prefixPath) return prefixPath
  const pfx = path.join(prefixPath, 'pfx')
  if (fs.existsSync(path.join(pfx, 'drive_c'))) return pfx
  if (fs.existsSync(path.join(prefixPath, 'drive_c'))) return prefixPath
  return prefixPath
}

function findEosOverlayInstallPath(): string | null {
  const home = os.homedir()
  let userTools: string | null = null
  try {
    userTools = path.join(app.getPath('userData'), 'tools', 'eos_overlay')
  } catch {
    // ignore
  }
  const candidates = [
    ...(userTools ? [userTools] : []),
    path.join(home, '.config', 'heroic', 'tools', 'eos_overlay'),
    path.join(home, '.config', 'legendary', 'overlay'),
    path.join(home, '.config', 'legendary', 'eos_overlay'),
    path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'tools', 'eos_overlay')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function readProcText(pid: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join('/proc', pid, file), 'utf8')
  } catch {
    return null
  }
}

function readProcCmdlineArgs(pid: string): string[] {
  const raw = readProcText(pid, 'cmdline')
  if (!raw) return []
  return raw.split('\0').filter(Boolean)
}

const IGNORED_WINE_EXE_NAMES = new Set([
  'services.exe',
  'winedevice.exe',
  'plugplay.exe',
  'rpcss.exe',
  'explorer.exe',
  'svchost.exe',
  'conhost.exe',
  'crashhandler.exe',
  'eosoverlayrenderer-win64-shipping.exe',
  'eosoverlayrenderer-win32-shipping.exe'
])

function listLinuxHandoffPids(options: {
  installDir: string
  exePath?: string | null
  prefixPath?: string | null
  excludePids?: number[]
}): number[] {
  if (process.platform !== 'linux') return []

  const installLower = String(options.installDir || '').toLowerCase()
  const exeBase = options.exePath ? path.basename(options.exePath).toLowerCase() : ''
  const exclude = new Set<number>((options.excludePids || []).filter((p) => Number.isFinite(p)) as number[])
  const prefixCandidates: string[] = []
  if (options.prefixPath) {
    prefixCandidates.push(String(options.prefixPath).toLowerCase())
    prefixCandidates.push(resolveWinePrefixPath(options.prefixPath).toLowerCase())
  }

  let entries: string[] = []
  try {
    entries = fs.readdirSync('/proc')
  } catch {
    return []
  }

  const scored: Array<{ pid: number; score: number }> = []

  for (const ent of entries) {
    if (!/^\d+$/.test(ent)) continue
    const pid = Number(ent)
    if (!pid || exclude.has(pid)) continue

    const args = readProcCmdlineArgs(ent)
    if (!args.length) continue
    const cmdLower = args.join(' ').toLowerCase()

    const exeArg = [...args].reverse().find((a) => a.toLowerCase().endsWith('.exe'))
    if (!exeArg) continue
    const exeName = path.basename(exeArg).toLowerCase()
    if (IGNORED_WINE_EXE_NAMES.has(exeName)) continue

    const matchesInstall = !!installLower && cmdLower.includes(installLower)
    const matchesExe = !!exeBase && cmdLower.includes(exeBase)

    let matchesPrefix = false
    if (prefixCandidates.length) {
      const envRaw = readProcText(ent, 'environ')
      if (envRaw) {
        const envLower = envRaw.toLowerCase()
        matchesPrefix = prefixCandidates.some((p) =>
          envLower.includes(`wineprefix=${p}`) || envLower.includes(`steam_compat_data_path=${p}`)
        )
      }
    }

    if (!matchesPrefix && !matchesInstall && !matchesExe) continue

    let score = 0
    if (matchesPrefix) score += 5
    if (matchesInstall) score += 3
    if (matchesExe) score += 2
    if (cmdLower.includes('wine') || cmdLower.includes('proton')) score += 1
    if (exeBase && exeName === exeBase) score += 2

    scored.push({ pid, score })
  }

  scored.sort((a, b) => (b.score - a.score) || (b.pid - a.pid))
  return scored.map((s) => s.pid)
}

async function waitForHandoffPid(options: {
  installDir: string
  exePath?: string | null
  prefixPath?: string | null
  excludePids?: number[]
  timeoutMs?: number
  intervalMs?: number
}): Promise<number | null> {
  const timeoutMs = options.timeoutMs ?? 15000
  const intervalMs = options.intervalMs ?? 1000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pids = listLinuxHandoffPids(options)
    if (pids.length) return pids[0]
    await waitMs(intervalMs)
  }
  return null
}

async function waitForNoHandoffPids(options: {
  installDir: string
  exePath?: string | null
  prefixPath?: string | null
  excludePids?: number[]
  intervalMs?: number
  emptyStreak?: number
}): Promise<void> {
  const intervalMs = options.intervalMs ?? 1500
  const emptyStreakTarget = options.emptyStreak ?? 3
  let emptyStreak = 0
  while (true) {
    const pids = listLinuxHandoffPids(options)
    if (pids.length === 0) {
      emptyStreak += 1
      if (emptyStreak >= emptyStreakTarget) break
    } else {
      emptyStreak = 0
    }
    await waitMs(intervalMs)
  }
}

async function waitForPidExit(pid: number, intervalMs = 1500): Promise<void> {
  while (isPidAlive(pid)) {
    await waitMs(intervalMs)
  }
}

function isEosOverlayPathValid(p: string | null): boolean {
  if (!p) return false
  try {
    const win64 = path.join(p, 'EOSOverlayRenderer-Win64-Shipping.exe')
    const win32 = path.join(p, 'EOSOverlayRenderer-Win32-Shipping.exe')
    const dll64 = path.join(p, 'EOSOVH-Win64-Shipping.dll')
    const dll32 = path.join(p, 'EOSOVH-Win32-Shipping.dll')
    return fs.existsSync(win64) || fs.existsSync(win32) || fs.existsSync(dll64) || fs.existsSync(dll32)
  } catch {
    return false
  }
}

async function promptInstallEosOverlay(owner: Electron.BrowserWindow | null): Promise<'install' | 'skip'> {
  const options = {
    type: 'question' as const,
    buttons: ['Instalar agora (Recomendado)', 'Continuar sem'] as string[],
    defaultId: 0,
    cancelId: 1,
    title: 'EOS Overlay não instalado',
    message: 'O EOS Overlay não está instalado.',
    detail: 'Recomendado: sem ele pode não ser possível convidar outros jogadores. Deseja instalar agora?'
  }
  const res = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return res.response === 0 ? 'install' : 'skip'
}

async function enableEosOverlayForPrefix(
  prefixPath: string,
  owner: Electron.BrowserWindow | null,
  onStatus?: (msg: string) => void
): Promise<boolean> {
  if (!prefixPath) return false
  const winePrefix = resolveWinePrefixPath(prefixPath)
  if (!winePrefix || !fs.existsSync(winePrefix)) {
    console.warn('[Launch] EOS overlay: prefix inválido:', winePrefix || prefixPath)
    return false
  }

  const ensured = await ensureLegendaryAvailable({ allowDownload: true, timeoutMs: 120_000 })
  const legendaryPath = ensured.path
  if (!ensured.ok || !legendaryPath) {
    console.warn('[Launch] EOS overlay: legendary indisponível:', ensured.message || 'unknown')
    return false
  }

  let overlayPath = findEosOverlayInstallPath()
  if (!isEosOverlayPathValid(overlayPath)) overlayPath = null
  if (!overlayPath) {
    const decision = await promptInstallEosOverlay(owner)
    if (decision === 'skip') {
      console.warn('[Launch] EOS overlay: usuário optou por não instalar')
      return false
    }

    let installPath = ''
    try {
      installPath = path.join(app.getPath('userData'), 'tools', 'eos_overlay')
    } catch {}

    onStatus?.('Instalando EOS Overlay (recomendado)...')
    console.log('[Launch] EOS overlay: installing via legendary...')
    await new Promise<void>((resolve) => {
      const args = installPath
        ? ['eos-overlay', 'install', '--path', installPath]
        : ['eos-overlay', 'install']
      const proc = spawn(legendaryPath, args, { stdio: 'ignore' })
      const t = setTimeout(() => {
        try { proc.kill() } catch {}
        console.warn('[Launch] EOS overlay: install timeout')
        resolve()
      }, 15 * 60 * 1000)

      proc.on('error', (err: Error) => {
        clearTimeout(t)
        console.warn('[Launch] EOS overlay: install falhou:', err?.message || err)
        resolve()
      })
      proc.on('exit', (code: number | null) => {
        clearTimeout(t)
        if (typeof code === 'number' && code !== 0) {
          console.warn('[Launch] EOS overlay: install retornou código', code)
        }
        resolve()
      })
    })

    overlayPath = findEosOverlayInstallPath()
    if (!isEosOverlayPathValid(overlayPath)) overlayPath = null
    if (!overlayPath) {
      const warnOptions = {
        type: 'warning',
        title: 'Falha ao instalar EOS Overlay',
        message: 'Não foi possível instalar o EOS Overlay.',
        detail: 'O jogo será iniciado sem o overlay. Você pode tentar instalar novamente nas configurações.'
      } as const
      if (owner) {
        await dialog.showMessageBox(owner, warnOptions)
      } else {
        await dialog.showMessageBox(warnOptions)
      }
      return false
    }
  }

  let enableOk = false
  await new Promise<void>((resolve) => {
    const args = ['eos-overlay', 'enable', '--prefix', winePrefix]
    if (overlayPath) args.push('--path', overlayPath)
    console.log('[Launch] EOS overlay: enabling with args:', args.join(' '))
    const proc = spawn(legendaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let stdout = ''
    proc.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf-8') })
    proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf-8') })
    const t = setTimeout(() => {
      try { proc.kill() } catch {}
      console.warn('[Launch] EOS overlay: enable timeout')
      resolve()
    }, 15000)

    proc.on('error', (err: Error) => {
      clearTimeout(t)
      console.warn('[Launch] EOS overlay: enable falhou:', err?.message || err)
      resolve()
    })
    proc.on('exit', (code: number | null) => {
      clearTimeout(t)
      enableOk = typeof code === 'number' ? code === 0 : false
      if (!enableOk) {
        console.warn('[Launch] EOS overlay: enable retornou código', code)
        const out = (stdout + '\n' + stderr).trim()
        if (out) console.warn('[Launch] EOS overlay: enable output:', out.slice(0, 1200))
      }
      resolve()
    })
  })
  return enableOk
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
      
      // Generate unique session ID for overlay IPC (used by both Proton and native)
      const overlaySessionId = `game_${extractGameIdFromUrl(gameUrl)}_${Date.now()}`

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

        // Detect OnlineFix overlay IDs (Steam vs Epic)
        let iniSteamAppId: string | null = null
        let epicProductId: string | null = null
        try {
          const found = await findAndReadOnlineFixIni(installDir)
          if (found?.content) {
            const ids = extractOnlineFixOverlayIds(found.content)
            iniSteamAppId = ids.steamAppId || null
            epicProductId = ids.epicProductId || null
            if (iniSteamAppId) {
              console.log('[Launch] ✅ OnlineFix.ini Steam AppID:', iniSteamAppId, ids.steamAppIdSource ? `(source: ${ids.steamAppIdSource})` : '')
            }
            if (ids.fakeAppId) {
              console.log('[Launch] ✅ OnlineFix.ini Fake AppID:', ids.fakeAppId)
            }
            if (ids.realAppId) {
              console.log('[Launch] ✅ OnlineFix.ini Real AppID:', ids.realAppId)
            }
            if (epicProductId) console.log('[Launch] ✅ OnlineFix.ini Epic Product ID:', epicProductId)
          }
        } catch (err: any) {
          console.warn('[Launch] Failed to read OnlineFix.ini for overlay IDs:', err?.message || err)
        }

        const normalizeSteamId = (v?: string | null): string | null => {
          const s = String(v || '').trim()
          if (!s || !/^\d+$/.test(s) || s === '0') return null
          return s
        }
        const detectedSteamAppId = detectSteamAppIdFromInstall(installDir)
        const steamAppId =
          normalizeSteamId(game?.steam_app_id as string | null) ||
          normalizeSteamId(iniSteamAppId) ||
          normalizeSteamId(detectedSteamAppId)
        const isEpic = Boolean(epicProductId)
        const enableSteamOverlay = !isEpic && Boolean(steamAppId)
        const enableEosOverlay = isEpic

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

        let eosOverlayEnabled = false
        if (enableEosOverlay) {
          console.log('[Launch] 🟣 Enabling EOS overlay for prefix...')
          eosOverlayEnabled = await enableEosOverlayForPrefix(prefixPath, getMainWindow(), (msg) => {
            sendGameLaunchStatus({ gameUrl, status: 'starting', message: msg })
          })
        }

        console.log('[Launch] 🔧 Building Proton launch command...')
        const launch = buildProtonLaunch(
          exePath,
          [],
          slug,
          game.proton_runtime || undefined,
          { ...protonOpts, steamAppId: steamAppId || undefined, installDir, enableSteamOverlay, enableEosOverlay: eosOverlayEnabled },
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

        // Build environment for game launch
        const gameEnv: NodeJS.ProcessEnv = { 
          ...process.env, 
          ...launch.env,
          // Session ID for notification routing
          VOIDLAUNCHER_SESSION: overlaySessionId,
        }
        console.log('[Launch] 🔑 Session:', overlaySessionId)

        // Check if Gamescope mode is enabled for in-game notifications
        const useGamescope = protonOpts.useGamescope === true
        let finalCmd = launch.cmd
        let finalArgs = launch.args || []

        if (useGamescope) {
          console.log('[Launch] 🎮 Gamescope mode enabled for in-game notifications')
          // Wrap the command with gamescope
          // -e: enable Steam integration (overlay support)
          // --backend sdl: use SDL for window creation
          // -W/-H: output resolution, -w/-h: game resolution
          finalArgs = [
            '--backend', 'sdl',
            '-e',
            '-W', '1920', '-H', '1080',
            '-w', '1920', '-h', '1080',
            '--',
            launch.cmd,
            ...(launch.args || [])
          ]
          finalCmd = 'gamescope'
        }

        const launchStartedAt = Date.now()
        child = spawn(finalCmd, finalArgs, {
          env: gameEnv,
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

          const earlyExit = Date.now() - launchStartedAt < 20000
          let handoffPid: number | null = null
          if (earlyExit && process.platform === 'linux') {
            handoffPid = await waitForHandoffPid({
              installDir,
              exePath,
              prefixPath,
              excludePids: [child.pid],
              timeoutMs: 20000,
              intervalMs: 1000
            })
            if (handoffPid) {
              console.warn('[Launch] Launcher repassou execução para PID:', handoffPid)
              const existing = runningGames.get(gameUrl)
              if (existing) runningGames.set(gameUrl, { ...existing, pid: handoffPid })
              setCurrentGamePid(handoffPid)
              sendGameLaunchStatus({
                gameUrl,
                status: 'running',
                pid: handoffPid,
                message: 'Launcher finalizado; acompanhando jogo.'
              })
              console.log('[Launch] Handoff: acompanhando processos do jogo...')
              await waitForNoHandoffPids({
                installDir,
                exePath,
                prefixPath,
                excludePids: [child.pid],
                intervalMs: 1500,
                emptyStreak: 3
              })
              console.log('[Launch] Handoff: nenhum processo do jogo encontrado.')
            }
          }

          const handoffNoPid = !handoffPid && isEpic && earlyExit
          const effectiveCode = handoffPid || handoffNoPid ? 0 : code
          const effectiveSignal = handoffPid || handoffNoPid ? null : signal
          if (handoffNoPid) {
            console.warn('[Launch] Epic launcher exited early; treating as handoff (no error).')
          }
          
          // Cleanup overlay IPC using the session ID stored in runningGames
          const gameInfo = runningGames.get(gameUrl)
          if (gameInfo?.overlaySessionId) {
            try {
              removeOverlayServer(gameInfo.overlaySessionId)
              console.log('[Launch] 🧹 Cleaned up overlay IPC for session:', gameInfo.overlaySessionId)
            } catch (err) {
              console.error('[Launch] Failed to cleanup overlay IPC:', err)
            }
          }
          
          // Clear current game PID to switch notifications back to desktop
          setCurrentGamePid(null)
          
          try { runningGames.delete(gameUrl) } catch {}
          try { achievementsManager.stopWatching(gameUrl) } catch {}

          let mergedTail = stderrTail
          const shouldAppendLog = (effectiveCode != null && Number(effectiveCode) !== 0) || !!effectiveSignal
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
          const exitMsg = handoffNoPid ? 'Launcher finalizado; o jogo pode ter continuado.' : undefined
          sendGameLaunchStatus({ gameUrl, status: 'exited', code: effectiveCode, signal: effectiveSignal, stderrTail: mergedTail, protonLogPath, message: exitMsg })

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

        // Build environment for game launch
        const gameEnv: NodeJS.ProcessEnv = { 
          ...process.env,
          // Session ID for notification routing
          VOIDLAUNCHER_SESSION: overlaySessionId,
        }
        console.log('[Launch] 🔑 Session:', overlaySessionId)

        child = spawn(exePath, [], {
          env: gameEnv,
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
          
          // Cleanup overlay IPC using the session ID stored in runningGames
          const gameInfo = runningGames.get(gameUrl)
          if (gameInfo?.overlaySessionId) {
            try {
              removeOverlayServer(gameInfo.overlaySessionId)
              console.log('[Launch] 🧹 Cleaned up overlay IPC for session:', gameInfo.overlaySessionId)
            } catch (err) {
              console.error('[Launch] Failed to cleanup overlay IPC:', err)
            }
          }
          
          // Clear current game PID to switch notifications back to desktop
          setCurrentGamePid(null)
          
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
        runningGames.set(gameUrl, { pid: child.pid, child, protonLogPath, startedAt: Date.now(), overlaySessionId })

        // Set current game PID for notification routing
        setCurrentGamePid(child.pid)

        // Create IPC server for in-game overlay communication (notifications)
        if (NOTIFICATIONS_ENABLED) {
          try {
            const server = createOverlayServer(overlaySessionId)
            await server.start()
            console.log('[Launch] 🔌 Overlay IPC server started for session:', overlaySessionId)
          } catch (err) {
            console.error('[Launch] Failed to start overlay IPC server:', err)
          }
        }

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
              
              // Send notifications (desktop + in-game overlay)
              if (NOTIFICATIONS_ENABLED) {
                try {
                  const notif = notifyAchievementUnlocked(
                    ev.achievement?.displayName || ev.achievement?.name || 'Achievement Unlocked',
                    ev.achievement?.description,
                    ev.achievement?.icon
                  )
                  
                  // Send to in-game overlay if game is running
                  const gameInfo = runningGames.get(gameUrl)
                  if (gameInfo?.overlaySessionId) {
                    const server = getOverlayServer(gameInfo.overlaySessionId)
                    if (server && server.isRunning()) {
                      server.sendNotification(notif)
                    }
                  }
                } catch (err) {
                  console.error('[Launch] Failed to send achievement notification:', err)
                }
              }
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
