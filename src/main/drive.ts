import { app, shell } from 'electron'
import http from 'http'
import url from 'url'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import crypto from 'crypto'
import { getDb } from './db.js'

const REDIRECT_PORT = 42813
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/oauth2callback`
const SCOPE = ['https://www.googleapis.com/auth/drive.file']
const TOKEN_FILE = path.join(app.getPath('userData'), 'drive_token.json')
const APP_FOLDER_NAME = 'OF-Client-Saves'

// OAuth proxy server URL (from settings or default)
function getOAuthProxyUrl(): string {
  try {
    const db = getDb()
    const row = db?.prepare('SELECT value FROM settings WHERE key = ?').get('lanControllerUrl') as { value: string } | undefined
    if (row?.value) return row.value
  } catch {}
  return 'https://vpn.mroz.dev.br'
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/auth'

// Cache for client_id fetched from server
let cachedClientId: string | null = null

async function getClientId(): Promise<string | null> {
  if (cachedClientId) return cachedClientId
  
  const proxyUrl = getOAuthProxyUrl()
  try {
    const res = await fetch(`${proxyUrl}/api/oauth/google/config`)
    const data = await res.json()
    if (data?.ok && data?.client_id) {
      cachedClientId = data.client_id
      return cachedClientId
    }
  } catch (err) {
    console.error('[Drive] Failed to fetch OAuth config:', err)
  }
  return null
}

async function launchAuthInBrowser(authUrl: string) {
  // Prefer Electron shell if available
  try {
    await shell.openExternal(authUrl)
  } catch (e) {
    // fallback: open via Node open
    const open = await import('open')
    open.default(authUrl)
  }
}

export async function authenticateWithDrive(): Promise<{ success: boolean; message?: string }> {
  // Get client_id from proxy server
  const clientId = await getClientId()
  if (!clientId) {
    return { success: false, message: 'Não foi possível obter configuração OAuth do servidor. Verifique sua conexão.' }
  }

  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const authUrl = new URL(AUTH_ENDPOINT)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  // start a temporary local server to receive the code (with timeout)
  const codePromise: Promise<string> = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const q = url.parse(req.url || '', true).query
        if (q && q.code) {
          res.end('<html><body><h3>Authentication successful. You can close this window.</h3></body></html>')
          resolve(String(q.code))
          server.close()
        } else {
          res.end('<html><body><h3>Missing code in callback</h3></body></html>')
        }
      } catch (e: any) {
        try { res.end('<html><body><h3>OAuth callback error</h3></body></html>') } catch {}
        reject(e)
        try { server.close() } catch {}
      }
    })

    server.on('error', (err) => reject(err))
    server.listen(REDIRECT_PORT, '127.0.0.1')

    const t = setTimeout(() => {
      try { server.close() } catch {}
      reject(new Error('OAuth timeout: nenhuma resposta recebida no callback local.'))
    }, 2 * 60 * 1000)

    const cleanup = () => clearTimeout(t)
    server.on('close', cleanup)
    server.on('error', cleanup)
  })

  await launchAuthInBrowser(authUrl.toString())

  try {
    const code = await codePromise
    
    // Exchange code for token via proxy server
    const proxyUrl = getOAuthProxyUrl()
    console.log('[Drive] Exchanging code for token via proxy...')
    
    const r = await fetch(`${proxyUrl}/api/oauth/google/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    })
    
    const data = await r.json().catch(() => null)
    console.log('[Drive] Token response status:', r.status, 'data:', data ? 'received' : 'null')
    
    if (!r.ok || !data?.ok) {
      const msg = (data as any)?.error_description || (data as any)?.error || `HTTP ${r.status}`
      console.error('[Drive] Token exchange failed:', msg)
      return { success: false, message: msg }
    }

    // Remove 'ok' field before saving
    const { ok, ...tokenData } = data
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2))
    console.log('[Drive] Token saved successfully')
    return { success: true }
  } catch (e: any) {
    console.error('[Drive] Auth error:', e)
    return { success: false, message: e?.message || String(e) }
  }
}

function safeReadJson(p: string): any | null {
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Refresh token via proxy server
async function refreshTokenViaProxy(refreshToken: string): Promise<any | null> {
  const proxyUrl = getOAuthProxyUrl()
  try {
    const r = await fetch(`${proxyUrl}/api/oauth/google/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })
    const data = await r.json()
    if (r.ok && data?.ok) {
      const { ok, ...tokenData } = data
      return tokenData
    }
  } catch (err) {
    console.error('[Drive] Token refresh via proxy failed:', err)
  }
  return null
}

// Custom auth that uses proxy for token refresh
function createProxyAuth(token: any) {
  let currentToken = { ...token }
  
  const isExpired = () => {
    if (!currentToken.expiry_date) return true
    return Date.now() >= currentToken.expiry_date - 60000 // 1 min buffer
  }
  
  const getAccessToken = async () => {
    if (isExpired() && currentToken.refresh_token) {
      console.log('[Drive] Token expired, refreshing via proxy...')
      const newToken = await refreshTokenViaProxy(currentToken.refresh_token)
      if (newToken) {
        currentToken = { ...currentToken, ...newToken }
        // Persist refreshed token
        try {
          fs.writeFileSync(TOKEN_FILE, JSON.stringify(currentToken, null, 2))
        } catch {}
      }
    }
    return currentToken.access_token
  }
  
  return {
    getAccessToken,
    get credentials() { return currentToken },
    setCredentials(creds: any) { currentToken = { ...currentToken, ...creds } }
  }
}

function loadOAuthClient(): { auth: any; drive: any } | null {
  const token = safeReadJson(TOKEN_FILE)

  if (!token) return null

  // Use proxy-based auth instead of googleapis OAuth2Client
  const proxyAuth = createProxyAuth(token)
  
  // Create a minimal auth object compatible with googleapis
  const authClient = {
    getAccessToken: async () => ({ token: await proxyAuth.getAccessToken() }),
    request: async (opts: any) => {
      const accessToken = await proxyAuth.getAccessToken()
      const headers = { ...opts.headers, Authorization: `Bearer ${accessToken}` }
      const response = await fetch(opts.url, { ...opts, headers })
      return { data: await response.json(), status: response.status }
    }
  }

  const drive = google.drive({ version: 'v3', auth: authClient as any })
  return { auth: authClient, drive }
}

async function ensureAppFolder(drive: any) {
  // check for folder named APP_FOLDER_NAME in root
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${APP_FOLDER_NAME}' and trashed=false`,
    fields: 'files(id, name)'
  })
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id
  const created = await drive.files.create({
    requestBody: { name: APP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id'
  })
  return created.data.id
}

export async function listSaves(realAppId?: string): Promise<{ id: string; name: string; modifiedTime?: string }[] | { error: string }> {
  const client = loadOAuthClient()
  if (!client) return { error: 'Missing credentials or token. Authenticate first.' }
  try {
    const folderId = await ensureAppFolder(client.drive)
    // If realAppId provided, filter by filename prefix to only include that game's backups
    const prefix = realAppId ? `ofsave_${String(realAppId)}_` : null
    const qParts = [`'${folderId}' in parents`, 'trashed=false']
    if (prefix) qParts.push(`name contains '${prefix}'`)
    const q = qParts.join(' and ')
    const res = await client.drive.files.list({
      q,
      fields: 'files(id, name, modifiedTime, appProperties)'
    })
    return (res.data.files || []).map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties })) as any
  } catch (e: any) {
    return { error: e.message || String(e) }
  }
}

export async function listFilesByNamePrefix(prefix: string): Promise<{ id: string; name: string; modifiedTime?: string }[] | { error: string }> {
  const client = loadOAuthClient()
  if (!client) return { error: 'Missing credentials or token. Authenticate first.' }
  try {
    const folderId = await ensureAppFolder(client.drive)
    const safePrefix = String(prefix || '').replace(/'/g, "\\'")
    const q = [`'${folderId}' in parents`, 'trashed=false', `name contains '${safePrefix}'`].join(' and ')
    const res = await client.drive.files.list({
      q,
      fields: 'files(id, name, modifiedTime, appProperties)'
    })
    return (res.data.files || []).map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties })) as any
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

function escapeDriveQueryValue(v: string): string {
  return String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function listFilesByAppProperties(props: Record<string, string>): Promise<{ id: string; name: string; modifiedTime?: string; appProperties?: Record<string, string> }[] | { error: string }> {
  const client = loadOAuthClient()
  if (!client) return { error: 'Missing credentials or token. Authenticate first.' }
  try {
    const folderId = await ensureAppFolder(client.drive)
    const qParts = [`'${folderId}' in parents`, 'trashed=false']
    const entries = Object.entries(props || {}).filter(([, v]) => String(v || '').trim() !== '')
    for (const [k, v] of entries) {
      const key = escapeDriveQueryValue(k)
      const val = escapeDriveQueryValue(String(v))
      qParts.push(`appProperties has { key='${key}' and value='${val}' }`)
    }
    const q = qParts.join(' and ')
    const res = await client.drive.files.list({
      q,
      fields: 'files(id, name, modifiedTime, appProperties)'
    })
    return (res.data.files || []).map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties }))
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

export async function deleteFile(fileId: string): Promise<{ success: boolean; message?: string }> {
  const client = loadOAuthClient()
  if (!client) return { success: false, message: 'Missing credentials or token. Authenticate first.' }
  try {
    if (!fileId) return { success: false, message: 'fileId ausente' }
    await client.drive.files.delete({ fileId })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

function parseDriveModifiedTimeMs(modifiedTime?: string): number {
  if (!modifiedTime) return 0
  const t = new Date(modifiedTime).getTime()
  return Number.isFinite(t) ? t : 0
}

export async function pruneFilesByNamePrefix(prefix: string, keepLatest: number): Promise<{ success: boolean; deleted?: number; message?: string }> {
  const requested = Number.isFinite(keepLatest) ? Math.floor(keepLatest) : 0
  const keepSafe = Math.max(1, requested)
  const res = await listFilesByNamePrefix(prefix)
  if (!Array.isArray(res)) return { success: false, message: (res as any)?.error || 'Falha ao listar arquivos no Drive.' }

  const files = res
    .slice()
    .sort((a, b) => parseDriveModifiedTimeMs(b.modifiedTime) - parseDriveModifiedTimeMs(a.modifiedTime))

  const toDelete = files.slice(keepSafe)
  let deleted = 0
  for (const f of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    const d = await deleteFile(f.id)
    if (d.success) deleted++
  }
  return { success: true, deleted }
}

export async function getNewestRemoteFileByPrefix(prefix: string): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  const res = await listFilesByNamePrefix(prefix)
  if (!Array.isArray(res) || !res.length) return null
  const files = res.slice()
  files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
  return files[0]
}

export async function getNewestRemoteFileByAppProperties(props: Record<string, string>): Promise<{ id: string; name: string; modifiedTime?: string; appProperties?: Record<string, string> } | null> {
  const res = await listFilesByAppProperties(props)
  if (!Array.isArray(res) || !res.length) return null
  const files = res.slice()
  files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
  return files[0]
}

export async function uploadSave(
  localPath: string,
  remoteName?: string,
  metadata?: { appProperties?: Record<string, string> }
): Promise<{ success: boolean; id?: string; message?: string }> {
  const client = loadOAuthClient()
  if (!client) return { success: false, message: 'Missing credentials or token. Authenticate first.' }
  try {
    const folderId = await ensureAppFolder(client.drive)
    const stream = fs.createReadStream(localPath)
    const res = await client.drive.files.create({
      requestBody: {
        name: remoteName || path.basename(localPath),
        parents: [folderId],
        ...(metadata?.appProperties ? { appProperties: metadata.appProperties } : {})
      },
      media: { body: stream },
      fields: 'id'
    })
    return { success: true, id: res.data.id ?? undefined }
  } catch (e: any) {
    const errMsg = e.message || String(e)
    console.error('[Drive] Upload failed:', errMsg)
    // Check for auth-related errors
    if (errMsg.includes('invalid_grant') || errMsg.includes('invalid_request') || errMsg.includes('Token has been expired')) {
      return { success: false, message: 'Token expirado. Por favor, faça login novamente no Google Drive nas configurações.' }
    }
    return { success: false, message: errMsg }
  }
}

export async function pruneFilesByAppProperties(props: Record<string, string>, keepLatest: number): Promise<{ success: boolean; deleted?: number; message?: string }> {
  const requested = Number.isFinite(keepLatest) ? Math.floor(keepLatest) : 0
  const keepSafe = Math.max(1, requested)
  const res = await listFilesByAppProperties(props)
  if (!Array.isArray(res)) return { success: false, message: (res as any)?.error || 'Falha ao listar arquivos no Drive.' }

  const files = res
    .slice()
    .sort((a, b) => parseDriveModifiedTimeMs(b.modifiedTime) - parseDriveModifiedTimeMs(a.modifiedTime))

  const toDelete = files.slice(keepSafe)
  let deleted = 0
  for (const f of toDelete) {
    // eslint-disable-next-line no-await-in-loop
    const d = await deleteFile(f.id)
    if (d.success) deleted++
  }
  return { success: true, deleted }
}

export async function getFileInfo(fileId: string): Promise<{ success: boolean; file?: { id: string; name: string; modifiedTime?: string; appProperties?: Record<string, string> }; message?: string }> {
  const client = loadOAuthClient()
  if (!client) return { success: false, message: 'Missing credentials or token. Authenticate first.' }
  try {
    if (!fileId) return { success: false, message: 'fileId ausente' }
    const res = await client.drive.files.get({ fileId, fields: 'id, name, modifiedTime, appProperties' })
    const f: any = res?.data
    return { success: true, file: { id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties } }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

export async function updateFileMetadata(fileId: string, patch: { name?: string; appProperties?: Record<string, string> }): Promise<{ success: boolean; message?: string }> {
  const client = loadOAuthClient()
  if (!client) return { success: false, message: 'Missing credentials or token. Authenticate first.' }
  try {
    if (!fileId) return { success: false, message: 'fileId ausente' }
    const requestBody: any = {}
    if (patch?.name) requestBody.name = patch.name
    if (patch?.appProperties) requestBody.appProperties = patch.appProperties
    if (!Object.keys(requestBody).length) return { success: true }
    await client.drive.files.update({ fileId, requestBody })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

export async function sha256File(filePath: string): Promise<string | null> {
  try {
    const hash = crypto.createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(filePath)
      rs.on('data', (chunk) => hash.update(chunk))
      rs.on('error', reject)
      rs.on('end', () => resolve())
    })
    return hash.digest('hex')
  } catch {
    return null
  }
}

export async function downloadSave(fileId: string, destPath: string): Promise<{ success: boolean; message?: string }> {
  const client = loadOAuthClient()
  if (!client) return { success: false, message: 'Missing credentials or token. Authenticate first.' }
  try {
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const res = await client.drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(destPath)
      res.data.pipe(ws)
      ws.on('finish', () => resolve())
      ws.on('error', (err: any) => reject(err))
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e.message || String(e) }
  }
}

export function getCredentialsPath() {
  return null
}

export function getTokenPath() {
  return TOKEN_FILE
}

export function isDriveConfigured(): boolean {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return false
    const token = safeReadJson(TOKEN_FILE)
    if (!token) return false
    // Minimal sanity: access_token or refresh_token must exist
    return Boolean(token.access_token || token.refresh_token)
  } catch {
    return false
  }
}

// Check if cloud saves feature is enabled (user can disable even if Drive is configured)
let cloudSavesEnabled = true
export function setCloudSavesEnabled(enabled: boolean) {
  cloudSavesEnabled = enabled
}
export function isCloudSavesEnabled(): boolean {
  return cloudSavesEnabled && isDriveConfigured()
}

export function getCredentialsContent(): { success: boolean; content?: string; message?: string } {
  return { success: false, message: 'Credenciais fixas do VoidLauncher (PKCE). Não há arquivo local.' }
}

export async function openCredentialsFile(): Promise<{ success: boolean; message?: string }> {
  return { success: false, message: 'Credenciais fixas do VoidLauncher (PKCE). Não há arquivo local.' }
}

export async function openTokenFile(): Promise<{ success: boolean; message?: string }> {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return { success: false, message: 'Token não existe (autentique primeiro)' }
    const r = await shell.openPath(TOKEN_FILE)
    if (r) return { success: false, message: r }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

export function clearToken(): { success: boolean; message?: string } {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.rmSync(TOKEN_FILE, { force: true })
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

export function saveClientCredentials(raw: string) {
  return { success: false, message: 'Credenciais fixas do VoidLauncher (PKCE). Não é necessário salvar JSON.' }
}

// Helpers to locate Proton prefix saves for OnlineFix
function findFileRecursive(dir: string, filename: string, depth = 2): string | null {
  try {
    if (depth < 0) return null
    const files = fs.readdirSync(dir)
    for (const f of files) {
      const full = path.join(dir, f)
      try {
        const stat = fs.statSync(full)
        if (stat.isFile() && f.toLowerCase() === filename.toLowerCase()) return full
        if (stat.isDirectory()) {
          const found = findFileRecursive(full, filename, depth - 1)
          if (found) return found
        }
      } catch (e) {
        // ignore permission errors
      }
    }
  } catch (e) {
    return null
  }
  return null
}

function findDirRecursive(dir: string, dirname: string, depth = 2): string | null {
  try {
    if (depth < 0) return null
    const entries = fs.readdirSync(dir)
    for (const e of entries) {
      const full = path.join(dir, e)
      try {
        const st = fs.statSync(full)
        if (st.isDirectory()) {
          if (e.toLowerCase() === dirname.toLowerCase()) return full
          const found = findDirRecursive(full, dirname, depth - 1)
          if (found) return found
        }
      } catch {
        // ignore
      }
    }
  } catch {
    return null
  }
  return null
}

export function readRealAppIdFromOnlineFixIni(installPath: string): string | null {
  if (!installPath) return null
  // Common locations: root of installPath or within one level
  const candidates = [
    path.join(installPath, 'OnlineFix.ini'),
    path.join(installPath, 'onlinefix', 'OnlineFix.ini')
  ]
  let iniPath: string | null = null
  for (const c of candidates) {
    if (fs.existsSync(c)) { iniPath = c; break }
  }
  if (!iniPath) {
    iniPath = findFileRecursive(installPath, 'OnlineFix.ini', 2)
  }
  if (!iniPath) return null
  try {
    const raw = fs.readFileSync(iniPath, 'utf-8')
    const m = raw.match(/RealAppId\s*=\s*([0-9A-Za-z_-]+)/i)
    if (m && m[1]) return m[1]
  } catch (e) {
    return null
  }
  return null
}

function normalizeProtonPrefixToPfx(protonPrefixPath: string): string | null {
  if (!protonPrefixPath) return null
  try {
    // if already looks like a prefix root with drive_c
    const directDriveC = path.join(protonPrefixPath, 'drive_c')
    if (fs.existsSync(directDriveC)) return protonPrefixPath

    // if the given path is compatdata root that contains pfx
    const pfx = path.join(protonPrefixPath, 'pfx')
    if (fs.existsSync(path.join(pfx, 'drive_c'))) return pfx

    // if ends with .../pfx already but drive_c missing, still return it (caller may create later)
    if (protonPrefixPath.endsWith(`${path.sep}pfx`)) return protonPrefixPath
  } catch {
    // ignore
  }
  return protonPrefixPath
}

export function getProtonSaveFolderForApp(protonPrefixPath: string, realAppId: string): string | null {
  if (!protonPrefixPath || !realAppId) return null

  const pfx = normalizeProtonPrefixToPfx(protonPrefixPath)
  if (!pfx) return null

  const p = path.join(pfx, 'drive_c', 'users', 'Public', 'Documents', 'OnlineFix', String(realAppId))
  return p
}

export function getSavesPathForGame(options: { protonPrefix?: string; installPath?: string; realAppId?: string }): string | null {
  const { protonPrefix, installPath, realAppId } = options
  let rid = realAppId || null
  // Prefer installPath (game install dir) as the source of truth for OnlineFix.ini
  if (!rid && installPath) rid = readRealAppIdFromOnlineFixIni(installPath)

  // If we still don't have a RealAppId, we cannot determine saves path (do not fall back to pfx)
  if (!rid) return null

  if (process.platform === 'linux') {
    if (!protonPrefix) return null
    return getProtonSaveFolderForApp(protonPrefix, rid)
  }

  // Windows fallback heuristics
  if (installPath) {
    const p = path.join(installPath, 'OnlineFix', String(rid))
    if (fs.existsSync(p)) return p

    const onlineFixDir = findDirRecursive(installPath, 'OnlineFix', 2)
    if (onlineFixDir) return path.join(onlineFixDir, String(rid))
  }
  return null
}

export function listLocalSavesForGame(options: { protonPrefix?: string; installPath?: string; realAppId?: string }): string[] | { error: string } {
  const p = getSavesPathForGame(options)
  if (!p) return { error: 'Não foi possível determinar a pasta de saves (falta protonPrefix ou RealAppId)' }
  try {
    if (!fs.existsSync(p)) return []
    const files = fs.readdirSync(p).map(f => path.join(p, f))
    return files
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

// Utility: return latest mtime (ISO) of files inside a folder (recursively)
function getLocalFolderLatestMtime(folder: string): string | null {
  try {
    if (!fs.existsSync(folder)) return null
    let latest = 0
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir)
      for (const e of entries) {
        const full = path.join(dir, e)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else if (st.isFile()) latest = Math.max(latest, st.mtimeMs)
      }
    }
    walk(folder)
    if (latest === 0) return null
    return new Date(latest).toISOString()
  } catch (e) {
    return null
  }
}

// ✅ NOVO: Função para obter a data do save mais recente como objeto Date (solução para o erro 1)
async function getLatestLocalSaveTime(savesPath: string): Promise<Date | null> {
  const mtimeIso = getLocalFolderLatestMtime(savesPath)
  return mtimeIso ? new Date(mtimeIso) : null
}


async function zipFolderTo(zipFrom: string, zipTo: string): Promise<void> {
  // Use archiver if available
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let archiver: any
  try {
    archiver = require('archiver')
  } catch (e) {
    throw new Error('Dependência ausente: archiver. Instale com `npm i archiver`.')
  }

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipTo)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    archive.on('error', (err: any) => reject(err))
    archive.pipe(output)
    archive.directory(zipFrom, false)
    archive.finalize()
  })
}

async function extractZipTo(zipPath: string, destDir: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let extract: any
  try {
    extract = require('extract-zip')
  } catch (e) {
    throw new Error('Dependência ausente: extract-zip. Instale com `npm i extract-zip`.')
  }
  // A extração deve ser feita no diretório-alvo. 
  // Se o zip contiver uma pasta raiz, isso pode ser um problema (extract-zip lida com isso se você extrair para um dir temporário e depois copiar).
  // Seus passos já usam um dir temporário, o que é bom.
  await extract(zipPath, { dir: destDir })
}

// Backup local saves folder to Drive (zips folder then uploads)
export async function backupLocalSavesToDrive(options: { protonPrefix?: string; installPath?: string; realAppId?: string; remoteName?: string }) {
  try {
    const savesPath = getSavesPathForGame(options)
    if (!savesPath) return { success: false, message: 'Não foi possível determinar pasta de saves local.' }
    if (!fs.existsSync(savesPath)) return { success: false, message: 'Pasta de saves local não existe.' }

    const rid = options.realAppId || readRealAppIdFromOnlineFixIni(options.installPath || '')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const name = options.remoteName || `ofsave_${rid || 'unknown'}_${ts}.zip`
    const tmp = path.join(app.getPath('temp'), name)

    await zipFolderTo(savesPath, tmp)

    const res = await uploadSave(tmp, name)

    // Prevent infinite Drive growth: keep only a small recent history per RealAppId.
    if (res.success && rid) {
      try {
        await pruneFilesByNamePrefix(`ofsave_${String(rid)}_`, 10)
      } catch {
        // ignore pruning failures
      }
    }

    try { fs.unlinkSync(tmp) } catch {}
    return res
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

// Download a zip save by fileId and extract into target folder (overwrite)
export async function downloadAndExtractSaveTo(fileId: string, targetFolder: string) {
  try {
    const tmpName = `ofsave_download_${fileId}.zip`
    const tmpPath = path.join(app.getPath('temp'), tmpName)
    const dres = await downloadSave(fileId, tmpPath)
    if (!dres.success) return dres

    // 1. Cria um diretório temporário para extração
    const extractDir = path.join(app.getPath('temp'), `ofsave_extract_${fileId}`)
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
    fs.mkdirSync(extractDir, { recursive: true })

    // 2. Extrai o zip para o diretório temporário
    await extractZipTo(tmpPath, extractDir)

    // 3. Copia recursivamente do diretório temporário para o diretório alvo (sobrescrevendo)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let fse: any
    try {
      fse = require('fs-extra')
    } catch {
      throw new Error('Dependência ausente: fs-extra. Instale com `npm i fs-extra`.')
    }
    
    // Antes de copiar, limpe o diretório alvo se ele existir e não estiver vazio. 
    // Isso garante uma restauração limpa.
    if (fs.existsSync(targetFolder)) {
      await fse.emptyDir(targetFolder)
    } else {
      fs.mkdirSync(targetFolder, { recursive: true })
    }

    await fse.copy(extractDir, targetFolder, { overwrite: true })

    // Limpeza
    try { fs.unlinkSync(tmpPath) } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch {}
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}

// Get newest Drive save metadata (id, name, modifiedTime)
export async function getNewestRemoteSave(realAppId?: string): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  const client = loadOAuthClient()
  if (!client) return null
  try {
    const folderId = await ensureAppFolder(client.drive)
    const prefix = realAppId ? `ofsave_${String(realAppId)}_` : null
    const qParts = [`'${folderId}' in parents`, 'trashed=false']
    if (prefix) qParts.push(`name contains '${prefix}'`)
    const q = qParts.join(' and ')
    const res = await client.drive.files.list({ q, fields: 'files(id, name, modifiedTime)' })
    const files = (res.data.files || []) as any[]
    if (!files.length) return null
    files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
    const f = files[0]
    return { id: f.id, name: f.name, modifiedTime: f.modifiedTime }
  } catch (e) {
    return null
  }
}

// Sync logic to run at play start: compare latest local vs remote and ensure local folder has the newest save
// Dentro de drive.ts
// Dentro de drive.ts
export async function syncSavesOnPlayStart(options: {
  protonPrefix?: string
  installPath?: string
  realAppId?: string
}) {
  try {
    const savesPath = getSavesPathForGame(options)
    if (!savesPath) {
      console.error('[DRIVE-SYNC-LOGIC] Falha: Não foi possível determinar pasta de saves local.')
      return { success: false, message: 'Não foi possível determinar pasta de saves local.' }
    }
    
    // ✅ LOGS E LÓGICA NOVO: Separa a leitura de IDs para logs melhores
    const ridFromOptions = options.realAppId
    const ridFromIni = readRealAppIdFromOnlineFixIni(options.installPath || '')
    const rid = ridFromOptions || ridFromIni
    
    console.log(`[DRIVE-SYNC-LOGIC] RealAppId das opções: ${ridFromOptions || 'NULO'}`)
    console.log(`[DRIVE-SYNC-LOGIC] RealAppId do INI: ${ridFromIni || 'NULO'}`)

    if (!rid) {
      console.error('[DRIVE-SYNC-LOGIC] Falha: Não foi possível determinar RealAppId.')
      return { success: false, message: 'Não foi possível determinar RealAppId (OnlineFix.ini ausente ou inválido).' }
    }
    
    console.log(`[DRIVE-SYNC-LOGIC] Saves Path: ${savesPath} | RealAppId FINAL: ${rid}`)
    
    // LOG NOVO 1: Verifica a existência da pasta de saves local
    const savesPathExists = fs.existsSync(savesPath)
    console.log(`[DRIVE-SYNC-LOGIC] Saves Path Existe: ${savesPathExists}`)

    // Esta função deve retornar 'null' se a pasta não existe ou está vazia.
    const localDate = await getLatestLocalSaveTime(savesPath) 
    
    // Busca o save remoto mais recente
    const remote = await getNewestRemoteSave(rid)
    const remoteDate = remote?.modifiedTime ? new Date(remote.modifiedTime) : null

    // LOG NOVO 2: Verifica o resultado da busca remota
    console.log(`[DRIVE-SYNC-LOGIC] Remote Search Result: ${remote ? 'Encontrado' : 'NULO'}`)
    
    // LOG 18 & 19: As datas finais
    console.log(`[DRIVE-SYNC-LOGIC] Local Date: ${localDate?.toISOString() || 'NULL'}`)
    console.log(`[DRIVE-SYNC-LOGIC] Remote Date: ${remoteDate?.toISOString() || 'NULL'}`)

    // A. Não há saves (local e remoto)
    if (!localDate && !remoteDate) { 
      console.log('[DRIVE-SYNC-LOGIC] Não há saves locais nem remotos. Nada a fazer.')
      return { success: true, message: 'Nenhum save local ou remoto encontrado.' }
    }
    
    // B. Upload: Local é mais novo ou remoto não existe (mas local existe)
    if (localDate && (!remoteDate || localDate.getTime() > remoteDate.getTime())) {
      console.log('[DRIVE-SYNC-LOGIC] Decisão: Local é mais novo. Fazendo Backup (Upload).')
      return await backupLocalSavesToDrive({ ...options, realAppId: rid })
    }

    // C. Download: Remote é mais novo OU Remote existe e Local não existe (localDate é NULL)
    if (remoteDate && (!localDate || remoteDate.getTime() > localDate.getTime())) {
      console.log('[DRIVE-SYNC-LOGIC] Decisão: Remote é mais novo/Local não existe. Fazendo Download.')
      
      // LOG NOVO 3: Confirma se a função de download será chamada
      console.log(`[DRIVE-SYNC-LOGIC] Chamando downloadAndExtractSaveTo(fileId: ${remote!.id}, destPath: ${savesPath})`)
      
      return await downloadAndExtractSaveTo(remote!.id, savesPath)
    }

    // D. Saves Sincronizados
    console.log('[DRIVE-SYNC-LOGIC] Decisão: Saves estão sincronizados (datas iguais).')
    return { success: true, message: 'Saves estão sincronizados.' }

  } catch (e: any) {
    console.error('[DRIVE-SYNC-LOGIC] Erro durante a sincronização:', e)
    return { success: false, message: e?.message || String(e) }
  }
}

// ✅ NOVO: Sempre tentar subir saves ao fechar o jogo (é isso que fazia sua pasta ficar vazia)
export async function syncSavesOnPlayEnd(options: { protonPrefix?: string; installPath?: string; realAppId?: string }) {
  try {
    const savesPath = getSavesPathForGame(options)
    if (!savesPath) return { success: false, message: 'Não foi possível determinar pasta de saves local.' }

    const rid = options.realAppId || readRealAppIdFromOnlineFixIni(options.installPath || '')
    if (!rid) return { success: false, message: 'Não foi possível determinar RealAppId (OnlineFix.ini ausente ou inválido).' }

    if (!fs.existsSync(savesPath)) {
      return { success: true, message: 'Pasta de saves local ainda não existe; nada para enviar.' }
    }

    const entries = fs.readdirSync(savesPath)
    if (!entries.length) {
      return { success: true, message: 'Pasta de saves está vazia; nada para enviar.' }
    }

    return await backupLocalSavesToDrive({ ...options, realAppId: rid })
  } catch (e: any) {
    return { success: false, message: e?.message || String(e) }
  }
}