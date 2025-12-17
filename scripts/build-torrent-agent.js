#!/usr/bin/env node
/**
 * Build script for torrent-agent standalone executable.
 * 
 * This script uses cx_Freeze to compile libtorrent_rpc.py + libtorrent
 * into a standalone executable that doesn't require Python installation.
 * 
 * The output goes to: services/torrent-agent/dist/
 * Which is then copied to resources/torrent-agent/ during packaging.
 */

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TORRENT_AGENT_DIR = path.join(__dirname, '..', 'services', 'torrent-agent')
const DIST_DIR = path.join(TORRENT_AGENT_DIR, 'dist')

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
  throw new Error('Python not found. Please install Python 3.8+ and add to PATH.')
}

function main() {
  console.log('=== Building torrent-agent standalone executable ===\n')

  const python = getPythonCommand()

  // Ensure we're in the right directory
  process.chdir(TORRENT_AGENT_DIR)
  console.log(`Working directory: ${TORRENT_AGENT_DIR}\n`)

  // Clean previous build
  if (fs.existsSync(DIST_DIR)) {
    console.log('Cleaning previous build...')
    fs.rmSync(DIST_DIR, { recursive: true, force: true })
  }

  // Install build dependencies
  console.log('\n--- Installing build dependencies ---')
  run(`${python} -m pip install --upgrade pip`)
  run(`${python} -m pip install cx_Freeze libtorrent`)

  // Build the executable
  console.log('\n--- Building executable with cx_Freeze ---')
  run(`${python} setup.py build_exe`)

  // Verify output
  const platform = process.platform
  const exeName = platform === 'win32' ? 'torrent-agent.exe' : 'torrent-agent'
  let exePath = path.join(DIST_DIR, exeName)

  if (!fs.existsSync(exePath)) {
    // cx_Freeze puts output in a subfolder like exe.win-amd64-3.11 or exe.linux-x86_64-3.11
    // Find it dynamically
    console.log('Executable not at root, searching for cx_Freeze output folder...')
    
    if (fs.existsSync(DIST_DIR)) {
      const dirs = fs.readdirSync(DIST_DIR).filter(d => {
        const fullPath = path.join(DIST_DIR, d)
        return fs.statSync(fullPath).isDirectory() && d.startsWith('exe.')
      })
      
      if (dirs.length > 0) {
        const exeDir = path.join(DIST_DIR, dirs[0])
        const candidateExe = path.join(exeDir, exeName)
        
        if (fs.existsSync(candidateExe)) {
          console.log(`Found executable in ${dirs[0]}, moving contents to dist root...`)
          
          // Move all contents from subfolder to DIST_DIR root
          for (const item of fs.readdirSync(exeDir)) {
            const src = path.join(exeDir, item)
            const dest = path.join(DIST_DIR, item)
            fs.renameSync(src, dest)
          }
          
          // Remove the now-empty subfolder
          fs.rmdirSync(exeDir)
          
          exePath = path.join(DIST_DIR, exeName)
        }
      }
    }
  }

  if (fs.existsSync(exePath)) {
    const stats = fs.statSync(exePath)
    console.log(`\n✅ Build successful!`)
    console.log(`   Executable: ${exePath}`)
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
  } else {
    // List what was created
    console.log('\nDist directory contents:')
    const listDir = (dir, indent = '') => {
      for (const item of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, item)
        const stat = fs.statSync(fullPath)
        console.log(`${indent}${item}${stat.isDirectory() ? '/' : ''}`)
        if (stat.isDirectory() && indent.length < 4) {
          listDir(fullPath, indent + '  ')
        }
      }
    }
    if (fs.existsSync(DIST_DIR)) {
      listDir(DIST_DIR)
    }
    throw new Error(`Expected executable not found at ${exePath}`)
  }

  console.log('\n=== Build complete ===')
}

main()
