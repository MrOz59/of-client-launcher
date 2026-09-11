/**
 * Which release asset belongs on this machine.
 *
 * Upstream projects name their files by hand, and the naming changes: legendary
 * shipped a single `legendary` binary until 0.20.34 and `legendary_linux_x64`
 * next to `legendary_linux_arm64` from 0.21.0 on. Matching that by scoring
 * substrings is where this went wrong — "64" is in `arm64` as much as in `x64`,
 * so an arm build tied with the x86 one and won on list order.
 *
 * So the architecture in a name is read, not scored: a name either declares one
 * or declares none, and a name declaring the wrong one is never a candidate.
 */

export type ArchFamily = 'x64' | 'arm64'

/**
 * ARM first: `aarch64` ends in "64" and would otherwise look like an x86 name
 * to a looser pattern. Nothing here matches a bare "64" — on its own it says
 * only that the build is 64-bit, which every build in this launcher is.
 */
const ARCH_PATTERNS: Array<{ family: ArchFamily; pattern: RegExp }> = [
  { family: 'arm64', pattern: /(?:^|[^a-z0-9])(arm64|aarch64|armv8)(?:[^a-z0-9]|$)/i },
  { family: 'x64', pattern: /(?:^|[^a-z0-9])(x86[-_]?64|amd64|x64|win64|linux64)(?:[^a-z0-9]|$)/i }
]

/** The architecture an asset name states, or null when it states none. */
export function declaredArch(name: string): ArchFamily | null {
  const value = String(name || '')
  for (const { family, pattern } of ARCH_PATTERNS) {
    if (pattern.test(value)) return family
  }
  return null
}

/** This machine's family. Anything not ARM is treated as x86: the launcher ships 64-bit only. */
export function hostArchFamily(arch: string = process.arch): ArchFamily {
  return arch === 'arm64' || arch === 'arm' ? 'arm64' : 'x64'
}

/**
 * True unless the name declares an architecture this machine cannot run. A name
 * with no architecture in it passes: for most of legendary's history that was
 * the only Linux build there was.
 */
export function assetRunsOnHost(name: string, arch: string = process.arch): boolean {
  const declared = declaredArch(name)
  return declared === null || declared === hostArchFamily(arch)
}

/** True only when the name names this machine's architecture outright. */
export function assetNamesHostArch(name: string, arch: string = process.arch): boolean {
  return declaredArch(name) === hostArchFamily(arch)
}
