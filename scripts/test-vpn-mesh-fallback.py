#!/usr/bin/env python3
"""What happens to a room when two players cannot reach each other directly.

The whole point of the mesh mode is that the Brazilian node matches players and
nothing else. That claim only holds if the node refuses to carry game traffic
even when it is the only path left — which is exactly the case this checks, by
blocking the direct path between two players while both keep reaching the
rendezvous. It then adds a third player both of them can reach, to see whether
the room finds a way through the mesh instead of going dark.

Run after building TypeScript and fetching EasyTier:
  python3 scripts/test-vpn-mesh-fallback.py
Nothing is configured on the host network; all links/routes disappear on exit.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / 'vendor/easytier/linux-x64/easytier-core'
children = []

if '--isolated' not in sys.argv:
    env = dict(os.environ, OF_VPN_TEST_HOST_NET=os.readlink('/proc/self/ns/net'))
    os.execvpe('unshare', ['unshare', '--user', '--map-root-user', '--net', sys.executable, __file__, '--isolated'], env)

WORKER = """
const fs = require('node:fs')
const mesh = require(process.argv[2])
const manifest = fs.readFileSync(process.argv[3], 'utf8')
const dir = process.argv[4]
;(async () => {
  const connected = await mesh.meshConnect(manifest, dir)
  if (!connected.success) throw new Error(connected.error)
  while (!fs.existsSync(dir + '/stop')) {
    fs.writeFileSync(dir + '/peers.json', JSON.stringify(await mesh.meshPeers()))
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  await mesh.meshDisconnect()
  fs.writeFileSync(dir + '/stopped', 'ok')
})().catch(error => { fs.writeFileSync(dir + '/error', error.message); mesh.meshStopImmediately(); process.exit(1) })
"""


def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True, timeout=15, **kwargs)


def start(*args):
    child = subprocess.Popen([str(x) for x in args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    children.append(child)
    return child


def inside(pid, *args, check=True):
    return subprocess.run(['nsenter', '--target', str(pid), '--net', *[str(x) for x in args]],
                          check=check, capture_output=True, text=True, timeout=15)


def stop(child):
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def player(number, temp):
    """A launcher instance in its own namespace, as the app would start it."""
    manifest = dict(version=1, transport='easytier', networkName='of-room-' + 'c' * 32,
                    networkSecret='d' * 64, ipv4=f'10.77.0.{number + 1}/24',
                    hostname=f'cccccccc-cccc-cccc-cccc-{number:012d}',
                    peers=[f'tcp://172.28.{number}.1:11010', f'udp://172.28.{number}.1:11010'])
    manifest_file = Path(temp) / f'{number}.json'
    manifest_file.write_text(json.dumps(manifest))
    manifest_file.chmod(0o600)
    user_data = Path(temp) / f'client{number}'
    user_data.mkdir()
    start('nsenter', '--target', str(namespaces[number]), '--net', 'node', Path(temp) / 'worker.js',
          ROOT / 'dist/main/vpnMeshManager.js', manifest_file, user_data)
    return user_data


def peers_of(user_data):
    try:
        return json.loads((user_data / 'peers.json').read_text())
    except (ValueError, FileNotFoundError):
        return []


def route_to(user_data, ip):
    for peer in peers_of(user_data):
        if peer.get('ip') == ip:
            return peer.get('connection')
    return None


def reachable(pid, ip, attempts=1):
    for _ in range(attempts):
        if inside(pid, 'ping', '-c', '2', '-W', '2', ip, check=False).returncode == 0:
            return True
        time.sleep(1)
    return False


def wait_for(condition, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(.5)
    return False


try:
    assert os.getuid() == 0, 'Run inside unshare --user --map-root-user --net'
    assert os.environ.get('OF_VPN_TEST_HOST_NET') and os.readlink('/proc/self/ns/net') != os.environ['OF_VPN_TEST_HOST_NET'], 'Refusing to modify the host network'
    assert CORE.exists(), 'Run npm run fetch:easytier first'

    run('ip', 'link', 'set', 'lo', 'up')
    run('sysctl', '-w', 'net.ipv4.ip_forward=1')

    # Three players on three different "ISPs", all routed by this namespace.
    namespaces = {}
    for number in (1, 2, 3):
        anchor = start('unshare', '--net', 'sleep', '240')
        for _ in range(50):
            if os.readlink(f'/proc/{anchor.pid}/ns/net') != os.readlink('/proc/self/ns/net'):
                break
            time.sleep(.02)
        namespaces[number] = anchor.pid
        run('ip', 'link', 'add', f'host{number}', 'type', 'veth', 'peer', 'name', f'client{number}')
        run('ip', 'link', 'set', f'client{number}', 'netns', anchor.pid)
        run('ip', 'addr', 'add', f'172.28.{number}.1/30', 'dev', f'host{number}')
        run('ip', 'link', 'set', f'host{number}', 'up')
        inside(anchor.pid, 'ip', 'link', 'set', 'lo', 'up')
        inside(anchor.pid, 'ip', 'addr', 'add', f'172.28.{number}.2/30', 'dev', f'client{number}')
        inside(anchor.pid, 'ip', 'link', 'set', f'client{number}', 'up')
        inside(anchor.pid, 'ip', 'route', 'add', 'default', 'via', f'172.28.{number}.1')

    # Players 1 and 2 cannot reach each other at all: the symmetric-NAT/CGNAT
    # case. Traffic to this namespace itself is untouched, so both still reach
    # the rendezvous, and player 3 stays reachable from both.
    run('iptables', '-I', 'FORWARD', '-s', '172.28.1.0/30', '-d', '172.28.2.0/30', '-j', 'DROP')
    run('iptables', '-I', 'FORWARD', '-s', '172.28.2.0/30', '-d', '172.28.1.0/30', '-j', 'DROP')
    assert not reachable(namespaces[1], '172.28.2.2'), 'The blocked pair can still reach each other'
    assert reachable(namespaces[1], '172.28.1.1'), 'Player 1 cannot reach the rendezvous'
    assert reachable(namespaces[2], '172.28.2.1'), 'Player 2 cannot reach the rendezvous'
    print('SETUP: players 1 and 2 have no path to each other; both reach the rendezvous.', flush=True)

    rendezvous = start(CORE, '--no-tun', 'true', '--network-name', 'of-rendezvous', '--listeners',
                       'tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010', '--relay-network-whitelist',
                       '--relay-all-peer-rpc', 'true', '--rpc-portal', '127.0.0.1:15888')

    with tempfile.TemporaryDirectory(prefix='of-mesh-fallback-') as temp:
        (Path(temp) / 'worker.js').write_text(WORKER)

        first = player(1, temp)
        second = player(2, temp)
        assert wait_for(lambda: route_to(first, '10.77.0.2') == 'local' and route_to(second, '10.77.0.3') == 'local', 90), \
            'Players did not start their own tunnels: ' + ((first / 'error').read_text() if (first / 'error').exists() else '')

        # Long enough for hole punching to be tried and to fail.
        time.sleep(20)
        assert not reachable(namespaces[1], '10.77.0.3', attempts=2), \
            'The rendezvous carried game traffic between two players — it is in the data path'
        print('PASS: with no direct path the room has no route; the rendezvous refuses to relay.', flush=True)

        # The engine still offers the rendezvous as a path. Calling that "via
        # relay" would read as connected while nothing passes.
        route = route_to(first, '10.77.0.3')
        assert route == 'connecting', f'A path that carries nothing was reported as {route!r}'
        assert all(peer.get('latencyMs') is None for peer in peers_of(first) if peer.get('ip') == '10.77.0.3'), \
            'A per-hop penalty was reported as a measured latency'
        print('PASS: the launcher reports it as still looking for a path, with no latency.', flush=True)

        third = player(3, temp)
        assert wait_for(lambda: route_to(third, '10.77.0.4') == 'local', 90), \
            'The third player did not start: ' + ((third / 'error').read_text() if (third / 'error').exists() else '')
        assert wait_for(lambda: reachable(namespaces[1], '10.77.0.3'), 60), \
            'A third player both sides can reach did not restore the room'
        route = route_to(first, '10.77.0.3')
        assert route == 'relay', f'Expected the launcher to report a relayed route, got {route!r}'
        print('PASS: a third player both sides can reach restores the room, reported as "Via relay".', flush=True)

        for number in (1, 2, 3):
            (Path(temp) / f'client{number}/stop').touch()
        assert wait_for(lambda: all((Path(temp) / f'client{n}/stopped').exists() for n in (1, 2, 3)), 20), \
            'Launcher failed to disconnect'
        print('PASS: every launcher disconnected and removed its tunnel.', flush=True)
finally:
    for child in reversed(children):
        stop(child)
