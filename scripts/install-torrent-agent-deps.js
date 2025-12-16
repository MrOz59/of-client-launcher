/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${res.status})`)
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function main() {
  const platform = process.env.OF_TARGET_PLATFORM || process.platform
  const python = String(process.env.OF_PYTHON_FOR_DEPS || process.env.OF_PYTHON_PATH || process.env.PYTHON || (platform === 'win32' ? 'python' : 'python3')).trim()
  const libtorrentVersion = String(process.env.OF_LIBTORRENT_VERSION || '2.0.11').trim()

  const repoRoot = path.join(__dirname, '..')
  const depsDir = path.join(repoRoot, 'services', 'torrent-agent', 'pydeps')
  ensureDir(depsDir)

  console.log(`[torrent-agent] installing deps into: ${depsDir}`)
  console.log(`[torrent-agent] python: ${python}`)

  // Ensure pip exists
  run(python, ['-m', 'pip', '--version'])

  const pkg = libtorrentVersion ? `libtorrent==${libtorrentVersion}` : 'libtorrent'

  run(python, [
    '-m', 'pip', 'install',
    '--only-binary=:all:',
    '--upgrade',
    '--target', depsDir,
    pkg
  ])

  console.log('[torrent-agent] done')
}

try {
  main()
} catch (err) {
  console.error('[torrent-agent] failed:', err)
  process.exit(1)
}
