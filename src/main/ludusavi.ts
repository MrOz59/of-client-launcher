import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

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

function extractFirstStringArray(obj: any, keys: string[]): string | null {
  for (const k of keys) {
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
      return (
        extractFirstStringArray(res.json, ['games', 'matches', 'results']) ||
        extractFirstStringArray(res.json?.response, ['games', 'matches', 'results'])
      )
    }
  }

  if (title) {
    const res = await runLudusavi(['find', '--api', '--backup', '--normalized', title])
    if (res.ok && res.json) {
      return (
        extractFirstStringArray(res.json, ['games', 'matches', 'results']) ||
        extractFirstStringArray(res.json?.response, ['games', 'matches', 'results'])
      )
    }

    const fuzzy = await runLudusavi(['find', '--api', '--backup', '--fuzzy', title])
    if (fuzzy.ok && fuzzy.json) {
      return (
        extractFirstStringArray(fuzzy.json, ['games', 'matches', 'results']) ||
        extractFirstStringArray(fuzzy.json?.response, ['games', 'matches', 'results'])
      )
    }

    // As a last resort, try using the title directly.
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
