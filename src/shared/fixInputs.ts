/**
 * The values a fix cannot carry, because they belong to the person applying it.
 *
 * Some fixes are only half a fix on their own. The Below Zero multiplayer mod
 * takes the player's name, a unique id and this machine's address off the
 * command line — the launcher's account and VPN used to supply them — so the
 * fix that makes the mod load can describe everything except the four values
 * that differ for every player. Until now it said so in a note and left the
 * person to edit the launch arguments by hand, which is the step most people
 * skip and then report the game as broken.
 *
 * A fix declares those as `inputs`, writes `{{id}}` where each one goes, and
 * the launcher asks for them when the fix is applied.
 *
 * Both ends of the IPC boundary use this file: the dialog validates as you
 * type, and the main process validates again on arrival, because a value from
 * the renderer is still a value from outside.
 */

export type FixInputType = 'text' | 'ipv4' | 'number'

export interface FixInput {
  id: string
  label: string
  description?: string
  type: FixInputType
  default?: string
  required: boolean
}

export const FIX_INPUT_TYPES: FixInputType[] = ['text', 'ipv4', 'number']

/** A dialog that asks for more than a handful of things is a fix that needs splitting. */
export const MAX_FIX_INPUTS = 8

/** The id is both the placeholder name and a key, so it stays identifier-shaped. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/**
 * A value ends up inside the launch arguments, which the launcher splits on
 * spaces: a space in one would quietly become two arguments, and a quote or a
 * backslash would change what the rest of the line means. The mods that want
 * these values say the same thing in their own words ("NO SPACES"), so the
 * restriction costs nothing and removes a whole class of silent breakage.
 */
const VALUE_PATTERNS: Record<FixInputType, RegExp> = {
  text: /^[^\s"'\\]{1,120}$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
  number: /^\d{1,12}$/
}

/** `{{id}}` is the only thing a fix may write where a value goes. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g

/** The option strings a fix may parameterise. Everything else is a fixed value. */
export const FIX_INPUT_OPTION_KEYS = ['launchArgs', 'wineDllOverrides', 'locale'] as const

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function isFixInputId(value: unknown): boolean {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function fixInputType(value: unknown): FixInputType {
  return FIX_INPUT_TYPES.includes(value as FixInputType) ? (value as FixInputType) : 'text'
}

export function isValidFixInputValue(type: FixInputType, value: string): boolean {
  return VALUE_PATTERNS[fixInputType(type)].test(value)
}

/** Every `{{id}}` in a string, in order, without duplicates. */
export function findFixPlaceholders(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  const found: string[] = []
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

export function substituteFixPlaceholders(value: string, values: Record<string, string>): string {
  return value.replace(PLACEHOLDER_PATTERN, (whole, id: string) =>
    Object.prototype.hasOwnProperty.call(values, id) ? values[id] : whole)
}

/** Reads the `inputs` of a fix that arrived from anywhere: a file, a download, the editor. */
export function sanitizeFixInputs(raw: unknown): FixInput[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const inputs: FixInput[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const id = text((entry as any).id, 40)
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    seen.add(id)

    inputs.push({
      id,
      label: text((entry as any).label, 80) || id,
      description: text((entry as any).description, 200) || undefined,
      type: fixInputType((entry as any).type),
      default: text((entry as any).default, 120) || undefined,
      required: (entry as any).required !== false
    })
    if (inputs.length >= MAX_FIX_INPUTS) break
  }

  return inputs
}

export type ResolvedFixInputs = {
  values: Record<string, string>
  /** Required and left empty. */
  missing: string[]
  /** Filled in, but not what the declared type accepts. */
  invalid: string[]
}

export function resolveFixInputValues(inputs: FixInput[], raw: unknown): ResolvedFixInputs {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const values: Record<string, string> = {}
  const missing: string[] = []
  const invalid: string[] = []

  for (const input of inputs) {
    const value = text(source[input.id], 120)
    if (!value) {
      if (input.required) missing.push(input.id)
      values[input.id] = ''
      continue
    }
    if (!isValidFixInputValue(input.type, value)) {
      invalid.push(input.id)
      continue
    }
    values[input.id] = value
  }

  return { values, missing, invalid }
}

/** Fills the placeholders in the option strings a fix is allowed to parameterise. */
export function substituteFixInputsInOptions<T extends Record<string, any>>(
  options: T,
  values: Record<string, string>
): T {
  const next: Record<string, any> = { ...options }
  for (const key of FIX_INPUT_OPTION_KEYS) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = substituteFixPlaceholders(next[key], values)
    }
  }
  return next as T
}

/**
 * Placeholders still standing after substitution. A fix that writes `{{peerIp}}`
 * without declaring it would otherwise reach the game as a literal `{{peerIp}}`
 * on the command line, which is the kind of failure nobody traces back here.
 */
export function pendingFixPlaceholders(options: Record<string, any>): string[] {
  const pending: string[] = []
  for (const key of FIX_INPUT_OPTION_KEYS) {
    for (const id of findFixPlaceholders(options?.[key])) {
      if (!pending.includes(id)) pending.push(id)
    }
  }
  return pending
}

/**
 * Reads back the answers already in effect, so re-applying a fix — after an
 * update, or on a second machine — opens the dialog on what this game is
 * already running with instead of on the fix author's defaults.
 *
 * It is a best guess and treated as one: the values are only a prefill, and
 * they go through the same validation as anything typed by hand.
 */
export function extractFixInputValues(template: string, actual: string): Record<string, string> {
  if (typeof template !== 'string' || typeof actual !== 'string') return {}
  if (!template || !actual || template.length > 512 || actual.length > 512) return {}

  const ids: string[] = []
  let pattern = ''
  let index = 0

  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    pattern += template.slice(index, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern += '(\\S+)'
    ids.push(match[1])
    index = (match.index ?? 0) + match[0].length
  }
  if (!ids.length) return {}
  pattern += template.slice(index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  let found: RegExpMatchArray | null = null
  try {
    found = actual.match(new RegExp(`^${pattern}$`))
  } catch {
    return {}
  }
  if (!found) return {}

  const values: Record<string, string> = {}
  ids.forEach((id, i) => {
    if (values[id] === undefined) values[id] = found![i + 1]
  })
  return values
}
