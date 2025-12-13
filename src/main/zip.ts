import { spawn } from 'child_process'
import { path7za } from '7zip-bin'
import fs from 'fs'
import { createExtractorFromFile as createRarExtractor } from 'node-unrar-js'
import path from 'path'
import crypto from 'crypto'

export function extractZipWithPassword(
  zipPath: string,
  destDir: string,
  password?: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const ext = zipPath.toLowerCase()
  if (ext.endsWith('.rar')) {
    return extractRar(zipPath, destDir, password, onProgress)
  }

  return new Promise((resolve, reject) => {
    const binary = path7za
    if (!binary) {
      return reject(new Error('7z/7za binary not found in bundled 7zip-bin'))
    }

    try {
      fs.mkdirSync(destDir, { recursive: true })
    } catch {}

    console.log('[Extract] Starting extraction (spawn)', { zipPath, destDir, binary })

    // Quote output dir because 7z expects no spaces unless quoted
    const outputArg = `-o"${destDir}"`

    const args = [
      'x',
      zipPath,
      `-p${password || 'online-fix.me'}`,
      outputArg,
      // Always overwrite existing files (avoid partial installs when re-extracting).
      '-aoa',
      '-y'
    ]

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdoutBuf = ''
    let stderrBuf = ''

    let lastPercent = 0
    const emitProgress = (p: number) => {
      const clamped = Math.max(0, Math.min(100, p))
      if (clamped !== lastPercent) {
        lastPercent = clamped
        onProgress?.(clamped)
        console.log('[Extract] progress', clamped)
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
        console.log('[Extract] finished', { zipPath, destDir })
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

function moveDirContentsOverwrite(srcDir: string, destDir: string) {
  if (!fs.existsSync(srcDir)) return
  fs.mkdirSync(destDir, { recursive: true })
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    try {
      if (entry.isDirectory()) {
        moveDirContentsOverwrite(srcPath, destPath)
        try { fs.rmSync(srcPath, { recursive: true, force: true }) } catch {}
      } else {
        try {
          if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true })
        } catch {}
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        try {
          fs.renameSync(srcPath, destPath)
        } catch {
          fs.cpSync(srcPath, destPath, { force: true })
          try { fs.rmSync(srcPath, { force: true }) } catch {}
        }
      }
    } catch (err) {
      console.warn('[Extract] Failed to move extracted entry', srcPath, '->', destPath, err)
    }
  }
}

async function extractRar(
  rarPath: string,
  destDir: string,
  password?: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  console.log('[ExtractRAR] Starting', { rarPath, destDir })
  try {
    fs.mkdirSync(destDir, { recursive: true })
  } catch {}

  // Extract to a temp dir first, then merge into destDir with overwrite.
  // This avoids "partial installs" when extracting over an existing folder.
  const tmpDir = path.join(destDir, `.of_extract_tmp_${crypto.randomBytes(4).toString('hex')}`)
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch {}

  const extractor = await createRarExtractor({
    filepath: rarPath,
    targetPath: tmpDir,
    password: password || 'online-fix.me'
  })

  const headersGen = extractor.getFileList().fileHeaders || []
  const entries = Array.from(headersGen as Iterable<any>)
  let processed = 0
  const total = entries.length || 1

  // Send an initial progress event so the UI shows extraction has begun
  onProgress?.(0)

  const iterator = extractor.extract().files || []
  for (const entry of iterator) {
    processed++
    const percent = Math.min(100, Math.max(0, (processed / total) * 100))
    // Keep merge time for the end.
    onProgress?.(Math.min(95, percent))
    console.log('[ExtractRAR] extracted', entry.fileHeader?.name, percent.toFixed(1) + '%')

    // Yield back to the event loop so the app UI stays responsive during long extractions
    // (node-unrar-js extraction is synchronous)
    await new Promise(resolve => setImmediate(resolve))
  }
  try {
    moveDirContentsOverwrite(tmpDir, destDir)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
  onProgress?.(100)
  console.log('[ExtractRAR] finished', { rarPath, destDir })
}
