import fs from 'fs'
import path from 'path'
import type { GameAchievementSource, GameMetaForAchievements, UnlockedAchievement } from './types'
import { discoverAchievementSources } from './discovery'
import { parseEmpressAchievementsJson, parseGoldbergAchievementsJson, parseIniUnlocked, parseRazor1911AchievementFile } from './parsers'

export type WatchTickResult = {
  sources: GameAchievementSource[]
  unlocks: UnlockedAchievement[]
}

function safeStatMtimeMs(p: string): number | null {
  try {
    const s = fs.statSync(p)
    return typeof s.mtimeMs === 'number' ? s.mtimeMs : s.mtime.getTime()
  } catch {
    return null
  }
}

function parseSource(source: GameAchievementSource): UnlockedAchievement[] {
  if (!fs.existsSync(source.path)) return []

  try {
    if (source.kind === 'goldberg_json') {
      return parseGoldbergAchievementsJson(source.path)
    }

    if (source.kind === 'empress_json') {
      return parseEmpressAchievementsJson(source.path)
    }

    if (source.kind === 'razor1911_txt') {
      return parseRazor1911AchievementFile(source.path)
    }

    if (source.kind === 'onlinefix_ini') return parseIniUnlocked(source.path, 'onlinefix_ini')
    if (source.kind === 'codex_ini') return parseIniUnlocked(source.path, 'codex_ini')
    if (source.kind === 'rune_ini') return parseIniUnlocked(source.path, 'rune_ini')
    if (source.kind === 'rld_ini') return parseIniUnlocked(source.path, 'rld_ini')
    if (source.kind === 'rle_ini') return parseIniUnlocked(source.path, 'rle_ini')
    if (source.kind === 'skidrow_ini') return parseIniUnlocked(source.path, 'skidrow_ini')
    if (source.kind === 'userstats_ini') return parseIniUnlocked(source.path, 'userstats_ini')
    if (source.kind === '_3dm_ini') return parseIniUnlocked(source.path, '_3dm_ini')
    if (source.kind === 'steamemu_achiev_ini') return parseIniUnlocked(source.path, 'steamemu_achiev_ini')
    if (source.kind === 'smartsteamemu_ini') return parseIniUnlocked(source.path, 'smartsteamemu_ini')
    if (source.kind === 'creamapi_cfg') return parseIniUnlocked(source.path, 'creamapi_cfg')

    return parseIniUnlocked(source.path, 'exe_relative_ini')
  } catch (err) {
    console.warn('[AchievementsWatcher] Failed to parse', source.kind, source.path, err)
    return []
  }
}

export class AchievementsWatcher {
  private readonly meta: GameMetaForAchievements
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  private lastDiscoverAt = 0
  private discoverMinIntervalMs = 30_000

  private sources: GameAchievementSource[] = []
  private lastMtimeByPath = new Map<string, number>()
  private lastUnlockedIds = new Set<string>()

  constructor(meta: GameMetaForAchievements, intervalMs = 1500) {
    this.meta = meta
    this.intervalMs = intervalMs
  }

  start(onTick: (result: WatchTickResult) => void) {
    if (this.timer) return

    // Initial discovery + baseline
    this.sources = discoverAchievementSources(this.meta)
    this.lastDiscoverAt = Date.now()
    const initialUnlocks = this.collectUnlocks(true)
    onTick({ sources: this.sources, unlocks: initialUnlocks })

    this.timer = setInterval(() => {
      try {
        // Rediscover only when necessary (reduces IO/CPU and prevents UI stalls)
        const now = Date.now()
        if (!this.sources.length || now - this.lastDiscoverAt > this.discoverMinIntervalMs) {
          this.sources = discoverAchievementSources(this.meta)
          this.lastDiscoverAt = now
        }
        const unlocks = this.collectUnlocks(false)
        if (unlocks.length) onTick({ sources: this.sources, unlocks })
      } catch (err) {
        console.warn('[AchievementsWatcher] Tick failed', err)
      }
    }, this.intervalMs)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  getSources() {
    return this.sources
  }

  private collectUnlocks(forceParseAll: boolean): UnlockedAchievement[] {
    const newlyUnlocked: UnlockedAchievement[] = []

    for (const src of this.sources) {
      const mtime = safeStatMtimeMs(src.path)
      if (mtime == null) continue

      const prev = this.lastMtimeByPath.get(src.path)
      const shouldParse = forceParseAll || prev == null || mtime > prev

      if (!shouldParse) continue
      this.lastMtimeByPath.set(src.path, mtime)

      const unlocks = parseSource(src).map((u) => ({ ...u, sourcePath: src.path, sourceKind: src.kind }))
      for (const u of unlocks) {
        const id = String(u.id || '').trim()
        if (!id) continue
        if (this.lastUnlockedIds.has(id)) continue
        this.lastUnlockedIds.add(id)
        newlyUnlocked.push(u)
      }
    }

    return newlyUnlocked
  }
}
