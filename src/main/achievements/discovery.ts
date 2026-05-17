import fs from 'fs'
import path from 'path'
import type { GameAchievementSource, GameMetaForAchievements } from './types'
import { candidateAchievementPaths, guessWindowsPaths, normalizeObjectId, wineUserPaths } from './paths'

const ACHIEVEMENT_FILE_NAMES = new Set([
  'achievements.json',
  'achievements.ini',
  'achiev.ini',
  'user_stats.ini',
  'creamapi.achievements.cfg',
  'achievement'
])

const SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'shadercache',
  'cache',
  'temp',
  'tmp',
  'logs',
  'log',
  'crashdumps',
  'screenshots',
  'movies',
  'video',
  'videos'
])

function kindForPath(p: string): GameAchievementSource['kind'] {
  const base = path.basename(p).toLowerCase()
  const full = p.replace(/\\/g, '/').toLowerCase()

  if (base === 'creamapi.achievements.cfg') return 'creamapi_cfg'
  if (base === 'achievement') return 'razor1911_txt'

  if (base === 'achievements.json') {
    if (full.includes('/empress/')) return 'empress_json'
    return 'goldberg_json'
  }

  if (base === 'achievements.ini') {
    if (full.includes('/onlinefix/')) return 'onlinefix_ini'
    if (full.includes('/steam/codex/')) return 'codex_ini'
    if (full.includes('/steam/rune/')) return 'rune_ini'
    if (full.includes('/rld!/')) return 'rld_ini'
    if (full.includes('/rle/')) return 'rle_ini'
    if (full.includes('/smartsteamemu/')) return 'smartsteamemu_ini'
    if (full.includes('/3dmgame/')) return '_3dm_ini'
    return 'exe_relative_ini'
  }

  if (base === 'achiev.ini') {
    if (full.includes('/skidrow/') || full.includes('/documents/player/')) return 'skidrow_ini'
    return 'steamemu_achiev_ini'
  }

  if (base === 'user_stats.ini') return 'userstats_ini'
  if (base === 'user_stats.ini') return 'userstats_ini'
  return 'exe_relative_ini'
}

function labelForKind(kind: GameAchievementSource['kind']) {
  switch (kind) {
    case 'goldberg_json':
      return 'Goldberg (achievements.json)'
    case 'empress_json':
      return 'EMPRESS (achievements.json)'
    case 'onlinefix_ini':
      return 'OnlineFix (Achievements.ini)'
    case 'codex_ini':
      return 'CODEX (achievements.ini)'
    case 'rune_ini':
      return 'RUNE (achievements.ini)'
    case 'rld_ini':
      return 'RLD! (achievements.ini)'
    case 'rle_ini':
      return 'RLE (achievements.ini)'
    case 'skidrow_ini':
      return 'SKIDROW (achiev.ini)'
    case 'userstats_ini':
      return 'user_stats.ini'
    case '_3dm_ini':
      return '3DMGAME (achievements.ini)'
    case 'smartsteamemu_ini':
      return 'SmartSteamEmu (Achievements.ini)'
    case 'steamemu_achiev_ini':
      return 'SteamEmu (achiev.ini)'
    case 'creamapi_cfg':
      return 'CreamAPI (Achievements.cfg)'
    case 'razor1911_txt':
      return 'RAZOR1911 (achievement)'
    case 'exe_relative_ini':
      return 'Crack (ini)'
    default:
      return 'Achievements'
  }
}

function listAchievementFiles(root: string, maxDepth: number, maxEntries = 1200): string[] {
  const start = String(root || '').trim()
  if (!start) return []

  const out: string[] = []
  let visited = 0

  const visit = (dir: string, depth: number) => {
    if (visited >= maxEntries || depth > maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    visited += entries.length

    for (const entry of entries) {
      if (visited >= maxEntries) break
      const fullPath = path.join(dir, entry.name)

      if (entry.isFile()) {
        if (ACHIEVEMENT_FILE_NAMES.has(entry.name.toLowerCase())) out.push(fullPath)
        continue
      }

      if (entry.isDirectory() && depth < maxDepth) {
        const lower = entry.name.toLowerCase()
        if (SCAN_SKIP_DIRS.has(lower)) continue
        visit(fullPath, depth + 1)
      }
    }
  }

  try {
    const stat = fs.statSync(start)
    if (stat.isFile()) return ACHIEVEMENT_FILE_NAMES.has(path.basename(start).toLowerCase()) ? [start] : []
    if (!stat.isDirectory()) return []
  } catch {
    return []
  }

  visit(start, 0)
  return out
}

function scanRootsForMeta(meta: GameMetaForAchievements): string[] {
  const installPath = meta.installPath ? String(meta.installPath) : ''
  const exePath = meta.executablePath ? String(meta.executablePath) : ''
  const exeDir = exePath ? path.dirname(exePath) : ''
  const objectId = normalizeObjectId(meta.schemaSteamAppId || meta.steamAppId || null)
  const roots: string[] = []

  for (const base of [exeDir, installPath]) {
    if (!base) continue
    roots.push(path.join(base, 'steam_settings'))
    roots.push(path.join(base, 'SteamData'))
    roots.push(path.join(base, '3DMGAME'))
  }

  if (objectId && process.platform === 'win32') {
    const { appData, localAppData, programData, publicDocuments, documents } = guessWindowsPaths()
    roots.push(
      path.win32.join(appData, 'Goldberg SteamEmu Saves', objectId),
      path.win32.join(appData, 'GSE Saves', objectId),
      path.win32.join(publicDocuments, 'OnlineFix', objectId),
      path.win32.join(publicDocuments, 'Steam', 'CODEX', objectId),
      path.win32.join(publicDocuments, 'Steam', 'RUNE', objectId),
      path.win32.join(programData, 'RLD!', objectId),
      path.win32.join(programData, 'Steam', 'Player', objectId),
      path.win32.join(programData, 'Steam', 'RLD!', objectId),
      path.win32.join(programData, 'Steam', 'dodi', objectId),
      path.win32.join(appData, 'RLE', objectId),
      path.win32.join(appData, 'CreamAPI', objectId),
      path.win32.join(appData, 'EMPRESS', 'remote', objectId),
      path.win32.join(publicDocuments, 'EMPRESS', objectId),
      path.win32.join(appData, '.1911', objectId),
      path.win32.join(documents, 'SKIDROW', objectId),
      path.win32.join(documents, 'Player', objectId),
      path.win32.join(localAppData, 'SKIDROW', objectId),
      path.win32.join(appData, 'SmartSteamEmu', objectId)
    )
  }

  if (objectId && process.platform !== 'win32' && meta.protonPrefix) {
    for (const u of wineUserPaths(meta.protonPrefix)) {
      roots.push(
        path.join(u.appDataRoaming, 'Goldberg SteamEmu Saves', objectId),
        path.join(u.appDataRoaming, 'GSE Saves', objectId),
        path.join(u.publicDocuments, 'OnlineFix', objectId),
        path.join(u.publicDocuments, 'Steam', 'CODEX', objectId),
        path.join(u.appDataRoaming, 'Steam', 'CODEX', objectId),
        path.join(u.publicDocuments, 'Steam', 'RUNE', objectId),
        path.join(u.appDataRoaming, 'Steam', 'RUNE', objectId),
        path.join(u.programData, 'RLD!', objectId),
        path.join(u.programData, 'Steam', 'Player', objectId),
        path.join(u.programData, 'Steam', 'RLD!', objectId),
        path.join(u.programData, 'Steam', 'dodi', objectId),
        path.join(u.appDataRoaming, 'RLE', objectId),
        path.join(u.appDataRoaming, 'CreamAPI', objectId),
        path.join(u.appDataRoaming, 'EMPRESS', 'remote', objectId),
        path.join(u.publicDocuments, 'EMPRESS', objectId),
        path.join(u.appDataRoaming, '.1911', objectId),
        path.join(u.documents, 'SKIDROW', objectId),
        path.join(u.documents, 'Player', objectId),
        path.join(u.localAppData, 'SKIDROW', objectId),
        path.join(u.appDataRoaming, 'SmartSteamEmu', objectId)
      )
    }
  }

  return Array.from(new Set(roots.filter(Boolean)))
}

export function discoverAchievementSources(meta: GameMetaForAchievements): GameAchievementSource[] {
  const objectId = meta.schemaSteamAppId || meta.steamAppId || null
  const candidates = candidateAchievementPaths({
    installPath: meta.installPath || null,
    executablePath: meta.executablePath || null,
    objectId,
    protonPrefix: meta.protonPrefix || null
  })

  const found: GameAchievementSource[] = []
  const scannedFiles: string[] = []

  for (const root of scanRootsForMeta(meta)) {
    scannedFiles.push(...listAchievementFiles(root, 4))
  }

  for (const p of [...candidates, ...scannedFiles]) {
    try {
      if (!fs.existsSync(p)) continue
      const stat = fs.statSync(p)
      if (!stat.isFile() && !stat.isDirectory()) continue
      const kind = kindForPath(p)
      found.push({ kind, label: labelForKind(kind), path: p, isDirectory: stat.isDirectory() })
    } catch {
      // ignore
    }
  }

  // Prioritize more specific sources first
  const order: Record<string, number> = {
    onlinefix_ini: 10,
    goldberg_json: 20,
    smartsteamemu_ini: 30,
    steamemu_achiev_ini: 40,
    exe_relative_ini: 50
  }
  found.sort((a, b) => (order[a.kind] || 999) - (order[b.kind] || 999))

  // De-dupe by path
  const seen = new Set<string>()
  return found.filter((s) => {
    if (seen.has(s.path)) return false
    seen.add(s.path)
    return true
  })
}
