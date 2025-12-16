import os from 'os'
import path from 'path'
import fs from 'fs'

function env(name: string): string {
  return String(process.env[name] || '').trim()
}

function winJoin(...parts: string[]) {
  return path.win32.join(...parts)
}

function expandHome(p: string) {
  if (!p) return p
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function guessWindowsPaths() {
  const appData = env('APPDATA') || winJoin(env('USERPROFILE') || 'C:\\', 'AppData', 'Roaming')
  const localAppData = env('LOCALAPPDATA') || winJoin(env('USERPROFILE') || 'C:\\', 'AppData', 'Local')
  const programData = env('PROGRAMDATA') || 'C:\\ProgramData'
  const publicDir = env('PUBLIC') || 'C:\\Users\\Public'
  const documents = env('USERPROFILE') ? winJoin(env('USERPROFILE'), 'Documents') : winJoin('C:\\Users', env('USERNAME') || 'Public', 'Documents')
  const publicDocuments = winJoin(publicDir, 'Documents')
  return { appData, localAppData, programData, publicDir, publicDocuments, documents }
}

function listDirSafe(p: string): string[] {
  try {
    return fs.readdirSync(p)
  } catch {
    return []
  }
}

export function getWineUserRoots(prefixPath: string): string[] {
  const prefix = expandHome(prefixPath)
  const driveC = path.join(prefix, 'drive_c')
  const usersDir = path.join(driveC, 'users')
  const users = listDirSafe(usersDir)
    .filter((x) => x && !x.startsWith('.'))
    .map((u) => path.join(usersDir, u))

  // Prefer typical wine users first
  const preferredOrder = ['steamuser', 'user', 'default', 'Public']
  users.sort((a, b) => {
    const an = path.basename(a)
    const bn = path.basename(b)
    const ai = preferredOrder.indexOf(an)
    const bi = preferredOrder.indexOf(bn)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return users
}

export function wineUserPaths(prefixPath: string): Array<{
  documents: string
  appDataRoaming: string
  localAppData: string
  publicDocuments: string
  programData: string
}> {
  const roots = getWineUserRoots(prefixPath)
  const prefix = expandHome(prefixPath)
  const programData = path.join(prefix, 'drive_c', 'ProgramData')

  const out: Array<{
    documents: string
    appDataRoaming: string
    localAppData: string
    publicDocuments: string
    programData: string
  }> = []

  for (const userRoot of roots) {
    out.push({
      documents: path.join(userRoot, 'Documents'),
      appDataRoaming: path.join(userRoot, 'AppData', 'Roaming'),
      localAppData: path.join(userRoot, 'AppData', 'Local'),
      publicDocuments: path.join(path.dirname(userRoot), 'Public', 'Documents'),
      programData
    })
  }

  return out
}

export function normalizeObjectId(appIdOrObjectId?: string | null): string | null {
  const raw = String(appIdOrObjectId || '').trim()
  if (!raw) return null
  // Hydra uses "objectId" (often steam appid). We'll accept any token-ish value.
  return raw.replace(/[^A-Za-z0-9_\-]/g, '') || null
}

export function candidateAchievementPaths(params: {
  installPath?: string | null
  executablePath?: string | null
  objectId?: string | null
  protonPrefix?: string | null
}): string[] {
  const installPath = params.installPath ? String(params.installPath) : ''
  const exePath = params.executablePath ? String(params.executablePath) : ''
  const objectId = normalizeObjectId(params.objectId)

  const exeDir = exePath ? path.dirname(exePath) : ''

  const candidates: string[] = []

  // Executable-relative patterns (common cracks)
  if (exeDir) {
    candidates.push(path.join(exeDir, 'SteamData', 'user_stats.ini'))
    candidates.push(path.join(exeDir, 'SteamData', 'UserStats', 'achiev.ini'))
    candidates.push(path.join(exeDir, '3DMGAME', 'Player', 'stats', 'achievements.ini'))
  }

  // Install-relative patterns
  if (installPath) {
    candidates.push(path.join(installPath, 'SteamData', 'user_stats.ini'))
    candidates.push(path.join(installPath, 'SteamData', 'UserStats', 'achiev.ini'))
    candidates.push(path.join(installPath, '3DMGAME', 'Player', 'stats', 'achievements.ini'))
    candidates.push(path.join(installPath, 'steam_settings', 'achievements.json'))
  }

  // Windows-known locations
  if (process.platform === 'win32' && objectId) {
    const { appData, localAppData, programData, publicDocuments, documents } = guessWindowsPaths()
    candidates.push(winJoin(appData, 'Goldberg SteamEmu Saves', objectId, 'achievements.json'))
    candidates.push(winJoin(appData, 'GSE Saves', objectId, 'achievements.json'))

    candidates.push(winJoin(publicDocuments, 'OnlineFix', objectId, 'Achievements.ini'))
    candidates.push(winJoin(publicDocuments, 'OnlineFix', objectId, 'Stats', 'Achievements.ini'))

    candidates.push(winJoin(publicDocuments, 'Steam', 'CODEX', objectId, 'achievements.ini'))
    candidates.push(winJoin(appData, 'Steam', 'CODEX', objectId, 'achievements.ini'))

    candidates.push(winJoin(publicDocuments, 'Steam', 'RUNE', objectId, 'achievements.ini'))
    candidates.push(winJoin(appData, 'Steam', 'RUNE', objectId, 'achievements.ini'))

    candidates.push(winJoin(programData, 'RLD!', objectId, 'achievements.ini'))
    candidates.push(winJoin(programData, 'Steam', 'Player', objectId, 'stats', 'achievements.ini'))
    candidates.push(winJoin(programData, 'Steam', 'RLD!', objectId, 'stats', 'achievements.ini'))
    candidates.push(winJoin(programData, 'Steam', 'dodi', objectId, 'stats', 'achievements.ini'))

    candidates.push(winJoin(appData, 'RLE', objectId, 'achievements.ini'))
    candidates.push(winJoin(appData, 'RLE', objectId, 'Achievements.ini'))

    candidates.push(winJoin(appData, 'CreamAPI', objectId, 'stats', 'CreamAPI.Achievements.cfg'))

    candidates.push(winJoin(appData, 'EMPRESS', 'remote', objectId, 'achievements.json'))
    candidates.push(winJoin(publicDocuments, 'EMPRESS', objectId, 'remote', objectId, 'achievements.json'))

    candidates.push(winJoin(appData, '.1911', objectId, 'achievement'))

    candidates.push(winJoin(documents, 'SKIDROW', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))
    candidates.push(winJoin(documents, 'Player', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))
    candidates.push(winJoin(localAppData, 'SKIDROW', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))

    candidates.push(winJoin(appData, 'SmartSteamEmu', objectId, 'User', 'Achievements.ini'))
  }

  // Proton/Wine prefix known locations (Linux)
  if (process.platform !== 'win32' && params.protonPrefix && objectId) {
    const roots = wineUserPaths(params.protonPrefix)
    for (const u of roots) {
      candidates.push(path.join(u.appDataRoaming, 'Goldberg SteamEmu Saves', objectId, 'achievements.json'))
      candidates.push(path.join(u.appDataRoaming, 'GSE Saves', objectId, 'achievements.json'))

      candidates.push(path.join(u.publicDocuments, 'OnlineFix', objectId, 'Achievements.ini'))
      candidates.push(path.join(u.publicDocuments, 'OnlineFix', objectId, 'Stats', 'Achievements.ini'))

      candidates.push(path.join(u.publicDocuments, 'Steam', 'CODEX', objectId, 'achievements.ini'))
      candidates.push(path.join(u.appDataRoaming, 'Steam', 'CODEX', objectId, 'achievements.ini'))

      candidates.push(path.join(u.publicDocuments, 'Steam', 'RUNE', objectId, 'achievements.ini'))
      candidates.push(path.join(u.appDataRoaming, 'Steam', 'RUNE', objectId, 'achievements.ini'))

      candidates.push(path.join(u.programData, 'RLD!', objectId, 'achievements.ini'))
      candidates.push(path.join(u.programData, 'Steam', 'Player', objectId, 'stats', 'achievements.ini'))
      candidates.push(path.join(u.programData, 'Steam', 'RLD!', objectId, 'stats', 'achievements.ini'))
      candidates.push(path.join(u.programData, 'Steam', 'dodi', objectId, 'stats', 'achievements.ini'))

      candidates.push(path.join(u.appDataRoaming, 'RLE', objectId, 'achievements.ini'))
      candidates.push(path.join(u.appDataRoaming, 'RLE', objectId, 'Achievements.ini'))

      candidates.push(path.join(u.appDataRoaming, 'CreamAPI', objectId, 'stats', 'CreamAPI.Achievements.cfg'))

      candidates.push(path.join(u.appDataRoaming, 'EMPRESS', 'remote', objectId, 'achievements.json'))
      candidates.push(path.join(u.publicDocuments, 'EMPRESS', objectId, 'remote', objectId, 'achievements.json'))

      candidates.push(path.join(u.appDataRoaming, '.1911', objectId, 'achievement'))

      candidates.push(path.join(u.documents, 'SKIDROW', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))
      candidates.push(path.join(u.documents, 'Player', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))
      candidates.push(path.join(u.localAppData, 'SKIDROW', objectId, 'SteamEmu', 'UserStats', 'achiev.ini'))

      candidates.push(path.join(u.appDataRoaming, 'SmartSteamEmu', objectId, 'User', 'Achievements.ini'))
    }
  }

  // De-dupe
  return Array.from(new Set(candidates.filter(Boolean)))
}
