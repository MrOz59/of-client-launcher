import type { SupportedLanguage, TranslationTable } from '../locales'

const modules = import.meta.glob<TranslationTable>('./*.json', {
  eager: true,
  import: 'default'
})

function codeFromPath(filePath: string): SupportedLanguage | null {
  const match = filePath.match(/\/([^/]+)\.json$/)
  return match?.[1] || null
}

export const translations = Object.entries(modules).reduce<Record<SupportedLanguage, TranslationTable>>((acc, [filePath, table]) => {
  const code = codeFromPath(filePath)
  if (code) acc[code] = table
  return acc
}, {})
