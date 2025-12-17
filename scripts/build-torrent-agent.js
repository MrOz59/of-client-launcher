#!/usr/bin/env node
/**
 * Build script for torrent-agent standalone executable.
 * 
 * This script uses cx_Freeze (or PyInstaller as fallback) to compile 
 * libtorrent_rpc.py + libtorrent into a standalone executable.
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

function tryRun(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  try {
    execSync(cmd, { stdio: 'inherit', ...opts })
    return true
  } catch (e) {
    console.log(`Command failed: ${e.message}`)
    return false
  }
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

function findAndMoveExecutable(exeName) {
  let exePath = path.join(DIST_DIR, exeName)

  if (!fs.existsSync(exePath)) {
    // cx_Freeze puts output in a subfolder like exe.win-amd64-3.11
    console.log('Executable not at root, searching for build output folder...')
    
    if (fs.existsSync(DIST_DIR)) {
      const dirs = fs.readdirSync(DIST_DIR).filter(d => {
        const fullPath = path.join(DIST_DIR, d)
        return fs.statSync(fullPath).isDirectory() && (d.startsWith('exe.') || d === 'dist')
      })
      
      for (const dir of dirs) {
        const exeDir = path.join(DIST_DIR, dir)
        const candidateExe = path.join(exeDir, exeName)
        
        if (fs.existsSync(candidateExe)) {
          console.log(`Found executable in ${dir}, moving contents to dist root...`)
          
          for (const item of fs.readdirSync(exeDir)) {
            const src = path.join(exeDir, item)
            const dest = path.join(DIST_DIR, item)
            if (!fs.existsSync(dest)) {
              fs.renameSync(src, dest)
            }
          }
          
          try { fs.rmdirSync(exeDir) } catch {}
          exePath = path.join(DIST_DIR, exeName)
          break
        }
      }
    }
  }
  
  return exePath
}

function buildWithCxFreeze(python) {
  console.log('\n--- Building executable with cx_Freeze ---')
  run(`${python} -m pip install cx_Freeze`)
  run(`${python} setup.py build_exe`)
}

function buildWithPyInstaller(python) {
  console.log('\n--- Building executable with PyInstaller ---')
  run(`${python} -m pip install pyinstaller`)
  
  // PyInstaller puts output in dist/ subfolder
  const pyinstallerDist = path.join(TORRENT_AGENT_DIR, 'dist')
  if (fs.existsSync(pyinstallerDist)) {
    fs.rmSync(pyinstallerDist, { recursive: true, force: true })
  }
  
  run(`${python} -m PyInstaller torrent-agent.spec --distpath "${DIST_DIR}" --workpath "${path.join(TORRENT_AGENT_DIR, 'build')}"`)
}

function main() {
  console.log('=== Building torrent-agent standalone executable ===\n')

  const python = getPythonCommand()

  // Ensure we're in the right directory
  process.chdir(TORRENT_AGENT_DIR)
  console.log(`Working directory: ${TORRENT_AGENT_DIR}\n`)

  // Clean previous build
  for (const dir of ['dist', 'build']) {
    const fullPath = path.join(TORRENT_AGENT_DIR, dir)
    if (fs.existsSync(fullPath)) {
      console.log(`Cleaning ${dir}/...`)
      fs.rmSync(fullPath, { recursive: true, force: true })
    }
  }

  // Install libtorrent
  console.log('\n--- Installing libtorrent ---')
  run(`${python} -m pip install --upgrade pip`)
  run(`${python} -m pip install libtorrent`)

  // Try cx_Freeze first, then PyInstaller as fallback
  let buildSuccess = false
  
  try {
    buildWithCxFreeze(python)
    buildSuccess = true
  } catch (e) {
    console.log(`\n⚠️ cx_Freeze failed: ${e.message}`)
    console.log('Trying PyInstaller as fallback...\n')
    
    try {
      buildWithPyInstaller(python)
      buildSuccess = true
    } catch (e2) {
      console.error(`PyInstaller also failed: ${e2.message}`)
    }
  }

  // Verify output
  const platform = process.platform
  const exeName = platform === 'win32' ? 'torrent-agent.exe' : 'torrent-agent'
  const exePath = findAndMoveExecutable(exeName)

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
