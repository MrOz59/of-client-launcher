#!/usr/bin/env node
/**
 * Checks for the executable picked out of a game folder, run against a
 * throwaway tree. The hint comes from a remote page, so the checks cover both
 * what it may name and what it must never be able to reach.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findExecutableInDir, bareExecutableName } = require('../dist/main/utils/fileUtils.js')

let failures = 0
function check(condition, label, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
  if (!condition) {
    failures++
    if (detail !== undefined) console.log('        got:', JSON.stringify(detail))
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'of-exe-'))
const write = (relative, megabytes) => {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(Math.round(megabytes * 1024 * 1024)))
  return full
}

// The shape these repacks arrive in: a large original binary next to the small
// patched one the page tells you to run.
const big = write('BigGame.exe', 80)
const fix = write('LyraGame.exe', 3)
write('unins000.exe', 2)

console.log('folder scan')
check(findExecutableInDir(root) === big, 'without a hint the scan still prefers the largest binary', findExecutableInDir(root))
check(
  findExecutableInDir(root, { prefer: 'LyraGame.exe' }) === fix,
  'the binary the page names wins over the heuristics',
  findExecutableInDir(root, { prefer: 'LyraGame.exe' })
)
check(
  findExecutableInDir(root, { prefer: 'lyragame.EXE' }) === fix,
  'the name matches whatever case the archive extracted with',
  findExecutableInDir(root, { prefer: 'lyragame.EXE' })
)
check(
  findExecutableInDir(root, { prefer: 'NotHere.exe' }) === big,
  'a name that is not in the folder falls back to the scan',
  findExecutableInDir(root, { prefer: 'NotHere.exe' })
)
check(findExecutableInDir(root, { prefer: null }) === big, 'no hint is not an error', findExecutableInDir(root, { prefer: null }))

// A binary reached through a subfolder is still found by the scan, and the
// hint only ever selects among what the scan returned.
const nested = write(path.join('Binaries', 'Win64', 'Shipping.exe'), 1)
check(
  findExecutableInDir(root, { prefer: 'Shipping.exe' }) === nested,
  'the hint names a file, the path still comes from the scan',
  findExecutableInDir(root, { prefer: 'Shipping.exe' })
)

// The value arrives from a remote page. It is reduced to a bare name and only
// ever compared against files the scan already found, so a directory in it is
// dropped rather than followed — and a quoted "Binaries/Win64/Game.exe" still
// yields a usable hint instead of being thrown away.
console.log('\nthe hint is a name, never a path')
check(bareExecutableName('LyraGame.exe') === 'LyraGame.exe', 'a plain name is kept')
check(
  bareExecutableName('Binaries/Win64/Game.exe') === 'Game.exe',
  'a directory in the hint is dropped, not followed',
  bareExecutableName('Binaries/Win64/Game.exe')
)
check(
  bareExecutableName('../../../etc/cron.exe') === 'cron.exe',
  'traversal collapses to a name that can only match inside the folder',
  bareExecutableName('../../../etc/cron.exe')
)
check(
  bareExecutableName('C:\\Windows\\System32\\cmd.exe') === 'cmd.exe',
  'a windows path collapses the same way',
  bareExecutableName('C:\\Windows\\System32\\cmd.exe')
)
check(bareExecutableName('../../../etc/passwd') === null, 'a non-executable is refused outright', bareExecutableName('../../../etc/passwd'))
check(bareExecutableName('game.dll') === null, 'only .exe is accepted', bareExecutableName('game.dll'))
check(bareExecutableName('') === null && bareExecutableName(undefined) === null, 'nothing is not a name')

// The point of the reduction: a hint pointing outside can name nothing but a
// file that is already in the scanned folder.
check(
  findExecutableInDir(root, { prefer: '/etc/LyraGame.exe' }) === fix,
  'a hint wearing a path still selects only from the folder',
  findExecutableInDir(root, { prefer: '/etc/LyraGame.exe' })
)
check(
  findExecutableInDir(root, { prefer: '../../../bin/sh.exe' }) === big,
  'a hint naming nothing in the folder changes nothing',
  findExecutableInDir(root, { prefer: '../../../bin/sh.exe' })
)

fs.rmSync(root, { recursive: true, force: true })

console.log(failures === 0 ? '\nall executable checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
