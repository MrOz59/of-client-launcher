import fs from 'fs'
import os from 'os'
import path from 'path'

export type OverlayStore = 'steam' | 'epic' | 'unknown'
export type SelectedOverlay = 'steam' | 'eos' | 'none'

export type OnlineFixOverlayIdentity = {
  found?: boolean
  steamAppId?: string | null
  fakeAppId?: string | null
  realAppId?: string | null
  epicProductId?: string | null
}

export type OverlayCompatibilityPolicy = {
  store: OverlayStore
  selectedOverlay: SelectedOverlay
  enableSteamOverlay: boolean
  enableEosOverlay: boolean
  steamOverlayAppId: string | null
  realSteamAppId: string | null
  configuredSteamAppId: string | null
  detectedSteamAppId: string | null
  epicProductId: string | null
  markers: {
    steam: string[]
    epic: string[]
  }
  reason: string
  warnings: string[]
}

export type DisplayCompatibilityInfo = {
  sessionType: string | null
  display: string | null
  waylandDisplay: string | null
  isWayland: boolean
  isGamescope: boolean
  gamescopePid: number | null
  warnings: string[]
}

export function normalizeSteamId(value?: string | number | null): string | null {
  const s = String(value ?? '').trim()
  if (!s || !/^\d+$/.test(s) || s === '0') return null
  return s
}

function resolvePath(p: string): string {
  try {
    return path.resolve(p)
  } catch {
    return p
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function scanStoreMarkers(installPath?: string | null) {
  const root = String(installPath || '').trim()
  const markers = { steam: [] as string[], epic: [] as string[] }
  if (!root || !dirExists(root)) return markers

  const steamNames = new Set([
    'steam_appid.txt',
    'steam_api.dll',
    'steam_api64.dll',
    'steamclient.dll',
    'steamclient64.dll'
  ])
  const epicNames = new Set([
    'eossdk-win32-shipping.dll',
    'eossdk-win64-shipping.dll',
    'eosovh-win32-shipping.dll',
    'eosovh-win64-shipping.dll',
    'eosoverlayrenderer-win32-shipping.exe',
    'eosoverlayrenderer-win64-shipping.exe',
    'epiconlineservices.exe'
  ])

  const maxDepth = 4
  const maxEntries = 6000
  let seen = 0

  function add(kind: 'steam' | 'epic', p: string) {
    const rel = path.relative(root, p) || path.basename(p)
    if (!markers[kind].includes(rel)) markers[kind].push(rel)
  }

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || seen > maxEntries) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const ent of entries) {
      if (++seen > maxEntries) return
      const full = path.join(dir, ent.name)
      const lower = ent.name.toLowerCase()

      if (ent.isFile()) {
        if (steamNames.has(lower)) add('steam', full)
        if (epicNames.has(lower) || lower.startsWith('epiconlineservices')) add('epic', full)
        continue
      }

      if (!ent.isDirectory() || depth >= maxDepth) continue
      if (['movies', 'videos', 'localization', 'content', 'paks', 'pakchunk', 'shadercache'].includes(lower)) continue
      walk(full, depth + 1)
      if (seen > maxEntries) return
    }
  }

  walk(root, 0)
  return markers
}

export function detectOverlayStore(installPath?: string | null, onlineFix?: OnlineFixOverlayIdentity): {
  store: OverlayStore
  markers: { steam: string[]; epic: string[] }
  reason: string
} {
  const markers = scanStoreMarkers(installPath)
  const epicProductId = String(onlineFix?.epicProductId || '').trim()
  const steamId = normalizeSteamId(onlineFix?.fakeAppId) || normalizeSteamId(onlineFix?.steamAppId) || normalizeSteamId(onlineFix?.realAppId)

  if (epicProductId) {
    return { store: 'epic', markers, reason: `OnlineFix.ini contém Epic Product ID (${epicProductId}).` }
  }

  if (markers.epic.length > 0 && markers.steam.length === 0) {
    return { store: 'epic', markers, reason: `Arquivos EOS detectados (${markers.epic.slice(0, 2).join(', ')}).` }
  }

  if (steamId) {
    return { store: 'steam', markers, reason: `OnlineFix.ini contém Steam AppID (${steamId}).` }
  }

  if (markers.steam.length > 0 && markers.epic.length === 0) {
    return { store: 'steam', markers, reason: `Arquivos Steamworks detectados (${markers.steam.slice(0, 2).join(', ')}).` }
  }

  if (markers.epic.length > 0 && markers.steam.length > 0) {
    return { store: 'epic', markers, reason: 'Arquivos Steamworks e EOS detectados; EOS tem prioridade para evitar injetar overlay Steam em jogo Epic.' }
  }

  return { store: 'unknown', markers, reason: 'Nenhum marcador confiável de Steam/Epic encontrado.' }
}

export function resolveOverlayCompatibility(input: {
  installPath?: string | null
  onlineFix?: OnlineFixOverlayIdentity
  configuredSteamAppId?: string | number | null
  detectedSteamAppId?: string | number | null
  protonOptions?: any
}): OverlayCompatibilityPolicy {
  const onlineFix = input.onlineFix || {}
  const storeDetection = detectOverlayStore(input.installPath, onlineFix)
  const configuredSteamAppId = normalizeSteamId(input.configuredSteamAppId)
  const detectedSteamAppId = normalizeSteamId(input.detectedSteamAppId)
  const fakeAppId = normalizeSteamId(onlineFix.fakeAppId)
  const iniSteamAppId = normalizeSteamId(onlineFix.steamAppId)
  const realSteamAppId = normalizeSteamId(onlineFix.realAppId) || configuredSteamAppId || detectedSteamAppId
  const steamOverlayAppId = fakeAppId || iniSteamAppId || realSteamAppId
  const epicProductId = String(onlineFix.epicProductId || '').trim() || null
  const steamOverlayAllowed = input.protonOptions?.steamOverlay !== false
  const selectedOverlay: SelectedOverlay =
    storeDetection.store === 'epic'
      ? 'eos'
      : storeDetection.store === 'steam' && steamOverlayAllowed && Boolean(steamOverlayAppId)
        ? 'steam'
        : 'none'

  const warnings: string[] = []
  if (storeDetection.store === 'steam' && !steamOverlayAllowed) {
    warnings.push('Overlay Steam desativado nas opções Proton deste jogo.')
  }
  if (storeDetection.store === 'steam' && steamOverlayAllowed && !steamOverlayAppId) {
    warnings.push('Jogo parece Steam, mas nenhum AppID confiável foi encontrado para o overlay.')
  }
  if (storeDetection.store === 'epic' && steamOverlayAppId) {
    warnings.push('AppID Steam foi ignorado porque o jogo foi classificado como Epic/EOS.')
  }
  if (storeDetection.store === 'unknown') {
    warnings.push('Sem loja detectada; o launcher não vai injetar overlay Steam nem EOS automaticamente.')
  }

  return {
    store: storeDetection.store,
    selectedOverlay,
    enableSteamOverlay: selectedOverlay === 'steam',
    enableEosOverlay: selectedOverlay === 'eos',
    steamOverlayAppId,
    realSteamAppId,
    configuredSteamAppId,
    detectedSteamAppId,
    epicProductId,
    markers: storeDetection.markers,
    reason: storeDetection.reason,
    warnings
  }
}

export function getDisplayCompatibilityInfo(env: NodeJS.ProcessEnv = process.env): DisplayCompatibilityInfo {
  const sessionType = String(env.XDG_SESSION_TYPE || '').trim().toLowerCase() || null
  const waylandDisplay = String(env.WAYLAND_DISPLAY || '').trim() || null
  const display = String(env.DISPLAY || '').trim() || null
  const isWayland = sessionType === 'wayland' || Boolean(waylandDisplay)
  let gamescopePid: number | null = null

  try {
    for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
      try {
        const comm = fs.readFileSync(path.join('/proc', entry.name, 'comm'), 'utf8').trim().toLowerCase()
        if (comm === 'gamescope' || comm === 'gamescope-wl') {
          gamescopePid = Number(entry.name)
          break
        }
      } catch {
        // process can exit while scanning
      }
    }
  } catch {
    // /proc is Linux-specific
  }

  const isGamescope = Boolean(gamescopePid || env.GAMESCOPE_WAYLAND_DISPLAY || env.GAMESCOPE_COMMAND)
  const warnings: string[] = []
  if (isWayland) warnings.push('Sessão Wayland detectada; overlays podem depender de Vulkan layer e compositor.')
  if (isGamescope) warnings.push('Gamescope detectado; integração de overlay pode mudar conforme o backend e flags usadas.')

  return { sessionType, display, waylandDisplay, isWayland, isGamescope, gamescopePid, warnings }
}

export function eosOverlayCandidates(userDataPath?: string | null): string[] {
  const home = os.homedir()
  const candidates = [
    userDataPath ? path.join(userDataPath, 'tools', 'eos_overlay') : '',
    path.join(home, '.config', 'heroic', 'tools', 'eos_overlay'),
    path.join(home, '.config', 'legendary', 'overlay'),
    path.join(home, '.config', 'legendary', 'eos_overlay'),
    path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'tools', 'eos_overlay')
  ]
  const seen = new Set<string>()
  return candidates
    .filter(Boolean)
    .map(resolvePath)
    .filter(p => {
      if (!p || seen.has(p)) return false
      seen.add(p)
      return true
    })
}

export function isEosOverlayPathValid(p?: string | null): boolean {
  const root = String(p || '').trim()
  if (!root || !dirExists(root)) return false
  return (
    fileExists(path.join(root, 'EOSOverlayRenderer-Win64-Shipping.exe')) ||
    fileExists(path.join(root, 'EOSOverlayRenderer-Win32-Shipping.exe')) ||
    fileExists(path.join(root, 'EOSOVH-Win64-Shipping.dll')) ||
    fileExists(path.join(root, 'EOSOVH-Win32-Shipping.dll'))
  )
}

export function findEosOverlayInstallPath(userDataPath?: string | null): string | null {
  for (const candidate of eosOverlayCandidates(userDataPath)) {
    if (isEosOverlayPathValid(candidate)) return candidate
  }
  return null
}
