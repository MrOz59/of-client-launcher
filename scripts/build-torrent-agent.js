#!/usr/bin/env node
/**
 * Build script for torrent-agent standalone executable.
 * 
 * This script uses cx_Freeze to compile libtorrent_rpc.py + libtorrent
 * into a standalone executable. This is the SAME approach used by Hydra Launcher.
 * 
 * See: https://github.com/hydralauncher/hydra/blob/main/.github/workflows/build.yml
 * 
 * The output goes to: services/torrent-agent/torrent-agent/
 * Which is then copied to resources/torrent-agent/ during packaging.
 */

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TORRENT_AGENT_DIR = path.join(__dirname, '..', 'services', 'torrent-agent')
const OUTPUT_DIR = path.join(TORRENT_AGENT_DIR, 'torrent-agent')  // Same name as Hydra uses

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function getPythonCommand() {
  // Try python3 first (Linux/macOS), then python (Windows)
  for (const cmd of ['python3', 'python']) {
    try {
      const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
      if (result.status === 0) {
        console.log(`Using Python: ${result.stdout.trim() || result.stderr.trim()}`)
        return cmd
      }
    } catch {
      // ignore
    }
  }
  throw new Error('Python not found. Please install Python 3.9 and add to PATH.')
}

function copyOpenSSLDlls() {
  // Copy OpenSSL DLLs with -x64 suffix (same as Hydra does)
  // See: https://github.com/hydralauncher/hydra/blob/main/.github/workflows/build.yml
  const libDir = path.join(OUTPUT_DIR, 'lib')
  
  if (!fs.existsSync(libDir)) {
    console.log('No lib directory found, skipping OpenSSL DLL copy')
    return
  }
  
  const dllsToCopy = [
    { src: 'libcrypto-1_1.dll', dst: 'libcrypto-1_1-x64.dll' },
    { src: 'libssl-1_1.dll', dst: 'libssl-1_1-x64.dll' }
  ]
  
  for (const { src, dst } of dllsToCopy) {
    const srcPath = path.join(libDir, src)
    const dstPath = path.join(libDir, dst)
    
    if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
      console.log(`Copying ${src} -> ${dst}`)
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

function main() {
  console.log('=== Building torrent-agent standalone executable ===')
  console.log('=== Using same approach as Hydra Launcher ===\n')

  const python = getPythonCommand()

  // Ensure we're in the right directory
  process.chdir(TORRENT_AGENT_DIR)
  console.log(`Working directory: ${TORRENT_AGENT_DIR}\n`)

  // Clean previous build
  for (const dir of ['torrent-agent', 'build']) {
    const fullPath = path.join(TORRENT_AGENT_DIR, dir)
    if (fs.existsSync(fullPath)) {
      console.log(`Cleaning ${dir}/...`)
      fs.rmSync(fullPath, { recursive: true, force: true })
    }
  }

  // Install dependencies from requirements.txt (same as Hydra)
  console.log('\n--- Installing dependencies from requirements.txt ---')
  run(`${python} -m pip install --upgrade pip`)
  run(`${python} -m pip install -r requirements.txt`)

  // Build with cx_Freeze (same as Hydra: python setup.py build)
  console.log('\n--- Building executable with cx_Freeze ---')
  run(`${python} setup.py build`)

  // Copy OpenSSL DLLs (same as Hydra does in their workflow)
  if (process.platform === 'win32') {
    console.log('\n--- Copying OpenSSL DLLs ---')
    copyOpenSSLDlls()
  }

  // Verify output
  const platform = process.platform
  const exeName = platform === 'win32' ? 'torrent-agent.exe' : 'torrent-agent'
  const exePath = path.join(OUTPUT_DIR, exeName)

  if (fs.existsSync(exePath)) {
    const stats = fs.statSync(exePath)
    console.log(`\n✅ Build successful!`)
    console.log(`   Executable: ${exePath}`)
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
    
    // List contents
    console.log('\nOutput directory contents:')
    const items = fs.readdirSync(OUTPUT_DIR)
    for (const item of items) {
      const itemPath = path.join(OUTPUT_DIR, item)
      const stat = fs.statSync(itemPath)
      console.log(`   ${item}${stat.isDirectory() ? '/' : ''}`)
    }
  } else {
    // List what was created
    console.log('\nOutput directory does not exist or missing executable.')
    if (fs.existsSync(TORRENT_AGENT_DIR)) {
      console.log('Directory contents:')
      for (const item of fs.readdirSync(TORRENT_AGENT_DIR)) {
        console.log(`   ${item}`)
      }
    }
    throw new Error(`Expected executable not found at ${exePath}`)
  }

  console.log('\n=== Build complete ===')
}

main()
