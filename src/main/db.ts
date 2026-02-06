import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let dbInstance: any | null = null
let sqliteAvailable = false

// JSON fallback performance: keep an in-memory cache and debounce writes.
let jsonStoreCache: any | null = null
let jsonStoreWriteTimer: NodeJS.Timeout | null = null

function flushJsonStoreNow() {
  initDb()
  if (sqliteAvailable) return
  if (!jsonStoreCache) return
  fs.writeFileSync(dbInstance._storePath, JSON.stringify(jsonStoreCache, null, 2))
}

function scheduleJsonStoreWrite(delayMs = 800) {
  initDb()
  if (sqliteAvailable) return
  if (jsonStoreWriteTimer) return
  jsonStoreWriteTimer = setTimeout(() => {
    jsonStoreWriteTimer = null
    try {
      flushJsonStoreNow()
    } catch {
      // ignore
    }
  }, delayMs)
  try {
    jsonStoreWriteTimer.unref()
  } catch {
    // ignore
  }
}

function resolveUserDataDir() {
  return app?.getPath?.('userData') ?? path.join(process.cwd(), '.userData')
}

function initDb() {
  if (dbInstance) return dbInstance
  const userDataDir = resolveUserDataDir()
  fs.mkdirSync(userDataDir, { recursive: true })
  const dbPath = path.join(userDataDir, 'launcher.db')
  // Try to load better-sqlite3; if it fails, we'll fall back to a JSON store
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3')
    const db = new BetterSqlite3(dbPath)
    db.pragma('journal_mode = WAL')
    sqliteAvailable = true
    dbInstance = db
  } catch (err) {
    console.warn('[DB] better-sqlite3 not available, using JSON fallback store', err)
    sqliteAvailable = false
    // initialize JSON store file
    const storePath = path.join(userDataDir, 'launcher.json')
    if (!fs.existsSync(storePath)) {
      const initial = { games: [], downloads: [], settings: {} }
      fs.writeFileSync(storePath, JSON.stringify(initial, null, 2))
    }
    dbInstance = { _storePath: storePath }
  }
    if (sqliteAvailable) {
      // Use the sqlite instance for schema setup
      const db = dbInstance
      db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT,
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  installed_version TEXT,
  latest_version TEXT,
  install_path TEXT,
  image_url TEXT,
  download_url TEXT,
  torrent_magnet TEXT,
  file_size TEXT,
  last_played DATETIME,
  install_date DATETIME,
  update_date DATETIME,
  is_favorite INTEGER DEFAULT 0,
  play_time INTEGER DEFAULT 0,
	  executable_path TEXT,
	  proton_prefix TEXT,
	  proton_runtime TEXT,
	  proton_options TEXT,
	  lan_mode TEXT,
	  lan_network_id TEXT,
	  lan_autoconnect INTEGER DEFAULT 0
	);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_url TEXT,
  title TEXT,
  type TEXT, -- 'http' or 'torrent'
  download_url TEXT,
  dest_path TEXT,
  info_hash TEXT,
  progress REAL DEFAULT 0,
  status TEXT, -- 'pending', 'downloading', 'paused', 'completed', 'error'
  speed TEXT,
  eta TEXT,
  size TEXT,
  downloaded TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`)
    // Migrations for existing installations
    ensureColumn(db, 'downloads', 'title', 'TEXT')
    ensureColumn(db, 'downloads', 'info_hash', 'TEXT')
    ensureColumn(db, 'downloads', 'install_path', 'TEXT')
  
    ensureColumn(db, 'games', 'game_id', 'TEXT')
    ensureColumn(db, 'games', 'proton_prefix', 'TEXT')
    ensureColumn(db, 'games', 'proton_runtime', 'TEXT')
    ensureColumn(db, 'games', 'proton_options', 'TEXT')
    ensureColumn(db, 'games', 'steam_app_id', 'TEXT')
    ensureColumn(db, 'games', 'is_favorite', 'INTEGER')
    ensureColumn(db, 'games', 'play_time', 'INTEGER')
    ensureColumn(db, 'games', 'last_played', 'DATETIME')
    ensureColumn(db, 'games', 'file_size', 'TEXT')
    ensureColumn(db, 'games', 'lan_mode', 'TEXT')
    ensureColumn(db, 'games', 'lan_network_id', 'TEXT')
    ensureColumn(db, 'games', 'lan_autoconnect', 'INTEGER')
  }
  
  return dbInstance
}

function ensureColumn(db: any, table: string, column: string, type: string) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const hasColumn = rows.some((r) => r.name === column)
    if (!hasColumn) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run()
      console.log(`[DB] Added column ${column} to ${table}`)
    }
  } catch (err) {
    console.warn(`[DB] Failed to ensure column ${column} on ${table}:`, err)
  }
}

// JSON store helpers for when better-sqlite3 is unavailable
function readStore() {
  initDb()
  if (sqliteAvailable) return null
  if (jsonStoreCache) return jsonStoreCache
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  jsonStoreCache = JSON.parse(raw)
  return jsonStoreCache
}

function writeStore(store: any) {
  initDb()
  if (sqliteAvailable) return
  jsonStoreCache = store
  // Default behavior: persist immediately for correctness.
  flushJsonStoreNow()
}

export function addOrUpdateGame(url: string, title?: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('INSERT OR IGNORE INTO games (url, title) VALUES (?, ?)')
    stmt.run(url, title || '')
    return
  }
  // JSON fallback
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  if (!store.games.some((g: any) => g.url === url)) {
    store.games.push({ url, title: title || '', installed_version: null, latest_version: null })
    fs.writeFileSync(dbInstance._storePath, JSON.stringify(store, null, 2))
  }
}

export function updateGameVersion(url: string, latest: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('UPDATE games SET latest_version = ? WHERE url = ?')
    stmt.run(latest, url)
    return
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  const g = store.games.find((x: any) => x.url === url)
  if (g) {
    g.latest_version = latest
    fs.writeFileSync(dbInstance._storePath, JSON.stringify(store, null, 2))
  }
}

export function getGame(url: string) {
  initDb()
  const candidates = buildUrlCandidates(url)
  const resolvedUrl = candidates[0] || url
  const gameId = extractGameIdFromUrl(resolvedUrl)

  if (sqliteAvailable) {
    try {
      const inList = candidates.length ? candidates : [resolvedUrl]
      const placeholders = inList.map(() => '?').join(',')
      const byUrl = dbInstance.prepare(`SELECT * FROM games WHERE url IN (${placeholders}) LIMIT 1`).get(...inList)
      if (byUrl) return byUrl
    } catch {}
    if (gameId) {
      try {
        const byId = dbInstance.prepare('SELECT * FROM games WHERE game_id = ? LIMIT 1').get(gameId)
        if (byId) return byId
      } catch {}
    }
    return null
  }

  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  const byUrl = (store.games || []).find((g: any) => candidates.includes(String(g.url)))
  if (byUrl) return byUrl
  if (gameId) return (store.games || []).find((g: any) => String(g.game_id || '') === gameId) || null
  return null
}

export function getAllGames() {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM games ORDER BY last_played DESC')
    return stmt.all()
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  return store.games
}

export function updateGameInfo(url: string, data: {
  title?: string
  game_id?: string
  installed_version?: string
  latest_version?: string
  install_path?: string
  image_url?: string | null
  download_url?: string
  torrent_magnet?: string
  file_size?: string
  executable_path?: string
  proton_runtime?: string | null
	  proton_options?: string | null
	  proton_prefix?: string | null
	  steam_app_id?: string | null
	  lan_mode?: string | null
	  lan_network_id?: string | null
	  lan_autoconnect?: number | null
	}) {
  initDb()
  if (sqliteAvailable) {
    const fields = Object.keys(data).map(key => `${key} = ?`).join(', ')
    const values = Object.values(data)
    const stmt = dbInstance.prepare(`UPDATE games SET ${fields} WHERE url = ?`)
    stmt.run(...values, url)
    return
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  const g = store.games.find((x: any) => x.url === url)
  if (g) {
    Object.assign(g, data)
    fs.writeFileSync(dbInstance._storePath, JSON.stringify(store, null, 2))
  }
}

/**
 * Extract game ID from URL
 * Example: https://online-fix.me/games/shooter/17973-section-13-po-seti.html -> 17973
 */
export function extractGameIdFromUrl(url: string): string | null {
  // Match pattern like /17973-game-name.html or /17973-game-name/
  const match = url.match(/\/(\d+)-[^\/]+(?:\.html)?(?:\/)?$/)
  if (match) {
    return match[1]
  }
  return null
}

function deriveTitleFromUrl(url: string): string {
  const match = url.match(/\/\d+-([^\/]+?)(?:\.html)?\/?$/)
  const rawSlug = match?.[1] || ''
  const cleaned = rawSlug
    .replace(/-po-seti$/i, '')
    .replace(/-ofme$/i, '')
    .replace(/-/g, ' ')
    .trim()

  if (!cleaned) {
    const id = extractGameIdFromUrl(url)
    return id ? `Game ${id}` : 'Unknown Game'
  }

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function buildUrlCandidates(url: string): string[] {
  const trimmed = String(url || '').trim()
  if (!trimmed) return []

  const withoutQuery = trimmed.split(/[?#]/)[0]
  const toggledSlash = withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : `${withoutQuery}/`

  const candidates = [trimmed, withoutQuery, toggledSlash]
    .map(s => s.trim())
    .filter(Boolean)

  return Array.from(new Set(candidates))
}

/**
 * Get game by game_id
 */
export function getGameByGameId(gameId: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM games WHERE game_id = ?')
    return stmt.get(gameId)
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  return store.games.find((g: any) => g.game_id === gameId) || null
}

export function markGameInstalled(url: string, installPath: string, version: string | null, executablePath?: string) {
  initDb()
  const candidates = buildUrlCandidates(url)
  const resolvedUrl = candidates[0] || url
  const normalizedVersion = typeof version === 'string' ? (version.trim() || null) : null

  console.log('[DB] markGameInstalled called:')
  console.log('[DB]   url:', url)
  console.log('[DB]   candidates:', candidates)
  console.log('[DB]   resolvedUrl:', resolvedUrl)
  console.log('[DB]   installPath:', installPath)
  console.log('[DB]   version:', normalizedVersion)
  console.log('[DB]   executablePath:', executablePath)

  if (sqliteAvailable) {
    let canonicalUrl = resolvedUrl
    try {
      const inList = candidates.length ? candidates : [resolvedUrl]
      const placeholders = inList.map(() => '?').join(',')
      const found = dbInstance.prepare(`SELECT url FROM games WHERE url IN (${placeholders}) LIMIT 1`).get(...inList) as any
      if (found?.url) canonicalUrl = found.url
    } catch {}

    let title: string | null = null
    let downloadUrl: string | null = null
    try {
      const inList = candidates.length ? candidates : [canonicalUrl]
      const placeholders = inList.map(() => '?').join(',')
      const meta = dbInstance.prepare(
        `SELECT title, download_url FROM downloads WHERE game_url IN (${placeholders}) ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1`
      ).get(...inList) as any
      title = (meta?.title ? String(meta.title) : null)
      downloadUrl = (meta?.download_url ? String(meta.download_url) : null)
    } catch {}

    addOrUpdateGame(canonicalUrl, title || deriveTitleFromUrl(canonicalUrl))

    const gameId = extractGameIdFromUrl(canonicalUrl)
    const stmt = dbInstance.prepare(`
      UPDATE games
      SET game_id = COALESCE(game_id, ?),
          installed_version = ?,
          latest_version = COALESCE(latest_version, ?),
          install_path = ?,
          executable_path = ?,
          download_url = COALESCE(download_url, ?),
          install_date = datetime('now')
      WHERE url = ?
    `)
    stmt.run(gameId, normalizedVersion, normalizedVersion, installPath, executablePath || null, downloadUrl, canonicalUrl)
    return
  }

  const store = readStore()
  const canonicalUrl = candidates.find(u => (store.games || []).some((g: any) => g.url === u)) || resolvedUrl
  let g = (store.games || []).find((x: any) => x.url === canonicalUrl)

  const download = (store.downloads || [])
    .filter((d: any) => candidates.includes(d.game_url))
    .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]

  const title = (download?.title ? String(download.title) : deriveTitleFromUrl(canonicalUrl))

  if (!g) {
    g = { url: canonicalUrl, title, installed_version: null, latest_version: null }
    store.games = store.games || []
    store.games.push(g)
  }

  g.game_id = g.game_id || extractGameIdFromUrl(canonicalUrl)
  g.installed_version = normalizedVersion
  if (!g.latest_version && normalizedVersion) g.latest_version = normalizedVersion
  g.install_path = installPath
  g.executable_path = executablePath || null
  g.install_date = new Date().toISOString()
  if (download?.download_url && !g.download_url) g.download_url = download.download_url
  writeStore(store)
}

export function updateGamePlayTime(url: string, playTimeMinutes: number) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare(`
      UPDATE games
      SET last_played = datetime('now'),
          play_time = play_time + ?
      WHERE url = ?
    `)
    stmt.run(playTimeMinutes, url)
    return
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  const g = store.games.find((x: any) => x.url === url)
  if (g) {
    g.last_played = new Date().toISOString()
    g.play_time = (g.play_time || 0) + playTimeMinutes
    fs.writeFileSync(dbInstance._storePath, JSON.stringify(store, null, 2))
  }
}

export function setGameFavorite(url: string, isFavorite: boolean) {
  initDb()
  const fav = isFavorite ? 1 : 0
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('UPDATE games SET is_favorite = ? WHERE url = ?')
    stmt.run(fav, url)
    return
  }
  const store = readStore()
  const g = (store.games || []).find((x: any) => x.url === url)
  if (g) {
    g.is_favorite = fav
    writeStore(store)
  }
}

export function toggleGameFavorite(url: string): { isFavorite: boolean } {
  initDb()
  if (sqliteAvailable) {
    const cur = dbInstance.prepare('SELECT is_favorite FROM games WHERE url = ?').get(url) as any
    const next = cur?.is_favorite ? 0 : 1
    dbInstance.prepare('UPDATE games SET is_favorite = ? WHERE url = ?').run(next, url)
    return { isFavorite: !!next }
  }
  const store = readStore()
  const g = (store.games || []).find((x: any) => x.url === url)
  if (!g) return { isFavorite: false }
  const next = g.is_favorite ? 0 : 1
  g.is_favorite = next
  writeStore(store)
  return { isFavorite: !!next }
}

export function deleteGame(url: string) {
  initDb()
  const candidates = buildUrlCandidates(url)
  const resolvedUrl = candidates[0] || url
  const gameId = extractGameIdFromUrl(resolvedUrl)

  if (sqliteAvailable) {
    try {
      const inList = candidates.length ? candidates : [resolvedUrl]
      const placeholders = inList.map(() => '?').join(',')
      dbInstance.prepare(`DELETE FROM games WHERE url IN (${placeholders})`).run(...inList)
    } catch {
      // fallback
      try { dbInstance.prepare('DELETE FROM games WHERE url = ?').run(url) } catch {}
    }
    if (gameId) {
      try { dbInstance.prepare('DELETE FROM games WHERE game_id = ?').run(gameId) } catch {}
    }
    return
  }
  const raw = fs.readFileSync(dbInstance._storePath, 'utf-8')
  const store = JSON.parse(raw)
  store.games = (store.games || []).filter((g: any) => {
    const u = String(g.url || '')
    const gid = String(g.game_id || '')
    if (candidates.includes(u)) return false
    if (gameId && gid === gameId) return false
    return true
  })
  fs.writeFileSync(dbInstance._storePath, JSON.stringify(store, null, 2))
}

// Downloads management
export function createDownload(data: {
  game_url: string
  title: string
  type: 'http' | 'torrent'
  download_url: string
  dest_path: string
  install_path?: string
  info_hash?: string
  size?: string
}) {
  initDb()
  if (sqliteAvailable) {
    const db = dbInstance
    const stmt = db.prepare(`
      INSERT INTO downloads (game_url, title, type, download_url, dest_path, install_path, info_hash, size, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `)
    const result = stmt.run(
      data.game_url,
      data.title,
      data.type,
      data.download_url,
      data.dest_path,
      data.install_path || null,
      data.info_hash || null,
      data.size || null
    )
    return result.lastInsertRowid
  }
  // JSON fallback
  const store = readStore()
  const id = (store.downloads.reduce((max: number, d: any) => Math.max(max, d.id || 0), 0) || 0) + 1
  const entry = {
    id,
    game_url: data.game_url,
    title: data.title,
    type: data.type,
    download_url: data.download_url,
    dest_path: data.dest_path,
    install_path: data.install_path || null,
    info_hash: data.info_hash || null,
    size: data.size || null,
    progress: 0,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  store.downloads.push(entry)
  writeStore(store)
  return id
}

export function updateDownloadInstallPath(id: number, installPath: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('UPDATE downloads SET install_path = ?, updated_at = datetime(\'now\') WHERE id = ?')
    stmt.run(installPath || null, id)
    return
  }
  const store = readStore()
  const d = store.downloads.find((x: any) => x.id === id)
  if (d) {
    d.install_path = installPath || null
    d.updated_at = new Date().toISOString()
    writeStore(store)
  }
}

export function updateDownloadInfoHash(id: number, infoHash: string) {
  const db = initDb()
  if (sqliteAvailable) {
    const stmt = db.prepare('UPDATE downloads SET info_hash = ? WHERE id = ?')
    stmt.run(infoHash, id)
    return
  }
  const store = readStore()
  const d = store.downloads.find((x: any) => x.id === id)
  if (d) {
    d.info_hash = infoHash
    d.updated_at = new Date().toISOString()
    writeStore(store)
  }
}

export function getDownloadByInfoHash(infoHash: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM downloads WHERE info_hash = ?')
    return stmt.get(infoHash) || null
  }
  const store = readStore()
  const d = store.downloads.find((x: any) => x.info_hash === infoHash)
  return d || null
}

export function getDownloadById(id: number) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM downloads WHERE id = ?')
    return stmt.get(id)
  }
  const store = readStore()
  return store.downloads.find((x: any) => x.id === id) || null
}

export function getDownloadByUrl(downloadUrl: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM downloads WHERE download_url = ?')
    return stmt.get(downloadUrl)
  }
  const store = readStore()
  return store.downloads.find((x: any) => x.download_url === downloadUrl) || null
}

export function getDownloadByGameUrl(gameUrl: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT * FROM downloads WHERE game_url = ? ORDER BY updated_at DESC LIMIT 1')
    return stmt.get(gameUrl) || null
  }
  const store = readStore()
  const list = store.downloads.filter((x: any) => x.game_url === gameUrl)
  if (!list.length) return null
  return list.sort((a: any, b: any) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null
}

export function updateDownloadProgress(id: number, progress: number, speed?: string, eta?: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare(`
      UPDATE downloads
      SET progress = ?,
          speed = ?,
          eta = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(progress, speed || null, eta || null, id)
    return
  }
  const store = readStore()
  const d = store.downloads.find((x: any) => x.id === id)
  if (d) {
    d.progress = progress
    d.speed = speed || null
    d.eta = eta || null
    d.updated_at = new Date().toISOString()
    // Torrent progress can emit extremely frequently; don't sync-write the whole JSON store each tick.
    // We'll coalesce writes to keep the UI responsive.
    scheduleJsonStoreWrite(2500)
  }
}

export function updateDownloadStatus(id: number, status: string, errorMessage?: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare(`
      UPDATE downloads
      SET status = ?,
          error_message = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(status, errorMessage || null, id)
    return
  }
  const store = readStore()
  const d = store.downloads.find((x: any) => x.id === id)
  if (d) {
    d.status = status
    d.error_message = errorMessage || null
    d.updated_at = new Date().toISOString()
    writeStore(store)
  }
}

export function getActiveDownloads() {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare("SELECT * FROM downloads WHERE status IN ('pending', 'downloading', 'paused', 'extracting', 'error')")
    return stmt.all()
  }
  const store = readStore()
  return store.downloads.filter((d: any) => ['pending', 'downloading', 'paused', 'extracting', 'error'].includes(d.status))
}

export function getCompletedDownloads() {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare("SELECT * FROM downloads WHERE status = 'completed' ORDER BY updated_at DESC LIMIT 10")
    return stmt.all()
  }
  const store = readStore()
  return (store.downloads || []).filter((d: any) => d.status === 'completed').sort((a: any, b: any) => {
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  }).slice(0, 10)
}

export function deleteDownload(id: number) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('DELETE FROM downloads WHERE id = ?')
    stmt.run(id)
    return
  }
  const store = readStore()
  store.downloads = store.downloads.filter((d: any) => d.id !== id)
  writeStore(store)
}

// Settings management
export function getSetting(key: string): string | null {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('SELECT value FROM settings WHERE key = ?')
    const result = stmt.get(key) as { value: string } | undefined
    return result?.value || null
  }
  const store = readStore()
  return store.settings?.[key] ?? null
}

export function setSetting(key: string, value: string) {
  initDb()
  if (sqliteAvailable) {
    const stmt = dbInstance.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    stmt.run(key, value)
    return
  }
  const store = readStore()
  store.settings = store.settings || {}
  store.settings[key] = value
  writeStore(store)
}

export default initDb()
