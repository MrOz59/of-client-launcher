import fs from 'fs'
import type { UnlockedAchievement, GameAchievementSourceKind, ParsedAchievement } from './types'

function asBool(v: string): boolean {
  const s = String(v || '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on' || s === 'unlocked' || s === 'earned'
}

function parseMaybeNumber(v: string): number | null {
  const n = Number(String(v || '').trim())
  return Number.isFinite(n) ? n : null
}

export function parseIniUnlocked(filePath: string, kind: GameAchievementSourceKind): UnlockedAchievement[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)

  let section = ''
  const sectionData: Record<string, Record<string, string>> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue

    const sec = trimmed.match(/^\[(.+?)\]$/)
    if (sec) {
      section = sec[1]
      if (!sectionData[section]) sectionData[section] = {}
      continue
    }

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()

    const key = k
    const val = v

    const bucket = sectionData[section || '__root__'] || (sectionData[section || '__root__'] = {})
    bucket[key] = val
  }

  const unlocks: UnlockedAchievement[] = []

  // OnlineFix style: sections per achievement with Achieved/Unlocked + optional time
  for (const [sec, data] of Object.entries(sectionData)) {
    const lowerKeys = Object.fromEntries(Object.entries(data).map(([k, v]) => [k.toLowerCase(), v])) as Record<string, string>

    const achieved = lowerKeys['achieved'] ?? lowerKeys['unlocked'] ?? lowerKeys['earned']
    if (achieved != null && asBool(achieved)) {
      const id = sec !== '__root__' ? sec : (lowerKeys['id'] || lowerKeys['name'] || '')
      if (id) {
        const tRaw = lowerKeys['unlocktime'] ?? lowerKeys['time'] ?? lowerKeys['timestamp']
        let unlockedAt: number | undefined
        const t = tRaw != null ? parseMaybeNumber(tRaw) : null
        if (t != null) {
          // If it looks like seconds, convert to ms
          unlockedAt = t < 2_000_000_000 ? t * 1000 : t
        }
        unlocks.push({
          id: String(id),
          name: lowerKeys['name'],
          description: lowerKeys['desc'] || lowerKeys['description'],
          unlockedAt,
          sourcePath: filePath,
          sourceKind: kind
        })
      }
    }
  }

  // SteamEmu/achiev.ini style: key=value pairs like ACH_XXX=1 or 0
  const root = sectionData['__root__'] || {}
  for (const [k, v] of Object.entries(root)) {
    const key = String(k)
    if (!key) continue
    if (!asBool(String(v))) continue
    // Filter out obvious non-achievement keys
    const low = key.toLowerCase()
    if (low === 'language' || low === 'user' || low === 'steamid' || low === 'version') continue
    unlocks.push({ id: key, sourcePath: filePath, sourceKind: kind })
  }

  // De-dupe by id
  const seen = new Set<string>()
  return unlocks.filter((u) => {
    const id = String(u.id || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function normalizeIniKeyName(k: string): string {
  return String(k || '').trim().toLowerCase()
}

function extractIniSectionId(sectionName: string, data: Record<string, string>): string {
  if (sectionName && sectionName !== '__root__') return sectionName
  const lowerKeys = Object.fromEntries(Object.entries(data).map(([k, v]) => [normalizeIniKeyName(k), v])) as Record<string, string>
  return String(lowerKeys['id'] || lowerKeys['api'] || lowerKeys['name'] || '').trim()
}

/**
 * Parses INI files that contain *all* achievements (not only unlocked ones).
 * Supports OnlineFix/CODEX/RUNE/RLD!/RLE style (sections per achievement) and SteamEmu-style root key/value.
 */
export function parseIniAll(filePath: string, kind: GameAchievementSourceKind): ParsedAchievement[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)

  let section = ''
  const sectionData: Record<string, Record<string, string>> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) continue

    const sec = trimmed.match(/^\[(.+?)\]$/)
    if (sec) {
      section = sec[1]
      if (!sectionData[section]) sectionData[section] = {}
      continue
    }

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()

    const bucket = sectionData[section || '__root__'] || (sectionData[section || '__root__'] = {})
    bucket[k] = v
  }

  const parsed: ParsedAchievement[] = []

  // Section-per-achievement styles (OnlineFix etc)
  for (const [sec, data] of Object.entries(sectionData)) {
    if (sec === '__root__') continue

    const lowerKeys = Object.fromEntries(Object.entries(data).map(([k, v]) => [normalizeIniKeyName(k), v])) as Record<string, string>

    const id = extractIniSectionId(sec, data)
    if (!id) continue

    const achievedRaw = lowerKeys['achieved'] ?? lowerKeys['unlocked'] ?? lowerKeys['earned']
    const unlocked = achievedRaw != null ? asBool(achievedRaw) : false

    const tRaw = lowerKeys['unlocktime'] ?? lowerKeys['time'] ?? lowerKeys['timestamp']
    let unlockedAt: number | undefined
    const t = tRaw != null ? parseMaybeNumber(tRaw) : null
    if (t != null) unlockedAt = t < 2_000_000_000 ? t * 1000 : t

    parsed.push({
      id: String(id),
      name: lowerKeys['name'] ? String(lowerKeys['name']).trim() : undefined,
      description: (lowerKeys['desc'] || lowerKeys['description']) ? String(lowerKeys['desc'] || lowerKeys['description']).trim() : undefined,
      unlocked,
      unlockedAt
    })
  }

  // Root key/value style (SteamEmu/achiev.ini): treat each key as an achievement id.
  const root = sectionData['__root__'] || {}
  for (const [k, v] of Object.entries(root)) {
    const id = String(k || '').trim()
    if (!id) continue
    const low = id.toLowerCase()
    if (low === 'language' || low === 'user' || low === 'steamid' || low === 'version') continue
    parsed.push({ id, unlocked: asBool(String(v)) })
  }

  // De-dupe by id, prefer richer entries (with name/description/unlockedAt)
  const bestById = new Map<string, ParsedAchievement>()
  for (const a of parsed) {
    const id = String(a.id || '').trim()
    if (!id) continue
    const prev = bestById.get(id)
    if (!prev) {
      bestById.set(id, a)
      continue
    }

    const merged: ParsedAchievement = {
      id,
      unlocked: prev.unlocked || a.unlocked,
      unlockedAt: prev.unlockedAt ?? a.unlockedAt,
      name: prev.name || a.name,
      description: prev.description || a.description
    }
    bestById.set(id, merged)
  }

  return Array.from(bestById.values())
}

/**
 * Best-effort parse for JSON achievement files that may contain both locked/unlocked entries.
 * If we can't infer locked entries, it returns only the unlocked ones.
 */
export function parseAchievementsJsonAll(filePath: string, kind: GameAchievementSourceKind): ParsedAchievement[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw)

  const out: ParsedAchievement[] = []

  // Shape A: { "ACH_ID": { earned: 0/1, time, name, desc } }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    if (Array.isArray((json as any).achievements)) {
      // Shape B: { achievements: [ { name/id, unlocked/earned, time, title/description } ] }
      const arr = (json as any).achievements
      for (const it of arr) {
        const id = String(it?.id || it?.name || it?.key || '').trim()
        if (!id) continue
        const unlocked = it?.unlocked ?? it?.earned ?? it?.achieved ?? it?.value
        const isUnlocked = unlocked === true || unlocked === 1 || unlocked === '1'
        const t = Number(it?.time ?? it?.timestamp ?? it?.unlockedAt)
        const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined
        out.push({
          id,
          name: it?.displayName || it?.title,
          description: it?.description,
          unlocked: isUnlocked,
          unlockedAt
        })
      }
    } else {
      for (const [k, v] of Object.entries(json)) {
        const id = String(k).trim()
        if (!id) continue
        if (v && typeof v === 'object') {
          const unlocked = (v as any).unlocked ?? (v as any).earned ?? (v as any).achieved ?? (v as any).value
          const isUnlocked = unlocked === true || unlocked === 1 || unlocked === '1'
          const t = Number((v as any).time ?? (v as any).timestamp ?? (v as any).unlockedAt)
          const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined
          out.push({
            id,
            name: (v as any).name || (v as any).title || (v as any).displayName,
            description: (v as any).desc || (v as any).description,
            unlocked: isUnlocked,
            unlockedAt
          })
        } else {
          // Primitive mapping (can't list locked ones reliably)
          const isUnlocked = v === 1 || v === true || v === '1'
          out.push({ id, unlocked: isUnlocked })
        }
      }
    }
  } else if (Array.isArray(json)) {
    // Shape C: [ { id/name, unlocked } ]
    for (const it of json) {
      const id = String(it?.id || it?.name || it?.key || '').trim()
      if (!id) continue
      const unlocked = it?.unlocked ?? it?.earned ?? it?.achieved ?? it?.value
      const isUnlocked = unlocked === true || unlocked === 1 || unlocked === '1'
      const t = Number(it?.time ?? it?.timestamp ?? it?.unlockedAt)
      const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined
      out.push({ id, name: it?.displayName || it?.title, description: it?.description, unlocked: isUnlocked, unlockedAt })
    }
  }

  // De-dupe by id
  const bestById = new Map<string, ParsedAchievement>()
  for (const a of out) {
    const id = String(a.id || '').trim()
    if (!id) continue
    const prev = bestById.get(id)
    if (!prev) {
      bestById.set(id, a)
      continue
    }
    bestById.set(id, {
      id,
      unlocked: prev.unlocked || a.unlocked,
      unlockedAt: prev.unlockedAt ?? a.unlockedAt,
      name: prev.name || a.name,
      description: prev.description || a.description
    })
  }

  return Array.from(bestById.values())
}

function extractUnlockedFromJsonValue(value: any, filePath: string, kind: GameAchievementSourceKind): UnlockedAchievement[] {
  const out: UnlockedAchievement[] = []

  // Common shapes:
  // 1) { "ACH_ID": { "earned": true, "time": 123 } }
  // 2) { "achievements": [{ "name": "ACH_ID", "unlocked": true, "time": 123 }] }
  // 3) [{"id":"ACH_ID","unlockedAt":123}]

  if (Array.isArray(value)) {
    for (const it of value) {
      const id = String(it?.id || it?.name || it?.key || '').trim()
      const unlocked = it?.unlocked ?? it?.earned ?? it?.achieved
      if (!id) continue
      if (unlocked == null || unlocked === true || unlocked === 1 || unlocked === '1') {
        const t = Number(it?.time ?? it?.timestamp ?? it?.unlockedAt)
        const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined
        out.push({ id, name: it?.displayName || it?.title, description: it?.description, unlockedAt, sourcePath: filePath, sourceKind: kind })
      }
    }
    return out
  }

  if (value && typeof value === 'object') {
    if (Array.isArray((value as any).achievements)) {
      return extractUnlockedFromJsonValue((value as any).achievements, filePath, kind)
    }

    for (const [k, v] of Object.entries(value)) {
      const id = String(k).trim()
      if (!id) continue
      if (v && typeof v === 'object') {
        const unlocked = (v as any).unlocked ?? (v as any).earned ?? (v as any).achieved ?? (v as any).value
        if (unlocked === true || unlocked === 1 || unlocked === '1') {
          const t = Number((v as any).time ?? (v as any).timestamp ?? (v as any).unlockedAt)
          const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined
          out.push({ id, unlockedAt, sourcePath: filePath, sourceKind: kind })
        }
      } else {
        // primitive: {"ACH_ID":1}
        if (v === 1 || v === true || v === '1') {
          out.push({ id, sourcePath: filePath, sourceKind: kind })
        }
      }
    }
  }

  return out
}

export function parseAchievementsJson(filePath: string, kind: GameAchievementSourceKind): UnlockedAchievement[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw)
  const unlocks = extractUnlockedFromJsonValue(json, filePath, kind)

  const seen = new Set<string>()
  return unlocks.filter((u) => {
    const id = String(u.id || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function parseGoldbergAchievementsJson(filePath: string): UnlockedAchievement[] {
  return parseAchievementsJson(filePath, 'goldberg_json')
}

export function parseEmpressAchievementsJson(filePath: string): UnlockedAchievement[] {
  return parseAchievementsJson(filePath, 'empress_json')
}

export function parseRazor1911AchievementFile(filePath: string): UnlockedAchievement[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)

  const unlocks: UnlockedAchievement[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    const name = parts[0]
    const unlockedFlag = parts[1]
    const unlockTime = parts[2]

    if (!name) continue
    if (unlockedFlag !== '1') continue

    const t = Number(unlockTime)
    const unlockedAt = Number.isFinite(t) ? (t < 2_000_000_000 ? t * 1000 : t) : undefined

    unlocks.push({ id: name, unlockedAt, sourcePath: filePath, sourceKind: 'razor1911_txt' })
  }

  const seen = new Set<string>()
  return unlocks.filter((u) => {
    const id = String(u.id || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}
