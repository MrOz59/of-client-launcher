import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { UnlockedAchievement } from './types'

export type AchievementStoreEntry = {
  id: string
  name?: string
  description?: string
  unlockedAt?: number
  firstSeenAt?: number
  lastSeenAt?: number
  sourcePath?: string
  sourceKind?: string
}

export type AchievementStoreData = {
  version: number
  games: Record<
    string,
    {
      unlocked: Record<string, AchievementStoreEntry>
      updatedAt?: number
    }
  >
}

const STORE_FILE = () => path.join(app.getPath('userData'), 'achievements.json')
const STORE_VERSION = 1

function safeReadJson(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeWriteJson(filePath: string, value: any) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  } catch (err) {
    console.warn('[AchievementsStore] Failed to write store', err)
  }
}

export function readAchievementStore(): AchievementStoreData {
  const fp = STORE_FILE()
  const existing = safeReadJson(fp)
  if (existing && typeof existing === 'object' && existing.games) {
    return {
      version: Number(existing.version || STORE_VERSION),
      games: existing.games || {}
    }
  }
  return { version: STORE_VERSION, games: {} }
}

export function writeAchievementStore(store: AchievementStoreData) {
  const fp = STORE_FILE()
  safeWriteJson(fp, store)
}

export function mergeUnlockedAchievements(gameKey: string, unlocks: UnlockedAchievement[]): {
  changed: UnlockedAchievement[]
  store: AchievementStoreData
} {
  const now = Date.now()
  const store = readAchievementStore()
  if (!store.games[gameKey]) store.games[gameKey] = { unlocked: {}, updatedAt: now }

  const game = store.games[gameKey]
  if (!game.unlocked) game.unlocked = {}

  const newlyUnlocked: UnlockedAchievement[] = []

  for (const u of unlocks) {
    const id = String(u.id || '').trim()
    if (!id) continue

    const prev = game.unlocked[id]
    if (!prev) {
      game.unlocked[id] = {
        id,
        name: u.name,
        description: u.description,
        unlockedAt: typeof u.unlockedAt === 'number' ? u.unlockedAt : now,
        firstSeenAt: now,
        lastSeenAt: now,
        sourcePath: u.sourcePath,
        sourceKind: u.sourceKind
      }
      newlyUnlocked.push({ ...u, unlockedAt: game.unlocked[id].unlockedAt })
      continue
    }

    // Refresh metadata without overriding unlockedAt unless we previously had none
    prev.lastSeenAt = now
    prev.sourcePath = u.sourcePath || prev.sourcePath
    prev.sourceKind = (u.sourceKind as any) || prev.sourceKind
    if (!prev.name && u.name) prev.name = u.name
    if (!prev.description && u.description) prev.description = u.description
    if (typeof prev.unlockedAt !== 'number' && typeof u.unlockedAt === 'number') prev.unlockedAt = u.unlockedAt
  }

  if (newlyUnlocked.length) game.updatedAt = now
  store.games[gameKey] = game
  if (newlyUnlocked.length) writeAchievementStore(store)

  return { changed: newlyUnlocked, store }
}

export function listUnlockedForGame(gameKey: string): Record<string, AchievementStoreEntry> {
  const store = readAchievementStore()
  return store.games?.[gameKey]?.unlocked || {}
}
