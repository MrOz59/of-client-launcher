import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

test('mesh rooms operate without WireGuard and isolate credentials, IP allocation and admission', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-controller-test-'))
  const child = spawn(process.execPath, [path.resolve('services/lan-controller/server.mjs')], {
    cwd: dir,
    env: { ...process.env, PORT: '0', VPN_ENABLE: 'true', VPN_TRANSPORT: 'easytier', VPN_MESH_PEERS: 'tcp://127.0.0.1:11010',
      VPN_STATE_FILE: path.join(dir, 'vpn.json'), ROOMS_FILE: path.join(dir, 'rooms.json'), PATH: '/nonexistent' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  t.after(async () => {
    child.kill()
    await once(child, 'exit')
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controller startup timed out')), 5000)
    child.stdout.on('data', data => {
      const match = data.toString().match(/listening on :(\d+)/)
      if (match) { clearTimeout(timer); resolve(Number(match[1])) }
    })
    child.once('error', reject)
  })
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vpn/${route}`, body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    } : {})
    return { status: response.status, ...await response.json() }
  }
  const transports = ['easytier', 'wireguard']
  const status = await request('status')
  assert.equal(status.ready, true)
  assert.equal(status.topology, 'mesh')
  assert.equal((await request('rooms/create', { roomName: 'old client' })).status, 426)
  const host = await request('rooms/create', { transports, roomName: 'Sydney', password: 'test-only', public: true, maxPlayers: 4 })
  assert.equal(host.status, 200)
  const config = JSON.parse(host.config)
  assert.equal(config.transport, 'easytier')
  assert.equal(config.ipv4, '10.77.0.2/24')
  assert.deepEqual(config.peers, ['tcp://127.0.0.1:11010'])
  assert.ok(host.sessionToken)
  const denied = await request('rooms/join', { transports, code: host.code, password: 'incorrect' })
  assert.equal(denied.status, 403)
  assert.equal(denied.needsPassword, true)
  const joins = await Promise.all(Array.from({ length: 8 }, () => request('rooms/join', { transports, code: host.code, password: 'test-only' })))
  const joined = joins.filter(result => result.ok)
  assert.equal(joined.length, 3)
  assert.equal(new Set([host.vpnIp, ...joined.map(peer => peer.vpnIp)]).size, 4)
  assert.ok(joined.every(peer => JSON.parse(peer.config).networkSecret === config.networkSecret))
  const other = await request('rooms/create', { transports, public: false })
  assert.equal(other.vpnIp, host.vpnIp, 'separate room networks can reuse the subnet')
  assert.notEqual(JSON.parse(other.config).networkSecret, config.networkSecret)
  assert.notEqual(JSON.parse(other.config).networkName, config.networkName)
  const publicRooms = await request('rooms/list')
  assert.equal(publicRooms.rooms.length, 1)
  assert.equal(publicRooms.rooms[0].code, host.code)
  const publicPeers = await request(`rooms/peers?code=${host.code}`)
  assert.ok(publicPeers.peers.every(peer => !('sessionToken' in peer) && !('networkSecret' in peer)))
  assert.equal((await request('heartbeat', { peerId: host.peerId })).status, 403)
  assert.equal((await request('rooms/leave', { peerId: host.peerId, sessionToken: other.sessionToken })).status, 403)
  const before = fs.statSync(path.join(dir, 'vpn.json')).mtimeMs
  for (let i = 0; i < 5; i++) assert.equal((await request('heartbeat', { peerId: host.peerId, sessionToken: host.sessionToken })).ok, true)
  await request('rooms/list')
  await request(`rooms/peers?code=${host.code}`)
  assert.equal(fs.statSync(path.join(dir, 'vpn.json')).mtimeMs, before, 'polling does not synchronously rewrite state')
  assert.equal((await request('rooms/leave', { peerId: host.peerId, sessionToken: host.sessionToken })).ok, true)
  assert.equal((await request('heartbeat', { peerId: joined[0].peerId, sessionToken: joined[0].sessionToken })).status, 404)
  assert.equal((await request('heartbeat', { peerId: other.peerId, sessionToken: other.sessionToken })).ok, true)
})
