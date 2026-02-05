#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OVERLAY_DIR = path.join(__dirname, '..', 'services', 'game-overlay');
const BUILD_DIR = path.join(OVERLAY_DIR, 'build');

async function exec(command, args, cwd = OVERLAY_DIR) {
  return new Promise((resolve, reject) => {
    console.log(`\x1b[36m[Build]\x1b[0m Running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false
    });
    
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function commandExists(cmd) {
  if (!cmd) return false;
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return true;
  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of pathEntries) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) return true;
    }
  }
  return false;
}

async function build() {
  if (process.env.VOIDLAUNCHER_DISABLE_GAME_OVERLAY === '1') {
    console.log('[VoidOverlay] Disabled via VOIDLAUNCHER_DISABLE_GAME_OVERLAY=1');
    return;
  }
  if (process.platform !== 'linux') {
    console.log('[VoidOverlay] Skipping Vulkan overlay build (Linux only)');
    return;
  }

  console.log('\x1b[35m[VoidOverlay]\x1b[0m Building Vulkan overlay layer...\n');
  
  try {
    // Check dependencies
    try {
      if (!commandExists('meson') || !commandExists('ninja')) {
        throw new Error('missing');
      }
    } catch (e) {
      console.error('\x1b[31m[Error]\x1b[0m meson or ninja not found!');
      console.error('Install with: sudo apt install meson ninja-build');
      process.exit(1);
    }
    
    // Setup build directory
    if (!fs.existsSync(BUILD_DIR)) {
      console.log('\x1b[36m[Build]\x1b[0m Setting up build directory...');
      await exec('meson', ['setup', 'build']);
    }
    
    // Build
    console.log('\x1b[36m[Build]\x1b[0m Compiling overlay...');
    await exec('ninja', ['-C', 'build']);
    
    console.log('\n\x1b[32m✓ Vulkan overlay built successfully!\x1b[0m');
    console.log('To install for development: cd services/game-overlay && ninja -C build install\n');
    
  } catch (error) {
    console.error('\n\x1b[31m[Error]\x1b[0m Build failed:', error.message);
    process.exit(1);
  }
}

build();
