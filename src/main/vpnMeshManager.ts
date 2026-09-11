import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { buildMeshToml, parseMeshConfig, parseMeshPeers } from './vpnMeshConfig'

type Runtime = { dir: string; lease: string; rpcPort: number; hostname: string; ip: string; cli: string }
let runtime: Runtime | null = null
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function roots() {
  return [process.resourcesPath, path.resolve(__dirname, '../..')].filter(Boolean)
}

function findResource(relative: string): string | undefined {
  for (const root of roots()) {
    const candidates = [path.join(root, relative), path.join(root, 'vendor', relative), path.join(root, 'resources', relative)]
    for (const file of candidates) if (fs.existsSync(file)) return file
  }
}

function binaries() {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const folder = `easytier/${process.platform}-${process.arch}`
  return { core: findResource(`${folder}/easytier-core${suffix}`), cli: findResource(`${folder}/easytier-cli${suffix}`) }
}

export function meshCheckInstalled() {
  const bins = binaries()
  const installed = !!(bins.core && bins.cli)
  return { installed, error: installed ? undefined : 'Componente P2P ausente. Atualize/reinstale o launcher (dev: npm run fetch:easytier).' }
}

async function freeLocalPort(): Promise<number> {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function runCli(current: Runtime, command: 'peer' | 'route') {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(current.cli, ['--rpc-portal', `127.0.0.1:${current.rpcPort}`, '--output', 'json', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    const timer = setTimeout(() => child.kill(), 2500)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      if (stdout.length > 1_000_000) child.kill()
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('P2P indisponível'))
      else resolve(stdout)
    })
  })
}

/**
 * The peer list says who is in the room; the route table says through whom
 * each one is reachable, which is what separates a working relay from the
 * rendezvous offering a path it will not carry. The routes are skipped while
 * starting up, where only this instance's own presence is being waited on.
 */
async function readPeers(current: Runtime, includeRoutes = true) {
  const peers = await runCli(current, 'peer')
  const rows = JSON.parse(peers)
  if (!Array.isArray(rows) || !rows.some(row => row.cost === 'Local' && row.hostname === current.hostname)) throw new Error('Sessão P2P não encontrada')
  const routes = includeRoutes ? await runCli(current, 'route').catch(() => undefined) : undefined
  return parseMeshPeers(peers, routes)
}

export async function meshPeers() {
  if (!runtime) return []
  return readPeers(runtime)
}

export function meshStopImmediately() {
  if (runtime) fs.rmSync(runtime.lease, { force: true })
}

export async function meshDisconnect(): Promise<{ success: boolean; error?: string }> {
  const current = runtime
  if (!current) return { success: true }
  fs.rmSync(current.lease, { force: true })
  // The supervisor stops its own elevated child, so disconnect needs no second UAC prompt.
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(250)
    try { await readPeers(current, false) } catch {
      fs.rmSync(current.dir, { recursive: true, force: true })
      if (runtime === current) runtime = null
      return { success: true }
    }
  }
  return { success: false, error: 'O processo P2P ainda está encerrando. Tente desconectar novamente.' }
}

export async function meshConnect(configText: string, userDataDir: string): Promise<{ success: boolean; tunnelName?: string; error?: string; needsInstall?: boolean }> {
  const config = parseMeshConfig(configText)
  if (!['linux', 'win32'].includes(process.platform)) return { success: false, error: 'Plataforma P2P não suportada' }
  const bins = binaries()
  if (!bins.core || !bins.cli) return { success: false, needsInstall: true, error: meshCheckInstalled().error }
  if (runtime) {
    const stopped = await meshDisconnect()
    if (!stopped.success) return stopped
  }
  if (Object.values(os.networkInterfaces()).flat().some(address => address?.family === 'IPv4' && address.address.startsWith('10.77.0.'))) {
    return { success: false, error: 'Outra rede já usa 10.77.0.0/24. Desconecte o túnel antigo antes de ativar o P2P.' }
  }
  const supervisor = findResource(`vpn/easytier-supervisor.${process.platform === 'win32' ? 'ps1' : 'sh'}`)
  if (!supervisor) return { success: false, error: 'Supervisor P2P ausente; reinstale o launcher' }
  const parent = path.join(userDataDir, 'vpn')
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  const dir = fs.mkdtempSync(path.join(parent, 'mesh-'))
  const configPath = path.join(dir, 'network.toml')
  const lease = path.join(dir, 'active')
  fs.writeFileSync(configPath, buildMeshToml(config), { mode: 0o600 })
  fs.writeFileSync(lease, '', { mode: 0o600 })
  const rpcPort = await freeLocalPort()
  const current = { dir, lease, rpcPort, cli: bins.cli, hostname: config.hostname, ip: config.ipv4.split('/')[0] }
  runtime = current
  const args = [bins.core, configPath, lease, String(process.pid), String(rpcPort)]
  let failed = false
  let child
  if (process.platform === 'linux') {
    const elevated = process.getuid?.() === 0
    child = spawn(elevated ? 'sh' : 'pkexec', [...(elevated ? [] : ['sh']), supervisor, ...args], { stdio: 'ignore' })
  } else {
    // Encode the command to preserve spaces and Unicode in paths through both PowerShell invocations.
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    const command = `& ${quote(supervisor)} ${args.map(quote).join(' ')}`
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    const launch = `$ErrorActionPreference='Stop'; Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}' | Out-Null`
    child = spawn('powershell.exe', ['-NoProfile', '-Command', launch], { windowsHide: true, stdio: 'ignore' })
  }
  child.once('error', () => { failed = true })
  child.once('exit', code => { if (process.platform === 'linux' || code !== 0) failed = true })
  const deadline = Date.now() + 120_000 // Allow the player time to answer the OS elevation dialog.
  while (!failed && Date.now() < deadline && runtime === current) {
    try {
      const peers = await readPeers(current, false)
      const hasAddress = os.networkInterfaces().ofmesh?.some(address => address.address === current.ip)
      if (hasAddress && peers.some(peer => peer.connection === 'local' && peer.ip === current.ip)) return { success: true, tunnelName: 'ofmesh' }
    } catch { /* The engine/RPC/TUN may still be starting. */ }
    await delay(500)
  }
  fs.rmSync(lease, { force: true })
  await meshDisconnect()
  return { success: false, error: 'Não foi possível iniciar a rede P2P. Verifique a autorização de administrador e o adaptador virtual.' }
}
