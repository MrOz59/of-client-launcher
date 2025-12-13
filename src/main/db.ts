import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

let dbInstance: Database.Database | null = null

function resolveUserDataDir() {
  return app?.getPath?.('userData') ?? path.join(process.cwd(), '.userData')
}

function initDb() {
  if (dbInstance) return dbInstance
  const userDataDir = resolveUserDataDir()
  fs.mkdirSync(userDataDir, { recursive: true })
  const dbPath = path.join(userDataDir, 'launcher.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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
	  ensureColumn(db, 'games', 'game_id', 'TEXT')
		  ensureColumn(db, 'games', 'proton_prefix', 'TEXT')
		  ensureColumn(db, 'games', 'proton_runtime', 'TEXT')
		  ensureColumn(db, 'games', 'proton_options', 'TEXT')
		  ensureColumn(db, 'games', 'steam_app_id', 'TEXT')
		  ensureColumn(db, 'games', 'lan_mode', 'TEXT')
		  ensureColumn(db, 'games', 'lan_network_id', 'TEXT')
		  ensureColumn(db, 'games', 'lan_autoconnect', 'INTEGER')

  dbInstance = db
  return dbInstance
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
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

export function addOrUpdateGame(url: string, title?: string) {
  const db = initDb()
  const stmt = db.prepare('INSERT OR IGNORE INTO games (url, title) VALUES (?, ?)')
  stmt.run(url, title || '')
}

export function updateGameVersion(url: string, latest: string) {
  const db = initDb()
  const stmt = db.prepare('UPDATE games SET latest_version = ? WHERE url = ?')
  stmt.run(latest, url)
}

export function getGame(url: string) {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM games WHERE url = ?')
  return stmt.get(url)
}

export function getAllGames() {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM games ORDER BY last_played DESC')
  return stmt.all()
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
  const db = initDb()
  const fields = Object.keys(data).map(key => `${key} = ?`).join(', ')
  const values = Object.values(data)
  const stmt = db.prepare(`UPDATE games SET ${fields} WHERE url = ?`)
  stmt.run(...values, url)
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

/**
 * Get game by game_id
 */
export function getGameByGameId(gameId: string) {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM games WHERE game_id = ?')
  return stmt.get(gameId)
}

export function markGameInstalled(url: string, installPath: string, version: string, executablePath?: string) {
  const db = initDb()
  const stmt = db.prepare(`
    UPDATE games
    SET installed_version = ?,
        install_path = ?,
        executable_path = ?,
        install_date = datetime('now')
    WHERE url = ?
  `)
  stmt.run(version, installPath, executablePath || null, url)
}

export function updateGamePlayTime(url: string, playTimeMinutes: number) {
  const db = initDb()
  const stmt = db.prepare(`
    UPDATE games
    SET last_played = datetime('now'),
        play_time = play_time + ?
    WHERE url = ?
  `)
  stmt.run(playTimeMinutes, url)
}

export function deleteGame(url: string) {
  const db = initDb()
  const stmt = db.prepare('DELETE FROM games WHERE url = ?')
  stmt.run(url)
}

// Downloads management
export function createDownload(data: {
  game_url: string
  title: string
  type: 'http' | 'torrent'
  download_url: string
  dest_path: string
  info_hash?: string
  size?: string
}) {
  const db = initDb()
  const stmt = db.prepare(`
    INSERT INTO downloads (game_url, title, type, download_url, dest_path, info_hash, size, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `)
  const result = stmt.run(
    data.game_url,
    data.title,
    data.type,
    data.download_url,
    data.dest_path,
    data.info_hash || null,
    data.size || null
  )
  return result.lastInsertRowid
}

export function updateDownloadInfoHash(id: number, infoHash: string) {
  const db = initDb()
  const stmt = db.prepare('UPDATE downloads SET info_hash = ? WHERE id = ?')
  stmt.run(infoHash, id)
}

export function getDownloadByInfoHash(infoHash: string) {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM downloads WHERE info_hash = ?')
  return stmt.get(infoHash)
}

export function getDownloadById(id: number) {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM downloads WHERE id = ?')
  return stmt.get(id)
}

export function getDownloadByUrl(downloadUrl: string) {
  const db = initDb()
  const stmt = db.prepare('SELECT * FROM downloads WHERE download_url = ?')
  return stmt.get(downloadUrl)
}

export function updateDownloadProgress(id: number, progress: number, speed?: string, eta?: string) {
  const db = initDb()
  const stmt = db.prepare(`
    UPDATE downloads
    SET progress = ?,
        speed = ?,
        eta = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `)
  stmt.run(progress, speed || null, eta || null, id)
}

export function updateDownloadStatus(id: number, status: string, errorMessage?: string) {
  const db = initDb()
  const stmt = db.prepare(`
    UPDATE downloads
    SET status = ?,
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `)
  stmt.run(status, errorMessage || null, id)
}

export function getActiveDownloads() {
  const db = initDb()
  const stmt = db.prepare("SELECT * FROM downloads WHERE status IN ('pending', 'downloading', 'paused')")
  return stmt.all()
}

export function getCompletedDownloads() {
  const db = initDb()
  const stmt = db.prepare("SELECT * FROM downloads WHERE status = 'completed' ORDER BY updated_at DESC LIMIT 10")
  return stmt.all()
}

export function deleteDownload(id: number) {
  const db = initDb()
  const stmt = db.prepare('DELETE FROM downloads WHERE id = ?')
  stmt.run(id)
}

// Settings management
export function getSetting(key: string): string | null {
  const db = initDb()
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const result = stmt.get(key) as { value: string } | undefined
  return result?.value || null
}

export function setSetting(key: string, value: string) {
  const db = initDb()
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run(key, value)
}

export default initDb()
