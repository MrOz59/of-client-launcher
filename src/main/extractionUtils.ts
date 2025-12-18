/**
 * Extraction utilities that can run in worker threads (no Electron imports).
 * IMPORTANT: Do not add any imports that depend on 'electron' module.
 */
import { extractZipWithPassword } from './zip'
import path from 'path'
import fs from 'fs'

function mergeMoveEntry(srcPath: string, destPath: string) {
  try {
    const srcStat = fs.existsSync(srcPath) ? fs.statSync(srcPath) : null
    if (!srcStat) return

    if (srcStat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      const entries = fs.readdirSync(srcPath, { withFileTypes: true })
      for (const entry of entries) {
        const s = path.join(srcPath, entry.name)
        const d = path.join(destPath, entry.name)
        mergeMoveEntry(s, d)
      }
      try { fs.rmSync(srcPath, { recursive: true, force: true }) } catch {}
      return
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    try {
      if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
        fs.rmSync(destPath, { recursive: true, force: true })
      } else if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { force: true })
      }
    } catch {
      // ignore
    }

    try {
      fs.renameSync(srcPath, destPath)
    } catch {
      try {
        fs.cpSync(srcPath, destPath, { force: true })
        try { fs.rmSync(srcPath, { force: true }) } catch {}
      } catch (err) {
        console.warn('[mergeMoveEntry] Failed to move', srcPath, '->', destPath, err)
      }
    }
  } catch (err) {
    console.warn('[mergeMoveEntry] Error', srcPath, '->', destPath, err)
  }
}

function flattenSingleSubdir(basePath: string) {
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
      .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')

    if (entries.length !== 1 || !entries[0].isDirectory()) return

    const subDir = path.join(basePath, entries[0].name)
    const subEntries = fs.readdirSync(subDir, { withFileTypes: true })

    subEntries.forEach(entry => {
      const src = path.join(subDir, entry.name)
      const dest = path.join(basePath, entry.name)
      mergeMoveEntry(src, dest)
    })

    try {
      fs.rmdirSync(subDir)
    } catch (err) {
      console.warn('[flattenSingleSubdir] Failed to remove subdir', subDir, err)
    }

    console.log('[flattenSingleSubdir] Flattened nested folder:', subDir)
  } catch (err) {
    console.warn('[flattenSingleSubdir] Error while flattening', basePath, err)
  }
}

function countFilesRecursive(dir: string, max = 5000): number {
  let count = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop() as string
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          stack.push(path.join(current, entry.name))
        } else {
          count++
          if (count >= max) return count
        }
      }
    } catch {
      // ignore
    }
  }
  return count
}

function flattenDominantSubdir(basePath: string) {
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
      .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')
    const subdirs = entries.filter(e => e.isDirectory())
    if (!subdirs.length) return

    const filesAtRoot = entries.filter(e => e.isFile()).length
    let bestDir: string | null = null
    let bestCount = 0

    for (const dir of subdirs) {
      const full = path.join(basePath, dir.name)
      const count = countFilesRecursive(full, 10000)
      if (count > bestCount) {
        bestCount = count
        bestDir = full
      }
    }

    if (!bestDir) return

    if (bestCount < Math.max(5, filesAtRoot * 2)) return

    console.log('[flattenDominantSubdir] Flattening dominant folder:', bestDir, 'files:', bestCount, 'rootFiles:', filesAtRoot)

    const subEntries = fs.readdirSync(bestDir, { withFileTypes: true })
    subEntries.forEach(entry => {
      const src = path.join(bestDir, entry.name)
      const dest = path.join(basePath, entry.name)
      mergeMoveEntry(src, dest)
    })

    removeFolderIfExists(bestDir)
  } catch (err) {
    console.warn('[flattenDominantSubdir] Error while flattening', basePath, err)
  }
}

function removeFolderIfExists(target: string) {
  if (!target || target === '/' || target === '.' || target === '..') return
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
    }
  } catch (err) {
    console.warn('[removeFolderIfExists] Failed to remove', target, err)
  }
}

export function findFilesRecursive(dir: string, pattern: RegExp): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, pattern))
      } else if (pattern.test(entry.name)) {
        results.push(fullPath)
      }
    }
  } catch (err) {
    console.warn('[findFilesRecursive] Error reading directory:', dir, err)
  }
  return results
}

function findOnlineFixIni(gameDir: string): string | null {
  const files = findFilesRecursive(gameDir, /^OnlineFix\.ini$/i)
  return files.length > 0 ? files[0] : null
}

function findExecutable(gameDir: string): string | null {
  console.log('[findExecutable] Searching in:', gameDir)
  try {
    const exeFiles: Array<{ name: string; path: string; depth: number }> = []

    function scanDir(dir: string, depth: number = 0) {
      if (depth > 4) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const skipDirs = ['__macosx', 'redist', 'directx', '_commonredist', 'vcredist', 'support', 'dotnet']
            if (!skipDirs.includes(entry.name.toLowerCase())) {
              scanDir(fullPath, depth + 1)
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
            exeFiles.push({ name: entry.name, path: fullPath, depth })
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    }

    scanDir(gameDir)

    if (exeFiles.length === 0) {
      console.log('[findExecutable] No exe files found')
      return null
    }

    console.log('[findExecutable] Found', exeFiles.length, 'exe files')

    const scoreExe = (exe: { name: string; path: string; depth: number }): number => {
      const nameLower = exe.name.toLowerCase()
      let score = 0

      if (nameLower.includes('uninstall')) score -= 100
      if (nameLower.includes('uninst')) score -= 100
      if (nameLower.includes('setup')) score -= 50
      if (nameLower.includes('install')) score -= 50
      if (nameLower.includes('redist')) score -= 50
      if (nameLower.includes('vcredist')) score -= 100
      if (nameLower.includes('dxsetup')) score -= 100
      if (nameLower.includes('directx')) score -= 100
      if (nameLower.includes('dotnet')) score -= 100
      if (nameLower.includes('crash')) score -= 30
      if (nameLower.includes('report')) score -= 30
      if (nameLower.includes('helper')) score -= 20
      if (nameLower.includes('update')) score -= 20
      if (nameLower.includes('patch')) score -= 20

      if (nameLower.includes('game')) score += 30
      if (nameLower.includes('launcher')) score += 20
      if (nameLower.includes('play')) score += 20
      if (nameLower.includes('start')) score += 15

      score += (4 - exe.depth) * 10
      if (exe.name.length > 10) score += 5

      return score
    }

    exeFiles.sort((a, b) => scoreExe(b) - scoreExe(a))

    console.log('[findExecutable] Top candidates:')
    exeFiles.slice(0, 5).forEach((exe, i) => {
      console.log(`  ${i + 1}. ${exe.name} (score: ${scoreExe(exe)}, depth: ${exe.depth})`)
    })

    const best = exeFiles[0]
    console.log('[findExecutable] Selected:', best.path)
    return best.path
  } catch (error) {
    console.error('[findExecutable] Error:', error)
    return null
  }
}

/**
 * Process torrent update - extract RAR, cleanup, restore configs.
 * This handles the case where a torrent downloads an update with a .rar file
 * that needs to be extracted over the existing game installation.
 *
 * NOTE: This function is designed to run in a Worker thread and has no Electron imports.
 * The previousExePath should be passed from the caller (main process) since we can't
 * access the database from a worker thread.
 */
export async function processUpdateExtraction(
  installPath: string,
  _gameUrl: string,
  onProgress?: (percent: number, details?: { etaSeconds?: number }) => void,
  previousExePath?: string | null
): Promise<{ success: boolean; error?: string; executablePath?: string }> {
  console.log('[UpdateProcessor] Starting update processing for:', installPath)

  // Find RAR files but exclude those in "Fix Repair" folders (these are optional repair tools, not game content)
  const allRarFiles = findFilesRecursive(installPath, /\.rar$/i)
  const rarFiles = allRarFiles.filter(f => {
    const lowerPath = f.toLowerCase()
    // Skip RARs inside "Fix Repair" folders
    if (lowerPath.includes('fix repair') || lowerPath.includes('fix_repair') || lowerPath.includes('fixrepair')) {
      console.log('[UpdateProcessor] Skipping Fix Repair RAR:', f)
      return false
    }
    return true
  })

  if (rarFiles.length === 0) {
    console.log('[UpdateProcessor] No RAR files found (excluding Fix Repair), skipping update processing')
    return { success: true }
  }

  console.log('[UpdateProcessor] Found RAR files to extract:', rarFiles)
  console.log('[UpdateProcessor] Previous executable path:', previousExePath)

  const onlineFixPath = findOnlineFixIni(installPath)
  let onlineFixBackup: string | null = null

  if (onlineFixPath) {
    console.log('[UpdateProcessor] Found OnlineFix.ini at:', onlineFixPath)
    try {
      onlineFixBackup = fs.readFileSync(onlineFixPath, 'utf-8')
      console.log('[UpdateProcessor] Backed up OnlineFix.ini')
    } catch (err) {
      console.warn('[UpdateProcessor] Failed to backup OnlineFix.ini:', err)
    }
  }

  const partRe = /^(.*)\.part(\d+)\.rar$/i
  const groups = new Map<string, { all: string[]; first: string }>()

  for (const rarFile of rarFiles) {
    const baseName = path.basename(rarFile)
    const m = baseName.match(partRe)
    const key = m ? path.join(path.dirname(rarFile), m[1]) : rarFile
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { all: [rarFile], first: rarFile })
    } else {
      existing.all.push(rarFile)
    }
  }

  for (const [key, group] of groups.entries()) {
    const candidates = group.all.slice().sort((a, b) => a.localeCompare(b))
    const part01 = candidates.find(f => /\.part0*1\.rar$/i.test(path.basename(f)))
    group.first = part01 || candidates[0]
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const rarFile = group.first
    console.log('[UpdateProcessor] Extracting:', rarFile, 'to:', installPath)
    try {
      await extractZipWithPassword(rarFile, installPath, undefined, (percent, details) => {
        onProgress?.(percent, { etaSeconds: details?.etaSeconds })
      })
      console.log('[UpdateProcessor] Extraction completed for:', rarFile)

      flattenSingleSubdir(installPath)
      flattenDominantSubdir(installPath)
      flattenSingleSubdir(installPath)

      for (const partPath of group.all) {
        try {
          if (fs.existsSync(partPath)) {
            fs.unlinkSync(partPath)
            console.log('[UpdateProcessor] Removed RAR file:', partPath)
          }
        } catch (err) {
          if ((err as any)?.code !== 'ENOENT') {
            console.warn('[UpdateProcessor] Failed to remove RAR file:', partPath, err)
          }
        }
      }

      const rarDir = path.dirname(rarFile)
      const fixRepairPath = path.join(rarDir, 'Fix Repair')
      if (fs.existsSync(fixRepairPath)) {
        try {
          fs.rmSync(fixRepairPath, { recursive: true, force: true })
          console.log('[UpdateProcessor] Removed Fix Repair folder:', fixRepairPath)
        } catch (err) {
          console.warn('[UpdateProcessor] Failed to remove Fix Repair folder:', err)
        }
      }

      const rootFixRepairPath = path.join(installPath, 'Fix Repair')
      if (fs.existsSync(rootFixRepairPath)) {
        try {
          fs.rmSync(rootFixRepairPath, { recursive: true, force: true })
          console.log('[UpdateProcessor] Removed root Fix Repair folder:', rootFixRepairPath)
        } catch (err) {
          console.warn('[UpdateProcessor] Failed to remove root Fix Repair folder:', err)
        }
      }

      if (rarDir !== installPath) {
        try {
          const remainingFiles = fs.readdirSync(rarDir)
          if (remainingFiles.length === 0) {
            fs.rmdirSync(rarDir)
            console.log('[UpdateProcessor] Removed empty folder:', rarDir)
          } else {
            const onlyJunk = remainingFiles.every(f => f.toLowerCase().includes('fix repair') || /\.(rar|zip|7z)$/i.test(f))
            if (onlyJunk) {
              fs.rmSync(rarDir, { recursive: true, force: true })
              console.log('[UpdateProcessor] Force removed junk folder:', rarDir)
            }
          }
        } catch (err) {
          // Folder not empty or other error, ignore
        }
      }
    } catch (err: any) {
      console.error('[UpdateProcessor] Failed to extract:', rarFile, err)
      return { success: false, error: `Failed to extract ${path.basename(rarFile)}: ${err.message}` }
    }
  }

  if (onlineFixBackup) {
    const newOnlineFixPath = findOnlineFixIni(installPath)
    if (newOnlineFixPath) {
      try {
        fs.writeFileSync(newOnlineFixPath, onlineFixBackup, 'utf-8')
        console.log('[UpdateProcessor] Restored OnlineFix.ini to:', newOnlineFixPath)
      } catch (err) {
        console.warn('[UpdateProcessor] Failed to restore OnlineFix.ini:', err)
      }
    } else if (onlineFixPath) {
      try {
        fs.writeFileSync(onlineFixPath, onlineFixBackup, 'utf-8')
        console.log('[UpdateProcessor] Restored OnlineFix.ini to original location:', onlineFixPath)
      } catch (err) {
        console.warn('[UpdateProcessor] Failed to restore OnlineFix.ini:', err)
      }
    }
  }

  let executablePath: string | null = null

  if (previousExePath && fs.existsSync(previousExePath)) {
    executablePath = previousExePath
    console.log('[UpdateProcessor] Using previous executable path:', executablePath)
  } else {
    executablePath = findExecutable(installPath)
    console.log('[UpdateProcessor] Found new executable path:', executablePath)
  }

  return { success: true, executablePath: executablePath || undefined }
}
