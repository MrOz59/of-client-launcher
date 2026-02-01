/**
 * Text and string utility functions
 */
import fs from 'fs'

/**
 * Slugify a string for use as a filename or identifier
 */
export function slugify(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'unnamed'
}

/**
 * Trim text to a maximum number of characters, keeping the end
 */
export function trimToMaxChars(text: string, maxChars: number): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

/**
 * Read the last N bytes of a file (tail)
 */
export function readFileTailBytes(filePath: string, maxBytes: number): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    const size = stat.size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, start)
      return buf.toString('utf8')
    } finally {
      try { fs.closeSync(fd) } catch {}
    }
  } catch {
    return null
  }
}

/**
 * Extract interesting lines from a Proton/Wine log, filtering out noise
 */
export function extractInterestingProtonLog(logText: string, maxLines: number): string | null {
  if (!logText) return null
  const lines = logText.split(/\r?\n/)

  const isNoise = (line: string) =>
    /trace:unwind|dump_unwind_info|RtlVirtualUnwind2|trace:seh:Rtl|unwind:Rtl/i.test(line)

  const interesting = (line: string) =>
    /(^|\s)(err:|warn:|fixme:)|fatal error|Unhandled Exception|EXCEPTION_|Assertion failed|wine: (err|unhandled)|err:module:|import_dll|d3d|dxgi|vulkan|vk_/i.test(line)

  const picked: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (isNoise(line)) continue
    if (interesting(line)) picked.push(line)
  }

  const src = picked.length ? picked : lines.filter(l => l && !isNoise(l))
  if (!src.length) return null

  const tail = src.slice(Math.max(0, src.length - maxLines))
  return tail.join('\n')
}
