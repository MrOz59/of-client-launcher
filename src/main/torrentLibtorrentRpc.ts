import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

// Minimal JSON-RPC-ish line protocol over stdin/stdout.
// This is intentionally small: start/pause/resume/remove/status.

export interface TorrentProgress {
  progress: number
  downloadSpeed: number
  downloaded: number
  total: number
  timeRemaining: number
  infoHash?: string
}

type RpcRequest = { id: number; method: string; params?: any }
type RpcResponse = { id: number; result?: any; error?: { message: string; code?: string } }

class LibtorrentUnavailableError extends Error {
  code = 'LIBTORRENT_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'LibtorrentUnavailableError'
  }
}

type ActiveTorrent = {
  aliases: Set<string>
  infoHash?: string
  source: string
  destPath: string
  finish?: (err?: Error) => void
  pausedRequested?: boolean
  pollTimer?: NodeJS.Timeout
}

const activeTorrents = new Map<string, ActiveTorrent>()

function registerActive(record: ActiveTorrent) {
  for (const key of record.aliases) activeTorrents.set(key, record)
}

function unregisterActive(record: ActiveTorrent) {
  for (const key of record.aliases) activeTorrents.delete(key)
}

function hasActiveAlias(ids: string[]): boolean {
  return ids.some(id => activeTorrents.has(id))
}

function getPythonExecutable(): string {
  const env = String(process.env.OF_PYTHON_PATH || '').trim()
  if (env) return env

  // If we ship an embedded python in resources, prefer it.
  // Layout: resources/torrent-agent/python/<platform>-<arch>/python(.exe)
  try {
  // Avoid hard electron import at module load.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron')
  if (app?.isPackaged) {
    const resources = process.resourcesPath
      const folder = `${process.platform}-${process.arch}`
      const base = path.join(resources, 'torrent-agent', 'python', folder)
      const exe = process.platform === 'win32' ? 'python.exe' : 'python'
      const candidate = path.join(base, exe)
    if (fs.existsSync(candidate)) return candidate
  }
  } catch {
  // ignore
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function getSidecarScriptPath(): string {
  const override = String(process.env.OF_SIDECAR_PATH || '').trim()
  if (override) return override

  // Dev path
  const devPath = path.join(process.cwd(), 'services', 'torrent-agent', 'libtorrent_rpc.py')
  if (fs.existsSync(devPath)) return devPath

  // Packaged path (electron-builder extraResources)
  try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron')
  if (app?.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'torrent-agent', 'libtorrent_rpc.py')
    if (fs.existsSync(packaged)) return packaged
  }
  } catch {
  // ignore
  }

  // Last resort: legacy writable location (backwards compatibility)
  const baseDir = process.env.OF_SIDECAR_DIR
  ? path.resolve(process.env.OF_SIDECAR_DIR)
  : path.join(process.cwd(), '.of-sidecar')
  fs.mkdirSync(baseDir, { recursive: true })
  return path.join(baseDir, 'libtorrent_rpc.py')
}

class LibtorrentRpcClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private starting: Promise<void> | null = null

  async start(): Promise<void> {
    if (this.proc) return
    if (this.starting) return this.starting

    this.starting = new Promise<void>((resolve, reject) => {
      const python = getPythonExecutable()
      const scriptPath = getSidecarScriptPath()

      const childEnv: NodeJS.ProcessEnv = { ...process.env }

      // Dev: if deps were installed into services/torrent-agent/pydeps, use them.
      try {
        const devDeps = path.join(process.cwd(), 'services', 'torrent-agent', 'pydeps')
        if (fs.existsSync(devDeps)) {
          const prev = String(childEnv.PYTHONPATH || '').trim()
          childEnv.PYTHONPATH = prev ? `${devDeps}${path.delimiter}${prev}` : devDeps
        }
      } catch {
        // ignore
      }

      try {
        // When packaged, dependencies are expected at: resources/torrent-agent/pydeps
        // This makes the sidecar self-contained (no system-wide installs).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { app } = require('electron') as typeof import('electron')
        if (app?.isPackaged) {
          const deps = path.join(process.resourcesPath, 'torrent-agent', 'pydeps')
          const prev = String(childEnv.PYTHONPATH || '').trim()
          childEnv.PYTHONPATH = prev ? `${deps}${path.delimiter}${prev}` : deps
        }
      } catch {
        // ignore
      }

      let proc: ChildProcessWithoutNullStreams
      try {
        proc = spawn(python, ['-u', scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv })
      } catch (e: any) {
        reject(new LibtorrentUnavailableError(e?.message || 'failed to spawn python'))
        return
      }

      this.proc = proc

      const rl = readline.createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        const text = String(line || '').trim()
        if (!text) return
        try {
          const msg = JSON.parse(text)

          // fatal early message (missing libtorrent)
          if (msg && msg.event === 'fatal') {
            const err = new LibtorrentUnavailableError(msg.message || 'libtorrent unavailable')
            ;(err as any).detail = msg.detail
            reject(err)
            try { proc.kill() } catch {}
            return
          }

          const res = msg as RpcResponse
          if (!res || typeof res.id !== 'number') return
          const pending = this.pending.get(res.id)
          if (!pending) return
          this.pending.delete(res.id)
          if (res.error) {
            const err = new Error(res.error.message || 'RPC error')
            ;(err as any).code = res.error.code
            pending.reject(err)
          } else {
            pending.resolve(res.result)
          }
        } catch {
          // ignore non-JSON output
        }
      })

      proc.on('exit', (code) => {
        const err = new Error(`libtorrent sidecar exited (${code ?? 'unknown'})`)
        for (const [, p] of this.pending) p.reject(err)
        this.pending.clear()
        this.proc = null
      })

      // Any stderr output is treated as availability hint but not fatal (some distros warn).
      let stderr = ''
      proc.stderr.on('data', (b) => { stderr += String(b || '') })

      // Probe the sidecar.
      this.call('ping', {}).then(() => {
        resolve()
      }).catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e))
        // If python ran but libtorrent is missing, stderr often contains details.
        ;(err as any).stderr = stderr
        reject(err)
        try { proc.kill() } catch {}
      })
    }).finally(() => {
      this.starting = null
    })

    return this.starting
  }

  async call(method: string, params?: any): Promise<any> {
    await this.start()
    if (!this.proc) throw new LibtorrentUnavailableError('sidecar not running')

    const id = this.nextId++
    const req: RpcRequest = { id, method, params: params || {} }

    const payload = JSON.stringify(req)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.proc!.stdin.write(payload + '\n')
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
    })
  }
}

const rpc = new LibtorrentRpcClient()

export function isTorrentActive(torrentId: string): boolean {
  return activeTorrents.has(torrentId)
}

export function getActiveTorrentIds(): string[] {
  return Array.from(new Set([...activeTorrents.values()].flatMap(r => Array.from(r.aliases))))
}

export async function downloadTorrent(
  magnetOrTorrent: string,
  destPath: string,
  onProgress?: (progress: number, details?: TorrentProgress & { infoHash: string }) => void,
  aliases: string[] = [],
  shouldCancel?: () => boolean
): Promise<void> {
  const lookupIds = Array.from(new Set([magnetOrTorrent, ...aliases].filter(Boolean)))
  if (hasActiveAlias(lookupIds)) throw new Error('Torrent already in progress')

  const record: ActiveTorrent = {
    aliases: new Set(lookupIds),
    source: magnetOrTorrent,
    destPath,
    pausedRequested: false
  }

  let cleaned = false
  let finished = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (record.pollTimer) clearInterval(record.pollTimer)
    unregisterActive(record)
  }

  const finish = (err?: Error) => {
    if (finished) return
    finished = true
    cleanup()
    if (err) throw err
  }

  registerActive(record)

  const rejectIfCancelled = async (): Promise<boolean> => {
    if (shouldCancel && shouldCancel()) {
      try {
        if (record.infoHash) await rpc.call('remove', { torrentId: record.infoHash, deleteFiles: false })
      } catch {
        // ignore
      }
      cleanup()
      throw new Error('cancelled')
    }
    return false
  }

  try {
    await rpc.start()
  } catch (e: any) {
    const err = e instanceof Error ? e : new Error(String(e))
    ;(err as any).code = (e as any)?.code || 'LIBTORRENT_UNAVAILABLE'
    throw err
  }

  await rejectIfCancelled()

  const addRes = await rpc.call('add', { source: magnetOrTorrent, savePath: destPath })
  const infoHash = String(addRes?.infoHash || '').trim()
  if (!infoHash) throw new Error('libtorrent: missing infoHash')

  record.infoHash = infoHash
  record.aliases.add(infoHash)
  registerActive(record)

  // Poll status and emit progress.
  await new Promise<void>((resolve, reject) => {
    const tick = async () => {
      try {
        await rejectIfCancelled()

        if (record.pausedRequested) {
          // keep status ticking (UI wants speed=0), but do not auto-resume.
        }

        const st = await rpc.call('status', { torrentId: infoHash })
        const progress = Number(st?.progress ?? 0)
        const downloaded = Number(st?.totalDone ?? 0)
        const total = Number(st?.totalWanted ?? 0)
        const downloadSpeed = Number(st?.downloadRate ?? 0)
        const timeRemaining = Number(st?.eta ?? 0)
        const peers = Number(st?.peers ?? 0)
        const seeds = Number(st?.seeds ?? 0)

        const details = {
          progress,
          downloaded,
          total,
          downloadSpeed,
          timeRemaining,
          infoHash,
          peers: Number.isFinite(peers) ? peers : 0,
          seeds: Number.isFinite(seeds) ? seeds : 0
        }
        onProgress?.(progress, details)

        const done = Boolean(st?.isFinished) || (total > 0 && downloaded >= total)
        if (done) {
          try { await rpc.call('pause', { torrentId: infoHash }) } catch {}
          cleanup()
          resolve()
        }
      } catch (err) {
        cleanup()
        reject(err)
      }
    }

    // Kick once immediately, then interval.
    tick()
    record.pollTimer = setInterval(tick, 800)
  })

  try {
    finish()
  } catch (e: any) {
    throw e
  }
}

export function pauseTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (!active) return false
  active.pausedRequested = true

  const ih = active.infoHash
  if (!ih) return true

  rpc.call('pause', { torrentId: ih }).catch(() => {})
  return true
}

export function resumeTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (!active) return false
  active.pausedRequested = false

  const ih = active.infoHash
  if (!ih) return true

  rpc.call('resume', { torrentId: ih }).catch(() => {})
  return true
}

export function cancelTorrent(torrentId: string): boolean {
  const active = activeTorrents.get(torrentId)
  if (!active) return false

  const ih = active.infoHash
  // Best-effort remove from session; DownloadManager already deletes files/dirs.
  if (ih) rpc.call('remove', { torrentId: ih, deleteFiles: false }).catch(() => {})

  if (active.finish) {
    try { active.finish(new Error('cancelled')) } catch {}
  }

  if (active.pollTimer) clearInterval(active.pollTimer)
  unregisterActive(active)
  return true
}
