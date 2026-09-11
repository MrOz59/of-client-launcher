/**
 * What the game needs to run, read from a Steam store entry.
 *
 * The guide on the site never says: it is written for people who already own
 * the game, so the page goes straight to the fix. Steam states it, but as a
 * block of markup meant for its own page — a heading, then a list whose items
 * are "<strong>Processor:</strong> i5 8th gen". That is read back into label
 * and value here so the launcher can lay it out as a table, in the reader's own
 * language (Steam translates these labels for the same `l=` the rest of the
 * lookup already asks for).
 *
 * Windows only, deliberately: these fixes patch the Windows build, which is
 * what a player runs here whether directly or through Proton.
 *
 * Plain Node, no Electron: the shapes Steam sends change without warning, so
 * this is kept testable against a saved payload.
 */

/** One "<label>: <value>" line of a requirements block. */
export type StoreRequirementRow = { label?: string; value: string }

export type StoreGameRequirements = {
  minimum?: StoreRequirementRow[]
  recommended?: StoreRequirementRow[]
}


const REQUIREMENT_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi
const REQUIREMENT_LABEL = /^([^:]{1,40}?)\s*\**\s*:\s*([\s\S]*)$/
const MAX_REQUIREMENT_ROWS = 12

function requirementText(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function requirementRow(html: string): StoreRequirementRow | undefined {
  const text = requirementText(html)
  if (!text) return undefined

  const labelled = REQUIREMENT_LABEL.exec(text)
  if (!labelled) return { value: text.slice(0, 200) }

  const value = labelled[2].trim()
  // A bare heading ("Minimum:") introduces the block; it is not a row.
  if (!value) return undefined

  return { label: labelled[1].trim().slice(0, 60), value: value.slice(0, 200) }
}

export function parseRequirements(html: unknown): StoreRequirementRow[] | undefined {
  const markup = String(html || '')
  if (!markup) return undefined

  const rows: StoreRequirementRow[] = []
  const items = [...markup.matchAll(REQUIREMENT_ITEM)].map((match) => match[1])

  // Entries that never filled the form out write the whole block as prose.
  for (const item of items.length > 0 ? items : markup.split(/<br\s*\/?>/i)) {
    if (rows.length >= MAX_REQUIREMENT_ROWS) break
    const row = requirementRow(item)
    if (row) rows.push(row)
  }

  return rows.length > 0 ? rows : undefined
}

/** Steam sends an empty list for a platform the game does not support. */
export function mapRequirements(data: any): StoreGameRequirements | undefined {
  const minimum = parseRequirements(data?.pc_requirements?.minimum)
  const recommended = parseRequirements(data?.pc_requirements?.recommended)
  if (!minimum && !recommended) return undefined

  return { ...(minimum ? { minimum } : {}), ...(recommended ? { recommended } : {}) }
}
