import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type ZeroTierResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: 'NOT_INSTALLED' | 'FAILED' }

type RunResult = { ok: true; stdout: string } | { ok: false; error: string; code?: 'NOT_INSTALLED' | 'FAILED' }

async function runZeroTierCli(args: string[], timeoutMs = 8000): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync('zerotier-cli', args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    })
    return { ok: true, stdout: String(stdout || '') }
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { ok: false, code: 'NOT_INSTALLED', error: 'zerotier-cli não encontrado no PATH' }
    }
    const stderr = String(err?.stderr || err?.message || 'Falha ao executar zerotier-cli')
    return { ok: false, code: 'FAILED', error: stderr.trim() }
  }
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
