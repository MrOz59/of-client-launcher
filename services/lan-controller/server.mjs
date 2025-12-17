import http from 'node:http'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const port = Number(process.env.PORT || 8787)
const apiKey = String(process.env.LAN_CONTROLLER_API_KEY || '').trim()
const ztToken = String(process.env.ZT_API_TOKEN || '').trim()
const defaultNetworkId = String(process.env.ZT_DEFAULT_NETWORK_ID || '').trim()
const roomsFile = String(process.env.ROOMS_FILE || '').trim() || path.join(process.cwd(), 'rooms.json')
const roomTtlDays = Number(process.env.ROOM_TTL_DAYS || 30)

// OF VPN (WireGuard) - optional
const vpnEnabled = String(process.env.VPN_ENABLE || 'false').trim().toLowerCase() === 'true'
const wgInterface = String(process.env.WG_INTERFACE || 'ofvpn0').trim() || 'ofvpn0'
const wgListenPort = Number(process.env.WG_LISTEN_PORT || 51820)
const wgEndpointHost = String(process.env.WG_ENDPOINT_HOST || '').trim() || null
const wgEndpointPort = Number(process.env.WG_ENDPOINT_PORT || wgListenPort)
const wgServerAddress = String(process.env.WG_SERVER_ADDRESS || '10.77.0.1/24').trim()
const wgSubnetCidr = String(process.env.WG_SUBNET_CIDR || '10.77.0.0/24').trim()
const wgDns = String(process.env.WG_DNS || '').trim()
const vpnStateFile = String(process.env.VPN_STATE_FILE || '').trim() || path.join(process.cwd(), 'vpn-state.json')
const vpnRoomTtlDays = Number(process.env.VPN_ROOM_TTL_DAYS || 2)
const vpnPeerTtlDays = Number(process.env.VPN_PEER_TTL_DAYS || 7)

function nowMs() {
  return Date.now()
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function safeReadJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const txt = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(txt)
  } catch {
    return fallback
  }
}

function safeWriteJsonFile(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch {
    return false
  }
}

function randomCode(length = 10) {
  // Easy to type, avoids ambiguous chars (0/O, 1/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function isRoomCode(code) {
  return /^[A-HJ-NP-Z2-9]{8,16}$/.test(code)
}

function isNetworkId(id) {
  return /^[0-9a-fA-F]{16}$/.test(id)
}

function isMemberId(id) {
  return /^[0-9a-fA-F]{10}$/.test(id)
}

function b64urlToB64(s) {
  const inStr = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = inStr.length % 4 === 0 ? '' : '='.repeat(4 - (inStr.length % 4))
  return inStr + pad
}

function makeX25519Keypair() {
  // WireGuard uses X25519 raw keys (32 bytes) base64 encoded.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' }
  })
  const pub = b64urlToB64(publicKey.x)
  const priv = b64urlToB64(privateKey.d)
  return { publicKey: pub, privateKey: priv }
}

function isWgKeyB64(key) {
  // WireGuard keys are base64 of 32 bytes (X25519 raw).
  const s = String(key || '').trim()
  if (!s) return false
  // base64 chars + optional padding, and must be 4-aligned.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false
  if (s.length % 4 !== 0) return false
  try {
    const buf = Buffer.from(s, 'base64')
    if (buf.length !== 32) return false
    // Reject non-canonical encodings.
    return buf.toString('base64') === s
  } catch {
    return false
  }
}

function parseCidrHost(cidr) {
  const m = String(cidr || '').trim().match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/)
  if (!m) return null
  return { ip: m[1], prefix: Number(m[2]) }
}

function ipToInt(ip) {
  const parts = String(ip || '').split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function intToIp(n) {
  const x = Number(n) >>> 0
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`
}

function allocateIpFromSubnet(subnetCidr, usedIps, startOffset = 2) {
  const parsed = parseCidrHost(subnetCidr)
  if (!parsed) return null
  const baseInt = ipToInt(parsed.ip)
  if (baseInt == null) return null
  const hostBits = 32 - parsed.prefix
  if (hostBits < 2 || hostBits > 16) return null
  const size = 2 ** hostBits

  // Skip .0 (network) and .1 (server), start from .2 by default
  for (let i = startOffset; i < size - 1; i++) {
    const ip = intToIp(baseInt + i)
    if (!usedIps.has(ip)) return ip
  }
  return null
}

// Very small in-memory rate limit (best-effort).
const rl = new Map()
function rateLimit(key, limit, windowMs) {
  const t = nowMs()
  const cur = rl.get(key) || { n: 0, resetAt: t + windowMs }
  if (t > cur.resetAt) {
    cur.n = 0
    cur.resetAt = t + windowMs
  }
  cur.n += 1
  rl.set(key, cur)
  return cur.n <= limit
}

const state = {
  rooms: safeReadJsonFile(roomsFile, { rooms: [] }),
  vpn: safeReadJsonFile(vpnStateFile, { server: null, rooms: [], peers: [] })
}

function cleanupRooms() {
  const ttlMs = Math.max(1, roomTtlDays) * 24 * 60 * 60 * 1000
  const cutoff = nowMs() - ttlMs
  const before = Array.isArray(state.rooms?.rooms) ? state.rooms.rooms.length : 0
  state.rooms.rooms = (Array.isArray(state.rooms?.rooms) ? state.rooms.rooms : []).filter((r) => (r?.createdAt || 0) >= cutoff)
  const after = state.rooms.rooms.length
  if (after !== before) safeWriteJsonFile(roomsFile, state.rooms)
}

cleanupRooms()
setInterval(cleanupRooms, 60 * 60 * 1000).unref?.()

function cleanupVpn() {
  const ttlRoomMs = Math.max(1, vpnRoomTtlDays) * 24 * 60 * 60 * 1000
  const ttlPeerMs = Math.max(1, vpnPeerTtlDays) * 24 * 60 * 60 * 1000
  const now = nowMs()

  state.vpn.rooms = Array.isArray(state.vpn?.rooms) ? state.vpn.rooms : []
  state.vpn.peers = Array.isArray(state.vpn?.peers) ? state.vpn.peers : []

  const keepRoom = new Set(
    state.vpn.rooms.filter((r) => (r?.createdAt || 0) >= now - ttlRoomMs).map((r) => r.code)
  )
  state.vpn.rooms = state.vpn.rooms.filter((r) => keepRoom.has(r.code))
  state.vpn.peers = state.vpn.peers.filter((p) => keepRoom.has(p.roomCode) && (p?.createdAt || 0) >= now - ttlPeerMs)

  safeWriteJsonFile(vpnStateFile, state.vpn)
}

cleanupVpn()
setInterval(cleanupVpn, 30 * 60 * 1000).unref?.()

function runCmd(bin, args, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 8000)
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    const err = []
    const t = setTimeout(() => {
      try { p.kill('SIGKILL') } catch {}
    }, timeoutMs)
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
    p.on('error', () => {
      clearTimeout(t)
      resolve({ code: -1, stdout: '', stderr: 'spawn_error' })
    })
  })
}

async function ensureWireGuardServer() {
  if (!vpnEnabled) return { ok: false, error: 'vpn_disabled' }

  // Ensure server keypair persisted.
  if (!state.vpn.server?.privateKey || !state.vpn.server?.publicKey) {
    const kp = makeX25519Keypair()
    state.vpn.server = { privateKey: kp.privateKey, publicKey: kp.publicKey, createdAt: nowMs() }
    safeWriteJsonFile(vpnStateFile, state.vpn)
  }
  if (!isWgKeyB64(state.vpn.server.privateKey) || !isWgKeyB64(state.vpn.server.publicKey)) {
    return { ok: false, error: 'server_key_invalid' }
  }

  // Basic tools presence
  const wgVer = await runCmd('wg', ['--version'], { timeoutMs: 3000 })
  if (wgVer.code !== 0) return { ok: false, error: 'wireguard_tools_not_found' }

  // Create interface if needed
  const link = await runCmd('ip', ['link', 'show', 'dev', wgInterface], { timeoutMs: 2000 })
  if (link.code !== 0) {
    const add = await runCmd('ip', ['link', 'add', 'dev', wgInterface, 'type', 'wireguard'], { timeoutMs: 5000 })
    if (add.code !== 0) return { ok: false, error: `wg_interface_create_failed: ${add.stderr || add.stdout}`.trim() }
  }

  // Ensure address present
  const addrShow = await runCmd('ip', ['address', 'show', 'dev', wgInterface], { timeoutMs: 2000 })
  if (!addrShow.stdout.includes(wgServerAddress.split('/')[0])) {
    await runCmd('ip', ['address', 'add', wgServerAddress, 'dev', wgInterface], { timeoutMs: 3000 })
  }

  // Write private key to a temp file (wg expects file path)
  const keyPath = path.join('/tmp', `wgkey_${wgInterface}`)
  try {
    fs.writeFileSync(keyPath, `${state.vpn.server.privateKey}\n`, { mode: 0o600 })
  } catch (e) {
    return { ok: false, error: 'server_key_write_failed' }
  }

  const set = await runCmd('wg', ['set', wgInterface, 'listen-port', String(wgListenPort), 'private-key', keyPath], { timeoutMs: 5000 })
  try { fs.unlinkSync(keyPath) } catch {}
  if (set.code !== 0) return { ok: false, error: `wg_set_failed: ${set.stderr || set.stdout}`.trim() }

  await runCmd('ip', ['link', 'set', 'up', 'dev', wgInterface], { timeoutMs: 3000 })

  // Enable forwarding (needed for hub routing between peers)
  await runCmd('sysctl', ['-w', 'net.ipv4.ip_forward=1'], { timeoutMs: 2000 })

  // Best-effort forwarding rules inside container (won't error if iptables missing)
  await runCmd('iptables', ['-C', 'FORWARD', '-i', wgInterface, '-j', 'ACCEPT'], { timeoutMs: 1000 }).then(async (r) => {
    if (r.code !== 0) await runCmd('iptables', ['-A', 'FORWARD', '-i', wgInterface, '-j', 'ACCEPT'], { timeoutMs: 2000 })
  })
  await runCmd('iptables', ['-C', 'FORWARD', '-o', wgInterface, '-j', 'ACCEPT'], { timeoutMs: 1000 }).then(async (r) => {
    if (r.code !== 0) await runCmd('iptables', ['-A', 'FORWARD', '-o', wgInterface, '-j', 'ACCEPT'], { timeoutMs: 2000 })
  })

  return { ok: true, publicKey: state.vpn.server.publicKey }
}

async function wgAddPeer(publicKey, ip) {
  const allowed = `${ip}/32`
  const r = await runCmd('wg', ['set', wgInterface, 'peer', publicKey, 'allowed-ips', allowed], { timeoutMs: 4000 })
  return { ok: r.code === 0, error: r.stderr || r.stdout }
}

function buildClientConfig(params) {
  const endpoint = wgEndpointHost ? `${wgEndpointHost}:${wgEndpointPort}` : null
  const lines = []
  lines.push('[Interface]')
  lines.push(`PrivateKey = ${params.privateKey}`)
  lines.push(`Address = ${params.ip}/32`)
  if (wgDns) lines.push(`DNS = ${wgDns}`)
  lines.push('')
  lines.push('[Peer]')
  lines.push(`PublicKey = ${params.serverPublicKey}`)
  if (endpoint) lines.push(`Endpoint = ${endpoint}`)
  lines.push(`AllowedIPs = ${wgSubnetCidr}`)
  lines.push('PersistentKeepalive = 25')
  return lines.join('\n')
}


function sendJson(res, code, body) {
  const data = Buffer.from(JSON.stringify(body ?? {}))
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.length)
  })
  res.end(data)
}

function sendText(res, code, text) {
  const data = Buffer.from(String(text ?? ''), 'utf8')
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(data.length)
  })
  res.end(data)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('JSON inválido'))
      }
    })
    req.on('error', reject)
  })
}

function checkApiKey(req) {
  const got = String(req.headers['x-api-key'] || '').trim()
  return !!(got && apiKey && got === apiKey)
}

function requirePrivileged(req) {
  // For privileged endpoints we REQUIRE the API key to be configured.
  if (!apiKey) return { ok: false, error: 'server_missing_api_key' }
  if (!checkApiKey(req)) return { ok: false, error: 'unauthorized' }
  return { ok: true }
}

async function ztFetchJson(url, method, bodyObj) {
  const body = bodyObj == null ? null : JSON.stringify(bodyObj)
  const headers = {
    authorization: `bearer ${ztToken}`,
    ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {})
  }
  const r = await fetch(url, { method, headers, body })
  const text = await r.text().catch(() => '')
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { ok: r.ok, status: r.status, json, text }
}

async function ztCreateNetwork(name) {
  if (!ztToken) return { ok: false, error: 'ZT_API_TOKEN não configurado no servidor' }

  const url = 'https://my.zerotier.com/api/network'

  const payloads = [
    { config: { name, private: true } },
    { name, private: true },
    {}
  ]

  for (const payload of payloads) {
    const r = await ztFetchJson(url, 'POST', payload)
    if (r.ok) {
      const id = String(r.json?.id || r.json?.nwid || r.json?.networkId || '').trim()
      if (isNetworkId(id)) return { ok: true, networkId: id }
      // Sometimes the API returns full object; try extracting from "config" too.
      const id2 = String(r.json?.config?.id || r.json?.config?.nwid || '').trim()
      if (isNetworkId(id2)) return { ok: true, networkId: id2 }
      return { ok: false, error: 'ZeroTier API criou a rede mas não retornou networkId' }
    }
    // If method/payload not accepted, try next.
    await sleep(150)
  }
  return { ok: false, error: 'Falha ao criar rede no ZeroTier Central' }
}

async function ztAuthorizeMember(networkId, memberId) {
  if (!ztToken) return { ok: false, error: 'ZT_API_TOKEN não configurado no servidor' }
  if (!isNetworkId(networkId)) return { ok: false, error: 'networkId inválido (precisa ter 16 hex chars)' }
  if (!isMemberId(memberId)) return { ok: false, error: 'memberId inválido (precisa ter 10 hex chars)' }

  const url = `https://my.zerotier.com/api/network/${networkId}/member/${memberId}`
  const body = JSON.stringify({ config: { authorized: true } })
  const headers = {
    authorization: `bearer ${ztToken}`,
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body))
  }

  // A API do ZeroTier aceita atualização do member via PUT/POST dependendo da versão;
  // tentamos alguns métodos para reduzir atrito.
  const methods = ['POST', 'PUT', 'PATCH']
  let lastError = null
  for (const method of methods) {
    try {
      const r = await fetch(url, { method, headers, body })
      if (r.ok) return { ok: true, status: r.status }
      const text = await r.text().catch(() => '')
      lastError = `ZeroTier API ${method} falhou: ${r.status} ${text}`.trim()
      // Se o método não for aceito, tenta o próximo.
      if (r.status === 405 || r.status === 404) continue
    } catch (e) {
      lastError = String(e?.message || e)
    }
  }
  return { ok: false, error: lastError || 'Falha ao autorizar member no ZeroTier' }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()

    if (u.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true })
    }

    if (u.pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        defaultNetworkId: isNetworkId(defaultNetworkId) ? defaultNetworkId : null,
        rooms: { enabled: true },
        zerotier: {
          tokenConfigured: !!ztToken,
          authorizeRequiresApiKey: !!apiKey
        },
        vpn: {
          enabled: vpnEnabled,
          wgInterface,
          wgListenPort,
          wgEndpointHost,
          wgEndpointPort,
          wgSubnetCidr
        }
      })
    }

    // =========================
    // OF VPN (WireGuard)
    // =========================

    if (u.pathname === '/api/vpn/status' && req.method === 'GET') {
      if (!vpnEnabled) return sendJson(res, 200, { ok: true, enabled: false })
      const ensured = await ensureWireGuardServer()
      if (!ensured.ok) return sendJson(res, 200, { ok: true, enabled: true, ready: false, error: ensured.error })
      return sendJson(res, 200, { ok: true, enabled: true, ready: true, publicKey: ensured.publicKey })
    }

    if (u.pathname === '/api/vpn/rooms/create' && req.method === 'POST') {
      if (!vpnEnabled) return sendJson(res, 400, { ok: false, error: 'vpn_disabled' })
      if (!rateLimit(`vpn_create:${ip}`, 30, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' })
      const ensured = await ensureWireGuardServer()
      if (!ensured.ok) return sendJson(res, 400, { ok: false, error: ensured.error })

      cleanupVpn()
      const body = await readJson(req)
      const userName = String(body?.name || '').trim().slice(0, 64)

      // Create room
      let code = randomCode(10)
      const existing = new Set((Array.isArray(state.vpn?.rooms) ? state.vpn.rooms : []).map((r) => r?.code))
      for (let i = 0; i < 5 && existing.has(code); i++) code = randomCode(10)

      state.vpn.rooms.push({ code, createdAt: nowMs() })

      // Create host peer
      const usedIps = new Set((Array.isArray(state.vpn?.peers) ? state.vpn.peers : []).map((p) => p?.ip).filter(Boolean))
      const ipAddr = allocateIpFromSubnet(wgSubnetCidr, usedIps)
      if (!ipAddr) return sendJson(res, 500, { ok: false, error: 'ip_pool_exhausted' })

      const kp = makeX25519Keypair()
      const peer = {
        id: crypto.randomUUID(),
        roomCode: code,
        name: userName || 'host',
        ip: ipAddr,
        publicKey: kp.publicKey,
        createdAt: nowMs(),
        role: 'host'
      }
      state.vpn.peers.push(peer)
      safeWriteJsonFile(vpnStateFile, state.vpn)

      const add = await wgAddPeer(peer.publicKey, peer.ip)
      if (!add.ok) return sendJson(res, 500, { ok: false, error: add.error || 'wg_add_peer_failed' })

      const config = buildClientConfig({ privateKey: kp.privateKey, ip: peer.ip, serverPublicKey: ensured.publicKey })
      return sendJson(res, 200, { ok: true, code, config, vpnIp: peer.ip })
    }

    if (u.pathname === '/api/vpn/rooms/join' && req.method === 'POST') {
      if (!vpnEnabled) return sendJson(res, 400, { ok: false, error: 'vpn_disabled' })
      if (!rateLimit(`vpn_join:${ip}`, 200, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' })
      const ensured = await ensureWireGuardServer()
      if (!ensured.ok) return sendJson(res, 400, { ok: false, error: ensured.error })

      cleanupVpn()
      const body = await readJson(req)
      const code = String(body?.code || '').trim().toUpperCase()
      const userName = String(body?.name || '').trim().slice(0, 64)
      if (!isRoomCode(code)) return sendJson(res, 400, { ok: false, error: 'code inválido' })

      const room = state.vpn.rooms.find((r) => String(r?.code || '').toUpperCase() === code)
      if (!room) return sendJson(res, 404, { ok: false, error: 'room_not_found' })

      const hostPeer = state.vpn.peers.find((p) => p?.roomCode === room.code && p?.role === 'host')
      const hostIp = hostPeer?.ip || null

      const usedIps = new Set((Array.isArray(state.vpn?.peers) ? state.vpn.peers : []).map((p) => p?.ip).filter(Boolean))
      const ipAddr = allocateIpFromSubnet(wgSubnetCidr, usedIps)
      if (!ipAddr) return sendJson(res, 500, { ok: false, error: 'ip_pool_exhausted' })

      const kp = makeX25519Keypair()
      const peer = {
        id: crypto.randomUUID(),
        roomCode: room.code,
        name: userName || 'peer',
        ip: ipAddr,
        publicKey: kp.publicKey,
        createdAt: nowMs(),
        role: 'peer'
      }
      state.vpn.peers.push(peer)
      safeWriteJsonFile(vpnStateFile, state.vpn)

      const add = await wgAddPeer(peer.publicKey, peer.ip)
      if (!add.ok) return sendJson(res, 500, { ok: false, error: add.error || 'wg_add_peer_failed' })

      const config = buildClientConfig({ privateKey: kp.privateKey, ip: peer.ip, serverPublicKey: ensured.publicKey })
      return sendJson(res, 200, { ok: true, config, vpnIp: peer.ip, hostIp })
    }

    if (u.pathname === '/api/vpn/rooms/peers' && req.method === 'GET') {
      if (!vpnEnabled) return sendJson(res, 400, { ok: false, error: 'vpn_disabled' })
      const code = String(u.searchParams.get('code') || '').trim().toUpperCase()
      if (!isRoomCode(code)) return sendJson(res, 400, { ok: false, error: 'code inválido' })
      cleanupVpn()
      const peers = (Array.isArray(state.vpn?.peers) ? state.vpn.peers : [])
        .filter((p) => String(p?.roomCode || '').toUpperCase() === code)
        .map((p) => ({ id: p.id, name: p.name, ip: p.ip, role: p.role }))
      return sendJson(res, 200, { ok: true, peers })
    }

    if (u.pathname === '/api/rooms/create' && req.method === 'POST') {
      // Plug&play: rooms are created inside a single pre-configured network.
      if (!isNetworkId(defaultNetworkId)) return sendJson(res, 400, { ok: false, error: 'server_missing_default_network_id' })
      if (!rateLimit(`create:${ip}`, 20, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' })
      const body = await readJson(req)
      const desiredName = String(body?.name || '').trim()
      const memberId = String(body?.memberId || '').trim()
      const name = desiredName || `LAN ${new Date().toISOString().slice(0, 10)}`

      let code = randomCode(10)
      // Ensure uniqueness
      const existing = new Set((Array.isArray(state.rooms?.rooms) ? state.rooms.rooms : []).map((r) => r?.code))
      for (let i = 0; i < 5 && existing.has(code); i++) code = randomCode(10)

      state.rooms.rooms = Array.isArray(state.rooms?.rooms) ? state.rooms.rooms : []
      state.rooms.rooms.push({ code, name, networkId: defaultNetworkId, createdAt: nowMs() })
      safeWriteJsonFile(roomsFile, state.rooms)

      let authorized = false
      let authError = null
      if (memberId) {
        const out = await ztAuthorizeMember(defaultNetworkId, memberId)
        authorized = !!out.ok
        if (!authorized) authError = out.error || 'Falha ao autorizar no ZeroTier'
      }

      return sendJson(res, 200, { ok: true, code, networkId: defaultNetworkId, authorized, authError })
    }

    if (u.pathname === '/api/rooms/join' && req.method === 'POST') {
      if (!rateLimit(`join:${ip}`, 120, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' })
      const body = await readJson(req)
      const code = String(body?.code || '').trim().toUpperCase()
      const memberId = String(body?.memberId || '').trim()
      if (!isRoomCode(code)) return sendJson(res, 400, { ok: false, error: 'code inválido' })

      cleanupRooms()
      const room = (Array.isArray(state.rooms?.rooms) ? state.rooms.rooms : []).find((r) => String(r?.code || '').toUpperCase() === code)
      if (!room) return sendJson(res, 404, { ok: false, error: 'room_not_found' })

      const networkId = String(room.networkId || '').trim()
      if (!isNetworkId(networkId)) return sendJson(res, 400, { ok: false, error: 'room inválida (networkId)' })

      let authorized = false
      let authError = null
      if (memberId && isMemberId(memberId)) {
        const out = await ztAuthorizeMember(networkId, memberId)
        authorized = !!out.ok
        if (!authorized) authError = out.error || 'Falha ao autorizar no ZeroTier'
      }

      return sendJson(res, 200, { ok: true, networkId, authorized, authError })
    }

    if (u.pathname === '/api/zerotier/authorize' && req.method === 'POST') {
      const auth = requirePrivileged(req)
      if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error })
      const body = await readJson(req)
      const networkId = String(body?.networkId || defaultNetworkId || '').trim()
      const memberId = String(body?.memberId || '').trim()
      if (!networkId) return sendJson(res, 400, { ok: false, error: 'networkId ausente' })
      if (!memberId) return sendJson(res, 400, { ok: false, error: 'memberId ausente' })
      const out = await ztAuthorizeMember(networkId, memberId)
      if (!out.ok) return sendJson(res, 400, { ok: false, error: out.error })
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) })
  }
})

server.listen(port, '0.0.0.0', () => {
  const masked = ztToken ? `${ztToken.slice(0, 4)}…` : '(vazio)'
  console.log(`[lan-controller] listening on :${port}`)
  console.log(`[lan-controller] ZT_DEFAULT_NETWORK_ID=${defaultNetworkId || '(vazio)'}`)
  console.log(`[lan-controller] LAN_CONTROLLER_API_KEY=${apiKey ? '(set)' : '(none)'}`)
  console.log(`[lan-controller] ZT_API_TOKEN=${masked}`)
})
