import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

function readOsRelease(): Record<string, string> {
  try {
    const txt = fs.readFileSync('/etc/os-release', 'utf8')
    const out: Record<string, string> = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2] || ''
      val = val.replace(/^\"|\"$/g, '')
      out[key] = val
    }
    return out
  } catch {
    return {}
  }
}

function run(bin: string, args: string[], opts?: { timeoutMs?: number }) {
  const timeoutMs = Number(opts?.timeoutMs || 15000)
  return new Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const t = setTimeout(() => {
      try { p.kill('SIGKILL') } catch {}
    }, timeoutMs)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('close', (code) => {
      clearTimeout(t)
      resolve({ ok: code === 0, code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
    p.on('error', () => {
      clearTimeout(t)
      resolve({ ok: false, code: null, stdout: '', stderr: 'spawn_error' })
    })
  })
}

async function trySpawnElevatedLinux(cmd: string): Promise<{ ok: boolean }> {
  const args = ['sh', '-lc', cmd]
  const pk = await run('pkexec', args, { timeoutMs: 10 * 60 * 1000 })
  if (pk.ok) return { ok: true }
  const sudo = await run('sudo', args, { timeoutMs: 10 * 60 * 1000 })
  if (sudo.ok) return { ok: true }
  return { ok: false }
}

export function getClientTunnelName() {
  return 'ofvpn'
}

export async function vpnCheckInstalled(): Promise<{ installed: boolean; error?: string }> {
  if (process.platform === 'linux') {
    const r = await run('wg', ['--version'], { timeoutMs: 3000 })
    return { installed: r.ok, error: r.ok ? undefined : 'wg não encontrado' }
  }
  if (process.platform === 'win32') {
    const exe = findWireGuardExeWindows()
    return { installed: !!exe, error: exe ? undefined : 'WireGuard não instalado' }
  }
  return { installed: false, error: 'Plataforma não suportada (por enquanto)' }
}

export async function vpnInstallBestEffort(): Promise<{ success: boolean; error?: string }> {
  if (process.platform === 'linux') {
    const osr = readOsRelease()
    const distroId = (osr.ID || '').toLowerCase()
    const distroLike = (osr.ID_LIKE || '').toLowerCase()
    const isArchLike = `${distroId} ${distroLike}`.includes('arch') || distroId.includes('cachyos')
    const isDebianLike = `${distroId} ${distroLike}`.includes('debian') || distroId.includes('debian') || distroId.includes('ubuntu')

    let cmd = ''
    if (isArchLike) {
      cmd = 'pacman -Syu --noconfirm && pacman -S --noconfirm --needed wireguard-tools'
    } else if (isDebianLike) {
      cmd = 'apt-get update && apt-get install -y wireguard wireguard-tools'
    } else {
      return { success: false, error: 'Distro não suportada para instalação automática' }
    }
    const res = await trySpawnElevatedLinux(cmd)
    if (!res.ok) return { success: false, error: 'Falha ao executar pkexec/sudo para instalar WireGuard' }
    return { success: true }
  }

  if (process.platform === 'win32') {
    // We don't auto-download installers here (avoids external dependency surprises).
    return { success: false, error: 'Windows: instale WireGuard (wireguard.com/install) e tente novamente' }
  }

  return { success: false, error: 'Plataforma não suportada (por enquanto)' }
}

function findWireGuardExeWindows(): string | null {
  const candidates = [
    'C:\\\\Program Files\\\\WireGuard\\\\wireguard.exe',
    'C:\\\\Program Files (x86)\\\\WireGuard\\\\wireguard.exe'
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return null
}

export async function vpnConnectFromConfig(params: { configText: string; userDataDir: string }): Promise<{ success: boolean; tunnelName?: string; configPath?: string; error?: string; needsInstall?: boolean }> {
  const tunnelName = getClientTunnelName()
  const userDataDir = String(params.userDataDir || '').trim()
  if (!userDataDir) return { success: false, error: 'userDataDir inválido' }
  const dir = path.join(userDataDir, 'vpn')
  fs.mkdirSync(dir, { recursive: true })
  const configPath = path.join(dir, `${tunnelName}.conf`)
  fs.writeFileSync(configPath, String(params.configText || '').trim() + os.EOL)

  if (process.platform === 'linux') {
    const installed = await vpnCheckInstalled()
    if (!installed.installed) return { success: false, error: installed.error, needsInstall: true }
    const cmd = `wg-quick down '${configPath}' >/dev/null 2>&1 || true; wg-quick up '${configPath}'`
    const res = await trySpawnElevatedLinux(cmd)
    if (!res.ok) return { success: false, error: 'Falha ao subir túnel (precisa de senha/admin)', configPath }
    return { success: true, tunnelName, configPath }
  }

  if (process.platform === 'win32') {
    const exe = findWireGuardExeWindows()
    if (!exe) return { success: false, error: 'WireGuard não instalado', needsInstall: true, configPath }
    // Instala como serviço (precisa admin). Sem auto-UAC aqui; tentativa direta.
    const r = await run(exe, ['/installtunnelservice', configPath], { timeoutMs: 30000 })
    if (!r.ok) return { success: false, error: r.stderr || r.stdout || 'Falha ao instalar serviço do túnel', configPath }
    return { success: true, tunnelName, configPath }
  }

  return { success: false, error: 'Plataforma não suportada (por enquanto)' }
}

export async function vpnDisconnect(params: { userDataDir: string }): Promise<{ success: boolean; error?: string }> {
  const tunnelName = getClientTunnelName()
  const userDataDir = String(params.userDataDir || '').trim()
  const configPath = path.join(userDataDir, 'vpn', `${tunnelName}.conf`)

  if (process.platform === 'linux') {
    const installed = await vpnCheckInstalled()
    if (!installed.installed) return { success: false, error: installed.error }
    const cmd = `wg-quick down '${configPath}'`
    const res = await trySpawnElevatedLinux(cmd)
    if (!res.ok) return { success: false, error: 'Falha ao derrubar túnel (precisa de senha/admin)' }
    return { success: true }
  }

  if (process.platform === 'win32') {
    const exe = findWireGuardExeWindows()
    if (!exe) return { success: false, error: 'WireGuard não instalado' }
    const r = await run(exe, ['/uninstalltunnelservice', tunnelName], { timeoutMs: 30000 })
    if (!r.ok) return { success: false, error: r.stderr || r.stdout || 'Falha ao remover serviço do túnel' }
    return { success: true }
  }

  return { success: false, error: 'Plataforma não suportada (por enquanto)' }
}

