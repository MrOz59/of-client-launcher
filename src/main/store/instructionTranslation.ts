import { app, net } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isOnlineFixHost, STORE_HOME_URL } from '../../shared/allowedHosts'
import { getUiLanguage } from '../i18nMain'
import { StoreRequestError } from './requestPolicy'
import { createInstructionTranslator, isInstructionTranslation } from './instructionTranslationClient'

const SUCCESS_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 300
const CACHE_SCHEMA_VERSION = 3

type CachedTranslation = {
  fetchedAt: number
  language: string
  instructions?: string[]
  failed?: boolean
}

export type StoreInstructionTranslation = {
  instructions: string[]
  language: string
  translated: boolean
  fromCache?: boolean
}

const inFlight = new Map<string, Promise<StoreInstructionTranslation>>()
const translateLines = createInstructionTranslator((url, init) => net.fetch(url, init))

function targetLanguage(preferred?: string): string {
  const locale = String(preferred || getUiLanguage()).trim().replace(/_/g, '-').toLowerCase()
  if (locale === 'zh-tw' || locale === 'zh-hk') return 'zh-TW'
  if (locale.startsWith('zh')) return 'zh-CN'
  const primary = locale.split('-')[0]
  return /^[a-z]{2,3}$/.test(primary) ? primary : 'en'
}

function normalizeInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter((line) => line.length >= 2)
    .slice(0, 12)
}

function cacheKey(url: string, language: string, instructions: string[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ schema: CACHE_SCHEMA_VERSION, url, language, instructions }))
    .digest('hex')
}

function cacheDirectory(create = true): string {
  const dir = path.join(app.getPath('userData'), 'cache', 'store-instruction-translations')
  if (create) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readCache(key: string): CachedTranslation | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(cacheDirectory(), `${key}.json`), 'utf8')) as CachedTranslation
    if (!value?.fetchedAt || !value?.language) return null
    return value
  } catch {
    return null
  }
}

function writeCache(key: string, value: CachedTranslation) {
  try {
    const dir = cacheDirectory()
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value), 'utf8')

    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, modified: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified)
    for (const file of files.slice(MAX_CACHE_ENTRIES)) fs.unlinkSync(path.join(dir, file.name))
  } catch (err) {
    console.warn('[Store] Failed to persist instruction translation:', err)
  }
}

export async function translateStoreInstructions(options: {
  url: string
  instructions: unknown
  language?: string
  force?: boolean
}): Promise<StoreInstructionTranslation> {
  const url = new URL(options.url, STORE_HOME_URL).toString()
  if (!['https:', 'http:'].includes(new URL(url).protocol) || !isOnlineFixHost(new URL(url).hostname)) throw new Error('Invalid store translation URL')

  const instructions = normalizeInstructions(options.instructions)
  const language = targetLanguage(options.language)
  if (instructions.length === 0 || language === 'ru' || !instructions.some((line) => /[\u0400-\u04ff]/.test(line))) {
    return { instructions, language, translated: false }
  }

  const key = cacheKey(url, language, instructions)
  const cached = readCache(key)
  const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY
  if (!options.force && cached?.instructions?.length === instructions.length && age < SUCCESS_CACHE_TTL_MS &&
      cached.instructions.every((line, index) => isInstructionTranslation(instructions[index], line, language))) {
    return { instructions: cached.instructions, language, translated: true, fromCache: true }
  }
  if (!options.force && cached?.failed && age < FAILURE_CACHE_TTL_MS) {
    throw new StoreRequestError('store-translation-unavailable', 'Instruction translation is temporarily unavailable')
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    try {
      const translated = await translateLines(instructions, language, (source) => {
        const entry = readCache(cacheKey('line', language, [source]))
        const line = entry?.instructions?.[0]
        return entry && Date.now() - entry.fetchedAt < SUCCESS_CACHE_TTL_MS && isInstructionTranslation(source, line, language)
          ? line : undefined
      }, (source, translated) => {
        writeCache(cacheKey('line', language, [source]), { fetchedAt: Date.now(), language, instructions: [translated] })
      })
      writeCache(key, { fetchedAt: Date.now(), language, instructions: translated })
      return { instructions: translated, language, translated: true } satisfies StoreInstructionTranslation
    } catch (err) {
      writeCache(key, { fetchedAt: Date.now(), language, failed: true })
      throw err
    }
  })()

  inFlight.set(key, request)
  try {
    return await request
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key)
  }
}

export function clearStoreInstructionTranslationCache() {
  try {
    fs.rmSync(cacheDirectory(false), { recursive: true, force: true })
  } catch (err) {
    console.warn('[Store] Failed to clear instruction translation cache:', err)
  }
}
