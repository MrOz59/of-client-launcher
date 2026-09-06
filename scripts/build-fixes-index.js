#!/usr/bin/env node
/**
 * Validates every fix in fixes/ and writes fixes/index.json.
 *
 * The launcher reads the index to know which fixes exist for a game without
 * downloading all of them, so the index has to describe exactly what is on
 * disk. Generating it from the files themselves is what keeps that true.
 *
 * With --check nothing is written: it fails if a fix is invalid or the index
 * has drifted, which is the form CI should run.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'fixes')
const INDEX = path.join(ROOT, 'index.json')
const checkOnly = process.argv.includes('--check')

const problems = []
const fail = (file, message) => problems.push(`${file}: ${message}`)

/** Mirrors what the launcher accepts, so a fix here cannot fail on arrival. */
function validate(file, fix) {
  const id = path.basename(file, '.json')

  if (fix.kind !== 'voidlauncher.gameFix') fail(file, 'kind must be "voidlauncher.gameFix"')
  if (fix.schemaVersion !== 1) fail(file, 'schemaVersion must be 1')
  if (fix.id !== id) fail(file, `id "${fix.id}" must match the file name "${id}"`)
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) fail(file, 'file name must be lowercase letters, digits, - or _')
  if (!String(fix.title || '').trim()) fail(file, 'title is required')

  const game = fix.game || {}
  if (!game.id && !game.url && !game.title) fail(file, 'game needs at least one of id, url or title')

  for (const verb of [...(fix.components?.winetricks || []), ...(fix.components?.protontricks || [])]) {
    if (!/^[a-z0-9_.+-]+$/i.test(verb)) fail(file, `component "${verb}" is not a plain winetricks verb`)
  }

  if (fix.launchExecutable != null && !/^[^/\\]+\.exe$/i.test(fix.launchExecutable)) {
    fail(file, `launchExecutable "${fix.launchExecutable}" must be a bare .exe file name`)
  }

  for (const entry of fix.runtimeAssemblies || []) {
    if (!/^[A-Za-z0-9_.+-]+\.dll$/i.test(entry?.name || '')) fail(file, `runtimeAssemblies name "${entry?.name}" must be a bare .dll file name`)
    const into = String(entry?.into || '')
    if (!into) fail(file, 'runtimeAssemblies needs "into"')
    if (into.startsWith('/') || /^[A-Za-z]:/.test(into)) fail(file, `"${into}" must be relative to the game folder`)
    if (into.split(/[\\/]/).some((segment) => segment === '..')) fail(file, `"${into}" must not climb out of the game folder`)
  }
}

const files = fs.readdirSync(ROOT).filter((name) => name.endsWith('.json') && name !== 'index.json').sort()
const entries = []

for (const file of files) {
  let fix
  try {
    fix = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
  } catch (err) {
    fail(file, `invalid JSON: ${err.message}`)
    continue
  }

  validate(file, fix)
  entries.push({
    id: fix.id,
    file,
    title: fix.title,
    description: fix.description || '',
    game: {
      id: fix.game?.id || null,
      title: fix.game?.title || null,
      url: fix.game?.url || null
    }
  })
}

if (problems.length) {
  console.error('Invalid fixes:\n  ' + problems.join('\n  '))
  process.exit(1)
}

const index = { schemaVersion: 1, fixes: entries }
const rendered = JSON.stringify(index, null, 2) + '\n'

if (checkOnly) {
  const current = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : ''
  if (current !== rendered) {
    console.error('fixes/index.json is out of date. Run: npm run fixes:index')
    process.exit(1)
  }
  console.log(`${entries.length} fix(es) valid, index up to date`)
} else {
  fs.writeFileSync(INDEX, rendered)
  console.log(`${entries.length} fix(es) valid, wrote fixes/index.json`)
}
