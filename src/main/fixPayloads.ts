/**
 * Fetches and installs the files a fix points at.
 *
 * The rules these files travel under are in src/shared/fixDownloads.ts; this is
 * the half that touches the disk, and it assumes none of them. Everything is
 * checked again here — the URL, the hash, every destination path, every entry
 * that comes out of the archive — because a fix reaches this point from a file
 * someone was sent, and the renderer that asked for it is not a trust boundary.
 *
 * What lands where is bounded twice over: the destination has to resolve inside
 * the game's folder or inside the user profile of its Wine prefix, and the
 * source has to resolve inside the folder the archive was unpacked into. A file
 * that is replaced is copied aside first, so a fix that turns out to be wrong
 * is undone by putting the backup back rather than by reinstalling the game.
 */
import { app } from 'electron'
import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { extractZipWithPassword } from './zip'
import {
  MAX_FIX_DOWNLOAD_BYTES,
  isAllowedFixDownloadUrl,
  parseInstallTarget,
  type FixDownload
} from '../shared/fixDownloads'

export type FixPayloadPhase = 'download' | 'extract' | 'install'

export type FixPayloadProgress = {
  downloadId: string
  label: string
  phase: FixPayloadPhase
  percent: number
}

export type FixPayloadResult = {
  installed: string[]
  warnings: string[]
  backupDir?: string
}

/** Where a fix is allowed to put a file, resolved for one game. */
type InstallRoots = { game: string; prefix: string | null }

const BACKUP_FOLDER = '_voidlauncher-backup'

/**
 * `prefix:` means the same thing on both systems — the Windows user profile the
 * game sees — which is why one install rule works for both. Under Proton that
 * is the prefix's steamuser folder; on Windows it is the real profile. Either
 * way it is the profile and nothing above it: never system32, never the prefix
 * root.
 */
function resolveRoots(game: any): InstallRoots {
  const install = String(game?.install_path || '').trim()
  if (!install || !fs.existsSync(install)) {
    throw new Error('Pasta do jogo não encontrada')
  }

  let profile = ''
  if (process.platform === 'win32') {
    profile = os.homedir()
  } else {
    const prefix = String(game?.proton_prefix || '').trim()
    profile = prefix ? path.join(prefix, 'pfx', 'drive_c', 'users', 'steamuser') : ''
  }

  return {
    game: path.resolve(install),
    prefix: profile && fs.existsSync(profile) ? path.resolve(profile) : null
  }
}

function archiveExtension(url: string): string {
  try {
    const name = new URL(url).pathname.toLowerCase()
    const match = /\.(zip|7z|rar)$/.exec(name)
    return match ? `.${match[1]}` : '.zip'
  } catch {
    return '.zip'
  }
}

/** True when `child` is `parent` itself or something under it. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function downloadAndVerify(
  download: FixDownload,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  if (!isAllowedFixDownloadUrl(download.url)) throw new Error('URL de download não permitida')

  const hash = crypto.createHash('sha256')
  let received = 0

  const response = await axios.get(download.url, {
    responseType: 'stream',
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 300
  })

  const declared = parseInt(String(response.headers['content-length'] || '0'), 10)
  if (declared > MAX_FIX_DOWNLOAD_BYTES) {
    response.data.destroy()
    throw new Error('Arquivo maior que o limite permitido para um fix')
  }

  const total = declared > 0 ? declared : download.size || 0
  const writer = fs.createWriteStream(destPath)

  try {
    await new Promise<void>((resolve, reject) => {
      let lastEmit = 0

      response.data.on('data', (chunk: Buffer) => {
        received += chunk.length
        // The cap is enforced on what actually arrives, not on what the server
        // said it would send.
        if (received > MAX_FIX_DOWNLOAD_BYTES) {
          response.data.destroy()
          reject(new Error('Arquivo maior que o limite permitido para um fix'))
          return
        }
        hash.update(chunk)

        const now = Date.now()
        if (total > 0 && now - lastEmit > 250) {
          lastEmit = now
          onProgress(Math.min(99, (received / total) * 100))
        }
      })

      response.data.on('error', reject)
      writer.on('error', reject)
      writer.on('finish', () => resolve())
      response.data.pipe(writer)
    })
  } finally {
    try { writer.destroy() } catch { /* already closed */ }
  }

  const digest = hash.digest('hex')
  if (digest !== download.sha256) {
    try { fs.rmSync(destPath, { force: true }) } catch { /* nothing to clean */ }
    throw new Error(`O arquivo baixado não confere com o sha256 do fix (recebido ${digest.slice(0, 16)}…)`)
  }
}

/**
 * Copies one folder into another, one file at a time, refusing anything that
 * would land outside `destRoot` and backing up whatever it replaces.
 */
function copyInto(
  sourceDir: string,
  destDir: string,
  destRoot: string,
  backupDir: string | null,
  result: { installed: string[]; warnings: string[] }
): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name)
    const dest = path.resolve(destDir, entry.name)

    if (!isInside(destRoot, dest)) {
      result.warnings.push(`Destino fora da pasta permitida, ignorado: ${entry.name}`)
      continue
    }

    // A symlink in the archive is a way to write through a folder that is
    // itself inside the allowed root, so none are followed or recreated.
    if (entry.isSymbolicLink()) {
      result.warnings.push(`Link simbólico ignorado: ${entry.name}`)
      continue
    }

    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      copyInto(source, dest, destRoot, backupDir ? path.join(backupDir, entry.name) : null, result)
      continue
    }

    if (!entry.isFile()) continue

    if (fs.existsSync(dest) && backupDir) {
      const backup = path.join(backupDir, entry.name)
      // Only the first time: the backup is what was there before this fix, not
      // what the fix itself wrote on an earlier run.
      if (!fs.existsSync(backup)) {
        fs.mkdirSync(backupDir, { recursive: true })
        fs.copyFileSync(dest, backup)
      }
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(source, dest)
    result.installed.push(path.relative(destRoot, dest))
  }
}

export async function installFixDownloads(options: {
  game: any
  fixId: string
  downloads: FixDownload[]
  onProgress?: (progress: FixPayloadProgress) => void
}): Promise<FixPayloadResult> {
  const { game, fixId, downloads, onProgress } = options
  const result: FixPayloadResult = { installed: [], warnings: [] }
  if (!downloads.length) return result

  const roots = resolveRoots(game)
  const backupRoot = path.join(roots.game, BACKUP_FOLDER, fixId.replace(/[^A-Za-z0-9_-]+/g, '-'))
  const tmpRoot = path.join(app.getPath('userData'), 'tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const workRoot = fs.mkdtempSync(path.join(tmpRoot, 'fix-download-'))

  try {
    for (const download of downloads) {
      const report = (phase: FixPayloadPhase, percent: number) =>
        onProgress?.({ downloadId: download.id, label: download.label, phase, percent })

      report('download', 0)
      // Keeps the archive's own extension: 7z picks its reader from the
      // signature, but the RAR fallback goes by the name.
      const archivePath = path.join(workRoot, `${download.id}${archiveExtension(download.url)}`)
      await downloadAndVerify(download, archivePath, (percent) => report('download', percent))

      report('extract', 0)
      const extractDir = path.join(workRoot, `${download.id}-files`)
      fs.mkdirSync(extractDir, { recursive: true })
      await extractZipWithPassword(archivePath, extractDir, undefined, (percent: number) => report('extract', percent))
      try { fs.rmSync(archivePath, { force: true }) } catch { /* keeps the temp dir tidy, nothing more */ }

      report('install', 0)
      for (const rule of download.install) {
        const target = parseInstallTarget(rule.into)
        if (!target) {
          result.warnings.push(`Destino inválido, ignorado: ${rule.into}`)
          continue
        }

        const root = target.root === 'game' ? roots.game : roots.prefix
        if (!root) {
          result.warnings.push('O prefixo Proton ainda não existe; prepare-o antes de instalar os arquivos deste fix.')
          continue
        }

        const source = path.resolve(extractDir, rule.from)
        if (!isInside(extractDir, source) || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
          result.warnings.push(`O arquivo baixado não contém a pasta "${rule.from || '.'}".`)
          continue
        }

        const dest = path.resolve(root, target.path)
        if (!isInside(root, dest)) {
          result.warnings.push(`Destino fora da pasta permitida, ignorado: ${rule.into}`)
          continue
        }

        fs.mkdirSync(dest, { recursive: true })
        copyInto(
          source,
          dest,
          root,
          path.join(backupRoot, target.root, target.path),
          result
        )
      }

      report('install', 100)
    }
  } finally {
    try { fs.rmSync(workRoot, { recursive: true, force: true }) } catch { /* temp dir, next run makes another */ }
  }

  if (fs.existsSync(backupRoot)) result.backupDir = backupRoot
  return result
}
