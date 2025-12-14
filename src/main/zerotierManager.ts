import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type ZeroTierResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: 'NOT_INSTALLED' | 'FAILED' | 'NEEDS_ROOT' }

type RunResult = { ok: true; stdout: string } | { ok: false; error: string; code?: 'NOT_INSTALLED' | 'FAILED' | 'NEEDS_ROOT' }

async function runZeroTierCli(args: string[], timeoutMs = 8000): Promise<RunResult> {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']
    const localAppData = process.env.LocalAppData
    const guesses = [
      'zerotier-cli.bat',
      'zerotier-cli.exe',
      'zerotier-cli'
    ]

    const guessedPaths: string[] = []
    for (const base of [programFilesX86, programFiles, localAppData]) {
      if (!base) continue
      guessedPaths.push(path.join(base, 'ZeroTier', 'One', 'zerotier-cli.bat'))
      guessedPaths.push(path.join(base, 'ZeroTier', 'One', 'zerotier-cli.exe'))
      guessedPaths.push(path.join(base, 'ZeroTier', 'One', 'zerotier-cli'))
    }

    for (const g of guesses) candidates.push(g)
    for (const p of guessedPaths) candidates.push(p)
  } else {
    candidates.push('zerotier-cli', '/usr/sbin/zerotier-cli', '/usr/bin/zerotier-cli', '/sbin/zerotier-cli')
  }

  const existingCandidates = candidates.filter((c) => {
    if (!c.includes(path.sep)) return true
    try { return fs.existsSync(c) } catch { return false }
  })

  const run = async (bin: string) => {
    const isBat = process.platform === 'win32' && /\.(bat|cmd)$/i.test(bin)
    if (isBat) {
      const { stdout } = await execFileAsync('cmd.exe', ['/c', bin, ...args], {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8
      })
      return String(stdout || '')
    }
    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    })
    return String(stdout || '')
  }

  let lastErr: any = null
  for (const bin of existingCandidates) {
    try {
      const stdout = await run(bin)
      return { ok: true, stdout }
    } catch (err: any) {
      lastErr = err
      if (err?.code === 'ENOENT') continue
      const stderr = String(err?.stderr || err?.message || 'Falha ao executar zerotier-cli')
      const msg = stderr.toLowerCase()
      if (
        msg.includes('authtoken.secret') ||
        msg.includes('try again as root') ||
        (msg.includes('not found or readable') && msg.includes('/var/lib/zerotier-one'))
      ) {
        return { ok: false, code: 'NEEDS_ROOT', error: stderr.trim() }
      }
      return { ok: false, code: 'FAILED', error: stderr.trim() }
    }
  }

  void lastErr
  return { ok: false, code: 'NOT_INSTALLED', error: 'ZeroTier não encontrado (zerotier-cli ausente)' }
}

async function runJson<T>(args: string[]): Promise<ZeroTierResult<T>> {
  const res = await runZeroTierCli(['-j', ...args])
  if (!res.ok) return { success: false, error: res.error, code: res.code }
  try {
    return { success: true, data: JSON.parse(res.stdout || 'null') as T }
  } catch (err: any) {
    return { success: false, code: 'FAILED', error: `Falha ao parsear JSON do zerotier-cli: ${err?.message || String(err)}` }
  }
}

export type ZeroTierStatus = {
  address?: string
  online?: boolean
  version?: string
  planetWorldId?: number
  planetWorldTimestamp?: number
}

export type ZeroTierNetwork = {
  nwid: string
  name?: string
  status?: string
  type?: string
  assignedAddresses?: string[]
  portDeviceName?: string
  mac?: string
}

export type ZeroTierPeer = {
  address: string
  role?: string
  latency?: number
  version?: string
  path?: string
}

export async function ztGetStatus() {
  return runJson<ZeroTierStatus>(['status'])
}

export async function ztListNetworks() {
  return runJson<ZeroTierNetwork[]>(['listnetworks'])
}

export async function ztListPeers() {
  return runJson<ZeroTierPeer[]>(['listpeers'])
}

export async function ztJoinNetwork(networkId: string): Promise<ZeroTierResult<{ joined: true }>> {
  const id = (networkId || '').trim()
  if (!/^[0-9a-fA-F]{16}$/.test(id)) {
    return { success: false, code: 'FAILED', error: 'Network ID inválido (precisa ter 16 hex chars)' }
  }
  const res = await runZeroTierCli(['join', id])
  if (!res.ok) {
    const msg = res.error.toLowerCase()
    if (msg.includes('already') && (msg.includes('member') || msg.includes('joined'))) {
      return { success: true, data: { joined: true } }
    }
    return { success: false, error: res.error, code: res.code }
  }
  return { success: true, data: { joined: true } }
}

export async function ztLeaveNetwork(networkId: string): Promise<ZeroTierResult<{ left: true }>> {
  const id = (networkId || '').trim()
  if (!/^[0-9a-fA-F]{16}$/.test(id)) {
    return { success: false, code: 'FAILED', error: 'Network ID inválido (precisa ter 16 hex chars)' }
  }
  const res = await runZeroTierCli(['leave', id])
  if (!res.ok) {
    const msg = res.error.toLowerCase()
    if (msg.includes('not') && (msg.includes('member') || msg.includes('joined'))) {
      return { success: true, data: { left: true } }
    }
    return { success: false, error: res.error, code: res.code }
  }
  return { success: true, data: { left: true } }
}
