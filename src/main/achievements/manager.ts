import type { GameMetaForAchievements, AchievementListItem } from './types'
import { discoverAchievementSources } from './discovery'
import { AchievementsWatcher } from './watcher'
import { listUnlockedForGame, mergeUnlockedAchievements, type AchievementStoreEntry } from './store'
import { getAchievementSchema, getCustomAchievementSchemaForGame, matchAchievementId, type AchievementSchemaItem } from './schema'
import { resolveSteamAppIdByTitle } from './steamAppId'

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

export class AchievementsManager {
  private watcherByGameUrl = new Map<string, AchievementsWatcher>()

  startWatching(meta: GameMetaForAchievements, onUnlocked: (ev: AchievementUnlockedEvent) => void) {
    const gameUrl = meta.gameUrl
    if (!gameUrl) return

    this.stopWatching(gameUrl)

    const watcher = new AchievementsWatcher(meta, 1500)
    this.watcherByGameUrl.set(gameUrl, watcher)

    const key = gameKey(meta)

    watcher.start(({ unlocks }) => {
      if (!unlocks?.length) return
      const { changed } = mergeUnlockedAchievements(key, unlocks)
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
   * 3. Just unlocked achievements (no schema available)
   */
  async getAchievements(meta: GameMetaForAchievements): Promise<AchievementListItem[]> {
    const key = gameKey(meta)
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

    // 3. No schema available - just return unlocked achievements
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
