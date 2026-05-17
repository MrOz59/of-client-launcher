import fs from 'fs'
import type { GameMetaForAchievements, AchievementListItem, GameAchievementSource, ParsedAchievement, UnlockedAchievement } from './types'
import { discoverAchievementSources } from './discovery'
import { AchievementsWatcher } from './watcher'
import { listUnlockedForGame, mergeUnlockedAchievements, type AchievementStoreEntry } from './store'
import { getAchievementSchema, getCustomAchievementSchemaForGame, matchAchievementId, type AchievementSchemaItem } from './schema'
import { resolveSteamAppIdByTitle } from './steamAppId'
import { parseAchievementsJsonAll, parseIniAll, parseRazor1911AchievementFile } from './parsers'

export type AchievementUnlockedEvent = {
  gameUrl: string
  title: string
  description?: string
  unlockedAt?: number
  id: string
}

function gameKey(meta: GameMetaForAchievements): string {
  // Prefer steam appid when available; else use gameUrl.
  const appId = String(meta.steamAppId || '').trim()
  if (appId) return `steam:${appId}`
  return `url:${meta.gameUrl}`
}

function canParseAllFromSource(source: GameAchievementSource): boolean {
  if (source.isDirectory) return false
  if (source.kind === 'goldberg_json' || source.kind === 'empress_json') return true
  if (source.kind === 'razor1911_txt') return true
  return source.kind.endsWith('_ini') || source.kind === 'creamapi_cfg'
}

function parseAllFromSource(source: GameAchievementSource): ParsedAchievement[] {
  if (!canParseAllFromSource(source) || !fs.existsSync(source.path)) return []

  try {
    if (source.kind === 'goldberg_json' || source.kind === 'empress_json') {
      return parseAchievementsJsonAll(source.path, source.kind)
    }

    if (source.kind === 'razor1911_txt') {
      return parseRazor1911AchievementFile(source.path).map((u) => ({
        id: u.id,
        name: u.name,
        description: u.description,
        unlocked: true,
        unlockedAt: u.unlockedAt
      }))
    }

    return parseIniAll(source.path, source.kind)
  } catch (err) {
    console.warn('[AchievementsManager] Failed to parse local achievement source', source.kind, source.path, err)
    return []
  }
}

function schemaCompletenessScore(item: AchievementSchemaItem): number {
  let score = 0
  if (item.name && item.name !== item.id) score += 3
  if (item.description) score += 3
  if (item.iconUrl) score += 2
  if (typeof item.percent === 'number') score += 1
  if (typeof item.hidden === 'boolean') score += 1
  return score
}

function parsedToSchemaItem(parsed: ParsedAchievement): AchievementSchemaItem | null {
  const id = String(parsed.id || '').trim()
  if (!id) return null

  return {
    id,
    name: String(parsed.name || id).trim(),
    description: parsed.description ? String(parsed.description).trim() : undefined
  }
}

function mergeLocalSchemaItems(items: AchievementSchemaItem[]): AchievementSchemaItem[] {
  const merged: AchievementSchemaItem[] = []

  for (const item of items) {
    const existingIndex = merged.findIndex((it) => matchAchievementId(it.id, item.id))
    if (existingIndex === -1) {
      merged.push(item)
      continue
    }

    const existing = merged[existingIndex]
    const candidate = schemaCompletenessScore(item) > schemaCompletenessScore(existing) ? item : existing
    merged[existingIndex] = {
      ...candidate,
      id: existing.id,
      name: candidate.name || existing.name || existing.id,
      description: candidate.description || existing.description,
      iconUrl: candidate.iconUrl || existing.iconUrl,
      percent: candidate.percent ?? existing.percent,
      hidden: candidate.hidden ?? existing.hidden
    }
  }

  return merged
}

function readLocalAchievementSnapshot(meta: GameMetaForAchievements): {
  schema: AchievementSchemaItem[]
  unlocked: UnlockedAchievement[]
  sources: GameAchievementSource[]
} {
  const sources = discoverAchievementSources(meta)
  const schemaItems: AchievementSchemaItem[] = []
  const unlocked: UnlockedAchievement[] = []

  for (const source of sources) {
    const parsed = parseAllFromSource(source)
    for (const item of parsed) {
      const schema = parsedToSchemaItem(item)
      if (schema) schemaItems.push(schema)

      if (item.unlocked) {
        unlocked.push({
          id: item.id,
          name: item.name,
          description: item.description,
          unlockedAt: item.unlockedAt,
          sourcePath: source.path,
          sourceKind: source.kind
        })
      }
    }
  }

  return {
    schema: mergeLocalSchemaItems(schemaItems),
    unlocked,
    sources
  }
}

export class AchievementsManager {
  private watcherByGameUrl = new Map<string, AchievementsWatcher>()

  startWatching(meta: GameMetaForAchievements, onUnlocked: (ev: AchievementUnlockedEvent) => void) {
    const gameUrl = meta.gameUrl
    if (!gameUrl) return

    this.stopWatching(gameUrl)

    const watcher = new AchievementsWatcher(meta, 1500)
    this.watcherByGameUrl.set(gameUrl, watcher)

    const key = gameKey(meta)

    watcher.start(({ unlocks, baseline }) => {
      if (!unlocks?.length) return
      const { changed } = mergeUnlockedAchievements(key, unlocks)
      if (baseline) return

      for (const u of changed) {
        const title = u.name || u.id
        onUnlocked({
          gameUrl,
          id: u.id,
          title,
          description: u.description,
          unlockedAt: u.unlockedAt
        })
      }
    })
  }

  stopWatching(gameUrl: string) {
    const prev = this.watcherByGameUrl.get(gameUrl)
    if (prev) {
      prev.stop()
      this.watcherByGameUrl.delete(gameUrl)
    }
  }

  getSources(meta: GameMetaForAchievements) {
    return discoverAchievementSources(meta)
  }

  /**
   * Get the full achievements list for a game, merging schema with unlocked achievements.
   * 
   * Priority:
   * 1. Custom schema (user-imported JSON)
   * 2. Steam schema (via Web API or Community scraping)
   * 3. Local schema from achievement files generated by emulators/cracks
   * 4. Just unlocked achievements (no schema available)
   */
  async getAchievements(meta: GameMetaForAchievements): Promise<AchievementListItem[]> {
    const key = gameKey(meta)
    const localSnapshot = readLocalAchievementSnapshot(meta)
    if (localSnapshot.unlocked.length) {
      mergeUnlockedAchievements(key, localSnapshot.unlocked)
    }

    const unlocked = listUnlockedForGame(key)
    const unlockedList = Object.values(unlocked)

    console.log(`[AchievementsManager] getAchievements for gameUrl=${meta.gameUrl}`)
    console.log(`[AchievementsManager] Unlocked achievements in store: ${unlockedList.length}`)

    // 1. Check for custom schema first
    const customSchema = getCustomAchievementSchemaForGame(meta.gameUrl)
    if (customSchema?.length) {
      console.log(`[AchievementsManager] Using custom schema (${customSchema.length} items)`)
      return this.mergeSchemaWithUnlocked(customSchema, unlockedList)
    }

    // 2. Try to get Steam schema
    let steamAppId = String(meta.schemaSteamAppId || meta.steamAppId || '').trim()
    console.log(`[AchievementsManager] Initial steamAppId: ${steamAppId || '(empty)'}`)

    // Try to resolve by title if no appid
    if (!steamAppId && meta.title) {
      console.log(`[AchievementsManager] Trying to resolve AppID by title: "${meta.title}"`)
      try {
        const resolved = await resolveSteamAppIdByTitle({ gameUrl: meta.gameUrl, title: meta.title })
        if (resolved) {
          steamAppId = String(resolved).trim()
          console.log(`[AchievementsManager] Resolved AppID by title: ${steamAppId}`)
        }
      } catch (err) {
        console.warn('[AchievementsManager] Failed to resolve AppID by title:', err)
      }
    }

    if (steamAppId) {
      console.log(`[AchievementsManager] Fetching Steam schema for appid=${steamAppId}`)
      const schema = await getAchievementSchema(steamAppId)
      
      if (schema.length > 0) {
        console.log(`[AchievementsManager] Got Steam schema with ${schema.length} achievements`)
        return this.mergeSchemaWithUnlocked(schema, unlockedList)
      } else {
        console.log('[AchievementsManager] Steam schema returned empty')
      }
    } else {
      console.log('[AchievementsManager] No steamAppId available, cannot fetch schema')
    }

    // 3. Use local schema embedded in achievement files when available.
    if (localSnapshot.schema.length) {
      console.log(`[AchievementsManager] Using local achievement schema (${localSnapshot.schema.length} items)`)
      return this.mergeSchemaWithUnlocked(localSnapshot.schema, unlockedList)
    }

    // 4. No schema available - just return unlocked achievements
    console.log('[AchievementsManager] Returning only unlocked achievements (no schema)')
    return unlockedList
      .map((u) => ({
        id: u.id,
        name: u.name || u.id,
        description: u.description,
        unlocked: true,
        unlockedAt: u.unlockedAt
      }))
      .sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0))
  }

  /**
   * Merge a schema with unlocked achievements to produce the full list.
   */
  private mergeSchemaWithUnlocked(
    schema: AchievementSchemaItem[],
    unlockedList: AchievementStoreEntry[]
  ): AchievementListItem[] {
    const usedUnlockedIds = new Set<string>()

    // Map schema items to list items, matching with unlocked
    const items: AchievementListItem[] = schema.map((s) => {
      const matched = unlockedList.find((u) => matchAchievementId(u.id, s.id))
      if (matched) usedUnlockedIds.add(matched.id)

      return {
        id: s.id,
        name: s.name,
        description: s.description,
        iconUrl: s.iconUrl,
        hidden: s.hidden,
        percent: s.percent,
        unlocked: !!matched,
        unlockedAt: matched?.unlockedAt
      }
    })

    // Add any unlocked achievements that weren't in the schema
    for (const u of unlockedList) {
      if (usedUnlockedIds.has(u.id)) continue
      items.push({
        id: u.id,
        name: u.name || u.id,
        description: u.description,
        unlocked: true,
        unlockedAt: u.unlockedAt
      })
    }

    // Sort: unlocked first, then by name
    items.sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
      const an = String(a.name || a.id).toLowerCase()
      const bn = String(b.name || b.id).toLowerCase()
      return an.localeCompare(bn)
    })

    return items
  }
}

// Singleton instance
export const achievementsManager = new AchievementsManager()
