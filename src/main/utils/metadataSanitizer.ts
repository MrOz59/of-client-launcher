import os from 'os'
import path from 'path'
import { sanitizeVersionText } from './versionUtils'

export function sanitizeTitle(value?: string | null): string {
  const text = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[\-|–]\s*(download|baixar|torrent|update|atualiza[cç][aã]o)\s*$/i, '')
    .trim()
  return text || 'Unknown Game'
}

export function sanitizeUrl(value?: string | null): string {
  const raw = String(value || '').replace(/\u00a0/g, '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    parsed.protocol = parsed.protocol.toLowerCase()
    parsed.hostname = parsed.hostname.toLowerCase()
    return parsed.toString()
  } catch {
    return raw.replace(/\s+/g, '')
  }
}

export function sanitizeSteamAppId(value?: string | number | null): string | null {
  const text = String(value ?? '').replace(/[^\d]/g, '').trim()
  if (!text || text === '0') return null
  return text.slice(0, 12)
}

export function sanitizeFilesystemPath(value?: string | null): string | null {
  const raw = String(value || '').replace(/\u0000/g, '').trim()
  if (!raw) return null
  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
  return path.normalize(expanded)
}

export function sanitizeGameId(value?: string | number | null): string | null {
  const text = String(value ?? '').replace(/[^\d]/g, '').trim()
  return text || null
}

export function sanitizeGameMetadataPatch<T extends Record<string, any>>(data: T): T {
  const next: Record<string, any> = { ...data }
  if ('title' in next && next.title != null) next.title = sanitizeTitle(next.title)
  if ('url' in next && next.url != null) next.url = sanitizeUrl(next.url)
  if ('game_url' in next && next.game_url != null) next.game_url = sanitizeUrl(next.game_url)
  if ('download_url' in next && next.download_url != null) next.download_url = sanitizeUrl(next.download_url)
  if ('torrent_magnet' in next && next.torrent_magnet != null) next.torrent_magnet = String(next.torrent_magnet).trim()
  if ('installed_version' in next && typeof next.installed_version === 'string') {
    next.installed_version = sanitizeVersionText(next.installed_version) || next.installed_version.trim()
  }
  if ('latest_version' in next && typeof next.latest_version === 'string') {
    next.latest_version = sanitizeVersionText(next.latest_version) || next.latest_version.trim()
  }
  if ('steam_app_id' in next) next.steam_app_id = sanitizeSteamAppId(next.steam_app_id)
  if ('game_id' in next) next.game_id = sanitizeGameId(next.game_id)
  for (const key of ['install_path', 'dest_path', 'executable_path', 'proton_prefix', 'proton_runtime']) {
    if (key in next) next[key] = sanitizeFilesystemPath(next[key])
  }
  return next as T
}
