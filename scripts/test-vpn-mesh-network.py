#!/usr/bin/env python3
"""Real encrypted TUN traffic in disposable Linux user/network namespaces.

Run after building TypeScript and fetching EasyTier:
  python3 scripts/test-vpn-mesh-network.py
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
CLI = CORE.with_name('easytier-cli')
children = []

if '--isolated' not in sys.argv:
    env = dict(os.environ, OF_VPN_TEST_HOST_NET=os.readlink('/proc/self/ns/net'))
    os.execvpe('unshare', ['unshare', '--user', '--map-root-user', '--net', sys.executable, __file__, '--isolated'], env)


def run(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True, timeout=15, **kwargs)


def start(*args):
    child = subprocess.Popen([str(x) for x in args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    children.append(child)
    return child


def inside(pid, *args):
    return run('nsenter', '--target', pid, '--net', *args)


def stop(child):
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


try:
    assert os.getuid() == 0, 'Run inside unshare --user --map-root-user --net'
    # Require a disposable network namespace, not a root invocation on the host.
    assert os.environ.get('OF_VPN_TEST_HOST_NET') and os.readlink('/proc/self/ns/net') != os.environ['OF_VPN_TEST_HOST_NET'], 'Refusing to modify the host network'
    assert CORE.exists(), 'Run npm run fetch:easytier first'
    run('ip', 'link', 'set', 'lo', 'up')
    run('sysctl', '-w', 'net.ipv4.ip_forward=1')
    namespaces = []
    for number in (1, 2):
        anchor = start('unshare', '--net', 'sleep', '120')
        for _ in range(50):
            if os.readlink(f'/proc/{anchor.pid}/ns/net') != os.readlink('/proc/self/ns/net'):
                break
            time.sleep(.02)
        namespaces.append(anchor.pid)
        run('ip', 'link', 'add', f'host{number}', 'type', 'veth', 'peer', 'name', f'client{number}')
        run('ip', 'link', 'set', f'client{number}', 'netns', anchor.pid)
        run('ip', 'addr', 'add', f'172.28.{number}.1/30', 'dev', f'host{number}')
        run('ip', 'link', 'set', f'host{number}', 'up')
        inside(anchor.pid, 'ip', 'link', 'set', 'lo', 'up')
        inside(anchor.pid, 'ip', 'addr', 'add', f'172.28.{number}.2/30', 'dev', f'client{number}')
        inside(anchor.pid, 'ip', 'link', 'set', f'client{number}', 'up')
        inside(anchor.pid, 'ip', 'route', 'add', 'default', 'via', f'172.28.{number}.1')
    bootstrap = start(CORE, '--no-tun', 'true', '--network-name', 'of-rendezvous', '--listeners',
                      'tcp://0.0.0.0:11010', 'udp://0.0.0.0:11010', '--relay-network-whitelist',
                      '--relay-all-peer-rpc', 'true', '--rpc-portal', '127.0.0.1:15888')
    with tempfile.TemporaryDirectory(prefix='of-mesh-network-') as temp:
        worker = Path(temp) / 'worker.js'
        worker.write_text("""
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
  const stopped = await mesh.meshDisconnect()
  if (!stopped.success) throw new Error(stopped.error)
  fs.writeFileSync(dir + '/stopped', 'ok')
})().catch(error => { fs.writeFileSync(dir + '/error', error.message); mesh.meshStopImmediately(); process.exit(1) })
""")
        for number, pid in enumerate(namespaces, start=1):
            manifest = dict(version=1, transport='easytier', networkName='of-room-' + 'a' * 32,
                            networkSecret='b' * 64, ipv4=f'10.77.0.{number + 1}/24',
                            hostname=f'aaaaaaaa-aaaa-aaaa-aaaa-{number:012d}',
                            peers=[f'tcp://172.28.{number}.1:11010'])
            toml = run('node', '-e',
                       "const fs=require('fs');const c=require(process.argv[1]);process.stdout.write(c.buildMeshToml(c.parseMeshConfig(fs.readFileSync(0,'utf8'))))",
                       ROOT / 'dist/main/vpnMeshConfig.js', input=json.dumps(manifest)).stdout
            file = Path(temp) / f'{number}.toml'
            file.write_text(toml)
            file.chmod(0o600)
            run(CORE, '--config-file', file, '--check-config')
            manifest_file = Path(temp) / f'{number}.json'
            manifest_file.write_text(json.dumps(manifest))
            manifest_file.chmod(0o600)
            user_data = Path(temp) / f'client{number}'
            user_data.mkdir()
            start('nsenter', '--target', pid, '--net', 'node', worker,
                  ROOT / 'dist/main/vpnMeshManager.js', manifest_file, user_data)
        deadline = time.monotonic() + 45
        direct = False
        while time.monotonic() < deadline:
            try:
                error = Path(temp) / 'client2/error'
                assert not error.exists(), error.read_text() if error.exists() else ''
                peers = json.loads((Path(temp) / 'client2/peers.json').read_text())
                direct = any(peer.get('ip') == '10.77.0.2' and peer.get('connection') == 'direct' for peer in peers)
                if direct:
                    inside(namespaces[1], 'ping', '-c', '2', '-W', '2', '10.77.0.2')
                    break
            except (subprocess.SubprocessError, ValueError, FileNotFoundError):
                pass
            time.sleep(.5)
        assert direct, 'Direct mesh route was not established'
        print('PASS: real TUN traffic takes the direct P2P route with data relay disabled.', flush=True)
        stop(bootstrap)
        time.sleep(2)
        inside(namespaces[1], 'ping', '-c', '3', '-W', '2', '10.77.0.2')
        print('PASS: game-network traffic continues after the rendezvous process is stopped.', flush=True)
        for number in (1, 2):
            (Path(temp) / f'client{number}/stop').touch()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not all((Path(temp) / f'client{n}/stopped').exists() for n in (1, 2)):
            time.sleep(.2)
        assert all((Path(temp) / f'client{n}/stopped').exists() for n in (1, 2)), 'Launcher failed to disconnect'
        for pid in namespaces:
            result = subprocess.run(['nsenter', '--target', str(pid), '--net', 'ip', 'link', 'show', 'ofmesh'], capture_output=True)
            assert result.returncode != 0, 'Tunnel leaked after disconnect'
        print('PASS: the launcher supervisors disconnect and remove both TUN devices.', flush=True)
finally:
    for child in reversed(children):
        stop(child)
