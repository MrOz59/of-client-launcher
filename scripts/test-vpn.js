const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildMeshToml, parseMeshConfig, parseMeshPeers } = require('../dist/main/vpnMeshConfig.js')
const controller = require('../dist/main/vpnControllerClient.js')
const { validateWireGuardConfig } = require('../dist/main/vpnWireGuardConfig.js')

const config = {
  version: 1, transport: 'easytier', networkName: 'of-room-' + 'a'.repeat(32), networkSecret: 'b'.repeat(64),
  ipv4: '10.77.0.2/24', hostname: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', peers: ['udp://vpn.example.com:11010']
}

test('untrusted room configs cannot install default routes or inject engine options', () => {
  for (const mutation of [
    { ipv4: '0.0.0.0/0' }, { ipv4: '10.77.0.256/24' }, { ipv4: '10.77.0.1/24' },
    { peers: ['file:///tmp/payload'] }, { peers: ['tcp://user:pass@example.com:1234'] },
    { peers: ['tcp://example.com:1234/evil'] }, { networkSecret: 'x\n[flags]\nenable_encryption=false' },
    { peers: [] }, { version: 2 }
  ]) assert.throws(() => parseMeshConfig(JSON.stringify({ ...config, ...mutation })))
  const valid = parseMeshConfig(JSON.stringify({ ...config, flags: { enable_exit_node: true }, routes: ['0.0.0.0/0'] }))
  assert.equal(valid.hostname.length, 32, 'identity must fit the actual EasyTier hostname limit')
  assert.deepEqual(parseMeshConfig(JSON.stringify(valid)), valid)
  const toml = buildMeshToml(valid)
  assert.match(toml, /enable_encryption = true/)
  assert.match(toml, /routes = \["10\.77\.0\.0\/24"\]/)
  // Relays for its own room and nothing else: never a public relay, but able
  // to bridge two players of this room who have no direct path.
  assert.match(toml, /relay_network_whitelist = "of-room-a{32}"/)
  assert.match(toml, /relay_all_peer_rpc = false/)
  assert.doesNotMatch(toml, /0\.0\.0\.0\/0|enable_exit_node = true/)
})

test('actual EasyTier CLI route format distinguishes direct, relayed and local peers', () => {
  const peers = JSON.stringify([
    { ipv4: '10.77.0.2', cost: 'Local', lat_ms: '-' },
    { ipv4: '10.77.0.3', cost: 'p2p', lat_ms: '3.45' },
    { ipv4: '10.77.0.4', cost: 'relay(2)', lat_ms: '180.00' },
    { ipv4: '', cost: 'p2p', lat_ms: '100' }
  ])
  const routes = parseMeshPeers(peers)
  assert.deepEqual(routes.map(route => route.connection), ['local', 'direct', 'relay'])
  assert.equal(routes[0].latencyMs, undefined)
  assert.equal(routes[1].latencyMs, 3.45)

  // The rendezvous carries discovery but drops game traffic, and it has no
  // address in the room: a route through it is not a playable relay.
  const throughRendezvous = parseMeshPeers(peers, JSON.stringify([
    { ipv4: '10.77.0.3/24', next_hop_ipv4: 'DIRECT', next_hop_ipv4_lat_first: 'DIRECT', path_len: 1 },
    { ipv4: '10.77.0.4/24', next_hop_ipv4: '', next_hop_ipv4_lat_first: '', next_hop_hostname_lat_first: 'PublicServer_vps', path_len: 2 }
  ]))
  assert.deepEqual(throughRendezvous.map(route => route.connection), ['local', 'direct', 'connecting'])
  assert.equal(throughRendezvous[2].latencyMs, undefined, 'a per-hop penalty must not read as a measured ping')

  const throughPlayer = parseMeshPeers(peers, JSON.stringify([
    { ipv4: '10.77.0.3/24', next_hop_ipv4_lat_first: 'DIRECT', path_len: 1 },
    { ipv4: '10.77.0.4/24', next_hop_ipv4_lat_first: '10.77.0.3/24', path_len: 2 }
  ]))
  assert.deepEqual(throughPlayer.map(route => route.connection), ['local', 'direct', 'relay'])
  assert.equal(throughPlayer[2].latencyMs, 180)
})

test('legacy WireGuard accepts controller configs but refuses elevated shell hooks', () => {
  const wg = `[Interface]\nPrivateKey = ${Buffer.alloc(32, 1).toString('base64')}\nAddress = 10.77.0.2/32\n[Peer]\nPublicKey = ${Buffer.alloc(32, 2).toString('base64')}\nEndpoint = vpn.example.com:51820\nAllowedIPs = 10.77.0.0/24\nPersistentKeepalive = 25\n`
  assert.doesNotThrow(() => validateWireGuardConfig(wg))
  for (const directive of ['PostUp = touch /tmp/unwanted', 'PreDown = false', 'Table = off', 'SaveConfig = true']) {
    assert.throws(() => validateWireGuardConfig(wg.replace('[Peer]', `${directive}\n[Peer]`)))
  }
  assert.throws(() => validateWireGuardConfig(wg.replace('10.77.0.0/24', '0.0.0.0/0')))
})

test('controller preserves password-required metadata on HTTP 403', async t => {
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ ok: false, needsPassword: true, error: 'password_required' }), { status: 403 }))
  const result = await controller.vpnControllerJoinRoom({ controllerUrl: 'https://controller.example/', code: 'ABCDEFGH' })
  assert.equal(result.success, false)
  assert.equal(result.needsPassword, true)
})

test('controller negotiates transports and sends private session credentials', async t => {
  const bodies = []
  t.mock.method(global, 'fetch', async (_url, request) => {
    bodies.push(JSON.parse(request.body))
    return new Response(JSON.stringify({ ok: true, peerId: 'peer', sessionToken: 'token' }))
  })
  const room = await controller.vpnControllerCreateRoom({ controllerUrl: 'https://controller.example/' })
  assert.deepEqual(bodies[0].transports, ['easytier', 'wireguard'])
  assert.equal(room.sessionToken, 'token')
  await controller.vpnControllerHeartbeat({ controllerUrl: 'https://controller.example/', peerId: 'peer', sessionToken: 'token' })
  assert.equal(bodies[1].sessionToken, 'token')
})

test('presence survives closing the renderer and never exposes its session token', async t => {
  const mesh = require('../dist/main/vpnMeshManager.js')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(controller, 'vpnControllerCreateRoom', async () => ({ success: true, code: 'ABCDEFGH', peerId: config.hostname, config: JSON.stringify(config), vpnIp: '10.77.0.2', sessionToken: 'private' }))
  const heartbeat = t.mock.method(controller, 'vpnControllerHeartbeat', async () => ({ success: true, peers: [{ id: config.hostname, ip: '10.77.0.2' }] }))
  const connect = t.mock.method(mesh, 'meshConnect', async () => ({ success: true }))
  t.mock.method(mesh, 'meshDisconnect', async () => ({ success: true }))
  t.mock.method(mesh, 'meshPeers', async () => [{ ip: '10.77.0.2', connection: 'local' }])
  const { VpnSession } = require('../dist/main/vpnSession.js')
  const session = new VpnSession(() => '/unused', () => 'https://controller.example/')
  t.after(() => session.stopOnQuit())
  const created = await session.create({})
  assert.equal('sessionToken' in created, false)
  assert.equal((await session.connect(JSON.stringify(config))).success, true)
  assert.equal((await session.autoconnect('ABCDEFGH')).success, true)
  assert.equal(connect.mock.callCount(), 1, 'launching a game reuses its active room instead of replacing the tunnel')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(heartbeat.mock.callCount(), 1)
  t.mock.timers.tick(15_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(heartbeat.mock.callCount(), 2)
  assert.equal('sessionToken' in session.snapshot(), false)
  assert.equal(session.snapshot().peers[0].connection, 'local')
  await session.disconnect()
  t.mock.timers.tick(60_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(heartbeat.mock.callCount(), 2)
})
