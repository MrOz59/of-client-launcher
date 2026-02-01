/**
 * File system utility functions
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

/**
 * Check if a directory is writable and executable
 */
export function isDirWritableAndExecutable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK | fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Configure a custom temp directory for Linux to avoid noexec issues
 */
export function configureLinuxTempDir(): void {
  if (process.platform !== 'linux') return
  const home = os.homedir()
  if (!home) return

  const tmpDir = path.join(home, '.local', 'share', 'of-launcher', 'tmp')
  try {
    fs.mkdirSync(tmpDir, { recursive: true })
  } catch (err) {
    console.warn('[TempDir] Failed to create tmp dir:', tmpDir, err)
    return
  }

  process.env.TMPDIR = tmpDir
  process.env.TMP = tmpDir
  process.env.TEMP = tmpDir

  try {
    app.setPath('temp', tmpDir)
  } catch (err) {
    console.warn('[TempDir] Failed to set Electron temp path:', err)
  }
}

/**
 * Find an archive file (.zip, .rar, .7z) starting from a path
 */
export function findArchive(startPath: string): { archivePath?: string; destDir: string } {
  const allowed = ['.zip', '.rar', '.7z']
  const resolveMaybe = (p: string) => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  const target = resolveMaybe(startPath)

  const isAllowedFile = (p: string) => {
    const ext = path.extname(p).toLowerCase()
    return allowed.includes(ext)
  }

  const statSafe = (p: string) => {
    try { return fs.statSync(p) } catch { return null }
  }

  const searchDir = (dir: string, depth = 0): string | undefined => {
    if (depth > 2) return undefined
    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir).map(f => path.join(dir, f))
    } catch {
      return undefined
    }
    for (const entry of entries) {
      const st = statSafe(entry)
      if (!st) continue
      if (st.isFile() && isAllowedFile(entry)) return entry
    }
    for (const entry of entries) {
      const st = statSafe(entry)
      if (st?.isDirectory()) {
        const found = searchDir(entry, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }

  const stat = statSafe(target)
  if (stat?.isFile() && isAllowedFile(target)) {
    return { archivePath: target, destDir: path.dirname(target) }
  }
  if (stat?.isDirectory()) {
    const found = searchDir(target)
    return { archivePath: found, destDir: target }
  }

  const parent = path.dirname(target)
  const parentStat = statSafe(parent)
  if (parentStat?.isDirectory()) {
    const found = searchDir(parent)
    return { archivePath: found, destDir: parent }
  }

  return { archivePath: undefined, destDir: path.dirname(target) }
}

/**
 * Find executable in directory with scoring to select the best one
 */
export function findExecutableInDir(dir: string): string | null {
  try {
    const exeFiles: Array<{ name: string; path: string; depth: number; size: number }> = []

    function scanDir(currentDir: string, depth: number = 0) {
      if (depth > 4) return
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name)
          if (entry.isDirectory()) {
            const skipDirs = ['__macosx', 'redist', 'directx', '_commonredist', 'vcredist', 'support', 'dotnet']
            if (!skipDirs.includes(entry.name.toLowerCase())) {
              scanDir(fullPath, depth + 1)
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
            try {
              const stat = fs.statSync(fullPath)
              exeFiles.push({ name: entry.name, path: fullPath, depth, size: stat.size })
            } catch {
              exeFiles.push({ name: entry.name, path: fullPath, depth, size: 0 })
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    }

    scanDir(dir)

    if (exeFiles.length === 0) return null

    const scoreExe = (exe: { name: string; path: string; depth: number; size: number }): number => {
      const nameLower = exe.name.toLowerCase()
      const pathLower = exe.path.toLowerCase()
      let score = 0

      // Negative scores for non-game executables
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
      if (nameLower.includes('ueprereq')) score -= 100

      // Positive scores for game-like names
      if (nameLower.includes('game')) score += 30
      if (nameLower.includes('launcher')) score += 20
      if (nameLower.includes('play')) score += 20
      if (nameLower.includes('start')) score += 15

      // Unreal Engine: prefer -Win64-Shipping.exe in Binaries/Win64
      if (nameLower.includes('-win64-shipping')) score += 100
      if (pathLower.includes('binaries/win64') || pathLower.includes('binaries\\win64')) score += 80

      // Unity: prefer .exe in *_Data parent folder pattern
      if (pathLower.includes('_data')) score += 30

      // Size scoring: larger executables are more likely to be the real game
      const sizeMB = exe.size / (1024 * 1024)
      if (sizeMB < 0.5) score -= 50
      else if (sizeMB < 1) score -= 20
      else if (sizeMB > 50) score += 60
      else if (sizeMB > 20) score += 40
      else if (sizeMB > 10) score += 20

      // Depth scoring
      score += (4 - exe.depth) * 5

      if (exe.name.length > 10) score += 5

      return score
    }

    exeFiles.sort((a, b) => scoreExe(b) - scoreExe(a))
    return exeFiles[0]?.path || null
  } catch (err) {
    console.warn('[findExecutableInDir] Failed to scan', dir, err)
  }
  return null
}

/**
 * Get directory size in bytes (with limits to avoid hanging)
 */
export async function getDirectorySizeBytes(
  rootDir: string,
  opts?: { maxEntries?: number; maxMs?: number }
): Promise<number> {
  const maxEntries = opts?.maxEntries ?? 100_000
  const maxMs = opts?.maxMs ?? 10_000

  let total = 0
  let entries = 0
  const start = Date.now()

  const walk = async (dir: string): Promise<void> => {
    if (entries >= maxEntries || Date.now() - start > maxMs) return
    let items: fs.Dirent[]
    try {
      items = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (entries >= maxEntries || Date.now() - start > maxMs) return
      entries++
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        await walk(fullPath)
      } else if (item.isFile()) {
        try {
          const st = await fs.promises.stat(fullPath)
          total += st.size
        } catch {
          // ignore
        }
      }
    }
  }

  await walk(rootDir)
  return total
}
