/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${res.status})`)
}

function runJson(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`Failed: ${cmd} ${args.join(' ')}\n${res.stderr || ''}`)
  }
  return JSON.parse(res.stdout)
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true })
}

function main() {
  const platform = process.env.OF_TARGET_PLATFORM || process.platform
  const arch = process.env.OF_TARGET_ARCH || process.arch

  const python = (process.env.OF_PYTHON_FOR_BUNDLE || process.env.PYTHON || (platform === 'win32' ? 'python' : 'python3')).trim()
  const libtorrentVersion = (process.env.OF_LIBTORRENT_VERSION || '').trim()

  const repoRoot = path.join(__dirname, '..')
  const agentRoot = path.join(repoRoot, 'services', 'torrent-agent')
  const outRoot = path.join(agentRoot, 'python', `${platform}-${arch}`)
  const depsDir = path.join(agentRoot, 'pydeps')

  console.log(`[torrent-agent] platform=${platform} arch=${arch}`)
  console.log(`[torrent-agent] python=${python}`)

  // Discover python prefix/executable
  const info = runJson(python, ['-c', 'import json,sys,sysconfig,site; print(json.dumps({"executable":sys.executable,"prefix":sys.prefix,"base_prefix":getattr(sys,"base_prefix",sys.prefix),"version":sys.version.split()[0]}))'])
  console.log('[torrent-agent] python info:', info)

  // Rebuild output folders
  rmrf(outRoot)
  rmrf(depsDir)
  ensureDir(outRoot)
  ensureDir(depsDir)

  // Copy python installation directory (base_prefix is the actual install root on setup-python)
  const pythonRoot = String(info.base_prefix || info.prefix)
  if (!pythonRoot || !fs.existsSync(pythonRoot)) {
    throw new Error(`python root not found: ${pythonRoot}`)
  }

  console.log('[torrent-agent] copying python root:', pythonRoot)
  copyRecursive(pythonRoot, outRoot)

  // Create a stable executable path expected by app:
  // resources/torrent-agent/python/<platform>-<arch>/python(.exe)
  if (platform === 'win32') {
    const exeCandidates = [
      path.join(outRoot, 'python.exe'),
      path.join(outRoot, 'python'),
      path.join(outRoot, 'python3.exe'),
      path.join(outRoot, 'Scripts', 'python.exe')
    ]
    const found = exeCandidates.find(p => fs.existsSync(p))
    if (!found) throw new Error('python.exe not found in copied runtime')
    if (found !== path.join(outRoot, 'python.exe')) {
      fs.copyFileSync(found, path.join(outRoot, 'python.exe'))
    }
  } else {
    const binCandidates = [
      path.join(outRoot, 'bin', 'python3'),
      path.join(outRoot, 'bin', 'python'),
      path.join(outRoot, 'python3'),
      path.join(outRoot, 'python')
    ]
    const found = binCandidates.find(p => fs.existsSync(p))
    if (!found) throw new Error('python3 not found in copied runtime')
    const target = path.join(outRoot, 'python')
    if (!fs.existsSync(target)) {
      fs.copyFileSync(found, target)
      fs.chmodSync(target, 0o755)
    }
  }

  // Install libtorrent into a dedicated deps dir, forcing wheels (no source builds)
  // This makes the packaged app not depend on system packages.
  const pipArgs = ['-m', 'pip', 'install', '--only-binary=:all:', '--upgrade']
  if (libtorrentVersion) {
    pipArgs.push(`libtorrent==${libtorrentVersion}`)
  } else {
    pipArgs.push('libtorrent')
  }
  pipArgs.push('--target', depsDir)

  console.log('[torrent-agent] installing libtorrent into:', depsDir)
  run(python, pipArgs)

  console.log('[torrent-agent] done')
}

try {
  main()
} catch (err) {
  console.error('[torrent-agent] failed:', err)
  process.exit(1)
}
