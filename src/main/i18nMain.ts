import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getSetting, setSetting } from './db'

/**
 * Translations for the strings the main process itself shows — desktop toasts,
 * mainly. The renderer keeps the language in localStorage, which main cannot
 * read, so the renderer mirrors it into the settings table (`ui_language`) and
 * this module reads the same JSON files the renderer bundles.
 *
 * Errors returned over IPC do NOT belong here: those carry a code and are
 * translated by the renderer (see src/shared/ipcErrors.ts).
 */

const FALLBACK_LANGUAGE = 'en'
const SETTING_KEY = 'ui_language'

type TranslationTable = Record<string, string>

const cache = new Map<string, TranslationTable>()

function translationDirs(): string[] {
  const dirs = [
    process.resourcesPath ? path.join(process.resourcesPath, 'i18n', 'translations') : '',
    path.join(app.getAppPath(), 'src', 'renderer', 'i18n', 'translations'),
    path.join(process.cwd(), 'src', 'renderer', 'i18n', 'translations')
  ]
  return dirs.filter(Boolean)
}

function loadTable(language: string): TranslationTable {
  const cached = cache.get(language)
  if (cached) return cached

  for (const dir of translationDirs()) {
    const file = path.join(dir, `${language}.json`)
    try {
      if (!fs.existsSync(file)) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        const table = parsed as TranslationTable
        cache.set(language, table)
        return table
      }
    } catch (err) {
      console.warn(`[i18n] Failed to read ${file}:`, err)
    }
  }

  const empty: TranslationTable = {}
  cache.set(language, empty)
  return empty
}

export function getUiLanguage(): string {
  const stored = String(getSetting(SETTING_KEY) || '').trim()
  return stored || FALLBACK_LANGUAGE
}

/** Called over IPC whenever the renderer's language changes. */
export function setUiLanguage(language: string): string {
  const value = String(language || '').trim() || FALLBACK_LANGUAGE
  setSetting(SETTING_KEY, value)
  cache.delete(value)
  return value
}

export function tMain(key: string, params?: Record<string, string | number>): string {
  const language = getUiLanguage()
  const template =
    loadTable(language)[key] ||
    (language === FALLBACK_LANGUAGE ? undefined : loadTable(FALLBACK_LANGUAGE)[key]) ||
    key

  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}
