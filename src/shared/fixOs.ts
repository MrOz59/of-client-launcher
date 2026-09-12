/**
 * Which systems a fix, or a piece of one, is for.
 *
 * Fixes started as a Linux thing — Proton settings, winetricks verbs, assemblies
 * pulled out of wine-mono — so the whole file was implicitly "what to do under
 * Proton". Then a fix needed to install a mod, and the mod is the same mod on
 * Windows: the same archive, the same folders, the same launch arguments. Only
 * the Proton half has no meaning there.
 *
 * So a fix says which systems it is for, and the launcher skips the parts that
 * do not apply instead of pretending they worked. What is skipped is not a
 * silent no-op: the person is told, because "the fix applied" and "the fix did
 * half of itself" have to look different.
 */

export type FixOs = 'linux' | 'windows'

export const FIX_OS_VALUES: FixOs[] = ['linux', 'windows']

/** Only the parts of a fix that are Proton's doing. Everything else is portable. */
export const PROTON_ONLY_OPTION_KEYS = [
  'esync',
  'fsync',
  'dxvk',
  'mesa_glthread',
  'gamemode',
  'mangohud',
  'useGamescope',
  'wineDllOverrides',
  'locale'
] as const

export function currentFixOs(platform: string = process.platform): FixOs | null {
  if (platform === 'linux') return 'linux'
  if (platform === 'win32') return 'windows'
  return null
}

/** An empty list means "every system": a fix says nothing until it has to. */
export function sanitizeFixOsList(raw: unknown): FixOs[] {
  if (!Array.isArray(raw)) return []
  const list: FixOs[] = []
  for (const entry of raw) {
    const value = typeof entry === 'string' ? entry.trim().toLowerCase() : ''
    if ((FIX_OS_VALUES as string[]).includes(value) && !list.includes(value as FixOs)) {
      list.push(value as FixOs)
    }
  }
  return list.length === FIX_OS_VALUES.length ? [] : list
}

export function fixAppliesToOs(list: FixOs[] | undefined, os: FixOs | null): boolean {
  if (!list || !list.length) return true
  if (!os) return false
  return list.includes(os)
}
