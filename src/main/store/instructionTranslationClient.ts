import { StoreRequestError } from './requestPolicy'

type FetchText = (url: string, init: RequestInit) => Promise<Response>
const CYRILLIC = /[\u0400-\u04ff]/
const CYRILLIC_LANGUAGES = new Set(['ru', 'uk', 'bg', 'be', 'mk', 'sr', 'kk', 'ky', 'tg', 'mn'])
const REQUEST_TIMEOUT_MS = 7000

export function isInstructionTranslation(source: string, translated: unknown, language: string): translated is string {
  if (typeof translated !== 'string' || !translated.trim() || translated.length > 4000) return false
  if (!CYRILLIC.test(source)) return translated === source
  if (translated.trim() === source.trim()) return false
  // Never cache the original Russian paragraph as a successful translation.
  // Technical filenames may legitimately contain Cyrillic characters.
  const prose = translated.replace(/https?:\/\/\S+|\S+\.(?:exe|dll|bat|cmd|ini|zip|rar|7z)\b/gi, '')
  return CYRILLIC_LANGUAGES.has(language.split('-')[0]) || !CYRILLIC.test(prose)
}

/** Only public instruction text is sent; no store URL, account or cookies. */
export function createInstructionTranslator(fetchText: FetchText) {
  let googleBlockedUntil = 0
  let memoryBlockedUntil = 0

  async function request(url: URL, signal: AbortSignal): Promise<Response> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchText(url.toString(), { signal: controller.signal, credentials: 'omit' })
      // Read the body within the timeout, too. Some providers stall after headers.
      const body = await response.text()
      return new Response(body, { status: response.status, headers: response.headers })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }

  function retryAt(response: Response, defaultMs: number): number {
    const retry = response.headers.get('retry-after')
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0
    return Date.now() + Math.max(defaultMs, Number.isFinite(delay) ? delay : 0)
  }

  return async function translate(
    instructions: string[],
    language: string,
    cachedLine: (source: string) => string | undefined,
    saveLine: (source: string, translated: string) => void
  ): Promise<string[]> {
    const values = instructions.map((line) => !CYRILLIC.test(line) ? line : cachedLine(line))
    const missing = [...new Set(instructions.filter((_line, index) => !values[index]))]
    if (!missing.length) return values as string[]

    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 20000)
    const translated = new Map<string, string>()
    try {
      if (Date.now() >= googleBlockedUntil) {
        try {
          // Google's public web endpoint is best-effort, not the authenticated
          // Cloud Translation API. Validate its output and keep a fallback.
          const url = new URL('https://translate.googleapis.com/translate_a/single')
          url.search = new URLSearchParams({ client: 'gtx', sl: 'ru', tl: language, dt: 't', q: missing.join('\n') }).toString()
          const response = await request(url, controller.signal)
          if (response.status === 429) googleBlockedUntil = retryAt(response, 15 * 60 * 1000)
          if (!response.ok) throw new Error(`Translation HTTP ${response.status}`)
          const data = await response.json() as unknown
          if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Invalid translation response')
          const lines = data[0].map((part: unknown) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join('').trim().split(/\r?\n/)
          // Preserve step boundaries; a merged/reordered result is not usable.
          if (lines.length === missing.length) {
            lines.forEach((line, index) => {
              const source = missing[index]
              if (isInstructionTranslation(source, line, language)) {
                translated.set(source, line.trim())
                saveLine(source, line.trim())
              }
            })
          }
        } catch {
          // A blocked Google endpoint must not prevent the independent fallback.
        }
      }

      const remaining = missing.filter((line) => !translated.has(line))
      let next = 0
      await Promise.all(Array.from({ length: Math.min(2, remaining.length) }, async () => {
        while (next < remaining.length) {
          const source = remaining[next++]
          if (controller.signal.aborted || Date.now() < memoryBlockedUntil || Buffer.byteLength(source, 'utf8') > 500) {
            throw new Error('Translation temporarily unavailable')
          }
          // https://mymemory.translated.net/doc/spec.php — read-only lookup;
          // never contribute user content through the provider's /set endpoint.
          const url = new URL('https://api.mymemory.translated.net/get')
          url.search = new URLSearchParams({ q: source, langpair: `ru|${language === 'pt' ? 'pt-BR' : language}` }).toString()
          const response = await request(url, controller.signal)
          if (response.status === 429) memoryBlockedUntil = retryAt(response, 60 * 1000)
          if (!response.ok) throw new Error(`Translation HTTP ${response.status}`)
          const data = await response.json() as { responseStatus?: number | string; quotaFinished?: boolean; responseData?: { translatedText?: string } }
          if (data.quotaFinished || Number(data.responseStatus) === 429 || Number(data.responseStatus) === 403) {
            memoryBlockedUntil = retryAt(response, 24 * 60 * 60 * 1000)
          }
          const line = data.responseData?.translatedText
          if (Number(data.responseStatus) !== 200 || !isInstructionTranslation(source, line, language)) {
            throw new Error('Incomplete translation response')
          }
          translated.set(source, line.trim())
          saveLine(source, line.trim())
        }
      }))

      return instructions.map((line, index) => values[index] || translated.get(line)!)
    } catch {
      throw new StoreRequestError('store-translation-unavailable', 'Instruction translation is temporarily unavailable')
    } finally {
      controller.abort()
      clearTimeout(deadline)
    }
  }
}
