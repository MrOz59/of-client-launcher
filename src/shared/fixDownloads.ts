/**
 * Files a fix points at, hosted somewhere else.
 *
 * Until now a fix was inert: it could only name things already on the disk —
 * a winetricks verb, an executable in the game's folder, an assembly the Proton
 * runtime ships. That is what made a fix safe to pass around: the worst a bad
 * one could do was misconfigure a game.
 *
 * A download changes that. The file lands in a folder whose executables are
 * launched under Wine, so whoever writes the fix can run code on the machine of
 * whoever applies it. Three things stand between those two people:
 *
 *  - the fix pins a sha256, and the launcher refuses anything else. The
 *    question stops being "trust this host" and becomes "trust this exact
 *    file, the one the fix author tested and a reviewer can check";
 *  - the destination is bounded — inside the game's folder, or inside the
 *    Windows user profile the game sees (the Proton prefix's on Linux, the
 *    real one on Windows), and nowhere else;
 *  - nothing is fetched without the person being shown the host, the size,
 *    the hash and the destination first, and saying yes to that screen.
 *
 * None of that makes a third-party file trustworthy. It makes it identifiable,
 * which is the most a launcher can honestly offer.
 */

import { sanitizeFixOsList, type FixOs } from './fixOs'

export interface FixInstallRule {
  /** Folder inside the archive whose contents are copied. Empty means its root. */
  from: string
  /** `game:<path>` or `prefix:<path>`, the folder the contents land in. */
  into: string
}

export interface FixDownload {
  id: string
  /** What this file is, in the words of whoever wrote the fix. */
  label: string
  url: string
  sha256: string
  /** Bytes, so the size can be shown before anything is fetched. */
  size?: number
  /** Systems this file is for; empty means every system the fix supports. */
  os?: FixOs[]
  install: FixInstallRule[]
}

/** A fix that needs more than a couple of files is shipping a mod, not a fix. */
export const MAX_FIX_DOWNLOADS = 4
export const MAX_FIX_INSTALL_RULES = 8

/** 512 MiB. Well past any mod, well short of filling a disk by accident. */
export const MAX_FIX_DOWNLOAD_BYTES = 512 * 1024 * 1024

/** Only formats the bundled 7z reads, and only archives: a loose file gets zipped. */
export const FIX_ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar']

export type FixInstallRoot = 'game' | 'prefix'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * A path inside an archive, or inside a destination root. Anything that could
 * climb out, name a drive, or start at the filesystem root is not a path a fix
 * may write — the empty string is, and means "the root itself".
 */
export function isSafeRelativePath(value: string): boolean {
  if (value === '') return true
  if (value.length > 240) return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(value)) return false
  if (/[\0<>:"|?*]/.test(value)) return false
  return value.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** Splits `game:Some/Folder` into the root it names and the path under it. */
export function parseInstallTarget(value: unknown): { root: FixInstallRoot; path: string } | null {
  const raw = text(value, 260)
  const match = /^(game|prefix):(.*)$/.exec(raw)
  if (!match) return null
  const path = match[2].replace(/^[\\/]+|[\\/]+$/g, '')
  if (!isSafeRelativePath(path)) return null
  return { root: match[1] as FixInstallRoot, path }
}

export function isArchiveUrl(url: string): boolean {
  let pathname = ''
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    return false
  }
  return FIX_ARCHIVE_EXTENSIONS.some((ext) => pathname.endsWith(ext))
}

/**
 * https, a real host, no credentials smuggled into the authority, and an
 * archive at the end of it. A URL that fails any of these is dropped rather
 * than repaired: a fix does not get to be nearly valid.
 */
export function isAllowedFixDownloadUrl(value: unknown): boolean {
  const raw = text(value, 500)
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (!url.hostname || !url.hostname.includes('.')) return false
  return isArchiveUrl(raw)
}

export function fixDownloadHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function sanitizeFixInstallRules(raw: unknown): FixInstallRule[] {
  if (!Array.isArray(raw)) return []
  const rules: FixInstallRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const from = text((entry as any).from, 240).replace(/^[\\/]+|[\\/]+$/g, '')
    if (!isSafeRelativePath(from)) continue
    const target = parseInstallTarget((entry as any).into)
    if (!target) continue
    rules.push({ from, into: `${target.root}:${target.path}` })
    if (rules.length >= MAX_FIX_INSTALL_RULES) break
  }
  return rules
}

export function sanitizeFixDownloads(raw: unknown): FixDownload[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const downloads: FixDownload[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const id = text((entry as any).id, 40)
    const url = text((entry as any).url, 500)
    const sha256 = text((entry as any).sha256, 64).toLowerCase()
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    if (!isAllowedFixDownloadUrl(url)) continue
    if (!SHA256_PATTERN.test(sha256)) continue

    const install = sanitizeFixInstallRules((entry as any).install)
    if (!install.length) continue

    const size = Number((entry as any).size)
    const only = sanitizeFixOsList((entry as any).os)
    seen.add(id)
    downloads.push({
      id,
      label: text((entry as any).label, 120) || id,
      url,
      sha256,
      size: Number.isFinite(size) && size > 0 && size <= MAX_FIX_DOWNLOAD_BYTES ? Math.floor(size) : undefined,
      os: only.length ? only : undefined,
      install
    })
    if (downloads.length >= MAX_FIX_DOWNLOADS) break
  }

  return downloads
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
