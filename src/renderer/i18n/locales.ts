export type SupportedLanguage = string

export type TranslationKey = string

export type TranslationTable = Record<string, string>

export type LanguageOption = {
  code: SupportedLanguage
  label: string
  nativeLabel: string
  source?: string
}

export const builtInLanguageMetadata: LanguageOption[] = [
  { code: 'pt-BR', label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)' },
  { code: 'en', label: 'English', nativeLabel: 'English' }
]

export const supportedLanguages = builtInLanguageMetadata

export const defaultLanguage: SupportedLanguage = 'pt-BR'
