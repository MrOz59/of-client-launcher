import { app, BrowserWindow, session, type Cookie } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isOnlineFixHost, STORE_HOME_URL } from '../../shared/allowedHosts'
import { getUiLanguage } from '../i18nMain'
import { getStoreCooldownMs, noteStoreRateLimit, reserveStoreRequestSlot, StoreRequestError } from './requestPolicy'

const STORE_PARTITION = 'persist:online-fix'
const TRANSLATION_PARTITION = 'persist:online-fix-translate'
const SUCCESS_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 30 * 60 * 1000
const LOAD_TIMEOUT_MS = 25000
const TRANSLATION_TIMEOUT_MS = 18000
const MAX_CACHE_ENTRIES = 300
const CACHE_SCHEMA_VERSION = 2

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
let translationSessionConfigured = false

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

function translationHostAllowed(hostname: string): boolean {
  return /(^|\.)(googleapis\.com|googleusercontent\.com|gstatic\.com)$/i.test(hostname) ||
    /(^|\.)translate\.google\./i.test(hostname)
}

function translationSession() {
  const target = session.fromPartition(TRANSLATION_PARTITION)
  if (!translationSessionConfigured) {
    translationSessionConfigured = true
    target.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.resourceType === 'mainFrame') {
        try {
          callback({ cancel: !isOnlineFixHost(new URL(details.url).hostname) })
        } catch {
          callback({ cancel: true })
        }
        return
      }

      let allowed = false
      try {
        const hostname = new URL(details.url).hostname
        allowed = isOnlineFixHost(hostname)
          ? details.resourceType === 'script'
          : translationHostAllowed(hostname)
      } catch {
        allowed = false
      }

      const unnecessary = details.resourceType === 'image' ||
        details.resourceType === 'media' ||
        details.resourceType === 'font' ||
        details.resourceType === 'stylesheet'
      callback({ cancel: !allowed || unnecessary })
    })
    target.webRequest.onCompleted({ urls: ['*://online-fix.me/*', '*://*.online-fix.me/*'] }, (details) => {
      if (details.statusCode === 429) noteStoreRateLimit(null)
    })
  }
  return target
}

function cookieUrl(cookie: Cookie): string {
  const host = String(cookie.domain || new URL(STORE_HOME_URL).hostname).replace(/^\./, '')
  return `https://${host}${cookie.path || '/'}`
}

async function syncStoreCookies(language: string) {
  const source = session.fromPartition(STORE_PARTITION)
  const target = translationSession()

  const existing = await target.cookies.get({ url: STORE_HOME_URL })
  await Promise.all(existing.map((cookie) => target.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => {})))

  const cookies = await source.cookies.get({ url: STORE_HOME_URL })
  for (const cookie of cookies) {
    try {
      await target.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.session ? undefined : cookie.expirationDate
      })
    } catch {
      // A non-essential cookie with incompatible flags must not stop translation.
    }
  }

  await target.cookies.set({
    url: STORE_HOME_URL,
    name: 'googtrans',
    value: `/auto/${language}`,
    path: '/'
  })
}

function probeScript(instructions: string[]): string {
  return `(() => {
    const steps = ${JSON.stringify(instructions)};
    const existing = document.getElementById('of-instruction-translation-probe');
    if (existing && existing.querySelectorAll('[data-index]').length === steps.length) return true;
    existing?.remove();
    const probe = document.createElement('section');
    probe.id = 'of-instruction-translation-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:640px;z-index:-1;pointer-events:none';
    for (let index = 0; index < steps.length; index++) {
      const line = document.createElement('p');
      line.dataset.index = String(index);
      line.textContent = steps[index];
      probe.appendChild(line);
    }
    (document.body || document.documentElement).appendChild(probe);
    return true;
  })()`
}

function readProbeScript(language: string): string {
  return `(() => {
    const target = ${JSON.stringify(language)};
    const select = document.querySelector('select.goog-te-combo');
    if (select && select.value !== target) {
      select.value = target;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { document.cookie = 'googtrans=/auto/' + target + ';path=/'; } catch {}
    const values = Array.from(document.querySelectorAll('#of-instruction-translation-probe [data-index]'))
      .map((node) => String(node.textContent || '').replace(/\\s+/g, ' ').trim());
    return { values, widgetReady: Boolean(select), translatedPage: document.documentElement.classList.contains('translated-ltr') || document.documentElement.classList.contains('translated-rtl') };
  })()`
}

async function translateWithSiteWidget(url: string, language: string, instructions: string[]): Promise<string[]> {
  await syncStoreCookies(language)
  await reserveStoreRequestSlot(900)

  if (getStoreCooldownMs() > 0) {
    throw new StoreRequestError('store-rate-limited', 'Store rate limit is active')
  }

  const win = new BrowserWindow({
    show: false,
    width: 760,
    height: 640,
    webPreferences: {
      partition: TRANSLATION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let loadTimer: NodeJS.Timeout | null = null
  try {
    let domSettled = false
    let rejectDomReady: ((error: Error) => void) | null = null
    let loadFailure = ''
    const domReady = new Promise<void>((resolve, reject) => {
      rejectDomReady = reject
      win.webContents.once('dom-ready', () => {
        if (domSettled) return
        domSettled = true
        win.webContents.executeJavaScript(probeScript(instructions), true).catch(() => {})
        resolve()
      })
    })

    // A blocked ad or embedded Discord frame can keep loadURL pending even
    // though the document we need is already usable. Translation starts as
    // soon as the DOM is ready and deliberately does not await did-finish-load.
    void win.loadURL(url).catch((err: any) => {
      loadFailure = err?.message || String(err)
      if (!domSettled && rejectDomReady) {
        domSettled = true
        rejectDomReady(new Error(loadFailure))
      }
    })
    await Promise.race([
      domReady,
      new Promise<never>((_resolve, reject) => {
        loadTimer = setTimeout(() => reject(new Error('Store translation DOM timed out')), LOAD_TIMEOUT_MS)
      })
    ])
    if (loadTimer) clearTimeout(loadTimer)

    await win.webContents.executeJavaScript(probeScript(instructions), true)
    const deadline = Date.now() + TRANSLATION_TIMEOUT_MS
    let best: string[] | null = null
    let lastState: { widgetReady?: boolean; translatedPage?: boolean } = {}

    while (Date.now() < deadline && !win.isDestroyed()) {
      const state = await win.webContents.executeJavaScript(readProbeScript(language), true) as {
        values?: string[]
        widgetReady?: boolean
        translatedPage?: boolean
      }
      lastState = state || {}
      const values = normalizeInstructions(state?.values)
      const changed = values.filter((line, index) => line && line !== instructions[index]).length
      if (values.length === instructions.length && changed > 0) best = values
      if (best && changed >= Math.max(1, Math.ceil(instructions.length / 2)) && (state.widgetReady || state.translatedPage)) {
        return best
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (best) return best
    throw new Error(
      `Google Translate widget did not return translated instructions ` +
      `(widget=${Boolean(lastState.widgetReady)}, pageTranslated=${Boolean(lastState.translatedPage)}, loadFailure=${loadFailure || 'none'})`
    )
  } finally {
    if (loadTimer) clearTimeout(loadTimer)
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function translateStoreInstructions(options: {
  url: string
  instructions: unknown
  language?: string
  force?: boolean
}): Promise<StoreInstructionTranslation> {
  const url = new URL(options.url, STORE_HOME_URL).toString()
  if (!isOnlineFixHost(new URL(url).hostname)) throw new Error('Invalid store translation URL')

  const instructions = normalizeInstructions(options.instructions)
  const language = targetLanguage(options.language)
  if (instructions.length === 0 || language === 'ru' || !instructions.some((line) => /[\u0400-\u04ff]/.test(line))) {
    return { instructions, language, translated: false }
  }

  const key = cacheKey(url, language, instructions)
  const cached = readCache(key)
  const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY
  if (!options.force && cached?.instructions && age < SUCCESS_CACHE_TTL_MS) {
    return { instructions: cached.instructions, language, translated: true, fromCache: true }
  }
  if (!options.force && cached?.failed && age < FAILURE_CACHE_TTL_MS) {
    throw new StoreRequestError('store-translation-unavailable', 'Instruction translation is temporarily unavailable')
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    try {
      const translated = await translateWithSiteWidget(url, language, instructions)
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
