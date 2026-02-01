import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn, spawnSync } from 'child_process'
import crypto from 'crypto'
import { getSetting, setSetting } from './db'
import { findFilesRecursive } from './downloadManager'

const DEFAULT_PREFIX_DIR = path.join(os.homedir(), '.local/share/of-launcher/prefixes')
const DEFAULT_RUNTIME_DIR = path.join(os.homedir(), '.local/share/of-launcher/proton')
const DEFAULT_PREFIX_NAME = '__default'
const DEFAULT_DEPS_SENTINEL = '.of_default_deps_v2'
const DEFAULT_DEPS_SCHEMA = 3

const inFlightDefaultPrefix = new Map<string, Promise<string>>()
const inFlightGamePrefix = new Map<string, Promise<string>>()

export interface ProtonRuntime {
  name: string
  path: string
  runner: string
  source: string
  realRunner?: string
}

export function isLinux() {
  return process.platform === 'linux'
}

export function getPrefixRootDir() {
  return DEFAULT_PREFIX_DIR
}

function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

// ✅ NOVA FUNÇÃO - Encontra o diretório raiz do Steam
function findSteamRoot(): string {
  const candidates = [
    path.join(os.homedir(), '.steam', 'steam'),
    path.join(os.homedir(), '.steam', 'root'),
    path.join(os.homedir(), '.local', 'share', 'Steam'),
    path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    '/usr/share/steam',
  ]
  
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('[Proton] Found Steam root at:', p)
      return p
    }
  }
  
  const fallback = path.join(os.homedir(), '.steam', 'steam')
  console.log('[Proton] Using fallback Steam root:', fallback)
  return fallback
}

export function getSavedProtonRuntime(): string | null {
  const val = getSetting('proton_runtime_path')
  return val ? expandHome(val) : null
}

export function setSavedProtonRuntime(runtimePath: string) {
  setSetting('proton_runtime_path', runtimePath)
}

export function findProtonRuntime(): string | null {
  if (!isLinux()) return null
  const saved = getSavedProtonRuntime()
  if (saved && fs.existsSync(saved)) return saved

  // Prefer a runtime found by scanning known locations (Heroic-like behavior)
  const runtimes = listProtonRuntimes()
  if (runtimes.length) {
    const rank = (name: string) => {
      const n = (name || '').toLowerCase()
      if (n.includes('proton - experimental') || n.includes('proton experimental')) return 100
      if (n.includes('proton - stable') || n.includes('proton stable')) return 90
      if (n.includes('ge-proton') || n.includes('proton-ge') || n.includes('proton ge')) return 80
      return 10
    }
    const best = runtimes
      .slice()
      .sort((a, b) => rank(b.name) - rank(a.name))[0]
    if (best?.path && fs.existsSync(path.join(best.path, 'proton'))) {
      setSavedProtonRuntime(best.path)
      return best.path
    }
  }

  // Fallback: try a few common paths directly
  const candidates = [
    '~/.steam/steam/steamapps/common/Proton - Experimental',
    '~/.steam/root/steamapps/common/Proton - Experimental',
    '~/.local/share/Steam/steamapps/common/Proton - Experimental',
    path.join(DEFAULT_RUNTIME_DIR, 'proton-ge'),
    process.env.PROTON_HOME
  ].filter(Boolean) as string[]

  for (const c of candidates) {
    const expanded = expandHome(c)
    const protonScript = path.join(expanded, 'proton')
    if (fs.existsSync(protonScript)) {
      setSavedProtonRuntime(expanded)
      return expanded
    }
  }

  return null
}

export function getProtonRunner(runtimePath: string | null): { runner: string | null; protonDir: string | null } {
  if (!runtimePath) return { runner: null, protonDir: null }
  const protonScript = path.join(runtimePath, 'proton')
  if (fs.existsSync(protonScript)) {
    return { runner: protonScript, protonDir: runtimePath }
  }
  return { runner: null, protonDir: null }
}

export function getPrefixPath(slug: string) {
  const dir = path.join(DEFAULT_PREFIX_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function runtimeKeyFor(runtimePath?: string) {
  const runner = getRunnerForRuntime(runtimePath)
  if (!runner) return null
  return crypto.createHash('sha1').update(runner).digest('hex').slice(0, 8)
}

export function getManagedPrefixPath(slug: string, runtimePath?: string) {
  const key = runtimeKeyFor(runtimePath)
  const name = key ? `${slug}__rt_${key}` : slug
  return getPrefixPath(name)
}

export function getDefaultPrefixPath() {
  return getPrefixPath(DEFAULT_PREFIX_NAME)
}

// Compute expected default prefix path for a given runtime WITHOUT creating directories.
export function getExpectedDefaultPrefixPath(runtimePath?: string) {
  const key = runtimeKeyFor(runtimePath)
  const name = key ? `${DEFAULT_PREFIX_NAME}__rt_${key}` : DEFAULT_PREFIX_NAME
  return path.join(DEFAULT_PREFIX_DIR, name)
}

function readPrefixSentinel(prefixPath: string): { proton?: string } | null {
  try {
    const sentinel = path.join(prefixPath, DEFAULT_DEPS_SENTINEL)
    if (!fs.existsSync(sentinel)) return null
    const raw = fs.readFileSync(sentinel, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return { proton: typeof (parsed as any).proton === 'string' ? (parsed as any).proton : undefined }
    }
    return null
  } catch {
    return null
  }
}

type ComponentInstallState = {
  attempts?: number
  lastAttemptAt?: string
  tool?: 'protontricks' | 'winetricks' | null
  ok?: boolean | null
}

type DefaultDepsMeta = {
  schema?: number
  initialized?: string
  updatedAt?: string
  proton?: string
  winebootDone?: boolean
  vcredist?: ComponentInstallState
  dotnet?: ComponentInstallState
  // 🆕 STEAM-LIKE: Track individual components that have been installed
  installedComponents?: string[]
  // 🆕 Track detected requirements for this game
  detectedRequirements?: string[]
  // 🆕 Track if smart install was used
  smartInstallUsed?: boolean
  // Legacy fields (file name existed before schema field)
  winetricks?: boolean
  protontricks?: boolean
}

function readDefaultDepsMeta(prefixCompatDataPath: string): DefaultDepsMeta | null {
  try {
    const sentinel = path.join(prefixCompatDataPath, DEFAULT_DEPS_SENTINEL)
    if (!fs.existsSync(sentinel)) return null
    const raw = fs.readFileSync(sentinel, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as DefaultDepsMeta
  } catch {
    // ignore
  }
  return null
}

function writeDefaultDepsMeta(prefixCompatDataPath: string, meta: DefaultDepsMeta) {
  try {
    const sentinel = path.join(prefixCompatDataPath, DEFAULT_DEPS_SENTINEL)
    fs.writeFileSync(sentinel, JSON.stringify(meta, null, 2))
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString()
}

function resetVcredistState(prefixCompatDataPath: string) {
  try {
    const meta = readDefaultDepsMeta(prefixCompatDataPath)
    if (!meta) return
    meta.schema = DEFAULT_DEPS_SCHEMA
    meta.updatedAt = nowIso()
    meta.vcredist = { attempts: 0, ok: null, tool: null }
    writeDefaultDepsMeta(prefixCompatDataPath, meta)
  } catch {
    // ignore
  }
}

function getRunnerForRuntime(runtimePath?: string): string | null {
  const protonPath = runtimePath || findProtonRuntime() || null
  const { runner } = getProtonRunner(protonPath)
  return runner
}

function resolveCompatDataPaths(prefixPath: string, allowMigrate: boolean) {
  const normalized = prefixPath
  const managed = normalized.startsWith(DEFAULT_PREFIX_DIR)

  // If already points to .../pfx
  if (normalized.endsWith(`${path.sep}pfx`)) {
    return { compatDataPath: path.dirname(normalized), winePrefix: normalized }
  }

  const pfx = path.join(normalized, 'pfx')
  if (fs.existsSync(pfx)) {
    // Repair: older migration could have moved our sentinel/state into pfx.
    // Keep these files at compatdata root so we don't reinstall prerequisites every launch.
    if (managed && allowMigrate) {
      const toRepair = [DEFAULT_DEPS_SENTINEL, '.of_commonredist_state.json']
      for (const name of toRepair) {
        const src = path.join(pfx, name)
        const dest = path.join(normalized, name)
        try {
          if (fs.existsSync(src) && !fs.existsSync(dest)) fs.renameSync(src, dest)
        } catch {
          // ignore
        }
      }
    }
    return { compatDataPath: normalized, winePrefix: pfx }
  }

  // If user-supplied prefix outside managed root, treat it as a plain WINEPREFIX.
  if (!managed && !allowMigrate) {
    return { compatDataPath: normalized, winePrefix: normalized }
  }

  // Migration for old-style managed prefixes (drive_c at root)
  const hasOldLayout = fs.existsSync(path.join(normalized, 'drive_c')) || fs.existsSync(path.join(normalized, 'dosdevices'))
  if (hasOldLayout && managed && allowMigrate) {
    try {
      fs.mkdirSync(pfx, { recursive: true })
      for (const name of fs.readdirSync(normalized)) {
        if (name === 'pfx') continue
        // Keep launcher sentinel/state at compatdata root.
        if (name.startsWith('.of_')) continue
        const src = path.join(normalized, name)
        const dest = path.join(pfx, name)
        try {
          fs.renameSync(src, dest)
        } catch {
          // fallback copy+remove for cross-device or locked files
          try {
            fs.cpSync(src, dest, { recursive: true })
            fs.rmSync(src, { recursive: true, force: true })
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.warn('[Proton] Failed to migrate old prefix layout to pfx:', normalized, err)
    }
    return { compatDataPath: normalized, winePrefix: pfx }
  }

  // Fresh compatdata structure
  if (managed && allowMigrate) {
    try { fs.mkdirSync(pfx, { recursive: true }) } catch {}
    return { compatDataPath: normalized, winePrefix: pfx }
  }

  // Fallback: treat as plain WINEPREFIX
  return { compatDataPath: normalized, winePrefix: normalized }
}

function findCommonRedistDir(installDir: string) {
  try {
    const direct = path.join(installDir, '_CommonRedist')
    if (fs.existsSync(direct)) return direct
  } catch {
    // ignore
  }
  return null
}

function getRedistSentinelPath(prefixCompatDataPath: string) {
  return path.join(prefixCompatDataPath, '.of_commonredist_state.json')
}

type RedistState = {
  completed: Record<string, { mtimeMs: number; status: number | null; at: string }>
}

function readRedistState(prefixCompatDataPath: string): RedistState {
  try {
    const p = getRedistSentinelPath(prefixCompatDataPath)
    if (!fs.existsSync(p)) return { completed: {} }
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).completed === 'object') return parsed as RedistState
  } catch {
    // ignore
  }
  return { completed: {} }
}

function writeRedistState(prefixCompatDataPath: string, state: RedistState) {
  try {
    fs.writeFileSync(getRedistSentinelPath(prefixCompatDataPath), JSON.stringify(state, null, 2))
  } catch {
    // ignore
  }
}

async function runInstallerWithProton(
  runner: string,
  env: NodeJS.ProcessEnv,
  installerPath: string,
  args: string[],
  timeoutMs: number
): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const proc = spawn(runner, ['run', installerPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const killTimer = setTimeout(() => {
      try { proc.kill() } catch {}
      resolve(null)
    }, timeoutMs)

    proc.stdout?.on('data', (d: Buffer) => console.log('[Redist stdout]', d.toString().trim()))
    proc.stderr?.on('data', (d: Buffer) => console.log('[Redist stderr]', d.toString().trim()))

    proc.on('error', () => {
      clearTimeout(killTimer)
      resolve(null)
    })
    proc.on('close', (code) => {
      clearTimeout(killTimer)
      resolve(typeof code === 'number' ? code : null)
    })
  })
}

export async function ensureGameCommonRedists(
  installDir: string,
  prefixCompatDataPath: string,
  runtimePath?: string,
  onProgress?: (msg: string) => void
): Promise<{ ran: boolean; ok: boolean; details?: string }> {
  if (!isLinux()) return { ran: false, ok: true }
  const common = findCommonRedistDir(installDir)
  if (!common) return { ran: false, ok: true }

  const protonPath = runtimePath || findProtonRuntime()
  const { runner } = getProtonRunner(protonPath)
  if (!runner) return { ran: false, ok: false, details: 'Proton runner não encontrado' }

  const allowMigrate = prefixCompatDataPath.startsWith(DEFAULT_PREFIX_DIR)
  const { compatDataPath, winePrefix } = resolveCompatDataPaths(prefixCompatDataPath, allowMigrate)

  const steamRoot = findSteamRoot()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    WINEPREFIX: winePrefix,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
    WINEDEBUG: '-all'
  }

  const state = readRedistState(compatDataPath)

  const installers = findFilesRecursive(common, /\.(exe|msi)$/i)
  const vcCandidates = installers.filter(p =>
    /vc[_-]?redist.*x64.*\.exe$/i.test(p) ||
    /vcredist.*x64.*\.exe$/i.test(p) ||
    /vc[_-]?redist.*x86.*\.exe$/i.test(p) ||
    /vcredist.*x86.*\.exe$/i.test(p)
  )
  const dxCandidates = installers.filter(p => /dxsetup\.exe$/i.test(p))

  const uniqPaths = (arr: string[]) => Array.from(new Set(arr))

  const vcX86 = vcCandidates.filter(p => /x86/i.test(path.basename(p)))
  const vcX64 = vcCandidates.filter(p => /x64/i.test(path.basename(p)))

  const queue: Array<{ path: string; kind: 'vcredist' | 'dxsetup' }> = [
    ...uniqPaths(vcX86).map(p => ({ path: p, kind: 'vcredist' as const })),
    ...uniqPaths(vcX64).map(p => ({ path: p, kind: 'vcredist' as const })),
    ...uniqPaths(dxCandidates).map(p => ({ path: p, kind: 'dxsetup' as const }))
  ]

  if (!queue.length) return { ran: false, ok: true }

  let ranAny = false
  let okAll = true

  for (const item of queue) {
    let stat: fs.Stats | null = null
    try { stat = fs.statSync(item.path) } catch { stat = null }
    const mtimeMs = stat?.mtimeMs || 0
    const key = item.path

    const prev = state.completed[key]
    const prevOk = prev && (prev.status === 0 || prev.status === 3010)
    if (prevOk && prev.mtimeMs === mtimeMs) continue

    ranAny = true
    const name = path.basename(item.path)

    if (item.kind === 'vcredist') {
      onProgress?.(`Instalando Visual C++ (${name})...`)
      // VC++ 2015-2022 usually supports these flags.
      const code = await runInstallerWithProton(runner, env, item.path, ['/install', '/quiet', '/norestart'], 5 * 60 * 1000)
      state.completed[key] = { mtimeMs, status: code, at: new Date().toISOString() }
      writeRedistState(compatDataPath, state)
      if (!(code === 0 || code === 3010)) okAll = false
    } else if (item.kind === 'dxsetup') {
      // DXSETUP is notoriously picky; keep to /silent only.
      onProgress?.(`Instalando DirectX (${name})...`)
      const code = await runInstallerWithProton(runner, env, item.path, ['/silent'], 5 * 60 * 1000)
      state.completed[key] = { mtimeMs, status: code, at: new Date().toISOString() }
      writeRedistState(compatDataPath, state)
      if (!(code === 0 || code === 3010)) okAll = false
    }
  }

  return { ran: ranAny, ok: okAll }
}

async function clonePrefix(sourcePrefix: string, targetPrefix: string) {
  try {
    if (!fs.existsSync(sourcePrefix)) return false
    // Ensure target is fresh
    if (fs.existsSync(targetPrefix)) {
      await fs.promises.rm(targetPrefix, { recursive: true, force: true })
    }
    await fs.promises.mkdir(path.dirname(targetPrefix), { recursive: true })
    // Note: fs.promises.cp is available in Node 16+
    // Copying the whole prefix ensures the sentinel exists so we don't reinstall prerequisites per game.
    await fs.promises.cp(sourcePrefix, targetPrefix, { recursive: true })
    return true
  } catch (err) {
    console.warn('[Proton] Failed to clone prefix', sourcePrefix, '->', targetPrefix, err)
    return false
  }
}

export async function ensureDefaultPrefix(runtimePath?: string) {
  const key = runtimePath || 'auto'
  const existing = inFlightDefaultPrefix.get(key)
  if (existing) return existing

  const task = (async () => {
    const prefix = getManagedPrefixPath(DEFAULT_PREFIX_NAME, runtimePath)
    const desiredRunner = getRunnerForRuntime(runtimePath) || undefined
    const meta = readPrefixSentinel(prefix)
    if (meta?.proton && desiredRunner && meta.proton !== desiredRunner) {
      console.log('[Proton] Default prefix runtime changed, recreating:', meta.proton, '->', desiredRunner)
      try { await fs.promises.rm(prefix, { recursive: true, force: true }) } catch {}
    }
    await ensurePrefixDefaults(prefix, runtimePath)
    return prefix
  })()

  inFlightDefaultPrefix.set(key, task)
  try {
    return await task
  } finally {
    inFlightDefaultPrefix.delete(key)
  }
}

/**
 * 🆕 STEAM-LIKE: Ensure game prefix with smart dependency detection.
 * This function analyzes the game directory to detect what dependencies
 * are actually needed, similar to how Steam/Proton works.
 */
export async function ensureGamePrefixFromDefault(
  gameSlug: string,
  runtimePath?: string,
  _commonRedistPath?: string,
  forceRecreate?: boolean,
  onProgress?: (msg: string) => void,
  gameInstallPath?: string  // 🆕 Path to game install for smart detection
) {
  const taskKey = `${gameSlug}::${runtimePath || 'auto'}::${forceRecreate ? 'recreate' : 'keep'}`
  const existing = inFlightGamePrefix.get(taskKey)
  if (existing) return existing

  const task = (async () => {
    onProgress?.('Preparando prefixo do jogo...')

    const gamePrefix = getManagedPrefixPath(gameSlug, runtimePath)

    const meta = readDefaultDepsMeta(gamePrefix)
    const hasSentinel = !!meta && (meta.schema === DEFAULT_DEPS_SCHEMA || !!meta.initialized)
    const desiredRunner = getRunnerForRuntime(runtimePath) || undefined
    const runtimeMismatch = !!(meta?.proton && desiredRunner && meta.proton !== desiredRunner)

    if (runtimeMismatch) {
      console.log('[Proton] Game prefix runtime changed, recreating:', meta?.proton, '->', desiredRunner)
    }

    // Determine game install path for smart detection
    const effectiveGamePath = gameInstallPath || _commonRedistPath?.replace('/_CommonRedist', '') || undefined

    if (forceRecreate || !fs.existsSync(gamePrefix) || !hasSentinel || runtimeMismatch) {
      onProgress?.('Criando/atualizando prefixo do jogo...')

      // 🆕 Use smart install with game path for requirement detection
      await ensurePrefixDefaults(gamePrefix, runtimePath, undefined, onProgress, effectiveGamePath)
    }

    // Reset vcredist state only when forcing recreate
    if (forceRecreate) {
      const { compatDataPath } = resolveCompatDataPaths(gamePrefix, true)
      resetVcredistState(compatDataPath)
    }

    // If the game package includes an _CommonRedist folder, attempt to run its installers
    // inside the game prefix (DirectX / bundled vcredist). This helps games that ship their
    // own redistributables instead of relying on winetricks.
    // 🆕 This is now the PREFERRED method - use game's own installers first
    try {
      if (_commonRedistPath && fs.existsSync(_commonRedistPath)) {
        onProgress?.('Aplicando redistribuíveis do jogo...')
        console.log('[Proton] 📦 Running game bundled redistributables (preferred over winetricks)')
        await ensureGameCommonRedists(_commonRedistPath, gamePrefix, runtimePath, onProgress)
      }
    } catch (err) {
      console.warn('[Proton] Failed to run game _CommonRedist installers:', err)
    }

    // 🆕 STEAM-LIKE: Only verify essential Wine files, not VC++ (game may not need it)
    try {
      const { winePrefix } = resolveCompatDataPaths(gamePrefix, true)
      const sys32 = path.join(winePrefix, 'drive_c', 'windows', 'system32')

      // Only check for Wine essentials, not VC++ (which may not be needed)
      const wineEssentials = ['wineboot.exe']
      const missing = wineEssentials.filter(e => !fs.existsSync(path.join(sys32, e)))

      if (missing.length) {
        console.warn('[Proton] Wine prefix not properly initialized, repairing...')
        onProgress?.('Reparando prefixo Wine...')
        await ensurePrefixDefaults(gamePrefix, runtimePath, undefined, onProgress, effectiveGamePath)
      } else {
        console.log('[Proton] ✅ Wine prefix looks healthy')
      }
    } catch (err) {
      console.warn('[Proton] Failed to verify game prefix:', err)
    }

    return gamePrefix
  })()

  inFlightGamePrefix.set(taskKey, task)
  try {
    return await task
  } finally {
    inFlightGamePrefix.delete(taskKey)
  }
}

export function setCustomProtonRoot(root: string) {
  const normalized = String(root || '').trim()
  if (!normalized) return

  const current = getCustomProtonRoots()
  const expanded = expandHome(normalized)
  const next = Array.from(new Set([...current, expanded])).filter(Boolean)

  // Persist new format
  try {
    setSetting('proton_runtime_roots', JSON.stringify(next))
  } catch {
    // ignore
  }

  // Keep legacy key as "last added" for compatibility.
  setSetting('proton_runtime_root', normalized)
}

export function setCustomProtonRoots(roots: string[]) {
  const list = Array.isArray(roots) ? roots : []
  const normalized = list
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .map((r) => expandHome(r))

  const uniq = Array.from(new Set(normalized))
  try {
    setSetting('proton_runtime_roots', JSON.stringify(uniq))
  } catch {
    // ignore
  }

  // Keep legacy key for older builds.
  const last = list.length ? String(list[list.length - 1] || '').trim() : ''
  setSetting('proton_runtime_root', last)
}

function getCustomProtonRoots(): string[] {
  const roots: string[] = []
  const legacy = getSetting('proton_runtime_root')
  if (legacy) roots.push(expandHome(String(legacy)))

  const raw = getSetting('proton_runtime_roots')
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw))
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) roots.push(expandHome(item.trim()))
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(roots)).filter(Boolean)
}

function scanProtonDir(dir: string, source: string): ProtonRuntime[] {
  if (!dir || !fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    if (!entry.isDirectory()) return []
    const runtimePath = path.join(dir, entry.name)
    const runner = path.join(runtimePath, 'proton')
    if (fs.existsSync(runner)) {
      let realRunner: string | undefined
      try {
        realRunner = fs.realpathSync(runner)
      } catch {
        // ignore resolution errors
      }
      return [{
        name: entry.name,
        path: runtimePath,
        runner,
        realRunner,
        source
      }]
    }
    return []
  })
}

export function listProtonRuntimes(): ProtonRuntime[] {
  if (!isLinux()) return []

  const candidates: Array<{ dir: string; source: string }> = [
    { dir: '~/.steam/steam/steamapps/common', source: 'steam' },
    { dir: '~/.steam/root/steamapps/common', source: 'steam' },
    { dir: '~/.local/share/Steam/steamapps/common', source: 'steam' },
    { dir: '~/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common', source: 'steam' },
    { dir: '~/.steam/steam/compatibilitytools.d', source: 'compat-tools' },
    { dir: '~/.local/share/Steam/compatibilitytools.d', source: 'compat-tools' },
    { dir: '~/.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d', source: 'compat-tools' },
    { dir: path.join(DEFAULT_RUNTIME_DIR), source: 'launcher' },
    { dir: path.join(DEFAULT_RUNTIME_DIR, 'proton-ge'), source: 'launcher' },
    ...getCustomProtonRoots().map(r => ({ dir: r, source: 'custom' }))
  ]

  const fromEnv = process.env.STEAM_COMPAT_TOOL_PATHS
  if (fromEnv) {
    fromEnv.split(':').filter(Boolean).forEach(p => candidates.push({ dir: p, source: 'env' }))
  }

  const all = candidates.flatMap(c => scanProtonDir(expandHome(c.dir), c.source))

  const byRunner = new Map<string, ProtonRuntime>()
  for (const rt of all) {
    const key = rt.realRunner || rt.runner
    if (byRunner.has(key)) continue
    byRunner.set(key, rt)
  }

  const byName = new Map<string, ProtonRuntime>()
  for (const rt of byRunner.values()) {
    const nameKey = rt.name.toLowerCase()
    if (byName.has(nameKey)) continue
    byName.set(nameKey, rt)
  }

  return Array.from(byName.values())
}

export function buildProtonLaunch(
  exePath: string,
  args: string[] = [],
  slug: string,
  runtimePath?: string,
  options?: {
    esync?: boolean
    fsync?: boolean
    dxvk?: boolean
    locale?: string
    mesa_glthread?: boolean
    gamemode?: boolean
    mangohud?: boolean
    logging?: boolean
    launchArgs?: string
    steamAppId?: string | number | null
    installDir?: string | null
  },
  prefixPathOverride?: string
) {
  const protonPath = runtimePath || findProtonRuntime()
  const { runner, protonDir } = getProtonRunner(protonPath)
  const rawPrefix = prefixPathOverride || getManagedPrefixPath(slug, runtimePath)
  const { compatDataPath: prefix, winePrefix } = resolveCompatDataPaths(
    rawPrefix,
    rawPrefix.startsWith(DEFAULT_PREFIX_DIR)
  )
  
  // ✅ CORREÇÃO: Encontrar o diretório raiz do Steam
  const steamRoot = findSteamRoot()

  const envOptions: Record<string, string> = {}
  // Many OnlineFix/Steamless games require native DLLs for proper functionality.
  // - steam_api/steam_api64: Steam API stubs
  // - winmm: Windows multimedia (n,b = native with builtin fallback)
  // - OnlineFix/OnlineFix64: OnlineFix loader DLLs
  // - SteamOverlay/SteamOverlay64: Steam overlay stubs
  // - dnet: .NET interop for some games
  // - winhttp: HTTP library (n,b = native with builtin fallback)
  const baseDllOverrides = 'steam_api=n;steam_api64=n;winmm=n,b;OnlineFix=n;OnlineFix64=n;SteamOverlay=n;SteamOverlay64=n;dnet=n;winhttp=n,b'
  const existingOverrides = (process.env.WINEDLLOVERRIDES || '').trim()
  envOptions.WINEDLLOVERRIDES = existingOverrides ? `${existingOverrides};${baseDllOverrides}` : baseDllOverrides
  if (options?.esync === false) envOptions.PROTON_NO_ESYNC = '1'
  if (options?.fsync === false) envOptions.PROTON_NO_FSYNC = '1'
  if (options?.dxvk === false) envOptions.PROTON_USE_WINED3D = '1'
  if (options?.mesa_glthread) envOptions.MESA_GLTHREAD = 'true'
  if (options?.locale) envOptions.LANG = options.locale
  if (options?.mangohud) envOptions.MANGOHUD = '1'
  const logging = options?.logging === true
  // Proton logs can get extremely noisy (e.g. trace:unwind spam). Provide a curated WINEDEBUG when logging is enabled.
  // When logging is disabled, keep wine quiet.
  envOptions.WINEDEBUG = logging
    ? '-all,+err,+warn,+fixme,+seh,+loaddll,-unwind'
    : '-all'

  // ✅ CORREÇÃO PRINCIPAL: Use 0 por default para non-Steam apps, evitando integração com Steam.exe
  const steamAppId = options?.steamAppId != null && String(options.steamAppId).trim() !== ''
    ? String(options.steamAppId).trim()
    : '0'

  const logsDir = path.join(os.homedir(), '.local/share/of-launcher/logs/proton', slug)
  try { fs.mkdirSync(logsDir, { recursive: true }) } catch {}

  const extraArgs = options?.launchArgs ? options.launchArgs.split(' ').filter(Boolean) : []
  // Use 'waitforexitandrun' instead of 'run' - this is required for ProtonFixes to work
  // and properly waits for the game process to exit
  const baseArgs = runner ? ['waitforexitandrun', exePath, ...args, ...extraArgs] : [exePath, ...args, ...extraArgs]

  let cmd = runner ? runner : exePath
  let finalArgs = baseArgs

  if (options?.gamemode) {
    // Only use gamemoderun if it's available on the system; otherwise fallback silently
    if (commandExists('gamemoderun')) {
      cmd = 'gamemoderun'
      finalArgs = runner ? [runner, ...baseArgs] : baseArgs
    } else {
      console.warn('[Proton] gamemoderun not found; launching without gamemode')
    }
  }

  return {
    runner,
    protonDir,
    prefix,
    winePrefix,
    cmd,
    args: finalArgs,
    env: Object.fromEntries(
      Object.entries({
        ...sanitizeEnvForProton(process.env),
        ...envOptions,
        STEAM_COMPAT_DATA_PATH: prefix,
        STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,  // ✅ CORREÇÃO!
        STEAM_COMPAT_INSTALL_PATH: options?.installDir ? String(options.installDir) : undefined,
        STEAM_COMPAT_APP_ID: steamAppId,
        SteamAppId: steamAppId,
        WINEPREFIX: winePrefix,
        PROTON_LOG: logging ? '1' : undefined,
        PROTON_ENABLE_LOG: logging ? '1' : undefined,
        PROTON_LOG_DIR: logsDir,
        PROTON_EAC_RUNTIME: fs.existsSync(path.join(steamRoot, 'steamapps/common/Proton EasyAntiCheat Support'))
          ? path.join(steamRoot, 'steamapps/common/Proton EasyAntiCheat Support')
          : undefined,
        PROTON_BATTLEYE_RUNTIME: fs.existsSync(path.join(steamRoot, 'steamapps/common/Proton BattlEye Runtime'))
          ? path.join(steamRoot, 'steamapps/common/Proton BattlEye Runtime')
          : undefined
      }).filter(([, value]) => value !== undefined)
    )
  }
}

// =====================================================
// 🆕 SISTEMA DE PRÉ-REQUISITOS MELHORADO
// =====================================================

function commandExists(cmd: string): boolean {
  return findCommandPath(cmd) != null
}

function sanitizeEnvForProton(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }

  const dropPrefixes = [
    'npm_',
    'NPM_',
    'VSCODE_',
    'ELECTRON_',
    'NODE_',
    'PYTHON',
    'PIP_',
    'VIRTUAL_ENV',
    'CONDA',
    'PYTEST_',
    'CLAUDE_',
  ]

  for (const key of Object.keys(out)) {
    if (dropPrefixes.some(p => key.startsWith(p))) {
      delete out[key]
      continue
    }
    if (
      key === 'NODE' ||
      key === 'NODE_ENV' ||
      key === 'npm_command' ||
      key === 'npm_lifecycle_event' ||
      key === 'npm_lifecycle_script' ||
      key === 'GIT_ASKPASS' ||
      key === 'SSH_ASKPASS' ||
      key === 'TERM_PROGRAM' ||
      key === 'TERM_PROGRAM_VERSION'
    ) {
      delete out[key]
    }
  }

  return out
}

function getProtonWineOverrides(protonDir?: string | null): NodeJS.ProcessEnv {
  if (!protonDir) return {}
  try {
    const filesRoot = fs.existsSync(path.join(protonDir, 'files')) ? path.join(protonDir, 'files') : null
    const distRoot = fs.existsSync(path.join(protonDir, 'dist')) ? path.join(protonDir, 'dist') : null
    const root = filesRoot || distRoot

    const candidates = [
      // Common layout (Valve Proton / GE-Proton)
      root ? { wine: path.join(root, 'bin', 'wine'), wineserver: path.join(root, 'bin', 'wineserver') } : null,
      root ? { wine: path.join(root, 'bin', 'wine64'), wineserver: path.join(root, 'bin', 'wineserver') } : null,
      // Fallback (older expectations)
      {
        wine: path.join(protonDir, 'files', 'bin', 'wine'),
        wineserver: path.join(protonDir, 'files', 'bin', 'wineserver')
      },
      {
        wine: path.join(protonDir, 'files', 'bin', 'wine64'),
        wineserver: path.join(protonDir, 'files', 'bin', 'wineserver')
      },
      {
        wine: path.join(protonDir, 'dist', 'bin', 'wine'),
        wineserver: path.join(protonDir, 'dist', 'bin', 'wineserver')
      },
      {
        wine: path.join(protonDir, 'dist', 'bin', 'wine64'),
        wineserver: path.join(protonDir, 'dist', 'bin', 'wineserver')
      }
    ].filter(Boolean) as Array<{ wine: string; wineserver: string }>

    for (const c of candidates) {
      if (fs.existsSync(c.wine) && fs.existsSync(c.wineserver)) {
        const binDir = path.dirname(c.wine)
        const prevPath = process.env.PATH || ''

        // ✅ MELHORIA CRÍTICA: adicionar libs do Proton ao LD_LIBRARY_PATH
        const libDirs: string[] = []
        const base = path.dirname(binDir) // .../files or .../dist
        const probe = [
          path.join(base, 'lib'),
          path.join(base, 'lib64'),
          path.join(base, 'lib', 'wine'),
          path.join(base, 'lib64', 'wine'),
          path.join(base, 'lib', 'wine', 'i386-unix'),
          path.join(base, 'lib64', 'wine', 'x86_64-unix'),
        ]
        for (const p of probe) {
          try { if (fs.existsSync(p)) libDirs.push(p) } catch { /* ignore */ }
        }

        const prevLd = process.env.LD_LIBRARY_PATH || ''
        const mergedLd = [
          ...libDirs.filter(Boolean),
          ...(prevLd ? [prevLd] : [])
        ].filter(Boolean).join(':')

        return {
          WINE: c.wine,
          WINESERVER: c.wineserver,
          PATH: `${binDir}${path.delimiter}${prevPath}`,
          LD_LIBRARY_PATH: mergedLd || prevLd
        }
      }
    }
  } catch {
    // ignore
  }
  return {}
}

async function runProtonTool(
  runner: string,
  env: NodeJS.ProcessEnv,
  toolArgs: string[],
  timeoutMs: number,
  tag: string
): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const proc = spawn(runner, ['run', ...toolArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] })

    const t = setTimeout(() => {
      try { proc.kill() } catch {}
      resolve(null)
    }, timeoutMs)

    proc.stdout?.on('data', (d: Buffer) => console.log(tag, d.toString().trim()))
    proc.stderr?.on('data', (d: Buffer) => console.log(tag, d.toString().trim()))

    proc.on('error', () => {
      clearTimeout(t)
      resolve(null)
    })
    proc.on('close', (code) => {
      clearTimeout(t)
      resolve(typeof code === 'number' ? code : null)
    })
  })
}

function findCommandPath(cmd: string): string | null {
  try {
    const fromEnv = (process.env.PATH || '')
      .split(path.delimiter)
      .map(p => p.trim())
      .filter(Boolean)

    const fallbacks = [
      path.join(os.homedir(), '.local', 'bin'),
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin'
    ]

    const dirs = Array.from(new Set([...fromEnv, ...fallbacks]))
    for (const dir of dirs) {
      const full = path.join(dir, cmd)
      if (fs.existsSync(full)) return full
    }
  } catch {
    // ignore
  }
  return null
}

function winetricksAvailable(): boolean {
  return commandExists('winetricks')
}

function protontricksAvailable(): boolean {
  return commandExists('protontricks')
}

// =====================================================
// 🆕 SISTEMA DE DETECÇÃO DE REQUISITOS (STEAM-LIKE)
// =====================================================

export interface GameRequirements {
  vcredist: boolean       // Visual C++ Runtime
  dotnet: string[]        // .NET versions needed (e.g., ['dotnet48'])
  directx9: boolean       // DirectX 9 (d3dx9)
  directx11: boolean      // DirectX 11 (d3dcompiler)
  xaudio: boolean         // XAudio/XACT
  physx: boolean          // NVIDIA PhysX
  msxml: boolean          // MSXML (common in older games)
  vbrun: boolean          // Visual Basic Runtime
  mfc: boolean            // Microsoft Foundation Classes
  fonts: boolean          // Core fonts
  detected: string[]      // List of detected requirements
}

/**
 * Analyze game directory to detect required dependencies.
 * This is similar to how Steam/Proton detects requirements.
 */
export function detectGameRequirements(installPath: string): GameRequirements {
  const result: GameRequirements = {
    vcredist: false,
    dotnet: [],
    directx9: false,
    directx11: false,
    xaudio: false,
    physx: false,
    msxml: false,
    vbrun: false,
    mfc: false,
    fonts: false,
    detected: []
  }

  if (!installPath || !fs.existsSync(installPath)) {
    return result
  }

  console.log('[RequirementsDetector] Analyzing game directory:', installPath)

  try {
    // Collect all DLLs and executables for analysis
    const files = findFilesRecursive(installPath, /\.(dll|exe)$/i)
    const fileNames = new Set(files.map(f => path.basename(f).toLowerCase()))

    // Check for VC++ Runtime dependencies
    const vcrtFiles = [
      'vcruntime140.dll', 'vcruntime140_1.dll',
      'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
      'concrt140.dll', 'vccorlib140.dll',
      'vcruntime120.dll', 'msvcp120.dll',
      'vcruntime110.dll', 'msvcp110.dll',
      'vcruntime100.dll', 'msvcp100.dll',
      'msvcr100.dll', 'msvcr110.dll', 'msvcr120.dll', 'msvcr140.dll'
    ]
    if (vcrtFiles.some(f => fileNames.has(f))) {
      result.vcredist = true
      result.detected.push('vcredist')
    }

    // Check for DirectX 9 dependencies
    const dx9Files = [
      'd3dx9_43.dll', 'd3dx9_42.dll', 'd3dx9_41.dll', 'd3dx9_40.dll',
      'd3dx9_39.dll', 'd3dx9_38.dll', 'd3dx9_37.dll', 'd3dx9_36.dll',
      'd3dx9_35.dll', 'd3dx9_34.dll', 'd3dx9_33.dll', 'd3dx9_32.dll',
      'd3dx9_31.dll', 'd3dx9_30.dll', 'd3dx9_29.dll', 'd3dx9_28.dll',
      'd3dx9_27.dll', 'd3dx9_26.dll', 'd3dx9_25.dll', 'd3dx9_24.dll',
      'd3d9.dll', 'xinput1_3.dll', 'xinput1_4.dll'
    ]
    if (dx9Files.some(f => fileNames.has(f))) {
      result.directx9 = true
      result.detected.push('directx9')
    }

    // Check for DirectX 11 dependencies
    const dx11Files = [
      'd3dcompiler_43.dll', 'd3dcompiler_46.dll', 'd3dcompiler_47.dll',
      'd3d11.dll', 'dxgi.dll'
    ]
    if (dx11Files.some(f => fileNames.has(f))) {
      result.directx11 = true
      result.detected.push('directx11')
    }

    // Check for XAudio/XACT dependencies
    const xaudioFiles = [
      'xaudio2_7.dll', 'xaudio2_8.dll', 'xaudio2_9.dll',
      'x3daudio1_7.dll', 'xactengine3_7.dll',
      'xapofx1_5.dll'
    ]
    if (xaudioFiles.some(f => fileNames.has(f))) {
      result.xaudio = true
      result.detected.push('xaudio')
    }

    // Check for PhysX dependencies
    const physxFiles = [
      'physxcooking.dll', 'physxcore.dll', 'physxloader.dll',
      'physx3common_x64.dll', 'physx3common_x86.dll',
      'physx3_x64.dll', 'physx3_x86.dll',
      'physxdevice.dll', 'nvcuda.dll'
    ]
    if (physxFiles.some(f => fileNames.has(f))) {
      result.physx = true
      result.detected.push('physx')
    }

    // Check for .NET dependencies
    const dotnetMarkers = [
      // Check for .NET config files
      ...files.filter(f => f.toLowerCase().endsWith('.exe.config')),
      // Check for CLR assemblies
      ...files.filter(f => {
        const name = path.basename(f).toLowerCase()
        return name.includes('clr') || name.includes('mscoree') || name.includes('mscorlib')
      })
    ]

    if (dotnetMarkers.length > 0 || fileNames.has('mscorlib.dll') || fileNames.has('mscoree.dll')) {
      // Try to detect which .NET version
      const configFiles = files.filter(f => f.toLowerCase().endsWith('.exe.config'))
      let detectedVersions = new Set<string>()

      for (const configFile of configFiles.slice(0, 5)) { // Check first 5 config files
        try {
          const content = fs.readFileSync(configFile, 'utf-8').toLowerCase()
          if (content.includes('v4.0') || content.includes('4.0.0') || content.includes('net4')) {
            detectedVersions.add('dotnet48')
          }
          if (content.includes('v3.5') || content.includes('3.5.0')) {
            detectedVersions.add('dotnet35')
          }
          if (content.includes('v2.0') || content.includes('2.0.0')) {
            detectedVersions.add('dotnet20')
          }
        } catch {
          // ignore read errors
        }
      }

      if (detectedVersions.size === 0) {
        // Default to .NET 4.8 if we can't detect specific version
        detectedVersions.add('dotnet48')
      }

      result.dotnet = Array.from(detectedVersions)
      result.detected.push(...result.dotnet)
    }

    // Check for MSXML dependencies
    if (fileNames.has('msxml4.dll') || fileNames.has('msxml6.dll') || fileNames.has('msxml3.dll')) {
      result.msxml = true
      result.detected.push('msxml')
    }

    // Check for Visual Basic Runtime
    if (fileNames.has('msvbvm60.dll') || fileNames.has('vb6run.dll')) {
      result.vbrun = true
      result.detected.push('vbrun')
    }

    // Check for MFC dependencies
    const mfcFiles = ['mfc140u.dll', 'mfc120u.dll', 'mfc110u.dll', 'mfc100u.dll', 'mfc42.dll']
    if (mfcFiles.some(f => fileNames.has(f))) {
      result.mfc = true
      result.detected.push('mfc')
    }

    // Check for _CommonRedist folder (indicates the game knows what it needs)
    const commonRedist = path.join(installPath, '_CommonRedist')
    if (fs.existsSync(commonRedist)) {
      // If game bundles its own redist, we should prioritize using those
      const redistContents = fs.readdirSync(commonRedist)
      console.log('[RequirementsDetector] Game has _CommonRedist folder with:', redistContents)
      result.detected.push('_CommonRedist')
    }

    // Always include fonts for better compatibility
    result.fonts = true

    console.log('[RequirementsDetector] Detected requirements:', result.detected)

  } catch (err) {
    console.warn('[RequirementsDetector] Error analyzing game:', err)
  }

  return result
}

/**
 * Convert detected requirements to winetricks components.
 */
export function requirementsToWinetricks(reqs: GameRequirements): string[] {
  const components: string[] = []

  if (reqs.vcredist) {
    components.push('vcrun2022') // Covers 2015-2022
  }
  if (reqs.directx9) {
    components.push('d3dx9')
  }
  if (reqs.directx11) {
    components.push('d3dcompiler_47')
  }
  if (reqs.xaudio) {
    components.push('xact')
  }
  if (reqs.physx) {
    components.push('physx')
  }
  if (reqs.msxml) {
    components.push('msxml6')
  }
  if (reqs.vbrun) {
    components.push('vb6run')
  }
  if (reqs.mfc) {
    components.push('vcrun2019') // MFC usually needs VC runtime
  }
  if (reqs.fonts) {
    components.push('corefonts')
  }

  // Remove duplicates
  return Array.from(new Set(components))
}

// Lista de pré-requisitos básicos (fallback se detecção falhar)
const BASIC_PREREQUISITES = {
  winetricks: [
    'vcrun2022',      // Visual C++ 2015-2022 Redistributable
    'corefonts',      // Microsoft Core Fonts
  ]
}

// Lista completa de pré-requisitos (modo legacy/forçado)
const COMMON_PREREQUISITES = {
  winetricks: [
    'vcrun2022',      // Visual C++ 2015-2022 Redistributable
    'corefonts',      // Microsoft Core Fonts (sometimes required by installers)
  ],
  // Componentes extras que podem ser necessários
  winetricksExtras: [
    'd3dx9',          // DirectX 9
    'd3dcompiler_47', // DirectX Shader Compiler
    'xact',           // X3DAudio (XAudio)
    'physx',          // NVIDIA PhysX
  ],
  // .NET via protontricks (melhor compatibilidade)
  protontricks: [
    'dotnet48',       // .NET Framework 4.8
    'dotnet40',       // .NET Framework 4.0
  ]
}

// 🆕 STEAM-LIKE: Optimized winetricks runner with better timeout and error handling
async function runWinetricks(
  runner: string,
  prefixCompatDataPath: string,
  components: string[],
  env: NodeJS.ProcessEnv,
  onProgress?: (msg: string) => void,
  protonDir?: string | null
): Promise<boolean> {
  const winetricksCmd = findCommandPath('winetricks')
  if (!winetricksCmd) {
    console.log('[Proton] winetricks not available, skipping')
    return false
  }

  if (components.length === 0) {
    return true
  }

  const winePrefix = typeof env.WINEPREFIX === 'string' && env.WINEPREFIX.trim() !== ''
    ? String(env.WINEPREFIX)
    : path.join(prefixCompatDataPath, 'pfx')

  // 🆕 OPTIMIZATION: Install multiple components at once when possible
  // Group compatible components together to reduce overhead
  const fastComponents = components.filter(c => ['corefonts', 'd3dcompiler_47'].includes(c))
  const slowComponents = components.filter(c => !fastComponents.includes(c))

  let okAll = true

  // Helper function to run winetricks for a set of components
  const runComponents = async (comps: string[], timeoutMs: number): Promise<boolean> => {
    if (comps.length === 0) return true

    const componentList = comps.join(' ')
    onProgress?.(`Instalando: ${comps.join(', ')}...`)
    console.log(`[Proton] Installing via winetricks: ${componentList}`)

    // Try direct winetricks with Proton overrides (more reliable than proton run)
    const protonOverrides = getProtonWineOverrides(protonDir)
    const winetricksEnv: NodeJS.ProcessEnv = {
      ...env,
      ...protonOverrides,
      WINEPREFIX: winePrefix,
      STEAM_COMPAT_DATA_PATH: prefixCompatDataPath,
      WINETRICKS_NONINTERACTIVE: '1',
      // 🆕 Reduce verbosity
      WINETRICKS_DOWNLOADER: 'wget',
      WINETRICKS_QUIET: '1'
    }

    const result = await new Promise<number | null>((resolve) => {
      const proc = spawn(winetricksCmd, ['--force', '-q', ...comps], {
        env: winetricksEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let lastOutput = Date.now()

      proc.stdout?.on('data', (data: Buffer) => {
        lastOutput = Date.now()
        const text = data.toString().trim()
        if (text) console.log(`[winetricks] ${text}`)
      })
      proc.stderr?.on('data', (data: Buffer) => {
        lastOutput = Date.now()
        const text = data.toString().trim()
        if (text) console.log(`[winetricks] ${text}`)
      })

      proc.on('close', (code) => resolve(typeof code === 'number' ? code : null))
      proc.on('error', () => resolve(null))

      // 🆕 Smart timeout: extend if we're seeing output
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - lastOutput
        if (elapsed > 60000) { // No output for 1 minute = stalled
          console.warn('[winetricks] No output for 60s, considering stalled')
          clearInterval(checkInterval)
          try { proc.kill() } catch {}
          resolve(null)
        }
      }, 10000)

      const hardTimeout = setTimeout(() => {
        clearInterval(checkInterval)
        console.warn(`[winetricks] Hard timeout reached (${timeoutMs / 1000}s)`)
        try { proc.kill() } catch {}
        resolve(null)
      }, timeoutMs)

      proc.on('close', () => {
        clearInterval(checkInterval)
        clearTimeout(hardTimeout)
      })
      proc.on('error', () => {
        clearInterval(checkInterval)
        clearTimeout(hardTimeout)
      })
    })

    if (result === 0) {
      console.log(`[Proton] ✅ Components installed: ${componentList}`)
      return true
    } else {
      console.warn(`[Proton] ⚠️ Components installation returned code ${result}: ${componentList}`)
      return false
    }
  }

  // Run fast components together (2 minute timeout)
  if (fastComponents.length > 0) {
    const fastOk = await runComponents(fastComponents, 2 * 60 * 1000)
    if (!fastOk) okAll = false
  }

  // Run slow components individually with longer timeout (3 minutes each)
  for (const component of slowComponents) {
    try {
      const ok = await runComponents([component], 3 * 60 * 1000)
      if (!ok) okAll = false
    } catch (err) {
      console.warn(`[Proton] Failed to install ${component}:`, err)
      okAll = false
    }
  }

  return okAll
}

// 🆕 STEAM-LIKE: Optimized protontricks runner with smart timeout
async function runProtontricks(
  prefixPath: string,
  components: string[],
  env: NodeJS.ProcessEnv,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  const protontricksCmd = findCommandPath('protontricks')
  if (!protontricksCmd) {
    console.log('[Proton] protontricks not available, skipping .NET installation')
    return false
  }

  if (components.length === 0) {
    return true
  }

  let okAll = true

  for (const component of components) {
    try {
      onProgress?.(`Instalando ${component}...`)
      console.log(`[Proton] Installing ${component} via protontricks...`)

      const result = await new Promise<number | null>((resolve) => {
        const proc = spawn(protontricksCmd, ['--no-steam', '-c', `winetricks -q ${component}`, prefixPath], {
          env: {
            ...env,
            STEAM_COMPAT_DATA_PATH: prefixPath,
            WINETRICKS_NONINTERACTIVE: '1',
            WINETRICKS_QUIET: '1'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let lastOutput = Date.now()

        proc.stdout?.on('data', (data: Buffer) => {
          lastOutput = Date.now()
          const text = data.toString().trim()
          if (text) console.log(`[protontricks] ${text}`)
        })

        proc.stderr?.on('data', (data: Buffer) => {
          lastOutput = Date.now()
          const text = data.toString().trim()
          if (text) console.log(`[protontricks] ${text}`)
        })

        proc.on('close', (code) => resolve(typeof code === 'number' ? code : null))
        proc.on('error', () => resolve(null))

        // 🆕 Smart timeout: check for stalled process
        const checkInterval = setInterval(() => {
          const elapsed = Date.now() - lastOutput
          if (elapsed > 120000) { // No output for 2 minutes = stalled
            console.warn('[protontricks] No output for 2 minutes, considering stalled')
            clearInterval(checkInterval)
            try { proc.kill() } catch {}
            resolve(null)
          }
        }, 15000)

        // 🆕 Reduced hard timeout: 5 minutes instead of 10
        const hardTimeout = setTimeout(() => {
          clearInterval(checkInterval)
          console.warn('[protontricks] Hard timeout reached (5 minutes)')
          try { proc.kill() } catch {}
          resolve(null)
        }, 5 * 60 * 1000)

        proc.on('close', () => {
          clearInterval(checkInterval)
          clearTimeout(hardTimeout)
        })
        proc.on('error', () => {
          clearInterval(checkInterval)
          clearTimeout(hardTimeout)
        })
      })

      if (result === 0) {
        console.log(`[Proton] ✅ ${component} installed via protontricks`)
      } else {
        console.warn(`[Proton] ⚠️ ${component} protontricks returned code ${result}`)
        okAll = false
      }
    } catch (err) {
      console.warn(`[Proton] Failed to install ${component} via protontricks:`, err)
      okAll = false
    }
  }

  return okAll
}

async function runCommonRedistInstallers(
  commonRedistPath: string,
  runner: string,
  env: NodeJS.ProcessEnv,
  onProgress?: (msg: string) => void
): Promise<void> {
  if (!commonRedistPath || !fs.existsSync(commonRedistPath)) {
    console.log('[Proton] No _CommonRedist folder found')
    return
  }

  console.log('[Proton] Scanning _CommonRedist folder:', commonRedistPath)
  
  const installers = findFilesRecursive(commonRedistPath, /\.(exe|msi)$/i)
  console.log(`[Proton] Found ${installers.length} installers in _CommonRedist`)

  for (const installer of installers) {
    try {
      const filename = path.basename(installer)
      onProgress?.(`Running ${filename}...`)
      console.log(`[Proton] Running CommonRedist installer: ${filename}`)
      
      // Different args for MSI vs EXE
      const isMsi = installer.toLowerCase().endsWith('.msi')
      const args = isMsi 
        ? ['run', 'msiexec', '/i', installer, '/quiet', '/norestart']
        : ['run', installer, '/quiet', '/silent', '/norestart', '-silent', '-q']
      
      const result = spawnSync(runner, args, { 
        env, 
        stdio: 'pipe',
        timeout: 120000 // 2 minute timeout per installer
      })
      
      if (result.status === 0) {
        console.log(`[Proton] ✅ ${filename} completed`)
      } else {
        console.warn(`[Proton] ⚠️ ${filename} returned code ${result.status}`)
      }
    } catch (err) {
      console.warn('[Proton] Failed to run CommonRedist installer', installer, err)
    }
  }
}

// =====================================================
// 🆕 STEAM-LIKE: VALIDAÇÃO PÓS-INSTALAÇÃO
// =====================================================

export interface PrefixValidationResult {
  valid: boolean
  winebootOk: boolean
  vcredistOk: boolean
  missingFiles: string[]
  warnings: string[]
}

/**
 * Validate that a prefix has the expected files after dependency installation.
 * Similar to how Steam verifies game files.
 */
export function validatePrefixInstallation(
  prefixPath: string,
  expectedComponents: string[] = []
): PrefixValidationResult {
  const result: PrefixValidationResult = {
    valid: true,
    winebootOk: false,
    vcredistOk: false,
    missingFiles: [],
    warnings: []
  }

  try {
    const { winePrefix } = resolveCompatDataPaths(prefixPath, false)
    const sys32 = path.join(winePrefix, 'drive_c', 'windows', 'system32')
    const syswow64 = path.join(winePrefix, 'drive_c', 'windows', 'syswow64')

    // Check Wine essentials
    const wineEssentials = ['wineboot.exe', 'ntdll.dll', 'kernel32.dll']
    const missingWine = wineEssentials.filter(f => !fs.existsSync(path.join(sys32, f)))

    if (missingWine.length === 0) {
      result.winebootOk = true
    } else {
      result.missingFiles.push(...missingWine.map(f => `system32/${f}`))
      result.warnings.push('Wine prefix not properly initialized')
    }

    // Check VC++ Runtime files (if vcredist was expected)
    if (expectedComponents.includes('vcrun2022') || expectedComponents.includes('vcredist')) {
      const vcFiles = ['vcruntime140.dll', 'msvcp140.dll']
      const missingVc = vcFiles.filter(f =>
        !fs.existsSync(path.join(sys32, f)) && !fs.existsSync(path.join(syswow64, f))
      )

      if (missingVc.length === 0) {
        result.vcredistOk = true
      } else {
        result.missingFiles.push(...missingVc)
        result.warnings.push('VC++ Runtime may not be fully installed')
      }
    } else {
      result.vcredistOk = true // Not expected, so OK
    }

    // Check DirectX 9 files (if d3dx9 was expected)
    if (expectedComponents.includes('d3dx9')) {
      const dx9Files = ['d3dx9_43.dll']
      const missingDx9 = dx9Files.filter(f =>
        !fs.existsSync(path.join(sys32, f)) && !fs.existsSync(path.join(syswow64, f))
      )
      if (missingDx9.length > 0) {
        result.warnings.push('DirectX 9 may not be fully installed')
      }
    }

    // Check .NET files (if dotnet was expected)
    if (expectedComponents.some(c => c.startsWith('dotnet'))) {
      const dotnetDir = path.join(winePrefix, 'drive_c', 'windows', 'Microsoft.NET')
      if (!fs.existsSync(dotnetDir)) {
        result.warnings.push('.NET Framework may not be installed')
      }
    }

    // Overall validity
    result.valid = result.winebootOk && result.missingFiles.length === 0

    if (result.warnings.length > 0) {
      console.log('[PrefixValidator] Validation warnings:', result.warnings)
    }
    if (result.missingFiles.length > 0) {
      console.log('[PrefixValidator] Missing files:', result.missingFiles)
    }

  } catch (err) {
    console.warn('[PrefixValidator] Validation error:', err)
    result.valid = false
    result.warnings.push(`Validation error: ${err}`)
  }

  return result
}

/**
 * Get a summary of what's installed in a prefix.
 */
export function getPrefixStatus(prefixPath: string): {
  exists: boolean
  initialized: boolean
  protonVersion: string | null
  installedComponents: string[]
  lastUpdated: string | null
} {
  const result = {
    exists: false,
    initialized: false,
    protonVersion: null as string | null,
    installedComponents: [] as string[],
    lastUpdated: null as string | null
  }

  try {
    if (!fs.existsSync(prefixPath)) {
      return result
    }
    result.exists = true

    const meta = readDefaultDepsMeta(prefixPath)
    if (meta) {
      result.initialized = meta.winebootDone === true
      result.protonVersion = meta.proton || null
      result.installedComponents = meta.installedComponents || []
      result.lastUpdated = meta.updatedAt || null
    }

    // Check for pfx directory
    const { winePrefix } = resolveCompatDataPaths(prefixPath, false)
    if (fs.existsSync(path.join(winePrefix, 'drive_c'))) {
      result.initialized = true
    }

  } catch (err) {
    console.warn('[getPrefixStatus] Error:', err)
  }

  return result
}

// =====================================================
// FUNÇÃO PRINCIPAL DE INICIALIZAÇÃO DO PREFIXO
// =====================================================

export async function ensurePrefixDefaults(
  prefixPath: string,
  runtimePath?: string,
  commonRedistPath?: string,
  onProgress?: (msg: string) => void,
  gameInstallPath?: string  // 🆕 Path to game for requirement detection
): Promise<boolean> {
  try {
    if (!isLinux()) return false
    fs.mkdirSync(prefixPath, { recursive: true })
    const resolved = resolveCompatDataPaths(prefixPath, true)
    const compatDataPath = resolved.compatDataPath
    const winePrefix = resolved.winePrefix

    const protonPath = runtimePath || findProtonRuntime()
    const { runner, protonDir } = getProtonRunner(protonPath)
    if (!runner) {
      console.error('[Proton] No Proton runner found!')
      return false
    }

    const steamRoot = findSteamRoot()

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WINEPREFIX: winePrefix,
      STEAM_COMPAT_DATA_PATH: compatDataPath,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
      WINEDEBUG: '-all',
      WINEDLLOVERRIDES: 'winemenubuilder.exe=d;mscoree,mshtml='
    }

    const prevMeta = readDefaultDepsMeta(compatDataPath)
    const prevSchema = typeof prevMeta?.schema === 'number' ? prevMeta.schema : 0
    const runtimeMismatch = !!(prevMeta?.proton && prevMeta.proton !== runner)

    const meta: DefaultDepsMeta = {
      schema: DEFAULT_DEPS_SCHEMA,
      initialized: prevMeta?.initialized || nowIso(),
      updatedAt: nowIso(),
      proton: runner,
      winebootDone: prevSchema === DEFAULT_DEPS_SCHEMA && !runtimeMismatch ? prevMeta?.winebootDone === true : false,
      vcredist: prevSchema === DEFAULT_DEPS_SCHEMA && !runtimeMismatch
        ? (prevMeta?.vcredist || { attempts: 0, ok: null, tool: null })
        : { attempts: 0, ok: null, tool: null },
      dotnet: prevSchema === DEFAULT_DEPS_SCHEMA && !runtimeMismatch
        ? (prevMeta?.dotnet || { attempts: 0, ok: null, tool: null })
        : { attempts: 0, ok: null, tool: null },
      winetricks: prevMeta?.winetricks,
      protontricks: prevMeta?.protontricks
    }

    // 🆕 STEAM-LIKE: Detect game requirements if game path provided
    let detectedReqs: GameRequirements | null = null
    let useSmartInstall = false

    if (gameInstallPath && fs.existsSync(gameInstallPath)) {
      onProgress?.('Analisando requisitos do jogo...')
      detectedReqs = detectGameRequirements(gameInstallPath)
      useSmartInstall = detectedReqs.detected.length > 0

      if (useSmartInstall) {
        console.log('[Proton] 🎯 Smart install mode: detected', detectedReqs.detected.length, 'requirements')
      }
    }

    const shouldAttempt = (attempts: number | undefined, max: number) => (attempts || 0) < max

    const canVcredist = winetricksAvailable()
    const needsVcredist = meta.vcredist?.ok !== true
    const shouldVcredist = needsVcredist && canVcredist && shouldAttempt(meta.vcredist?.attempts, 2)
    const shouldDotnet = detectedReqs?.dotnet && detectedReqs.dotnet.length > 0

    if (meta.winebootDone && !needsVcredist && !shouldDotnet && prevSchema === DEFAULT_DEPS_SCHEMA && !runtimeMismatch) {
      console.log('[Proton] Prefix dependencies already satisfied; nothing to do')
      return true
    }

    console.log('[Proton] ========================================')
    console.log('[Proton] Initializing game prefix:', compatDataPath)
    console.log('[Proton] Using Proton:', runner)
    console.log('[Proton] Steam root:', steamRoot)
    console.log('[Proton] Smart install:', useSmartInstall ? 'enabled' : 'disabled (fallback mode)')
    if (useSmartInstall && detectedReqs) {
      console.log('[Proton] Detected requirements:', detectedReqs.detected.join(', '))
    }
    console.log('[Proton] ========================================')

    // Step 1: Initialize Wine prefix (only once per prefix)
    if (!meta.winebootDone) {
      // Kill any previous wineserver for this prefix (common when switching Proton versions).
      try {
        await runProtonTool(runner, env, ['wineserver', '-k'], 15_000, '[wineserver]')
        await runProtonTool(runner, env, ['wineserver', '-w'], 15_000, '[wineserver]')
      } catch {
        // ignore
      }

      onProgress?.('Initializing Wine prefix...')
      console.log('[Proton] Step 1: Initializing Wine prefix...')

      await new Promise<void>((resolve) => {
        const p = spawn(runner, ['run', 'wineboot', '-u'], { 
          env, 
          stdio: ['ignore', 'pipe', 'pipe'] 
        })
        p.stdout?.on('data', (d: Buffer) => console.log('[wineboot]', d.toString().trim()))
        p.stderr?.on('data', (d: Buffer) => console.log('[wineboot]', d.toString().trim()))
        p.on('close', () => resolve())
        p.on('error', () => resolve())
        setTimeout(() => { try { p.kill() } catch {}; resolve() }, 60000)
      })
      meta.winebootDone = true
      meta.updatedAt = nowIso()
      writeDefaultDepsMeta(compatDataPath, meta)
      console.log('[Proton] ✅ Wine prefix initialized')
    } else {
      console.log('[Proton] Prefix already bootstrapped; skipping wineboot')
    }

    // 🆕 STEAM-LIKE: Smart dependency installation based on detected requirements
    if (useSmartInstall && detectedReqs && winetricksAvailable()) {
      // Convert detected requirements to winetricks components
      const smartComponents = requirementsToWinetricks(detectedReqs)

      if (smartComponents.length > 0) {
        onProgress?.(`Instalando ${smartComponents.length} dependências detectadas...`)
        console.log('[Proton] Step 2: Smart install - installing detected dependencies:', smartComponents)

        meta.vcredist = {
          attempts: (meta.vcredist?.attempts || 0) + 1,
          lastAttemptAt: nowIso(),
          tool: 'winetricks',
          ok: null
        }
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)

        const ok = await runWinetricks(runner, compatDataPath, smartComponents, env, onProgress, protonDir)
        meta.vcredist.ok = ok
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)

        if (ok) {
          console.log('[Proton] ✅ Smart install completed successfully')
        } else {
          console.warn('[Proton] ⚠️ Some smart install components may have failed')
        }
      }

      // Install .NET only if detected
      if (detectedReqs.dotnet.length > 0 && protontricksAvailable()) {
        onProgress?.(`Instalando .NET (${detectedReqs.dotnet.join(', ')})...`)
        console.log('[Proton] Step 3: Installing detected .NET versions:', detectedReqs.dotnet)

        const dotnetOk = await runProtontricks(compatDataPath, detectedReqs.dotnet, env, onProgress)
        meta.dotnet = {
          attempts: (meta.dotnet?.attempts || 0) + 1,
          lastAttemptAt: nowIso(),
          tool: 'protontricks',
          ok: dotnetOk
        }
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)
      }

    } else {
      // FALLBACK MODE: Install basic dependencies if smart detection wasn't available

      // Step 2: Install VC++ Runtimes via winetricks (prefix is compatible with Proton)
      if (meta.vcredist?.ok !== true && winetricksAvailable() && shouldAttempt(meta.vcredist?.attempts, 2)) {
        meta.vcredist = {
          attempts: (meta.vcredist?.attempts || 0) + 1,
          lastAttemptAt: nowIso(),
          tool: 'winetricks',
          ok: null
        }
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)

        onProgress?.('Installing Visual C++ Runtimes...')
        console.log('[Proton] Step 2 (fallback): Installing VC++ Runtimes via winetricks...')

        // Only install basic prerequisites in fallback mode (faster)
        const ok = await runWinetricks(runner, compatDataPath, COMMON_PREREQUISITES.winetricks, env, onProgress, protonDir)
        meta.vcredist.ok = ok
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)
      } else if (!winetricksAvailable()) {
        onProgress?.('Dependências VC++: winetricks não encontrado')
        console.log('[Proton] ⚠️ winetricks not installed - skipping VC++ runtimes')
        console.log('[Proton] CachyOS/Arch: sudo pacman -S winetricks')
      } else if (meta.vcredist?.ok === true) {
        console.log('[Proton] VC++ runtimes already installed; skipping')
      }

      // Step 3: Skip extras in fallback mode (they take too long and may not be needed)
      // Games that need these should be detected by smart install
      console.log('[Proton] Skipping extras in fallback mode (use smart install for full dependencies)')
    }

    // Optional Step: install game-bundled installers if requested
    try {
      if (commonRedistPath && fs.existsSync(commonRedistPath)) {
        onProgress?.('Aplicando redistribuíveis do jogo (se houver)...')
        await runCommonRedistInstallers(commonRedistPath, runner, env, onProgress)
      }
    } catch (err) {
      console.warn('[Proton] Failed to run CommonRedist installers:', err)
    }

    console.log('[Proton] ========================================')
    console.log('[Proton] ✅ Prefix initialization complete!')
    console.log('[Proton] ========================================')
    
    return true
  } catch (err) {
    console.error('[Proton] ensurePrefixDefaults failed:', err)
    return false
  }
}

// =====================================================
// FUNÇÃO PARA INSTALAR REQUISITOS EXTRAS
// =====================================================

export async function installExtraComponents(
  prefixPath: string,
  components: string[],
  onProgress?: (msg: string) => void
): Promise<boolean> {
  if (!isLinux()) return false
  
  const allowMigrate = prefixPath.startsWith(DEFAULT_PREFIX_DIR)
  const { compatDataPath, winePrefix } = resolveCompatDataPaths(prefixPath, allowMigrate)
  const steamRoot = findSteamRoot()

  const protonPath = findProtonRuntime()
  const { runner, protonDir } = getProtonRunner(protonPath)
  if (!runner) return false

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WINEPREFIX: winePrefix,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
  }

  console.log('[Proton] Installing extra components:', components)
  await runWinetricks(runner, compatDataPath, components, env, onProgress, protonDir)
  
  return true
}