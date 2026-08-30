import fs from 'fs'
import path from 'path'

/**
 * Free space on the filesystem holding `target`.
 *
 * The directory often does not exist yet (a download folder created on demand),
 * so walk up until something real is found. Returns null when the platform or
 * the Node build cannot answer — callers treat that as "cannot tell", never as
 * "no space".
 */
export function freeSpaceBytes(target: string): number | null {
  let current = path.resolve(String(target || '.'))

  for (let depth = 0; depth < 32; depth++) {
    try {
      if (fs.existsSync(current)) {
        const stats = typeof fs.statfsSync === 'function' ? fs.statfsSync(current) : null
        if (!stats) return null
        return Number(stats.bavail) * Number(stats.bsize)
      }
    } catch {
      return null
    }

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }

  return null
}

export function toGigabytes(bytes: number): number {
  return bytes / (1024 * 1024 * 1024)
}

/**
 * A game download plus its extraction needs roughly twice the archive size, and
 * the size is unknown until the torrent metadata arrives — so this is a warning
 * threshold, not a precise requirement.
 */
export const LOW_DISK_SPACE_GB = 15

export function isLowOnSpace(target: string): { low: boolean; freeGb: number | null } {
  const bytes = freeSpaceBytes(target)
  if (bytes === null) return { low: false, freeGb: null }

  const freeGb = toGigabytes(bytes)
  return { low: freeGb < LOW_DISK_SPACE_GB, freeGb }
}
