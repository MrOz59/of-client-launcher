import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

import https from 'https'
import os from 'os'

export type LudusaviExecResult = {
  ok: boolean
  code?: number | null
  stdout: string
  stderr: string
  json?: any
}

function spawnAndCapture(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<LudusaviExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...(opts?.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    const timeout = opts?.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }, opts.timeoutMs)
      : null

    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf-8')
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf-8')
    })

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout)

      let json: any | undefined
      const trimmed = stdout.trim()
      if (trimmed) {
        try {
          json = JSON.parse(trimmed)
        } catch {
          // not JSON
        }
      }

      resolve({ ok: code === 0, code, stdout, stderr, json })
    })

    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout)
      resolve({ ok: false, code: null, stdout, stderr: stderr + String(err) })
    })
  })
}

function tryResolveBinaryFromEnv(): string | null {
  const raw = String(process.env.LUDUSAVI_PATH || '').trim()
  if (!raw) return null
  const expanded = raw.startsWith('~') ? path.join(process.env.HOME || '', raw.slice(1)) : raw
  if (fs.existsSync(expanded)) return expanded
  return raw
}

function tryResolveBundledBinary(): string | null {
  // Packaged app: bundled under resources/ludusavi/<platform>-<arch>/ludusavi(.exe)
  if (app?.isPackaged && process.resourcesPath) {
    const folder = `${process.platform}-${process.arch}`
    const exe = process.platform === 'win32' ? 'ludusavi.exe' : 'ludusavi'
    const candidate = path.join(process.resourcesPath, 'ludusavi', folder, exe)
    if (fs.existsSync(candidate)) return candidate
  }

  // Downloaded at runtime: userData/tools/ludusavi/<platform>-<arch>/ludusavi(.exe)
  try {
    const folder = `${process.platform}-${process.arch}`
    const exe = process.platform === 'win32' ? 'ludusavi.exe' : 'ludusavi'
    const candidate = path.join(app.getPath('userData'), 'tools', 'ludusavi', folder, exe)
    if (fs.existsSync(candidate)) return candidate
  } catch {
    // ignore
  }

  // Dev: allow a vendored binary downloaded by scripts/fetch-ludusavi.js
  try {
    const folder = `${process.platform}-${process.arch}`
    const exe = process.platform === 'win32' ? 'ludusavi.exe' : 'ludusavi'
    const candidate = path.join(process.cwd(), 'vendor', 'ludusavi', folder, exe)
    if (fs.existsSync(candidate)) return candidate
  } catch {
    // ignore
  }

  return null
}

function httpGetJson(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'voidlauncher-ludusavi'
        }
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`))
            return
          }
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error('timeout'))
      } catch {
        // ignore
      }
    })
    req.end()
  })
}

function httpDownload(url: string, destFile: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'voidlauncher-ludusavi'
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpDownload(res.headers.location, destFile, timeoutMs).then(resolve, reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`download failed: HTTP ${res.statusCode}`))
          return
        }
        const out = fs.createWriteStream(destFile)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve()))
        out.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error('timeout'))
      } catch {
        // ignore
      }
    })
    req.end()
  })
}

function mkdirp(p: string) {
  try {
    fs.mkdirSync(p, { recursive: true })
  } catch {
    // ignore
  }
}

function rimraf(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function findFileRecursive(root: string, predicate: (p: string) => boolean, maxFiles = 5000): string | null {
  const stack = [root]
  let seen = 0

  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const ent of entries) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(p)
      } else if (ent.isFile()) {
        seen++
        if (predicate(p)) return p
        if (seen > maxFiles) return null
      }
    }
  }

  return null
}

function selectLudusaviAsset(assets: any[], platform: NodeJS.Platform, arch: string): any | null {
  const name = (a: any) => String(a?.name || '').toLowerCase()

  const platformNeedles =
    platform === 'win32'
      ? ['windows', 'win']
      : platform === 'darwin'
        ? ['macos', 'mac', 'osx']
        : ['linux']

  const archNeedles =
    arch === 'x64'
      ? ['x86_64', 'x64', 'amd64', 'win64', 'win-x64']
      : arch === 'arm64'
        ? ['aarch64', 'arm64']
        : [arch]

  const isArchive = (n: string) => n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz')

  const scored = (assets || [])
    .filter((a) => isArchive(name(a)))
    .map((a) => {
      const n = name(a)
      let score = 0

      const hasPlatform = platformNeedles.some((p) => n.includes(p))
      const hasArch = archNeedles.some((r) => n.includes(r))

      if (hasPlatform) score += 10
      if (hasArch) score += 10

      // Linux asset sometimes omits arch (e.g. "...-linux.tar.gz")
      if (!hasArch && platform === 'linux' && arch === 'x64' && hasPlatform) {
        const looksArm = n.includes('arm') || n.includes('aarch64')
        if (!looksArm) score += 10
      }

      // Windows asset may use "win64" without explicit x64 needle.
      if (!hasArch && platform === 'win32' && arch === 'x64' && hasPlatform) {
        const looksArm = n.includes('arm') || n.includes('aarch64')
        const looks64 = n.includes('64')
        if (looks64 && !looksArm) score += 10
      }

      if (n.includes('cli')) score += 2
      if (n.includes('gui')) score -= 1
      if (platform === 'linux' && (n.endsWith('.tar.gz') || n.endsWith('.tgz'))) score += 1
      if (platform === 'win32' && n.endsWith('.zip')) score += 1

      return { a, score }
    })
    .sort((x, y) => y.score - x.score)

  const best = scored[0]
  if (!best || best.score < 20) return null
  return best.a
}

async function extractArchive(archivePath: string, extractDir: string, timeoutMs: number): Promise<void> {
  const lower = archivePath.toLowerCase()
  mkdirp(extractDir)

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const r = await spawnAndCapture('tar', ['-xzf', archivePath, '-C', extractDir], { timeoutMs })
    if (!r.ok) throw new Error(r.stderr || r.stdout || 'failed to extract tar.gz')
    return
  }

  if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const ps = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
      ]
      const r = await spawnAndCapture('powershell', ps, { timeoutMs })
      if (!r.ok) throw new Error(r.stderr || r.stdout || 'failed to extract zip')
      return
    }

    // On Linux, prefer system unzip if present.
    const r = await spawnAndCapture('unzip', ['-o', archivePath, '-d', extractDir], { timeoutMs })
    if (!r.ok) throw new Error(r.stderr || r.stdout || 'failed to extract zip')
    return
  }

  throw new Error(`unsupported archive type: ${path.basename(archivePath)}`)
}

export async function ensureLudusaviAvailable(options?: {
  version?: string
  repo?: string
  timeoutMs?: number
  allowDownload?: boolean
}): Promise<{ ok: boolean; path?: string; message?: string; downloaded?: boolean }> {
  if (!process.versions?.electron) {
    return { ok: false, message: 'Auto-download do Ludusavi requer runtime do Electron.' }
  }

  const already = await resolveLudusaviBinary()
  if (already) return { ok: true, path: already, downloaded: false }

  if (options?.allowDownload === false) {
    return { ok: false, message: 'Ludusavi não encontrado e auto-download desativado.' }
  }

  const version = String(options?.version || process.env.LUDUSAVI_VERSION || '0.30.0').replace(/^v/, '')
  const repo = String(options?.repo || process.env.LUDUSAVI_REPO || 'mtkennerly/ludusavi')
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? (options!.timeoutMs as number) : 60_000

  const folder = `${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'ludusavi.exe' : 'ludusavi'
  const outDir = path.join(app.getPath('userData'), 'tools', 'ludusavi', folder)
  const destExe = path.join(outDir, exe)
  if (fs.existsSync(destExe)) return { ok: true, path: destExe, downloaded: false }

  // Fetch release asset from GitHub
  const releaseUrl = `https://api.github.com/repos/${repo}/releases/tags/v${version}`
  const release = await httpGetJson(releaseUrl, timeoutMs)
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const asset = selectLudusaviAsset(assets, process.platform, process.arch)
  if (!asset?.browser_download_url || !asset?.name) {
    return { ok: false, message: `Não foi possível encontrar asset do Ludusavi para ${folder} (v${version}).` }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voidlauncher-ludusavi-'))
  const archivePath = path.join(tmpRoot, String(asset.name))
  const extractDir = path.join(tmpRoot, 'extract')

  try {
    await httpDownload(String(asset.browser_download_url), archivePath, timeoutMs)
    await extractArchive(archivePath, extractDir, timeoutMs)

    const found = findFileRecursive(extractDir, (p) => path.basename(p).toLowerCase() === exe)
    if (!found) return { ok: false, message: `Archive do Ludusavi não contém ${exe}.` }

    rimraf(outDir)
    mkdirp(outDir)
    fs.copyFileSync(found, destExe)
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(destExe, 0o755)
      } catch {
        // ignore
      }
    }
    fs.writeFileSync(path.join(outDir, 'VERSION.txt'), `v${version}\n`, 'utf8')

    return { ok: true, path: destExe, downloaded: true }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) }
  } finally {
    rimraf(tmpRoot)
  }
}

async function resolveFromPath(): Promise<string | null> {
  const candidates = process.platform === 'win32' ? ['ludusavi.exe', 'ludusavi'] : ['ludusavi']
  for (const bin of candidates) {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    const res = await spawnAndCapture(probe, [bin], { timeoutMs: 2000 })
    if (res.ok) {
      const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
      if (first) return first
      return bin
    }
  }
  return null
}

export async function resolveLudusaviBinary(): Promise<string | null> {
  const env = tryResolveBinaryFromEnv()
  if (env) return env

  const bundled = tryResolveBundledBinary()
  if (bundled) return bundled

  return await resolveFromPath()
}

export async function runLudusavi(args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<LudusaviExecResult> {
  const bin = await resolveLudusaviBinary()
  if (!bin) {
    return { ok: false, code: null, stdout: '', stderr: 'Ludusavi não encontrado no PATH (instale `ludusavi` ou defina LUDUSAVI_PATH).'
    }
  }
  return await spawnAndCapture(bin, args, opts)
}

function extractFirstGameName(obj: any): string | null {
  // Ludusavi find --api returns: { "games": { "Game Name": { "score": 0.85 }, ... } }
  // We need to extract the first game name from the keys
  const games = obj?.games
  if (games && typeof games === 'object') {
    const names = Object.keys(games)
    if (names.length > 0) {
      // Return the first/best match (they should be sorted by score)
      return names[0]
    }
  }
  
  // Also try legacy format with arrays
  for (const k of ['games', 'matches', 'results']) {
    const v = obj?.[k]
    if (Array.isArray(v) && v.length) {
      const s = v.find((x) => typeof x === 'string')
      if (s) return s
      const n = v.find((x) => typeof x?.name === 'string')
      if (n) return n.name
    }
  }
  return null
}

export async function resolveLudusaviGameName(options: { steamId?: string | null; title?: string | null }): Promise<string | null> {
  const steamId = String(options.steamId || '').trim()
  const title = String(options.title || '').trim()

  if (steamId) {
    const res = await runLudusavi(['find', '--api', '--backup', '--steam-id', steamId])
    if (res.ok && res.json) {
      const found = extractFirstGameName(res.json) || extractFirstGameName(res.json?.response)
      if (found) return found
    }
  }

  if (title) {
    // Try exact/normalized match first
    const res = await runLudusavi(['find', '--api', '--backup', '--normalized', title])
    if (res.ok && res.json) {
      const found = extractFirstGameName(res.json) || extractFirstGameName(res.json?.response)
      if (found) return found
    }

    // Try fuzzy match
    const fuzzy = await runLudusavi(['find', '--api', '--backup', '--fuzzy', title])
    if (fuzzy.ok && fuzzy.json) {
      const found = extractFirstGameName(fuzzy.json) || extractFirstGameName(fuzzy.json?.response)
      if (found) return found
    }

    // As a last resort, try using the title directly.
    // This allows Ludusavi to attempt backup even if the game isn't in its database.
    return title
  }

  return null
}

export async function ludusaviBackupOne(options: {
  configDir: string
  backupDir: string
  gameName: string
  winePrefix?: string
}): Promise<LudusaviExecResult> {
  const args = [
    '--config',
    options.configDir,
    'backup',
    '--api',
    '--force',
    '--no-cloud-sync',
    '--format',
    'zip',
    '--path',
    options.backupDir
  ]
  if (options.winePrefix) {
    args.push('--wine-prefix', options.winePrefix)
  }
  args.push(options.gameName)
  return await runLudusavi(args)
}

export async function ludusaviPreviewBackupOne(options: {
  configDir: string
  backupDir: string
  gameName: string
  winePrefix?: string
}): Promise<LudusaviExecResult> {
  const args = [
    '--config',
    options.configDir,
    'backup',
    '--preview',
    '--api',
    '--force',
    '--no-cloud-sync',
    '--format',
    'zip',
    '--path',
    options.backupDir
  ]
  if (options.winePrefix) {
    args.push('--wine-prefix', options.winePrefix)
  }
  args.push(options.gameName)
  return await runLudusavi(args)
}

export async function ludusaviRestoreOne(options: {
  configDir: string
  backupDir: string
  gameName: string
}): Promise<LudusaviExecResult> {
  const args = [
    '--config',
    options.configDir,
    'restore',
    '--api',
    '--force',
    '--no-cloud-sync',
    '--path',
    options.backupDir,
    options.gameName
  ]
  return await runLudusavi(args)
}
