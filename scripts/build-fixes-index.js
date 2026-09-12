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

// Mirrors src/shared/fixInputs.ts. This script runs on plain node with no
// build step, so the rules are repeated rather than imported.
const MAX_INPUTS = 8
const INPUT_ID = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const INPUT_TYPES = ['text', 'ipv4', 'number']
const OPTION_KEYS = ['launchArgs', 'wineDllOverrides', 'locale']
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g
const MAX_DOWNLOADS = 4
const MAX_INSTALL_RULES = 8
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const DOWNLOAD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const SHA256 = /^[a-f0-9]{64}$/i
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar']
const OS_VALUES = ['linux', 'windows']
const VALUE_PATTERNS = {
  text: /^[^\s"'\\]{1,120}$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
  number: /^\d{1,12}$/
}

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

  validateOsList(file, fix.os, 'os')

  for (const verb of fix.components?.winetricks || []) {
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

  validateInputs(file, fix)
  validateDownloads(file, fix)
}

/**
 * Which systems something is for. Absent, or every value, means all of them —
 * a fix only says this when it has a reason to.
 */
function validateOsList(file, value, where) {
  if (value == null) return
  if (!Array.isArray(value)) {
    fail(file, `"${where}" must be a list of ${OS_VALUES.join(' or ')}`)
    return
  }
  if (!value.length) fail(file, `"${where}" cannot be empty: leave it out to mean every system`)
  for (const entry of value) {
    if (!OS_VALUES.includes(entry)) fail(file, `"${where}" has "${entry}"; use ${OS_VALUES.join(' or ')}`)
  }
}

/** Anything that could climb out of the folder it is supposed to stay in. */
function isSafeRelativePath(value) {
  if (value === '') return true
  if (value.length > 240) return false
  if (value.startsWith('/') || value.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(value)) return false
  if (/[\0<>:"|?*]/.test(value)) return false
  return value.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * The only part of a fix that reaches outside the machine.
 *
 * A published fix has to pin a sha256: it is what turns "download something
 * from that host" into "download this exact file", the one whoever reviews this
 * pull request can fetch and check for themselves. A rolling link that serves
 * whatever is newest cannot be reviewed, so it cannot be published here.
 */
function validateDownloads(file, fix) {
  const downloads = Array.isArray(fix.downloads) ? fix.downloads : []
  if (!downloads.length) return
  if (downloads.length > MAX_DOWNLOADS) fail(file, `a fix may point at most at ${MAX_DOWNLOADS} downloads`)

  const ids = new Set()
  for (const entry of downloads) {
    const id = String(entry?.id || '')
    if (!DOWNLOAD_ID.test(id)) {
      fail(file, `download id "${id}" must be letters, digits, - or _`)
      continue
    }
    if (ids.has(id)) fail(file, `download "${id}" is declared twice`)
    ids.add(id)

    if (!String(entry?.label || '').trim()) fail(file, `download "${id}" needs a label saying what the file is`)
    if (!SHA256.test(String(entry?.sha256 || ''))) fail(file, `download "${id}" must pin a sha256`)

    let url = null
    try {
      url = new URL(String(entry?.url || ''))
    } catch {
      fail(file, `download "${id}" has no valid url`)
    }
    if (url) {
      if (url.protocol !== 'https:') fail(file, `download "${id}" must use https`)
      if (url.username || url.password) fail(file, `download "${id}" must not carry credentials in the url`)
      if (!ARCHIVE_EXTENSIONS.some((ext) => url.pathname.toLowerCase().endsWith(ext))) {
        fail(file, `download "${id}" must point at a ${ARCHIVE_EXTENSIONS.join(', ')} archive`)
      }
    }

    validateOsList(file, entry?.os, `download "${id}" os`)

    if (entry?.size != null && (!Number.isInteger(entry.size) || entry.size <= 0 || entry.size > MAX_DOWNLOAD_BYTES)) {
      fail(file, `download "${id}" has a size outside what a fix may fetch`)
    }

    const install = Array.isArray(entry?.install) ? entry.install : []
    if (!install.length) fail(file, `download "${id}" needs at least one install rule`)
    if (install.length > MAX_INSTALL_RULES) fail(file, `download "${id}" has more than ${MAX_INSTALL_RULES} install rules`)

    for (const rule of install) {
      const from = String(rule?.from ?? '')
      if (!isSafeRelativePath(from.replace(/^[\\/]+|[\\/]+$/g, ''))) {
        fail(file, `download "${id}": "${from}" is not a path inside the archive`)
      }
      const into = String(rule?.into || '')
      const match = /^(game|prefix):(.*)$/.exec(into)
      if (!match) {
        fail(file, `download "${id}": "${into}" must start with "game:" or "prefix:"`)
        continue
      }
      if (!isSafeRelativePath(match[2].replace(/^[\\/]+|[\\/]+$/g, ''))) {
        fail(file, `download "${id}": "${into}" must stay inside the folder it names`)
      }
    }
  }
}

/**
 * The values the launcher asks for when the fix is applied, and the `{{id}}`
 * placeholders they fill in. The two halves are checked against each other:
 * an input nobody uses asks a question for nothing, and a placeholder nobody
 * declared would reach the game as literal text on the command line.
 */
function validateInputs(file, fix) {
  const inputs = Array.isArray(fix.inputs) ? fix.inputs : []
  if (inputs.length > MAX_INPUTS) fail(file, `a fix may declare at most ${MAX_INPUTS} inputs`)

  const declared = new Set()
  for (const entry of inputs) {
    const id = String(entry?.id || '')
    if (!INPUT_ID.test(id)) {
      fail(file, `input id "${id}" must start with a letter and use only letters, digits or _`)
      continue
    }
    if (declared.has(id)) fail(file, `input "${id}" is declared twice`)
    declared.add(id)

    if (!String(entry?.label || '').trim()) fail(file, `input "${id}" needs a label`)
    if (entry?.type != null && !INPUT_TYPES.includes(entry.type)) {
      fail(file, `input "${id}" has type "${entry.type}"; use one of ${INPUT_TYPES.join(', ')}`)
    }
    const fallback = entry?.default
    if (fallback != null && !VALUE_PATTERNS[entry?.type || 'text'].test(String(fallback))) {
      fail(file, `input "${id}" has a default its own type would reject`)
    }
  }

  const used = new Set()
  for (const key of OPTION_KEYS) {
    const value = fix.proton?.options?.[key]
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(PLACEHOLDER)) used.add(match[1])
  }

  for (const id of used) {
    if (!declared.has(id)) fail(file, `{{${id}}} is used in proton.options but never declared in "inputs"`)
  }
  for (const id of declared) {
    if (!used.has(id)) fail(file, `input "${id}" is declared but never used as {{${id}}}`)
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
