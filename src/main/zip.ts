import { spawn } from 'child_process'
import { path7z } from '7zip-bin-full'
import fs from 'fs'
import path from 'path'
import { Worker } from 'worker_threads'
import os from 'os'

export interface ExtractProgress {
  percent: number
  etaSeconds?: number // Estimated time remaining in seconds
  speedMBps?: number  // Extraction speed in MB/s (approximate based on progress)
}

// Determine optimal thread count: use half of available cores (min 1, max 8)
// This balances speed with leaving resources for the system
function getOptimalThreadCount(): number {
  const cpus = os.cpus().length
  return Math.max(1, Math.min(8, Math.floor(cpus / 2))) || 2
}

/**
 * Get the correct path to 7z binary.
 * When packaged with electron-builder and asarUnpack, the binary is extracted
 * to app.asar.unpacked instead of being inside the .asar archive.
 */
function get7zBinaryPath(): string {
  let binary = path7z
  if (!binary) {
    throw new Error('7z/7zz binary not found in bundled 7zip-bin-full')
  }

  // In packaged apps, convert .asar path to .asar.unpacked
  if (binary.includes('.asar' + path.sep)) {
    binary = binary.replace('.asar' + path.sep, '.asar.unpacked' + path.sep)
  }

  // Verify the binary exists
  if (!fs.existsSync(binary)) {
    console.warn('[7z] Binary not found at:', binary, '- falling back to original path')
    binary = path7z
  }

  return binary
}

export function extractZipWithPassword(
  zipPath: string,
  destDir: string,
  password?: string,
  onProgress?: (percent: number, details?: ExtractProgress) => void
): Promise<void> {
  const ext = zipPath.toLowerCase()
  
  // 7z supports RAR natively and is much faster than node-unrar-js (WASM)
  // Try 7z first for all formats, fall back to node-unrar-js only if needed
  if (ext.endsWith('.rar')) {
    return extract7z(zipPath, destDir, password, onProgress)
      .catch((err) => {
        console.warn('[Extract] 7z failed for RAR, falling back to node-unrar-js:', err.message)
        return extractRarFallback(zipPath, destDir, password, onProgress)
      })
  }

  return extract7z(zipPath, destDir, password, onProgress)
}

function extract7z(
  archivePath: string,
  destDir: string,
  password?: string,
  onProgress?: (percent: number, details?: ExtractProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let binary: string
    try {
      binary = get7zBinaryPath()
    } catch (err: any) {
      return reject(err)
    }

    try {
      fs.mkdirSync(destDir, { recursive: true })
    } catch {}

    const threads = getOptimalThreadCount()
    console.log('[Extract] Starting extraction (7zz spawn)', { archivePath, destDir, binary, threads })

    const args = [
      'x',
      archivePath,
      `-p${password || 'online-fix.me'}`,
      `-o${destDir}`,
      // Multi-threading for faster extraction
      `-mmt=${threads}`,
      // Always overwrite existing files (avoid partial installs when re-extracting).
      '-aoa',
      '-y',
      // Show progress indicator
      '-bsp1'
    ]

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdoutBuf = ''
    let stderrBuf = ''

    let lastPercent = 0
    const startTime = Date.now()
    let lastProgressTime = startTime
    let lastProgressPercent = 0

    const emitProgress = (p: number) => {
      const clamped = Math.max(0, Math.min(100, p))
      if (clamped !== lastPercent) {
        lastPercent = clamped
        
        // Calculate ETA based on progress rate
        const now = Date.now()
        const elapsedMs = now - startTime
        let etaSeconds: number | undefined
        
        if (clamped > 0 && clamped < 100) {
          // Use overall progress for more stable ETA
          const msPerPercent = elapsedMs / clamped
          const remainingPercent = 100 - clamped
          etaSeconds = Math.round((msPerPercent * remainingPercent) / 1000)
        }
        
        onProgress?.(clamped, { percent: clamped, etaSeconds })
        
        if (etaSeconds !== undefined) {
          const etaMin = Math.floor(etaSeconds / 60)
          const etaSec = etaSeconds % 60
          console.log(`[Extract] progress ${clamped}% (ETA: ${etaMin}m ${etaSec}s)`)
        } else {
          console.log('[Extract] progress', clamped)
        }
        
        lastProgressTime = now
        lastProgressPercent = clamped
      }
    }

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString()
      stdoutBuf += text
      const matches = text.match(/(\d{1,3})%/g)
      if (matches) {
        const nums = matches.map(m => parseInt(m.replace('%', ''), 10)).filter(n => !isNaN(n))
        if (nums.length) emitProgress(Math.max(...nums))
      }
      console.log('[Extract] stdout', text.trim())
    })

    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString()
      stderrBuf += text
      const matches = text.match(/(\d{1,3})%/g)
      if (matches) {
        const nums = matches.map(m => parseInt(m.replace('%', ''), 10)).filter(n => !isNaN(n))
        if (nums.length) emitProgress(Math.max(...nums))
      }
      console.warn('[Extract] stderr', text.trim())
    })

    child.on('exit', (code) => {
      if (code === 0) {
        emitProgress(100)
        console.log('[Extract] finished', { archivePath, destDir })
        resolve()
      } else {
        const msg = `Extraction failed with code ${code}. stdout: ${stdoutBuf.trim()} stderr: ${stderrBuf.trim()}`
        console.error('[Extract] failure', msg)
        reject(new Error(msg))
      }
    })

    child.on('error', (err) => {
      console.error('[Extract] spawn error', err)
      reject(err)
    })
  })
}

// Fallback RAR extraction using node-unrar-js (slower, WASM-based)
// Only used if 7z fails for some reason
async function extractRarFallback(
  rarPath: string,
  destDir: string,
  password?: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  console.log('[ExtractRAR] Starting via worker (fallback)', { rarPath, destDir })

  // Resolve the worker script path (works in both dev and packaged builds)
  // Use __dirname which works in both contexts
  const workerPath = path.join(__dirname, 'rarExtractWorker.js')

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { rarPath, destDir, password }
    })

    worker.on('message', (msg: { type: string; percent?: number; error?: string }) => {
      if (msg.type === 'progress' && typeof msg.percent === 'number') {
        onProgress?.(msg.percent)
      } else if (msg.type === 'done') {
        resolve()
      } else if (msg.type === 'error') {
        reject(new Error(msg.error || 'RAR extraction failed'))
      }
    })

    worker.on('error', (err) => {
      console.error('[ExtractRAR] worker error', err)
      reject(err)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`RAR worker exited with code ${code}`))
      }
    })
  })
}
