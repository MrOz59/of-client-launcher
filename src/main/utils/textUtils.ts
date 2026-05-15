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
 * Trim text to a maximum number of characters, preserving both the beginning
 * and the end. Useful for live logs where startup context is as important as
 * the most recent failure.
 */
export function trimToHeadAndTailChars(text: string, maxChars: number, headRatio = 0.38): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  const marker = '\n\n...[conteudo intermediario omitido para manter o inicio e o fim do log]...\n\n'
  const available = Math.max(0, maxChars - marker.length)
  const headChars = Math.max(1024, Math.floor(available * headRatio))
  const tailChars = Math.max(1024, available - headChars)
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`
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
 * Read the first and last chunks of a file without loading very large logs
 * completely into memory.
 */
export function readFileHeadTailBytes(filePath: string, headBytes: number, tailBytes: number): { head: string; tail: string; size: number; truncated: boolean } | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    const size = stat.size
    const fd = fs.openSync(filePath, 'r')
    try {
      const readChunk = (start: number, length: number) => {
        if (length <= 0) return ''
        const buf = Buffer.alloc(length)
        fs.readSync(fd, buf, 0, length, start)
        return buf.toString('utf8')
      }

      if (size <= headBytes + tailBytes) {
        const all = readChunk(0, size)
        return { head: all, tail: '', size, truncated: false }
      }

      const head = readChunk(0, Math.min(headBytes, size))
      const tailStart = Math.max(0, size - tailBytes)
      const tail = readChunk(tailStart, size - tailStart)
      return { head, tail, size, truncated: true }
    } finally {
      try { fs.closeSync(fd) } catch {}
    }
  } catch {
    return null
  }
}

function isNoisyProtonLine(line: string): boolean {
  return /trace:unwind|dump_unwind_info|RtlVirtualUnwind2|trace:seh:Rtl|unwind:Rtl|call_vectored_handlers|call_seh_handlers|dispatch_exception code=4001000[6a]|RtlRestoreContext/i.test(line)
}

function isInterestingProtonLine(line: string): boolean {
  return /(^|\s)(err:|warn:|fixme:)|fatal error|Unhandled Exception|EXCEPTION_|Assertion failed|wine: (err|unhandled)|err:module:|import_dll|ProtonFixes|SteamGameId|Command:|Options:|WINEDLLOVERRIDES|WINEDEBUG|Loaded L\".*(steam_api|OnlineFix|SteamOverlay|winhttp|lsteamclient|EOS|dxgi|d3d|vulkan|winevulkan)|d3d|dxgi|vulkan|vk_/i.test(line)
}

function uniquePush(lines: string[], seen: Set<string>, line: string) {
  const clean = String(line || '').trimEnd()
  if (!clean) return
  const key = clean.slice(0, 500)
  if (seen.has(key)) return
  seen.add(key)
  lines.push(clean)
}

function cleanProtonLines(text: string, maxLines: number, mode: 'context' | 'interesting'): string {
  const source = String(text || '').split(/\r?\n/)
  const out: string[] = []
  const seen = new Set<string>()

  for (const line of source) {
    if (!line.trim()) continue
    if (isNoisyProtonLine(line)) continue
    if (mode === 'interesting' && !isInterestingProtonLine(line)) continue
    uniquePush(out, seen, line)
  }

  const selected = mode === 'context' ? out.slice(0, maxLines) : out.slice(Math.max(0, out.length - maxLines))
  return selected.join('\n')
}

export function compactProtonLogParts(parts: { head?: string; tail?: string; truncated?: boolean }, maxChars: number): string {
  const sections: string[] = []
  const head = String(parts.head || '')
  const tail = String(parts.tail || '')

  const startup = cleanProtonLines(head, 180, 'context')
  if (startup) sections.push(`=== Proton log: inicio preservado ===\n${startup}`)

  const recentImportant = cleanProtonLines(tail || head, 260, 'interesting')
  if (recentImportant) sections.push(`=== Proton log: eventos importantes recentes ===\n${recentImportant}`)

  const recentContext = cleanProtonLines(tail || head, 180, 'context')
  if (parts.truncated && recentContext) sections.push(`=== Proton log: tail filtrado ===\n${recentContext}`)

  const text = sections.join('\n\n')
  return trimToHeadAndTailChars(text, maxChars)
}

/**
 * Extract interesting lines from a Proton/Wine log, filtering out noise
 */
export function extractInterestingProtonLog(logText: string, maxLines: number): string | null {
  if (!logText) return null
  const lines = logText.split(/\r?\n/)

  const picked: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (isNoisyProtonLine(line)) continue
    if (isInterestingProtonLine(line)) picked.push(line)
  }

  const src = picked.length ? picked : lines.filter(l => l && !isNoisyProtonLine(l))
  if (!src.length) return null

  const tail = src.slice(Math.max(0, src.length - maxLines))
  return tail.join('\n')
}
