import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  builtInLanguageMetadata,
  defaultLanguage,
  type LanguageOption,
  type SupportedLanguage,
  type TranslationKey,
  type TranslationTable
} from './locales'
import { translations as bundledTranslations } from './translations'

const STORAGE_KEY = 'voidlauncher.language'

type I18nContextValue = {
  language: SupportedLanguage
  setLanguage: (language: SupportedLanguage) => void
  supportedLanguages: LanguageOption[]
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function normalizeLanguage(value?: string | null): SupportedLanguage {
  const raw = String(value || '').trim().replace(/_/g, '-')
  if (!raw) return defaultLanguage
  if (raw in bundledTranslations) return raw
  const lower = raw.toLowerCase()
  const bundledMatch = Object.keys(bundledTranslations).find(code => code.toLowerCase() === lower)
  if (bundledMatch) return bundledMatch
  if (lower === 'pt' && bundledTranslations['pt-BR']) return 'pt-BR'
  if (lower === 'en' && bundledTranslations.en) return 'en'
  return raw
}

function getInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return normalizeLanguage(stored)
  } catch {
    // ignore
  }
  return defaultLanguage
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key]
    return value == null ? match : String(value)
  })
}

function getLanguageOption(code: SupportedLanguage, table?: TranslationTable): LanguageOption {
  const known = builtInLanguageMetadata.find(item => item.code === code)
  return {
    code,
    label: table?.['language.label'] || known?.label || code,
    nativeLabel: table?.['language.nativeLabel'] || known?.nativeLabel || code,
    source: known ? 'bundled' : undefined
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => getInitialLanguage())
  const [runtimeTranslations, setRuntimeTranslations] = useState<Record<SupportedLanguage, TranslationTable>>({})

  const translations = useMemo(
    () => ({ ...bundledTranslations, ...runtimeTranslations }),
    [runtimeTranslations]
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // ignore
    }
    try {
      document.documentElement.lang = language
    } catch {
      // ignore
    }
  }, [language])

  useEffect(() => {
    let disposed = false

    async function loadRuntimeLanguagePacks() {
      const api = window.electronAPI?.listLanguagePacks
      if (typeof api !== 'function') return

      try {
        const res = await api()
        if (disposed || !res?.success || !Array.isArray(res.languages)) return

        const next: Record<SupportedLanguage, TranslationTable> = {}
        for (const item of res.languages) {
          if (!item?.code || !item.translations) continue
          next[item.code] = item.translations
        }
        setRuntimeTranslations(next)
      } catch (err) {
        console.warn('[i18n] Failed to load runtime language packs:', err)
      }
    }

    loadRuntimeLanguagePacks()
    return () => {
      disposed = true
    }
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    const setLanguage = (next: SupportedLanguage) => setLanguageState(normalizeLanguage(next))
    const t = (key: TranslationKey, params?: Record<string, string | number>) => {
      const template = translations[language]?.[key] || translations[defaultLanguage][key] || key
      return interpolate(template, params)
    }
    const supportedLanguages = Object.keys(translations)
      .map(code => getLanguageOption(code, translations[code]))
      .sort((a, b) => {
        if (a.code === defaultLanguage) return -1
        if (b.code === defaultLanguage) return 1
        return a.nativeLabel.localeCompare(b.nativeLabel)
      })

    if (language && !supportedLanguages.some(item => item.code === language)) {
      supportedLanguages.push(getLanguageOption(language))
    }

    return { language, setLanguage, supportedLanguages, t }
  }, [language, translations])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
