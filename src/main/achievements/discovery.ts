import fs from 'fs'
import path from 'path'
import type { GameAchievementSource, GameMetaForAchievements } from './types'
import { candidateAchievementPaths } from './paths'

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

export function discoverAchievementSources(meta: GameMetaForAchievements): GameAchievementSource[] {
  const objectId = meta.schemaSteamAppId || meta.steamAppId || null
  const candidates = candidateAchievementPaths({
    installPath: meta.installPath || null,
    executablePath: meta.executablePath || null,
    objectId,
    protonPrefix: meta.protonPrefix || null
  })

  const found: GameAchievementSource[] = []

  for (const p of candidates) {
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
