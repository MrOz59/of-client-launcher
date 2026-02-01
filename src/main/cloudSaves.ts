import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import archiver from 'archiver'

import * as drive from './drive'
import {
  ludusaviBackupOne,
  ludusaviPreviewBackupOne,
  ludusaviRestoreOne,
  ensureLudusaviAvailable,
  resolveLudusaviBinary,
  resolveLudusaviGameName
} from './ludusavi'
import { detectSaveLocations, detectSaveLocationsAsync, DetectedSaveLocation } from './saveDetector'

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function guessWinePrefixFromCompatData(prefixPath?: string | null): string | undefined {
  const raw = String(prefixPath || '').trim()
  if (!raw) return undefined
  const normalized = raw
  if (normalized.endsWith(`${path.sep}pfx`)) return normalized
  const pfx = path.join(normalized, 'pfx')
  if (fs.existsSync(pfx)) return pfx
  return normalized
}

function newestZipInDir(dir: string, minMtimeMs?: number): string | null {
  try {
    if (!fs.existsSync(dir)) return null
    const entries = fs.readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.zip'))
      .map((n) => path.join(dir, n))

    let best: { p: string; m: number } | null = null
    for (const p of entries) {
      let st: fs.Stats
      try {
        st = fs.statSync(p)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (minMtimeMs != null && st.mtimeMs < minMtimeMs) continue
      if (!best || st.mtimeMs > best.m) best = { p, m: st.mtimeMs }
    }
    return best?.p || null
  } catch {
    return null
  }
}

export type CloudSaveSyncOptions = {
  gameUrl?: string
  title?: string
  steamAppId?: string | null
  protonPrefix?: string | null
}

export function computeCloudSavesGameKey(opts: CloudSaveSyncOptions): string {
  const steam = String(opts.steamAppId || '').trim()
  if (steam && /^\d+$/.test(steam)) return `steam_${steam}`
  const title = String(opts.title || '').trim()
  if (title) return `title_${slugify(title)}`
  const url = String(opts.gameUrl || '').trim()
  return `url_${slugify(url || 'game')}`
}

function ludusaviConfigDir(): string {
  return path.join(app.getPath('userData'), 'ludusavi-config')
}

function ludusaviBackupDirForGame(gameKey: string): string {
  return path.join(app.getPath('userData'), 'ludusavi-backups', gameKey)
}

export function getLocalLudusaviBackupDir(opts: CloudSaveSyncOptions): string {
  const gameKey = computeCloudSavesGameKey(opts)
  return ludusaviBackupDirForGame(gameKey)
}

function remotePrefixForGame(gameKey: string): string {
  // New canonical prefix (so we can store conflicts without them being auto-restored)
  return `ludusavi_${gameKey}__main_`
}

function remoteLegacyPrefixForGame(gameKey: string): string {
  // Backward compatibility with earlier builds
  return `ludusavi_${gameKey}_`
}

function remoteConflictPrefixForGame(gameKey: string): string {
  return `ludusavi_${gameKey}__conflict_`
}

const DRIVE_KEEP_MAIN_BACKUPS = 10
const DRIVE_KEEP_CONFLICT_BACKUPS = 5
const DRIVE_KEEP_LEGACY_BACKUPS = 2

function parseDriveModifiedTimeMs(modifiedTime?: string): number | null {
  if (!modifiedTime) return null
  const ms = new Date(modifiedTime).getTime()
  return Number.isFinite(ms) ? ms : null
}

function findNewestTimestampMsFromJson(value: any): number | null {
  let best: number | null = null
  const seen = new Set<any>()

  const consider = (n: number) => {
    if (!Number.isFinite(n)) return
    if (n < 0) return
    if (best == null || n > best) best = n
  }

  const walk = (v: any, keyHint?: string) => {
    if (v == null) return
    if (typeof v === 'object') {
      if (seen.has(v)) return
      seen.add(v)
    }

    if (typeof v === 'number') {
      // Heuristic: epoch seconds vs ms
      if (v > 1e12) consider(v)
      else if (v > 1e9) consider(v * 1000)
      return
    }

    if (typeof v === 'string') {
      const s = v.trim()
      // Only treat as time when keys look like timestamps or strings look like ISO
      const key = String(keyHint || '').toLowerCase()
      const keyLooksTime = /(time|mtime|modified|updated|timestamp|latest|newest)/.test(key)
      if (keyLooksTime || /^\d{4}-\d{2}-\d{2}t/i.test(s)) {
        const ms = new Date(s).getTime()
        if (Number.isFinite(ms)) consider(ms)
      }
      return
    }

    if (Array.isArray(v)) {
      for (const item of v) walk(item, keyHint)
      return
    }

    if (typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        walk(item, k)
      }
    }
  }

  walk(value)
  return best
}

async function getLocalSaveStateMsViaPreview(opts: {
  configDir: string
  backupDir: string
  gameName: string
  winePrefix?: string
}): Promise<number | null> {
  const res = await ludusaviPreviewBackupOne(opts)
  if (!res.ok || !res.json) return null
  return findNewestTimestampMsFromJson(res.json)
}

async function getNewestRemoteForGameKey(gameKey: string): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  // Prefer new canonical prefix; fall back to legacy prefix.
  const canonical = await drive.getNewestRemoteFileByPrefix(remotePrefixForGame(gameKey))
  if (canonical) return canonical
  return await drive.getNewestRemoteFileByPrefix(remoteLegacyPrefixForGame(gameKey))
}

/**
 * Create a zip backup of detected save locations using system zip command
 */
async function createHeuristicBackup(
  locations: DetectedSaveLocation[],
  backupDir: string,
  gameTitle?: string
): Promise<{ success: boolean; zipPath?: string; message?: string }> {
  if (locations.length === 0) {
    return { success: false, message: 'Nenhuma pasta de saves detectada.' }
  }

  ensureDir(backupDir)
  
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = slugify(gameTitle || 'game')
  const zipName = `heuristic_${safeName}_${ts}.zip`
  const zipPath = path.join(backupDir, zipName)

  // Filter to only high/medium confidence and existing paths with actual content
  const validLocations = locations.filter(l => {
    if (l.confidence !== 'high' && l.confidence !== 'medium') return false
    if (!fs.existsSync(l.path)) return false
    // Skip empty folders or folders with no recent activity
    if ((l.saveFileCount || 0) === 0 && !l.lastModified) return false
    return true
  })

  if (validLocations.length === 0) {
    return { success: false, message: 'Nenhuma pasta de saves válida encontrada.' }
  }

  console.log('[CloudSaves] Creating heuristic backup with', validLocations.length, 'locations')
  for (const loc of validLocations) {
    console.log(`  - ${loc.type}: ${loc.path} (${loc.saveFileCount || 0} files)`)
  }

  try {
    // Create manifest with metadata
    const manifest = {
      created: new Date().toISOString(),
      gameTitle,
      locations: validLocations.map(l => ({
        path: l.path,
        type: l.type,
        confidence: l.confidence,
        steamAppId: l.steamAppId,
        gameName: l.gameName,
        saveFileCount: l.saveFileCount,
        totalSize: l.totalSize,
        lastModified: l.lastModified?.toISOString()
      }))
    }

    // Create zip using archiver (no external zip command needed)
    return new Promise((resolve) => {
      const output = fs.createWriteStream(zipPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => {
        const size = archive.pointer()
        console.log('[CloudSaves] Heuristic backup created:', zipPath, `(${(size / 1024).toFixed(1)} KB)`)
        resolve({ success: true, zipPath })
      })

      archive.on('error', (err) => {
        console.error('[CloudSaves] Archive error:', err)
        resolve({ success: false, message: err.message })
      })

      archive.pipe(output)

      // Add manifest
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

      // Add each save location as a directory
      for (let i = 0; i < validLocations.length; i++) {
        const loc = validLocations[i]
        const folderName = `${i}_${loc.type}_${loc.steamAppId || loc.gameName || 'saves'}`.replace(/[^a-zA-Z0-9_-]/g, '_')
        
        // Add directory contents to archive
        archive.directory(loc.path, folderName)
      }

      archive.finalize()
    })
  } catch (err: any) {
    console.error('[CloudSaves] Failed to create heuristic backup:', err)
    return { success: false, message: err?.message || String(err) }
  }
}

export async function restoreCloudSavesBeforeLaunch(opts: CloudSaveSyncOptions): Promise<{ success: boolean; message?: string; skipped?: boolean }> {
  // Check if cloud saves feature is enabled
  if (!drive.isCloudSavesEnabled()) {
    return { success: true, skipped: true, message: 'Cloud Saves desabilitado.' }
  }
  await ensureLudusaviAvailable({ allowDownload: true })
  const bin = await resolveLudusaviBinary()
  if (!bin) return { success: true, skipped: true, message: 'Ludusavi não encontrado; pulando restore.' }

  const gameKey = computeCloudSavesGameKey(opts)
  const remote = await getNewestRemoteForGameKey(gameKey)
  if (!remote) return { success: true, skipped: true, message: 'Nenhum backup remoto encontrado.' }

  const configDir = ludusaviConfigDir()
  const backupDir = ludusaviBackupDirForGame(gameKey)
  ensureDir(configDir)
  ensureDir(backupDir)

  const resolvedName = await resolveLudusaviGameName({ steamId: opts.steamAppId, title: opts.title })
  if (!resolvedName) return { success: false, message: 'Não foi possível identificar o jogo no Ludusavi.' }

  // Steam Cloud-like decision: only restore if remote appears newer than live local saves.
  const winePrefix = guessWinePrefixFromCompatData(opts.protonPrefix)
  const localStateMs = await getLocalSaveStateMsViaPreview({ configDir, backupDir, gameName: resolvedName, winePrefix })
  const remoteMs = parseDriveModifiedTimeMs(remote.modifiedTime)
  const DRIFT_MS = 30_000
  if (localStateMs != null && remoteMs != null && localStateMs > remoteMs + DRIFT_MS) {
    return { success: true, skipped: true, message: 'Saves locais parecem mais novos; ignorando restore remoto.' }
  }

  const localZip = path.join(backupDir, remote.name)
  const dl = await drive.downloadSave(remote.id, localZip)
  if (!dl.success) return { success: false, message: dl.message || 'Falha ao baixar backup do Drive.' }

  const res = await ludusaviRestoreOne({ configDir, backupDir, gameName: resolvedName })
  if (!res.ok) {
    return { success: false, message: res.stderr || res.stdout || 'Ludusavi restore falhou.' }
  }

  return { success: true }
}

export async function backupCloudSavesAfterExit(opts: CloudSaveSyncOptions): Promise<{ success: boolean; message?: string; skipped?: boolean; fileId?: string }> {
  // Check if cloud saves feature is enabled
  if (!drive.isCloudSavesEnabled()) {
    return { success: true, skipped: true, message: 'Cloud Saves desabilitado.' }
  }

  const gameKey = computeCloudSavesGameKey(opts)
  const configDir = ludusaviConfigDir()
  const backupDir = ludusaviBackupDirForGame(gameKey)
  ensureDir(configDir)
  ensureDir(backupDir)

  const startedAt = Date.now()
  const winePrefix = guessWinePrefixFromCompatData(opts.protonPrefix)

  // Try Ludusavi first
  await ensureLudusaviAvailable({ allowDownload: true })
  const bin = await resolveLudusaviBinary()
  const resolvedName = bin ? await resolveLudusaviGameName({ steamId: opts.steamAppId, title: opts.title }) : null

  let zipPath: string | null = null
  let usedHeuristic = false

  if (bin && resolvedName) {
    // Compare live local state vs remote before uploading, to avoid overwriting newer cloud saves.
    const localStateMs = await getLocalSaveStateMsViaPreview({ configDir, backupDir, gameName: resolvedName, winePrefix })
    const remote = await getNewestRemoteForGameKey(gameKey)
    const remoteMs = parseDriveModifiedTimeMs(remote?.modifiedTime)

    const backupRes = await ludusaviBackupOne({ configDir, backupDir, gameName: resolvedName, winePrefix })
    if (backupRes.ok) {
      zipPath = newestZipInDir(backupDir, startedAt - 5000)
    }
    
    if (!zipPath) {
      console.log('[CloudSaves] Ludusavi backup produced no zip, trying heuristic detection...')
    }
  } else {
    console.log('[CloudSaves] Ludusavi unavailable or game not found, trying heuristic detection...')
  }

  // Fallback to heuristic detection if Ludusavi failed
  if (!zipPath && winePrefix) {
    console.log('[CloudSaves] Using heuristic save detection (includes PCGamingWiki lookup)...')
    
    // Use async version that includes PCGamingWiki lookup
    const detected = await detectSaveLocationsAsync({
      winePrefix,
      gameTitle: opts.title || undefined,
      steamAppId: opts.steamAppId || undefined
    })

    if (detected.length > 0) {
      console.log('[CloudSaves] Detected', detected.length, 'save locations via heuristics/PCGamingWiki')
      const heuristicResult = await createHeuristicBackup(detected, backupDir, opts.title || undefined)
      if (heuristicResult.success && heuristicResult.zipPath) {
        zipPath = heuristicResult.zipPath
        usedHeuristic = true
      }
    } else {
      console.log('[CloudSaves] No save locations detected via heuristics/PCGamingWiki')
    }
  }

  if (!zipPath) {
    return { success: false, message: 'Nenhum save encontrado (Ludusavi e heurística falharam).' }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')

  // For heuristic backups, always upload as main (no conflict detection without Ludusavi timestamps)
  const prefix = usedHeuristic ? remotePrefixForGame(gameKey) : remotePrefixForGame(gameKey)
  const remoteName = `${prefix}${ts}.zip`
  const up = await drive.uploadSave(zipPath, remoteName)
  if (!up.success) return { success: false, message: up.message || 'Falha ao enviar backup ao Drive.' }

  // Prevent infinite Drive growth: keep a small history per gameKey.
  try {
    await drive.pruneFilesByNamePrefix(remotePrefixForGame(gameKey), DRIVE_KEEP_MAIN_BACKUPS)
    await drive.pruneFilesByNamePrefix(remoteConflictPrefixForGame(gameKey), DRIVE_KEEP_CONFLICT_BACKUPS)
    await drive.pruneFilesByNamePrefix(remoteLegacyPrefixForGame(gameKey), DRIVE_KEEP_LEGACY_BACKUPS)
  } catch {
    // ignore pruning failures
  }

  const methodUsed = usedHeuristic ? 'heurística' : 'Ludusavi'
  return { success: true, fileId: up.id, message: `Backup realizado via ${methodUsed}.` }
}

export async function syncCloudSavesManual(opts: CloudSaveSyncOptions): Promise<{ success: boolean; message?: string }> {
  const restore = await restoreCloudSavesBeforeLaunch(opts)
  if (!restore.success) return { success: false, message: restore.message }

  // If there was nothing to restore, still ensure we have at least one backup in the cloud.
  const backup = await backupCloudSavesAfterExit(opts)
  if (!backup.success) return { success: false, message: backup.message }

  const restoreSkipped = Boolean((restore as any)?.skipped)
  const backupSkipped = Boolean((backup as any)?.skipped)
  if (restoreSkipped && backupSkipped) {
    return { success: false, message: 'Ludusavi não encontrado; usando método legado.' }
  }

  return { success: true }
}
