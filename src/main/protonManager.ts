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

type DefaultDepsMeta = {
  schema?: number
  initialized?: string
  updatedAt?: string
  proton?: string
  winebootDone?: boolean
  vcredist?: {
    attempts?: number
    lastAttemptAt?: string
    tool?: 'protontricks' | 'winetricks' | null
    ok?: boolean | null
  }
  dotnet?: {
    attempts?: number
    lastAttemptAt?: string
    tool?: 'protontricks' | null
    ok?: boolean | null
  }
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

export async function ensureGamePrefixFromDefault(
  gameSlug: string,
  runtimePath?: string,
  _commonRedistPath?: string,
  forceRecreate?: boolean,
  onProgress?: (msg: string) => void
) {
  const taskKey = `${gameSlug}::${runtimePath || 'auto'}::${forceRecreate ? 'recreate' : 'keep'}`
  const existing = inFlightGamePrefix.get(taskKey)
  if (existing) return existing

  const task = (async () => {
    onProgress?.('Preparando prefixo do jogo...')

    const gamePrefix = getManagedPrefixPath(gameSlug, runtimePath)

    // ✅ Default prefix NÃO deve ser necessário pra rodar o jogo.
    // Ele vira apenas uma otimização: se existir e estiver válido, a gente clona.
    const defaultPrefixCandidate = getManagedPrefixPath(DEFAULT_PREFIX_NAME, runtimePath)
    const defaultMeta = readDefaultDepsMeta(defaultPrefixCandidate)
    const defaultLooksValid = !!defaultMeta && (defaultMeta.schema === DEFAULT_DEPS_SCHEMA || !!defaultMeta.initialized)

    const meta = readDefaultDepsMeta(gamePrefix)
    const hasSentinel = !!meta && (meta.schema === DEFAULT_DEPS_SCHEMA || !!meta.initialized)
    const desiredRunner = getRunnerForRuntime(runtimePath) || undefined
    const runtimeMismatch = !!(meta?.proton && desiredRunner && meta.proton !== desiredRunner)
    if (runtimeMismatch) {
      console.log('[Proton] Game prefix runtime changed, recreating:', meta?.proton, '->', desiredRunner)
    }

    if (forceRecreate || !fs.existsSync(gamePrefix) || !hasSentinel || runtimeMismatch) {
      onProgress?.('Criando/atualizando prefixo do jogo...')

      // REMOVIDO: Não tenta clonar do default para evitar mistura com saves/default.
      // Sempre inicializa do zero para independência total.
      // Se quiser reativar, descomente:
      // let ok = false
      // if (defaultLooksValid && fs.existsSync(defaultPrefixCandidate)) {
      //   ok = await clonePrefix(defaultPrefixCandidate, gamePrefix)
      // }
      // if (!ok) {
        await ensurePrefixDefaults(gamePrefix, runtimePath, undefined, onProgress)
      // }
    }

    // Ensure base deps are applied/upgraded (handles old sentinel schema or previous failures).
    if (forceRecreate) {
      const { compatDataPath } = resolveCompatDataPaths(gamePrefix, true)
      resetVcredistState(compatDataPath)
    }

    // Run prefix initialization and common vcredist steps.
    await ensurePrefixDefaults(gamePrefix, runtimePath, undefined, onProgress)

    // If the game package includes an _CommonRedist folder, attempt to run its installers
    // inside the game prefix (DirectX / bundled vcredist). This helps games that ship their
    // own redistributables instead of relying on winetricks.
    try {
      if (_commonRedistPath) {
        onProgress?.('Aplicando redistribuíveis do jogo (se houver)...')
        await ensureGameCommonRedists(_commonRedistPath, gamePrefix, runtimePath, onProgress)
      }
    } catch (err) {
      console.warn('[Proton] Failed to run game _CommonRedist installers:', err)
    }

    // Verification: ensure essential files exist in the winePrefix/system32 after initialization.
    try {
      const { winePrefix } = resolveCompatDataPaths(gamePrefix, true)
      const sys32 = path.join(winePrefix, 'drive_c', 'windows', 'system32')
      const essentials = [
        'wineboot.exe', // wine runtime helper
        'vcruntime140.dll', // common VC runtime
        'msvcp140.dll'
      ]

      const missing = essentials.filter(e => !fs.existsSync(path.join(sys32, e)))
      if (missing.length) {
        console.warn('[Proton] Missing essential files in game prefix system32:', missing)
        onProgress?.('Detectados arquivos essenciais ausentes no prefixo; tentando reparar...')

        // Try one more time to initialize (run wineboot + winetricks) to fix missing runtime bits.
        const repaired = await ensurePrefixDefaults(gamePrefix, runtimePath, undefined, onProgress)
        if (repaired) {
          const stillMissing = essentials.filter(e => !fs.existsSync(path.join(sys32, e)))
          if (stillMissing.length) {
            console.warn('[Proton] Reparação incompleta, arquivos ainda ausentes:', stillMissing)
            onProgress?.('Falha ao reparar todos os arquivos essenciais do prefixo; verifique winetricks/proton runtime')
          } else {
            console.log('[Proton] Reparação bem-sucedida; arquivos essenciais presentes')
            onProgress?.('Prefixo reparado com sucesso')
          }
        } else {
          console.warn('[Proton] ensurePrefixDefaults failed during repair attempt')
          onProgress?.('Não foi possível reparar o prefixo automaticamente')
        }
      }
    } catch (err) {
      console.warn('[Proton] Failed to verify/repair game prefix system32:', err)
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
  // Many OnlineFix/Steamless games require native steam_api(64) and sometimes native winmm.
  // Keep this conservative (prefer native, fallback builtin for winmm only).
  const baseDllOverrides = 'steam_api=n;steam_api64=n;winmm=n,b;OnlineFix=n;OnlineFix64=n;SteamOverlay=n;SteamOverlay64=n'
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
  const baseArgs = runner ? ['run', exePath, ...args, ...extraArgs] : [exePath, ...args, ...extraArgs]

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

// Lista de pré-requisitos comuns para jogos Windows
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

// ✅ MELHORIA: winetricks agora tenta rodar via "proton run" e, se falhar,
// usa fallback com overrides corretos (WINE/WINESERVER + LD_LIBRARY_PATH do Proton).
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

  const winePrefix = typeof env.WINEPREFIX === 'string' && env.WINEPREFIX.trim() !== ''
    ? String(env.WINEPREFIX)
    : path.join(prefixCompatDataPath, 'pfx')

  let okAll = true

  for (const component of components) {
    try {
      onProgress?.(`Installing ${component} via winetricks...`)
      console.log(`[Proton] Installing ${component} via winetricks...`)

      // 1) Primeira tentativa: rodar winetricks "por dentro" do Proton (pode falhar em algumas distros/Protons)
      const attemptProtonRun = await new Promise<number | null>((resolve) => {
        const proc = spawn(
          runner,
          ['run', winetricksCmd, '--force', '-q', component],
          {
            env: {
              ...env,
              STEAM_COMPAT_DATA_PATH: prefixCompatDataPath,
              WINETRICKS_NONINTERACTIVE: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )

        proc.stdout?.on('data', (data: Buffer) => console.log(`[winetricks/proton-run] ${data.toString().trim()}`))
        proc.stderr?.on('data', (data: Buffer) => console.log(`[winetricks/proton-run] ${data.toString().trim()}`))

        proc.on('close', (code) => resolve(typeof code === 'number' ? code : null))
        proc.on('error', () => resolve(null))

        const t = setTimeout(() => {
          try { proc.kill() } catch {}
          resolve(null)
        }, 5 * 60 * 1000)

        proc.on('close', () => clearTimeout(t))
        proc.on('error', () => clearTimeout(t))
      })

      if (attemptProtonRun === 0) {
        console.log(`[Proton] ✅ ${component} installed successfully (proton run)`)
        continue
      }

      // 2) Fallback robusto: chamar winetricks direto, mas com overrides completos do Proton
      const protonOverrides = getProtonWineOverrides(protonDir)
      const winetricksEnv: NodeJS.ProcessEnv = {
        ...env,
        ...protonOverrides,
        WINEPREFIX: winePrefix,
        STEAM_COMPAT_DATA_PATH: prefixCompatDataPath,
        WINETRICKS_NONINTERACTIVE: '1'
      }

      const attemptDirect = await new Promise<number | null>((resolve) => {
        const proc = spawn(winetricksCmd, ['--force', '-q', component], {
          env: winetricksEnv,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        proc.stdout?.on('data', (data: Buffer) => console.log(`[winetricks] ${data.toString().trim()}`))
        proc.stderr?.on('data', (data: Buffer) => console.log(`[winetricks] ${data.toString().trim()}`))

        proc.on('close', (code) => resolve(typeof code === 'number' ? code : null))
        proc.on('error', () => resolve(null))

        const t = setTimeout(() => {
          try { proc.kill() } catch {}
          resolve(null)
        }, 5 * 60 * 1000)

        proc.on('close', () => clearTimeout(t))
        proc.on('error', () => clearTimeout(t))
      })

      if (attemptDirect === 0) {
        console.log(`[Proton] ✅ ${component} installed successfully (fallback overrides)`)
      } else {
        console.warn(`[Proton] ⚠️ ${component} installation returned code ${attemptDirect}`)
        okAll = false
      }
    } catch (err) {
      console.warn(`[Proton] Failed to install ${component}:`, err)
      okAll = false
    }
  }

  return okAll
}

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

  let okAll = true
  for (const component of components) {
    try {
      onProgress?.(`Installing ${component} via protontricks...`)
      console.log(`[Proton] Installing ${component} via protontricks...`)
      
      await new Promise<void>((resolve) => {
        const proc = spawn(protontricksCmd, ['--no-steam', '-c', `winetricks -q ${component}`, prefixPath], {
          env: { ...env, STEAM_COMPAT_DATA_PATH: prefixPath, WINETRICKS_NONINTERACTIVE: '1' },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        
        proc.stdout?.on('data', (data: Buffer) => {
          console.log(`[protontricks] ${data.toString().trim()}`)
        })
        
        proc.stderr?.on('data', (data: Buffer) => {
          console.log(`[protontricks] ${data.toString().trim()}`)
        })
        
        proc.on('close', (code) => {
          if (code === 0) {
            console.log(`[Proton] ✅ ${component} installed via protontricks`)
          } else {
            console.warn(`[Proton] ⚠️ ${component} protontricks returned code ${code}`)
            okAll = false
          }
          resolve()
        })
        
        proc.on('error', () => {
          okAll = false
          resolve()
        })
        
        // Timeout after 10 minutes for .NET
        const t = setTimeout(() => {
          try { proc.kill() } catch {}
          okAll = false
          resolve()
        }, 10 * 60 * 1000)

        proc.on('close', () => clearTimeout(t))
        proc.on('error', () => clearTimeout(t))
      })
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
// FUNÇÃO PRINCIPAL DE INICIALIZAÇÃO DO PREFIXO
// =====================================================

export async function ensurePrefixDefaults(
  prefixPath: string, 
  runtimePath?: string, 
  commonRedistPath?: string,
  onProgress?: (msg: string) => void
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

    const shouldAttempt = (attempts: number | undefined, max: number) => (attempts || 0) < max

    const canVcredist = winetricksAvailable()
    const needsVcredist = meta.vcredist?.ok !== true
    const shouldVcredist = needsVcredist && canVcredist && shouldAttempt(meta.vcredist?.attempts, 2)
    const shouldDotnet = false
    if (meta.winebootDone && !needsVcredist && !shouldDotnet && prevSchema === DEFAULT_DEPS_SCHEMA && !runtimeMismatch) {
      console.log('[Proton] Prefix dependencies already satisfied; nothing to do')
      return true
    }

    console.log('[Proton] ========================================')
    console.log('[Proton] Initializing game prefix:', compatDataPath)
    console.log('[Proton] Using Proton:', runner)
    console.log('[Proton] Steam root:', steamRoot)
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
      console.log('[Proton] Step 2: Installing VC++ Runtimes via winetricks...')

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

    // Step 3: Install common extras (DirectX, d3dx9, etc.) via winetricks when available.
    if (winetricksAvailable()) {
      try {
        onProgress?.('Installing common extras (DirectX, d3dx9, etc.)...')
        console.log('[Proton] Installing common extras via winetricks')
        const extrasOk = await runWinetricks(runner, compatDataPath, COMMON_PREREQUISITES.winetricksExtras, env, onProgress, protonDir)
        if (!extrasOk) console.warn('[Proton] Some extras failed to install via winetricks')
      } catch (err) {
        console.warn('[Proton] Failed to install extras via winetricks:', err)
      }
    } else {
      console.log('[Proton] winetricks not available; skipping extras installation')
    }

    // Step 4: Install .NET via protontricks if available (safer than winetricks in Proton).
    if (protontricksAvailable()) {
      try {
        onProgress?.('Installing .NET via protontricks (if required)...')
        console.log('[Proton] Attempting .NET installation via protontricks')
        const dotnetOk = await runProtontricks(compatDataPath, COMMON_PREREQUISITES.protontricks, env, onProgress)
        meta.dotnet = meta.dotnet || { attempts: 0, ok: null, tool: null }
        meta.dotnet.attempts = (meta.dotnet.attempts || 0) + 1
        meta.dotnet.lastAttemptAt = nowIso()
        meta.dotnet.tool = 'protontricks'
        meta.dotnet.ok = dotnetOk
        meta.updatedAt = nowIso()
        writeDefaultDepsMeta(compatDataPath, meta)
      } catch (err) {
        console.warn('[Proton] Failed to install .NET via protontricks:', err)
      }
    } else {
      console.log('[Proton] protontricks not available; skipping .NET installation')
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