import fs from 'fs'
import path from 'path'

export type OnlineFixKV = { key: string; value: string }

function sanitizeIniValue(raw: string): string {
  let v = String(raw ?? '').trim()
  if (v.includes(';')) v = v.split(';')[0].trim()
  if (v.includes('#')) v = v.split('#')[0].trim()
  v = v.replace(/^["']+|["']+$/g, '').trim()
  return v
}

export function parseIniKeyValues(text: string): OnlineFixKV[] {
  const out: OnlineFixKV[] = []
  const lines = String(text || '').split(/\r?\n/)

  // aceita key=value, ignora seções [..] e comentários de linha
  const kvRegex = /^\s*([^=;\[#]+?)\s*=\s*(.*)$/

  for (const line of lines) {
    const m = line.match(kvRegex)
    if (!m) continue
    const key = String(m[1] || '').trim()
    let value = String(m[2] || '').trim()
    if (!key) continue
    out.push({ key, value })
  }
  return out
}

export function extractNumericAppId(raw: string): string | null {
  if (!raw) return null
  const v = sanitizeIniValue(raw)
  const m = v.match(/\d+/)
  return m ? m[0] : null
}

export function extractRealAppIdFromIniText(text: string): string | null {
  const fields = parseIniKeyValues(text)
  const wantedKeys = ['RealAppId', 'RealAppID']

  const lowerMap = new Map<string, string>()
  for (const f of fields) {
    lowerMap.set(String(f.key || '').toLowerCase().trim(), String(f.value ?? ''))
  }

  for (const k of wantedKeys) {
    const raw = lowerMap.get(k.toLowerCase().trim())
    const id = extractNumericAppId(raw || '')
    if (id) return id
  }
  return null
}

export function extractAppIdFromIniText(text: string): string | null {
  const fields = parseIniKeyValues(text)
  const wantedKeys = ['AppId', 'AppID', 'SteamAppId', 'SteamAppID']

  const lowerMap = new Map<string, string>()
  for (const f of fields) {
    lowerMap.set(String(f.key || '').toLowerCase().trim(), String(f.value ?? ''))
  }

  for (const k of wantedKeys) {
    const raw = lowerMap.get(k.toLowerCase().trim())
    const id = extractNumericAppId(raw || '')
    if (id) return id
  }
  return null
}

export function extractFakeAppIdFromIniText(text: string): string | null {
  const fields = parseIniKeyValues(text)
  const wantedKeys = ['FakeAppId', 'FakeAppID']

  const lowerMap = new Map<string, string>()
  for (const f of fields) {
    lowerMap.set(String(f.key || '').toLowerCase().trim(), String(f.value ?? ''))
  }

  for (const k of wantedKeys) {
    const raw = lowerMap.get(k.toLowerCase().trim())
    const id = extractNumericAppId(raw || '')
    if (id) return id
  }
  return null
}

// Prefer RealAppId (saves/achievements), fallback to AppId/SteamAppId.
export function extractSteamAppIdFromIniText(text: string): string | null {
  return extractRealAppIdFromIniText(text) || extractAppIdFromIniText(text)
}

// Prefer AppId/SteamAppId for overlay; fallback to RealAppId.
export function extractSteamOverlayAppIdFromIniText(text: string): string | null {
  return extractAppIdFromIniText(text) || extractFakeAppIdFromIniText(text) || extractRealAppIdFromIniText(text)
}

export function extractEpicProductIdFromIniText(text: string): string | null {
  const fields = parseIniKeyValues(text)
  const wantedKeys = ['RealProductId', 'RealProductID', 'ProductId', 'ProductID', 'EpicProductId', 'EpicProductID']

  const lowerMap = new Map<string, string>()
  for (const f of fields) {
    lowerMap.set(String(f.key || '').toLowerCase().trim(), String(f.value ?? ''))
  }

  for (const k of wantedKeys) {
    const raw = lowerMap.get(k.toLowerCase().trim())
    const v = sanitizeIniValue(raw || '')
    if (v) return v
  }
  return null
}

export function extractOnlineFixOverlayIds(text: string): {
  steamAppId?: string
  steamAppIdSource?: 'appId' | 'fakeAppId' | 'realAppId'
  realAppId?: string
  fakeAppId?: string
  epicProductId?: string
} {
  const appId = extractAppIdFromIniText(text)
  const realAppId = extractRealAppIdFromIniText(text)
  const fakeAppId = extractFakeAppIdFromIniText(text)
  const steamAppId = appId || fakeAppId || realAppId
  const steamAppIdSource = appId ? 'appId' : (fakeAppId ? 'fakeAppId' : (realAppId ? 'realAppId' : undefined))
  const epicProductId = extractEpicProductIdFromIniText(text)
  return {
    steamAppId: steamAppId || undefined,
    steamAppIdSource,
    realAppId: realAppId || undefined,
    fakeAppId: fakeAppId || undefined,
    epicProductId: epicProductId || undefined
  }
}

export async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(filePath)
    if (!st.isFile()) return null
    return await fs.promises.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Tenta localizar o OnlineFix.ini em paths comuns.
 * Ajuste/adicione paths aqui conforme o padrão do teu instalador.
 */
export async function findAndReadOnlineFixIni(installPath: string): Promise<{ path: string; content: string } | null> {
  const root = String(installPath || '').trim()
  if (!root) return null

  const candidates = [
    path.join(root, 'OnlineFix.ini'),
    path.join(root, 'onlinefix.ini'),
    path.join(root, 'of_config.ini'),

    path.join(root, 'steam_settings', 'OnlineFix.ini'),
    path.join(root, 'steam_settings', 'onlinefix.ini'),
    path.join(root, 'steam_settings', 'of_config.ini'),

    path.join(root, 'steam_settings', 'configs', 'OnlineFix.ini'),
    path.join(root, 'steam_settings', 'configs', 'onlinefix.ini'),
    path.join(root, 'steam_settings', 'configs', 'of_config.ini'),

    path.join(root, 'steam_settings', 'settings', 'OnlineFix.ini'),
    path.join(root, 'steam_settings', 'settings', 'onlinefix.ini'),
    path.join(root, 'steam_settings', 'settings', 'of_config.ini'),
  ]

  for (const p of candidates) {
    const txt = await readFileIfExists(p)
    if (txt != null) return { path: p, content: txt }
  }

  // fallback leve: busca por OnlineFix.ini até depth 3 (evita varrer jogo inteiro)
  const maxDepth = 3
  const maxEntries = 4000
  let seen = 0

  async function walk(dir: string, depth: number): Promise<{ path: string; content: string } | null> {
    if (depth > maxDepth) return null
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }

    for (const ent of entries) {
      if (++seen > maxEntries) return null
      const full = path.join(dir, ent.name)

      if (ent.isFile()) {
        const n = ent.name.toLowerCase()
        if (n === 'onlinefix.ini' || n === 'of_config.ini') {
          const txt = await readFileIfExists(full)
          if (txt != null) return { path: full, content: txt }
        }
        continue
      }

      if (ent.isDirectory()) {
        // evita pastas enormes comuns
        const dn = ent.name.toLowerCase()
        if (dn === 'movies' || dn === 'videos' || dn === 'redist' || dn === 'directx' || dn === 'vcredist') continue

        const found = await walk(full, depth + 1)
        if (found) return found
      }
    }
    return null
  }

  return await walk(root, 0)
}
