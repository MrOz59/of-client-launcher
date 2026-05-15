const CONCATENATED_UI_TOKENS =
  /(download|baixar|descargar|t[eé]l[eé]charger|torrent|magnet|update|atualiza[cç][aã]o|скачать|торрент|обновить).*$/i

export function sanitizeVersionText(value?: string | null): string | null {
  const raw = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!raw) return null

  const withoutUiTail = raw.replace(CONCATENATED_UI_TOKENS, '').trim()
  const text = withoutUiTail || raw

  const build = text.match(/\b(Build[.\s_]*\d{6,10})\b/i)
  if (build?.[1]) return build[1].replace(/\s+/g, ' ').trim()

  const semantic = text.match(/\b(v?\d+(?:\.\d+){1,6})(?:[-_ ]?(alpha|beta|rc|hotfix|patch)\.?\d*)?\b/i)
  if (semantic?.[0]) return semantic[0].trim()

  const isoDate = text.match(/\b(20\d{2}[.\-_]\d{2}[.\-_]\d{2})\b/)
  if (isoDate?.[1]) return isoDate[1].trim()

  const reversedDate = text.match(/\b(\d{2}[.\-_]\d{2}[.\-_]20\d{2})\b/)
  if (reversedDate?.[1]) return reversedDate[1].trim()

  return text
}

export function isKnownUnknownVersion(value?: string | null): boolean {
  const text = String(value || '').trim().toLowerCase()
  return !text || text === 'unknown' || text === 'n/a' || text === 'na' || text === '-'
}
