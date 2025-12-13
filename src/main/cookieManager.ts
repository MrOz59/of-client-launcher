import { session, app } from 'electron'
import fs from 'fs'
import path from 'path'

function cookieFilePath() {
  const userData = app?.getPath?.('userData') ?? path.join(process.cwd(), '.userData')
  return path.join(userData, 'cookies.json')
}

// Export cookies for a given URL (or all if url is undefined)
export async function exportCookies(url?: string) {
  const cookies = url ? await session.defaultSession.cookies.get({ url }) : await session.defaultSession.cookies.get({})
  // Save to file
  try {
    fs.writeFileSync(cookieFilePath(), JSON.stringify(cookies, null, 2))
  } catch (err) {
    console.error('Failed to write cookies file', err)
  }
  return cookies
}

function cookieToSetDetails(c: Electron.Cookie) {
  // Map saved cookie object into a format accepted by cookies.set
  const detailsPartial: Partial<Electron.CookiesSetDetails> = {
    name: c.name,
    value: c.value,
    path: c.path ?? '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: (c.sameSite as any) ?? undefined
  }

  // Prefer to include url (required by cookies.set) if we can construct it
  try {
    if ((c as any).url) {
      detailsPartial.url = (c as any).url
    } else if (c.domain) {
      const domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain
      const protocol = c.secure ? 'https' : 'http'
      detailsPartial.url = `${protocol}://${domain}`
    }
  } catch (e) {
    // ignore
  }

  if (c.expirationDate) (detailsPartial as any).expirationDate = c.expirationDate

  // Ensure url exists since Electron cookies.set requires a URL
  if (!detailsPartial.url) {
    // try to generate via domain
    if (c.domain) {
      const domain = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain
      const protocol = c.secure ? 'https' : 'http'
      detailsPartial.url = `${protocol}://${domain}`
    }
  }

  return detailsPartial as Electron.CookiesSetDetails
}

export async function importCookies(url?: string) {
  const file = cookieFilePath()
  if (!fs.existsSync(file)) return
  try {
    const data = fs.readFileSync(file, 'utf-8')
    const cookies: Electron.Cookie[] = JSON.parse(data)
    for (const c of cookies) {
      const details = cookieToSetDetails(c)
      try {
        await session.defaultSession.cookies.set(details)
      } catch (err) {
        console.warn('Failed to set cookie', details.name, err)
      }
    }
  } catch (err) {
    console.error('Failed to load cookies', err)
  }
}

export async function getCookieHeaderForUrl(url: string): Promise<string> {
  const collect = async (ses: Electron.Session | null | undefined) => {
    if (!ses) return [] as Electron.Cookie[]
    try {
      return await ses.cookies.get({ url })
    } catch {
      return [] as Electron.Cookie[]
    }
  }

  // Pull cookies from both default session and the webview partition used to log in
  const fromDefault = await collect(session.defaultSession)
  const fromPartition = await collect(session.fromPartition?.('persist:online-fix'))

  // Deduplicate by cookie name, preferring partition cookies over defaults
  const combined = [...fromDefault, ...fromPartition]
  const seen = new Set<string>()
  const deduped: Electron.Cookie[] = []
  for (let i = combined.length - 1; i >= 0; i--) {
    const c = combined[i]
    if (seen.has(c.name)) continue
    seen.add(c.name)
    deduped.unshift(c)
  }

  return deduped.map((c) => `${c.name}=${c.value}`).join('; ')
}

export async function clearCookies() {
  const cookies = await session.defaultSession.cookies.get({})
  for (const c of cookies) {
    try {
      // Build a URL for the cookie deletion: https://domain/path
      const domain = c.domain?.startsWith('.') ? c.domain.substring(1) : c.domain
      const protocol = c.secure ? 'https' : 'http'
      const url = `${protocol}://${domain}${c.path ?? '/'}`
      await session.defaultSession.cookies.remove(url, c.name)
    } catch (e) {
      // ignore errors
    }
  }
}
