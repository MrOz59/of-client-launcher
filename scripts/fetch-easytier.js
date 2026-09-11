// Pinned upstream CLI runtime, bundled so players don't install a separate VPN.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')
const { spawnSync } = require('node:child_process')
const { path7z } = require('7zip-bin-full')

const VERSION = '2.6.4'
const ASSETS = {
  'linux-x64': ['linux-x86_64', '61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6'],
  'linux-arm64': ['linux-aarch64', 'f533ec25a7ea714e09f645615012200278058525795cc3bb690ff011aec1a70f'],
  'win32-x64': ['windows-x86_64', '27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84'],
  'win32-arm64': ['windows-arm64', '37023f8a3451c9234b17ee2089a03dc344ce90d803b5b359cb6c46682b0549b4']
}

function download(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many download redirects'))
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'VoidLauncher-EasyTier' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        clearTimeout(timer)
        download(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        clearTimeout(timer)
        reject(new Error(`EasyTier download: HTTP ${response.statusCode}`))
        return
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)) })
      response.on('error', error => { clearTimeout(timer); reject(error) })
    })
    const timer = setTimeout(() => request.destroy(new Error('EasyTier download timed out')), 300_000)
    request.on('error', error => { clearTimeout(timer); reject(error) })
  })
}

async function main() {
  const platform = process.env.EASYTIER_PLATFORM || (process.argv.includes('--windows') ? 'win32' : process.platform)
  const arch = process.env.EASYTIER_ARCH || process.arch
  const target = `${platform}-${arch}`
  const asset = ASSETS[target]
  if (!asset) throw new Error(`Unsupported EasyTier target: ${target}`)
  const destination = path.resolve(__dirname, '../vendor/easytier', target)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'of-easytier-'))
  try {
    const name = `easytier-${asset[0]}-v${VERSION}.zip`
    console.log(`Fetching EasyTier ${VERSION} for ${target}...`)
    const bytes = process.env.EASYTIER_ARCHIVE ? fs.readFileSync(process.env.EASYTIER_ARCHIVE)
      : await download(`https://github.com/EasyTier/EasyTier/releases/download/v${VERSION}/${name}`)
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset[1]) throw new Error('EasyTier SHA-256 mismatch')
    const archive = path.join(temp, 'runtime.zip')
    fs.writeFileSync(archive, bytes)
    const unpacked = path.join(temp, 'unpacked')
    const extracted = spawnSync(path7z, ['x', '-y', `-o${unpacked}`, archive], { encoding: 'utf8' })
    if (extracted.status !== 0) throw new Error(`Cannot extract EasyTier: ${extracted.error?.message || extracted.stderr}`)
    const entries = fs.readdirSync(unpacked, { recursive: true }).map(String)
    const suffix = platform === 'win32' ? '.exe' : ''
    const core = entries.find(entry => path.basename(entry) === `easytier-core${suffix}`)
    if (!core) throw new Error('EasyTier archive is missing easytier-core')
    const root = path.dirname(path.join(unpacked, core))
    for (const name of [`easytier-core${suffix}`, `easytier-cli${suffix}`]) {
      if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing ${name}`)
    }
    if (platform === 'win32' && !fs.existsSync(path.join(root, 'wintun.dll'))) throw new Error('Missing Wintun driver')
    fs.mkdirSync(destination, { recursive: true })
    // Only ship the engine/CLI and driver, not the unrelated web server binaries.
    for (const name of [`easytier-core${suffix}`, `easytier-cli${suffix}`, ...(platform === 'win32' ? ['wintun.dll'] : [])]) {
      fs.copyFileSync(path.join(root, name), path.join(destination, name))
    }
    if (platform !== 'win32') {
      fs.chmodSync(path.join(destination, 'easytier-core'), 0o755)
      fs.chmodSync(path.join(destination, 'easytier-cli'), 0o755)
    }
    fs.writeFileSync(path.join(destination, 'VERSION.txt'), `${VERSION}\n`)
    console.log(`EasyTier ${VERSION} verified and bundled for ${target}`)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
