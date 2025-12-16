/* eslint-disable no-console */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

function main() {
  const repoRoot = path.join(__dirname, '..')
  const script = path.join(repoRoot, 'services', 'torrent-agent', 'libtorrent_rpc.py')
  const pydeps = path.join(repoRoot, 'services', 'torrent-agent', 'pydeps')

  const python = process.env.OF_PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
  const torrentPath = process.argv[2]
  const savePath = process.argv[3] || path.join(repoRoot, 'downloads', '__torrent_agent_test')

  if (!torrentPath) {
    console.error('Usage: node scripts/test-torrent-agent.js /path/to/file.torrent [savePath]')
    process.exit(2)
  }
  if (!fs.existsSync(torrentPath)) {
    console.error('torrent file not found:', torrentPath)
    process.exit(2)
  }

  const env = { ...process.env }
  if (fs.existsSync(pydeps)) {
    env.PYTHONPATH = env.PYTHONPATH ? `${pydeps}${path.delimiter}${env.PYTHONPATH}` : pydeps
  }

  const child = spawn(python, ['-u', script], { stdio: ['pipe', 'pipe', 'pipe'], env })

  let buf = ''
  const pending = new Map()

  child.stdout.on('data', (b) => {
    buf += String(b)
    while (true) {
      const idx = buf.indexOf('\n')
      if (idx < 0) break
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg && msg.event === 'fatal') {
        console.error('FATAL:', msg)
        process.exit(1)
      }
      if (typeof msg.id === 'number') {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'))
          else p.resolve(msg.result)
        }
      } else {
        console.log('EVENT:', msg)
      }
    }
  })

  child.stderr.on('data', (b) => {
    console.error('[stderr]', String(b))
  })

  child.on('exit', (code) => {
    console.log('sidecar exited:', code)
  })

  let nextId = 1
  function call(method, params) {
    const id = nextId++
    const payload = JSON.stringify({ id, method, params: params || {} })
    child.stdin.write(payload + '\n')
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }

  ;(async () => {
    console.log('ping...')
    console.log(await call('ping', {}))

    console.log('add...')
    const addRes = await call('add', { source: torrentPath, savePath })
    console.log(addRes)

    const ih = addRes.infoHash
    if (!ih) throw new Error('missing infoHash')

    for (let i = 0; i < 10; i++) {
      const st = await call('status', { torrentId: ih })
      console.log('status', i, st)
      await new Promise(r => setTimeout(r, 1000))
    }

    console.log('pause...')
    await call('pause', { torrentId: ih })
    console.log('resume...')
    await call('resume', { torrentId: ih })

    console.log('remove...')
    await call('remove', { torrentId: ih, deleteFiles: false })

    child.kill('SIGTERM')
  })().catch((e) => {
    console.error('test failed:', e)
    try { child.kill('SIGTERM') } catch {}
    process.exit(1)
  })
}

main()
