/**
 * IPC Handlers for Game Management
 */
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { spawn, spawnSync } from 'child_process'
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
import { ensureGamePrefixFromDefault, findProtonRuntime } from '../protonManager'
import { extractOnlineFixOverlayIds, findAndReadOnlineFixIni } from '../utils/onlinefixIni'
import {
  findEosOverlayInstallPath,
  findExecutableInDir,
  getDisplayCompatibilityInfo,
  isEosOverlayPathValid,
  isPidAlive,
  resolveOverlayCompatibility
} from '../utils'
import { detectSteamAppIdFromInstall } from './achievementsHandlers'
import { resolveLegendaryBinary } from '../legendary'
import type { IpcContext, IpcHandlerRegistrar } from './types'

// Helper to slugify strings
function slugify(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'game'
}

const DEFAULT_PROTON_OPTIONS = {
  esync: true,
  fsync: true,
  dxvk: true,
  mesa_glthread: false,
  locale: '',
  gamemode: false,
  mangohud: false,
  logging: false,
  steamOverlay: true,
  launchArgs: '',
  useGamescope: false,
  wineDllOverrides: ''
}

function pathInfo(p?: string | null, baseDir?: string | null) {
  const value = String(p || '').trim()
  if (!value) return { path: '', exists: false, type: 'missing' as const }
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir || process.cwd(), value)
  try {
    const st = fs.statSync(resolved)
    return {
      path: resolved,
      exists: true,
      type: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other',
      size: st.isFile() ? st.size : undefined
    }
  } catch {
    return { path: resolved, exists: false, type: 'missing' as const }
  }
}

function commandExists(cmd: string): boolean {
  try {
    const res = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`], { stdio: 'ignore' })
    return res.status === 0
  } catch {
    return false
  }
}

function commandPath(cmd: string): string | null {
  try {
    const res = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(cmd)}`], { encoding: 'utf8' })
    const out = String(res.stdout || '').trim().split(/\r?\n/)[0]
    return res.status === 0 && out ? out : null
  } catch {
    return null
  }
}

function isProcessRunning(names: string[]): boolean {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  try {
    for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
      try {
        const comm = fs.readFileSync(path.join('/proc', entry.name, 'comm'), 'utf8').trim().toLowerCase()
        if (wanted.has(comm)) return true
      } catch {
        // process can exit while scanning
      }
    }
  } catch {
    // /proc is Linux-specific
  }
  return false
}

function steamRootCandidates() {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.steam', 'debian-installation'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    '/usr/share/steam'
  ]
  const seen = new Set<string>()
  return candidates
    .map(p => {
      try { return path.resolve(p) } catch { return p }
    })
    .filter(p => {
      if (!p || seen.has(p)) return false
      seen.add(p)
      return fs.existsSync(p)
    })
}

function firstExisting(paths: string[]) {
  return paths.find(p => {
    try { return fs.existsSync(p) } catch { return false }
  }) || null
}

function diagnosticStatus(ok: boolean, warn = false): 'ok' | 'warn' | 'error' {
  if (ok) return 'ok'
  return warn ? 'warn' : 'error'
}

function parseProtonOptions(raw: any) {
  let parsed: any = {}
  let invalid = false
  try {
    parsed = raw ? JSON.parse(String(raw)) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = {}
      invalid = true
    }
  } catch {
    parsed = {}
    invalid = Boolean(raw)
  }

  return {
    invalid,
    options: {
      ...DEFAULT_PROTON_OPTIONS,
      ...parsed,
      esync: parsed.esync !== false,
      fsync: parsed.fsync !== false,
      dxvk: parsed.dxvk !== false,
      mesa_glthread: !!parsed.mesa_glthread,
      locale: parsed.locale || '',
      gamemode: !!parsed.gamemode,
      mangohud: !!parsed.mangohud,
      logging: !!parsed.logging,
      steamOverlay: parsed.steamOverlay !== false,
      launchArgs: parsed.launchArgs || '',
      useGamescope: !!parsed.useGamescope,
      wineDllOverrides: parsed.wineDllOverrides || ''
    }
  }
}

function isEmptyOrPlaceholderAppId(value: any) {
  const id = String(value || '').trim()
  return !id || id === '0' || id === '480'
}

function startSteamClient(command: string) {
  const child = spawn(command, ['-silent'], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  })
  child.unref()
}

async function collectGameDiagnostics(gameUrl: string, ctx: IpcContext) {
  const game = getGame(gameUrl) as any
  if (!game) return { success: false, error: 'Jogo não encontrado' }

  const installPath = pathInfo(game.install_path)
  const exePath = pathInfo(game.executable_path, installPath.exists && installPath.type === 'directory' ? installPath.path : null)
  const prefixPath = pathInfo(game.proton_prefix)
  const detectedRuntime = findProtonRuntime()
  const runtimePath = pathInfo(game.proton_runtime || detectedRuntime)
  const protonRunner = runtimePath.exists && runtimePath.type === 'directory'
    ? pathInfo(path.join(runtimePath.path, 'proton'))
    : pathInfo(null)

  const steamRoots = steamRootCandidates()
  const steamRoot = steamRoots[0] || null
  const overlay32 = firstExisting(steamRoots.map(root => path.join(root, 'ubuntu12_32', 'gameoverlayrenderer.so')))
  const overlay64 = firstExisting(steamRoots.map(root => path.join(root, 'ubuntu12_64', 'gameoverlayrenderer.so')))
  const vk32 = firstExisting(steamRoots.flatMap(root => [
    path.join(root, 'ubuntu12_32', 'steamoverlayvulkanlayer.so'),
    path.join(root, 'steamrt32', 'steamoverlayvulkanlayer.so')
  ]))
  const vk64 = firstExisting(steamRoots.flatMap(root => [
    path.join(root, 'ubuntu12_64', 'steamoverlayvulkanlayer.so'),
    path.join(root, 'steamrt64', 'steamoverlayvulkanlayer.so')
  ]))

  let onlineFix: any = { found: false }
  if (installPath.exists && installPath.type === 'directory') {
    try {
      const found = await findAndReadOnlineFixIni(installPath.path)
      if (found?.content) {
        const ids = extractOnlineFixOverlayIds(found.content)
        onlineFix = {
          found: true,
          path: found.path,
          steamAppId: ids.steamAppId || null,
          steamAppIdSource: ids.steamAppIdSource || null,
          fakeAppId: ids.fakeAppId || null,
          realAppId: ids.realAppId || null,
          epicProductId: ids.epicProductId || null
        }
      }
    } catch {
      onlineFix = { found: false, error: 'Falha ao ler OnlineFix.ini' }
    }
  }

  const parsedProtonOptions = parseProtonOptions(game.proton_options)
  const protonOptions = parsedProtonOptions.options
  const configuredSteamAppId = String(game.steam_app_id || '').trim()
  const detectedSteamAppId = installPath.exists && installPath.type === 'directory'
    ? detectSteamAppIdFromInstall(installPath.path)
    : null
  const overlayPolicy = resolveOverlayCompatibility({
    installPath: installPath.exists && installPath.type === 'directory' ? installPath.path : null,
    onlineFix,
    configuredSteamAppId,
    detectedSteamAppId,
    protonOptions
  })
  const overlayAppId = overlayPolicy.steamOverlayAppId
  const overlayEnabled = overlayPolicy.enableSteamOverlay
  const displayCompatibility = getDisplayCompatibilityInfo()
  const eosOverlayPath = findEosOverlayInstallPath(app.getPath('userData'))
  const eosOverlayValid = isEosOverlayPathValid(eosOverlayPath)
  const legendaryPath = await resolveLegendaryBinary()
  const running = ctx.runningGames.get(gameUrl)
  const runningPidAlive = Boolean(running?.pid && isPidAlive(running.pid))
  const steamCmd = commandPath('steam')
  const steamRunning = isProcessRunning(['steam', 'steamwebhelper'])
  const needsExecutableRepair = !exePath.exists || exePath.type !== 'file'
  const candidateExe = needsExecutableRepair && installPath.exists && installPath.type === 'directory'
    ? findExecutableInDir(installPath.path)
    : null

  const repairActions: any[] = []
  const addRepair = (id: string, label: string, detail: string, payload?: any) => {
    repairActions.push({ id, label, detail, automatic: true, payload })
  }

  if (running && !runningPidAlive) {
    addRepair('clear-stale-running-state', 'Limpar estado de execução preso', `PID ${running.pid} não está mais ativo`)
  }
  if (needsExecutableRepair && candidateExe) {
    addRepair('set-detected-executable', 'Definir executável detectado', candidateExe, { executablePath: candidateExe })
  }
  if ((!protonRunner.exists || !game.proton_runtime) && detectedRuntime) {
    addRepair('set-detected-proton-runtime', 'Definir runtime Proton detectado', detectedRuntime, { runtimePath: detectedRuntime })
  }
  if (parsedProtonOptions.invalid) {
    addRepair('normalize-proton-options', 'Recriar opções Proton inválidas', 'O JSON salvo está quebrado e será substituído pelos padrões seguros', { options: protonOptions })
  } else if (!game.proton_options) {
    addRepair('normalize-proton-options', 'Salvar opções Proton padrão', 'Cria uma configuração explícita para evitar divergência entre UI e launch', { options: protonOptions })
  }
  if ((!prefixPath.exists || prefixPath.type !== 'directory') && detectedRuntime && process.platform === 'linux') {
    addRepair('create-game-prefix', 'Criar prefixo dedicado', 'Cria/atualiza o prefixo Wine deste jogo em background', { runtimePath: detectedRuntime })
  }
  if (overlayPolicy.store === 'steam' && onlineFix.realAppId && isEmptyOrPlaceholderAppId(configuredSteamAppId)) {
    addRepair('set-onlinefix-real-appid', 'Salvar Steam AppID real do OnlineFix', onlineFix.realAppId, { steamAppId: onlineFix.realAppId })
  }
  if (overlayPolicy.selectedOverlay === 'steam' && steamCmd && !steamRunning) {
    addRepair('start-steam-client', 'Iniciar Steam para overlay', 'Abre o Steam em modo silencioso para melhorar a chance do Shift+Tab funcionar', { command: steamCmd })
  }

  const displayDetail = [
    displayCompatibility.sessionType ? `sessão ${displayCompatibility.sessionType}` : 'sessão desconhecida',
    displayCompatibility.waylandDisplay ? `Wayland ${displayCompatibility.waylandDisplay}` : null,
    displayCompatibility.display ? `X11 ${displayCompatibility.display}` : null,
    displayCompatibility.isGamescope ? `Gamescope${displayCompatibility.gamescopePid ? ` PID ${displayCompatibility.gamescopePid}` : ''}` : null
  ].filter(Boolean).join(' / ')

  const checks = [
    {
      id: 'install-path',
      label: 'Pasta de instalação',
      status: diagnosticStatus(installPath.exists && installPath.type === 'directory'),
      detail: installPath.path || 'Não configurada'
    },
    {
      id: 'executable',
      label: 'Executável',
      status: diagnosticStatus(exePath.exists && exePath.type === 'file'),
      detail: exePath.path || 'Não configurado'
    },
    {
      id: 'proton-runtime',
      label: 'Runtime Proton',
      status: diagnosticStatus(Boolean(protonRunner.exists), true),
      detail: protonRunner.exists ? protonRunner.path : (runtimePath.path || 'Não encontrado')
    },
    {
      id: 'prefix',
      label: 'Prefixo Wine',
      status: diagnosticStatus(prefixPath.exists && prefixPath.type === 'directory', true),
      detail: prefixPath.path || 'Será criado automaticamente'
    },
    {
      id: 'onlinefix',
      label: 'OnlineFix.ini',
      status: onlineFix.found ? 'ok' : 'warn',
      detail: onlineFix.found ? onlineFix.path : 'Não encontrado no diretório do jogo'
    },
    {
      id: 'steam-client',
      label: 'Cliente Steam',
      status: overlayPolicy.selectedOverlay !== 'steam' ? 'info' : steamCmd ? 'ok' : 'warn',
      detail: overlayPolicy.selectedOverlay !== 'steam'
        ? `Não necessário para overlay ${overlayPolicy.selectedOverlay === 'eos' ? 'Epic/EOS' : 'desativado'}`
        : steamCmd ? `Comando steam disponível: ${steamCmd}` : 'Comando steam não encontrado no PATH'
    },
    {
      id: 'steam-running',
      label: 'Steam rodando',
      status: overlayPolicy.selectedOverlay !== 'steam' ? 'info' : steamRunning ? 'ok' : 'warn',
      detail: overlayPolicy.selectedOverlay !== 'steam'
        ? 'Não será iniciado porque este jogo não foi classificado como Steam'
        : steamRunning ? 'Steam está ativo' : 'Necessário para Shift+Tab funcionar de forma confiável'
    },
    {
      id: 'overlay-policy',
      label: 'Decisão de overlay',
      status: overlayPolicy.selectedOverlay === 'none' ? 'info' : 'ok',
      detail: `${overlayPolicy.store.toUpperCase()} -> ${overlayPolicy.selectedOverlay === 'steam' ? `Steam (${overlayPolicy.steamOverlayAppId})` : overlayPolicy.selectedOverlay === 'eos' ? 'Epic/EOS' : 'nenhum'}: ${overlayPolicy.reason}`
    },
    {
      id: 'steam-overlay',
      label: 'Steam Overlay',
      status: overlayPolicy.selectedOverlay === 'steam' && overlay32 && overlay64 ? 'ok' : overlayPolicy.selectedOverlay === 'steam' ? 'warn' : 'info',
      detail: overlayEnabled
        ? `AppID do overlay: ${overlayAppId}`
        : overlayPolicy.store === 'epic'
          ? 'Jogo detectado como Epic/EOS; Steam Overlay não será injetado'
          : 'Sem AppID Steam/OnlineFix detectado ou toggle desligado'
    },
    {
      id: 'eos-overlay',
      label: 'Epic/EOS Overlay',
      status: overlayPolicy.selectedOverlay !== 'eos' ? 'info' : eosOverlayValid ? 'ok' : legendaryPath ? 'warn' : 'warn',
      detail: overlayPolicy.selectedOverlay !== 'eos'
        ? 'Não necessário para este jogo'
        : eosOverlayValid
          ? `EOS overlay encontrado: ${eosOverlayPath}`
          : legendaryPath
            ? `EOS overlay ainda não instalado; Legendary disponível em ${legendaryPath} e o launch pode instalar/ativar`
            : 'EOS overlay não encontrado; instale Legendary ou permita o launcher baixar/ativar no primeiro launch'
    },
    {
      id: 'vulkan-overlay',
      label: 'Vulkan Overlay Layer',
      status: overlayPolicy.selectedOverlay !== 'steam' ? 'info' : vk32 || vk64 ? 'ok' : 'warn',
      detail: overlayPolicy.selectedOverlay !== 'steam'
        ? 'Checagem relevante apenas quando Steam Overlay é usado'
        : [vk64 ? '64-bit OK' : '64-bit ausente', vk32 ? '32-bit OK' : '32-bit ausente'].join(' / ')
    },
    {
      id: 'display-server',
      label: 'Sessão gráfica',
      status: displayCompatibility.isWayland || displayCompatibility.isGamescope ? 'warn' : 'ok',
      detail: displayCompatibility.warnings.length ? `${displayDetail || 'ambiente desconhecido'}; ${displayCompatibility.warnings.join(' ')}` : (displayDetail || 'Ambiente X11/padrão')
    }
  ]

  return {
    success: true,
    diagnostics: {
      generatedAt: Date.now(),
      game: {
        title: game.title,
        url: game.url,
        gameId: game.game_id || extractGameIdFromUrl(game.url),
        installedVersion: game.installed_version || null,
        latestVersion: game.latest_version || null
      },
      paths: {
        install: installPath,
        executable: exePath,
        prefix: prefixPath,
        protonRuntime: runtimePath,
        protonRunner,
        detectedExecutable: candidateExe,
        detectedProtonRuntime: detectedRuntime
      },
      steam: {
        commandAvailable: Boolean(steamCmd),
        commandPath: steamCmd,
        running: steamRunning,
        roots: steamRoots,
        selectedRoot: steamRoot,
        overlay32,
        overlay64,
        vulkan32: vk32,
        vulkan64: vk64,
        configuredSteamAppId: configuredSteamAppId || null,
        detectedSteamAppId,
        overlayAppId,
        overlayEnabled
      },
      epic: {
        overlayPath: eosOverlayPath,
        overlayValid: eosOverlayValid,
        legendaryPath
      },
      display: displayCompatibility,
      overlayCompatibility: overlayPolicy,
      onlineFix,
      protonOptions,
      protonOptionsInvalid: parsedProtonOptions.invalid,
      running: running
        ? { pid: running.pid, alive: runningPidAlive, startedAt: running.startedAt || null, protonLogPath: running.protonLogPath || null }
        : null,
      tools: {
        gamescope: commandExists('gamescope'),
        gamemoderun: commandExists('gamemoderun'),
        winetricks: commandExists('winetricks'),
        protontricks: commandExists('protontricks')
      },
      checks,
      repairActions
    }
  }
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

  ipcMain.handle('get-game-diagnostics', async (_event, gameUrl: string) => {
    try {
      return await collectGameDiagnostics(gameUrl, ctx)
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao gerar diagnóstico' }
    }
  })

  ipcMain.handle('repair-game-diagnostics', async (_event, gameUrl: string) => {
    const results: Array<{ id: string; label: string; status: 'done' | 'skipped' | 'error'; detail?: string }> = []
    try {
      const before = await collectGameDiagnostics(gameUrl, ctx)
      if (!before.success) return before

      const game = getGame(gameUrl) as any
      if (!game) return { success: false, error: 'Jogo não encontrado' }

      for (const action of before.diagnostics?.repairActions || []) {
        try {
          switch (action.id) {
            case 'clear-stale-running-state':
              ctx.runningGames.delete(gameUrl)
              results.push({ id: action.id, label: action.label, status: 'done', detail: 'Estado de execução limpo' })
              break

            case 'set-detected-executable': {
              const executablePath = String(action.payload?.executablePath || '').trim()
              if (!executablePath || !fs.existsSync(executablePath)) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Executável detectado não existe mais' })
                break
              }
              updateGameInfo(gameUrl, { executable_path: executablePath })
              results.push({ id: action.id, label: action.label, status: 'done', detail: executablePath })
              break
            }

            case 'set-detected-proton-runtime': {
              const runtimePath = String(action.payload?.runtimePath || findProtonRuntime() || '').trim()
              if (!runtimePath || !fs.existsSync(path.join(runtimePath, 'proton'))) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Runtime Proton não encontrado' })
                break
              }
              updateGameInfo(gameUrl, { proton_runtime: runtimePath })
              results.push({ id: action.id, label: action.label, status: 'done', detail: runtimePath })
              break
            }

            case 'normalize-proton-options': {
              const options = action.payload?.options || DEFAULT_PROTON_OPTIONS
              updateGameInfo(gameUrl, { proton_options: JSON.stringify(options) })
              results.push({ id: action.id, label: action.label, status: 'done', detail: 'Opções Proton normalizadas' })
              break
            }

            case 'create-game-prefix': {
              if (ctx.inFlightPrefixJobs.has(gameUrl)) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Já existe uma operação de prefixo em andamento' })
                break
              }

              const latestGame = getGame(gameUrl) as any
              const stableId = (latestGame?.game_id as string | null) || extractGameIdFromUrl(gameUrl)
              const slug = stableId ? `game_${stableId}` : slugify(latestGame?.title || game.title || gameUrl || 'game')
              const runtimePath = String(action.payload?.runtimePath || latestGame?.proton_runtime || findProtonRuntime() || '').trim()
              if (!runtimePath) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Runtime Proton não encontrado' })
                break
              }

              ctx.inFlightPrefixJobs.set(gameUrl, { startedAt: Date.now() })
              ctx.sendPrefixJobStatus({ gameUrl, status: 'starting', message: 'Autocorreção: preparando prefixo...' })
              const prefix = await ensureGamePrefixFromDefault(slug, runtimePath, undefined, true, (msg) => {
                ctx.sendPrefixJobStatus({ gameUrl, status: 'progress', message: `Autocorreção: ${msg}` })
              })
              updateGameInfo(gameUrl, { proton_prefix: prefix })
              ctx.inFlightPrefixJobs.delete(gameUrl)
              ctx.sendPrefixJobStatus({ gameUrl, status: 'done', message: 'Prefixo pronto', prefix })
              results.push({ id: action.id, label: action.label, status: 'done', detail: prefix })
              break
            }

            case 'set-onlinefix-real-appid': {
              const steamAppId = String(action.payload?.steamAppId || '').replace(/[^\d]/g, '')
              if (!steamAppId) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Steam AppID inválido' })
                break
              }
              updateGameInfo(gameUrl, { steam_app_id: steamAppId })
              results.push({ id: action.id, label: action.label, status: 'done', detail: steamAppId })
              break
            }

            case 'start-steam-client': {
              const steam = String(action.payload?.command || commandPath('steam') || '').trim()
              if (!steam) {
                results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Comando steam não encontrado' })
                break
              }
              startSteamClient(steam)
              results.push({ id: action.id, label: action.label, status: 'done', detail: 'Steam iniciado em modo silencioso' })
              break
            }

            default:
              results.push({ id: action.id, label: action.label, status: 'skipped', detail: 'Ação desconhecida' })
              break
          }
        } catch (err: any) {
          if (action.id === 'create-game-prefix') {
            try { ctx.inFlightPrefixJobs.delete(gameUrl) } catch {}
            ctx.sendPrefixJobStatus({ gameUrl, status: 'error', message: err?.message || String(err) })
          }
          results.push({ id: action.id, label: action.label, status: 'error', detail: err?.message || String(err) })
        }
      }

      const after = await collectGameDiagnostics(gameUrl, ctx)
      return { success: true, actions: results, diagnostics: after.success ? after.diagnostics : undefined }
    } catch (err: any) {
      return { success: false, actions: results, error: err?.message || 'Falha ao autocorrigir diagnóstico' }
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
            
            // Check if this is actually a new update (version differs from installed)
            const currentVersion = String(g.installed_version || '').toLowerCase().trim()
            const latestVersion = String(info.version || '').toLowerCase().trim()
            if (currentVersion && latestVersion && currentVersion !== latestVersion && g.is_installed) {
              try {
                const { notifyUpdateAvailable } = require('../notificationOverlay.js')
                notifyUpdateAvailable(g.title || 'Jogo', info.version)
              } catch {}
            }
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
