/**
 * Single source of truth for the hosts the launcher is allowed to talk to.
 *
 * These checks used to live in three copies — main process, Store tab and the
 * torrent IPC handler — and they drifted apart: the copy guarding the download
 * handler matched with a bare `hostname.endsWith('online-fix.me')`, which also
 * accepts a lookalike domain such as `evil-online-fix.me`. Everything that
 * needs one of these answers imports it from here.
 */

export const STORE_HOME_URL = 'https://online-fix.me'

/**
 * Hosts operated by online-fix: the site itself and its subdomains, which is
 * where the torrent files are served from (uploads.online-fix.me:2053).
 */
export const STORE_DOMAINS = ['online-fix.me']

/** Only reachable because the site's sign-in flow goes through them. */
export const LOGIN_HOSTS = ['accounts.google.com', 'accounts.google.com.br', 'discord.com']
export const LOGIN_SUFFIXES = ['.discord.com', '.discordapp.com']

function normalizeHost(host: string | null | undefined): string {
  return String(host || '').trim().toLowerCase()
}

/** Exact host or a real subdomain of it — never a suffix match on the bare name. */
function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function isOnlineFixHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  return STORE_DOMAINS.some((domain) => matchesDomain(h, domain))
}

export function isAllowedWebviewHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  if (isOnlineFixHost(h)) return true
  if (LOGIN_HOSTS.includes(h)) return true
  return LOGIN_SUFFIXES.some((suffix) => h.endsWith(suffix))
}

export function isAllowedWebviewUrl(raw?: string | null): boolean {
  const url = String(raw || '').trim()
  if (!url) return false
  if (url.startsWith('about:')) return true

  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return false
    return isAllowedWebviewHost(parsed.hostname)
  } catch {
    return false
  }
}

export function isAllowedTorrentUrl(raw?: string | null): boolean {
  const url = String(raw || '').trim()
  if (!url) return false

  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return false
    if (!isOnlineFixHost(parsed.hostname)) return false
    return parsed.pathname.includes('/torrents/') || parsed.pathname.endsWith('.torrent')
  } catch {
    return false
  }
}
