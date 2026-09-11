#!/usr/bin/env node
/**
 * Which release asset belongs on this machine, checked against the names the
 * upstream projects actually publish.
 *
 * The names are fixtures on purpose: this ran green against a GitHub API that
 * was reachable, and the bug it covers only appeared when legendary changed its
 * naming — from a single `legendary` binary to a per-architecture set — and an
 * arm build started reading as an x86 one.
 */
const {
  declaredArch,
  hostArchFamily,
  assetRunsOnHost,
  assetNamesHostArch
} = require('../dist/main/utils/releaseAssets.js')

let failures = 0
function check(condition, label, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  if (!condition) {
    failures++
    if (detail !== undefined) console.log('        got:', JSON.stringify(detail))
  }
}

// legendary 0.21.0 onwards: one asset per platform and architecture.
const LEGENDARY_0_21 = [
  'legendary_linux_arm64',
  'legendary_linux_x64',
  'legendary_macOS.zip',
  'legendary_macOS_arm64',
  'legendary_macOS_x64',
  'legendary_windows_arm64.exe',
  'legendary_windows_x64.exe'
]

// legendary 0.20.34 and before: no architecture in any name.
const LEGENDARY_0_20 = ['legendary', 'legendary.exe', 'legendary_macOS.zip']

const LUDUSAVI = [
  'ludusavi-v0.31.0-legal.zip',
  'ludusavi-v0.31.0-linux.tar.gz',
  'ludusavi-v0.31.0-mac.tar.gz',
  'ludusavi-v0.31.0-win32.zip',
  'ludusavi-v0.31.0-win64.zip'
]

console.log('the architecture a name states')
check(declaredArch('legendary_linux_arm64') === 'arm64', 'arm64 is arm', declaredArch('legendary_linux_arm64'))
check(declaredArch('legendary_linux_x64') === 'x64', 'x64 is x86', declaredArch('legendary_linux_x64'))
check(declaredArch('tool-aarch64.tar.gz') === 'arm64', 'aarch64 is arm, not x86 for ending in 64', declaredArch('tool-aarch64.tar.gz'))
check(declaredArch('tool-x86_64.tar.gz') === 'x64', 'x86_64 is x86', declaredArch('tool-x86_64.tar.gz'))
check(declaredArch('proton-cachyos-x86_64_v3.tar.xz') === 'x64', 'a microarchitecture suffix still reads as x86', declaredArch('proton-cachyos-x86_64_v3.tar.xz'))
check(declaredArch('ludusavi-v0.31.0-win64.zip') === 'x64', 'win64 is x86', declaredArch('ludusavi-v0.31.0-win64.zip'))
check(declaredArch('legendary') === null, 'a name with no architecture states none', declaredArch('legendary'))
check(declaredArch('ludusavi-v0.31.0-linux.tar.gz') === null, 'a plain linux archive states none', declaredArch('ludusavi-v0.31.0-linux.tar.gz'))

// This is the bug: "64" is in arm64 as much as in x64, so a pattern carrying a
// bare 64 made every arm asset look like an x86 one.
console.log('\nan arm build is never an x86 build')
check(assetRunsOnHost('legendary_linux_arm64', 'x64') === false, 'arm64 does not run on x86', assetRunsOnHost('legendary_linux_arm64', 'x64'))
check(assetRunsOnHost('legendary_linux_x64', 'arm64') === false, 'x86 does not run on arm', assetRunsOnHost('legendary_linux_x64', 'arm64'))
check(assetNamesHostArch('legendary_linux_arm64', 'x64') === false, 'and it is not preferred either')

console.log('\nwhat is left to choose from on each machine')
const runnable = (names, arch) => names.filter((name) => assetRunsOnHost(name, arch))

check(
  JSON.stringify(runnable(LEGENDARY_0_21, 'x64')) === JSON.stringify(['legendary_linux_x64', 'legendary_macOS.zip', 'legendary_macOS_x64', 'legendary_windows_x64.exe']),
  'on x86 only the x86 assets survive, plus the one that names no architecture',
  runnable(LEGENDARY_0_21, 'x64')
)
check(
  JSON.stringify(runnable(LEGENDARY_0_21, 'arm64')) === JSON.stringify(['legendary_linux_arm64', 'legendary_macOS.zip', 'legendary_macOS_arm64', 'legendary_windows_arm64.exe']),
  'on arm the mirror of it',
  runnable(LEGENDARY_0_21, 'arm64')
)
check(
  runnable(LEGENDARY_0_21, 'x64').filter((name) => name.includes('linux')).length === 1,
  'exactly one linux candidate, so the sort cannot pick by list order',
  runnable(LEGENDARY_0_21, 'x64').filter((name) => name.includes('linux'))
)

// The releases from before the rename have to keep working: those names carry
// no architecture at all, and rejecting them would leave nothing to install.
check(
  JSON.stringify(runnable(LEGENDARY_0_20, 'x64')) === JSON.stringify(LEGENDARY_0_20),
  'the older single-binary releases still qualify',
  runnable(LEGENDARY_0_20, 'x64')
)
check(
  JSON.stringify(runnable(LEGENDARY_0_20, 'arm64')) === JSON.stringify(LEGENDARY_0_20),
  'on arm too — a name that states nothing is not a claim to the contrary',
  runnable(LEGENDARY_0_20, 'arm64')
)

check(
  JSON.stringify(runnable(LUDUSAVI, 'x64')) === JSON.stringify(LUDUSAVI),
  'ludusavi names no architecture on linux, and win64 is x86',
  runnable(LUDUSAVI, 'x64')
)
check(
  runnable(LUDUSAVI, 'arm64').includes('ludusavi-v0.31.0-win64.zip') === false,
  'the windows x86 archive is out on an arm machine',
  runnable(LUDUSAVI, 'arm64')
)

console.log('\nthe host')
check(hostArchFamily('x64') === 'x64' && hostArchFamily('arm64') === 'arm64', 'the two families map to themselves')
check(hostArchFamily('ia32') === 'x64', 'anything not arm is treated as x86', hostArchFamily('ia32'))

console.log(failures === 0 ? '\nall release asset checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
