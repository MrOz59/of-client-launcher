import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export type CloudSavesHistoryEntry = {
  at: number
  gameKey: string
  gameUrl?: string
  stage: 'restore' | 'backup'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  data?: any
}

const HISTORY_FILE = path.join(app.getPath('userData'), 'cloud_saves_history.json')
const MAX_ENTRIES = 500

function safeReadJson(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeWriteJson(filePath: string, value: any) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
  } catch {
    // ignore
  }
}

export function appendCloudSavesHistory(entry: CloudSavesHistoryEntry) {
  const existing = safeReadJson(HISTORY_FILE)
  const list: CloudSavesHistoryEntry[] = Array.isArray(existing) ? existing : []
  list.push(entry)
  if (list.length > MAX_ENTRIES) {
    list.splice(0, list.length - MAX_ENTRIES)
  }
  safeWriteJson(HISTORY_FILE, list)
}

export function listCloudSavesHistory(options?: { gameKey?: string; limit?: number }): CloudSavesHistoryEntry[] {
  const existing = safeReadJson(HISTORY_FILE)
  let list: CloudSavesHistoryEntry[] = Array.isArray(existing) ? existing : []
  if (options?.gameKey) list = list.filter((e) => e?.gameKey === options.gameKey)
  list = list.slice().sort((a, b) => (b?.at || 0) - (a?.at || 0))
  const limit = typeof options?.limit === 'number' ? options!.limit! : 50
  return list.slice(0, Math.max(1, Math.min(200, limit)))
}
