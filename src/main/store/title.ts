/**
 * Store titles carry the site's own suffixes — "по сети" (over the network),
 * "Online", edition notes in brackets — which do not exist in a game's real
 * name and ruin a Steam lookup. Pure functions so they can be tested.
 */

/** Suffixes the site appends to say "this build plays online". */
const NETWORK_SUFFIXES = [
  /\s*по\s+сети\s*$/i,
  /\s*онлайн\s*$/i,
  /\s*\bonline\b\s*$/i,
  /\s*\bcoop\b\s*$/i,
  /\s*\bco-?op\b\s*$/i,
  /\s*\bmultiplayer\b\s*$/i
]

/** Bracketed notes at the end: "(2026)", "[v1.2]", "(Repack)". */
const TRAILING_BRACKETS = /\s*[([{][^)\]}]{0,40}[)\]}]\s*$/

export function cleanStoreTitle(raw: string | null | undefined): string {
  let title = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!title) return ''

  // Applied repeatedly: titles often end with more than one of these.
  for (let pass = 0; pass < 4; pass++) {
    const before = title

    for (const suffix of NETWORK_SUFFIXES) {
      title = title.replace(suffix, '').trim()
    }
    title = title.replace(TRAILING_BRACKETS, '').trim()
    title = title.replace(/[\s\-–—:,]+$/, '').trim()

    if (title === before) break
  }

  return title || String(raw || '').trim()
}
