import { Readable } from 'stream'

/**
 * Minimal gaxios-compatible transport for the googleapis client.
 *
 * `googleapis` hands the auth client a request description and expects it to be
 * honoured in full: query parameters live in `params` (never in `url`), the body
 * lives in `data` (a string, a Buffer or a stream for media uploads), and the
 * caller may ask for a specific `responseType`. Anything the transport drops is
 * silently missing from the request — an adapter that only forwards the URL
 * turns `files.get({ alt: 'media' })` into a metadata read, and an upload into
 * an empty file.
 */

export type DriveRequestOptions = {
  url: string
  method?: string
  params?: Record<string, unknown>
  paramsSerializer?: (params: Record<string, unknown>) => string
  data?: unknown
  headers?: Record<string, unknown> | Headers
  responseType?: string
}

export type DriveResponse<T = any> = {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  config: DriveRequestOptions
}

export class DriveRequestError extends Error {
  status: number
  code: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'DriveRequestError'
    this.status = status
    this.code = status
    this.details = details
  }
}

export function buildRequestUrl(opts: DriveRequestOptions): string {
  const params = opts.params || {}
  const query = opts.paramsSerializer
    ? opts.paramsSerializer(params)
    : new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)])
      ).toString()

  if (!query) return opts.url
  return `${opts.url}${opts.url.includes('?') ? '&' : '?'}${query}`
}

function isNodeStream(value: any): value is Readable {
  return !!value && typeof value === 'object' && typeof value.pipe === 'function'
}

function buildRequestBody(opts: DriveRequestOptions): {
  body?: BodyInit
  duplex?: 'half'
  contentType?: string
} {
  const data = opts.data

  if (data === undefined || data === null) return {}
  if (typeof data === 'string' || Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return { body: data as BodyInit }
  }

  // Media uploads arrive as a Node stream; fetch only takes web streams, and
  // only with an explicit half-duplex opt-in.
  if (isNodeStream(data)) {
    return { body: Readable.toWeb(data) as unknown as BodyInit, duplex: 'half' }
  }

  return { body: JSON.stringify(data), contentType: 'application/json' }
}

function normalizeHeaders(raw: DriveRequestOptions['headers']): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!raw) return headers

  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null) return
    // googleapis asks for gzip; let fetch negotiate and decode it instead.
    if (key.toLowerCase() === 'accept-encoding') return
    headers[key] = String(value)
  }

  if (typeof Headers !== 'undefined' && raw instanceof Headers) {
    raw.forEach((value, key) => put(key, value))
  } else {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) put(key, value)
  }

  return headers
}

async function readResponseBody(response: Response, responseType?: string): Promise<any> {
  if (responseType === 'stream') {
    if (!response.body) return Readable.from([])
    return Readable.fromWeb(response.body as any)
  }

  if (responseType === 'arraybuffer') return Buffer.from(await response.arrayBuffer())
  if (responseType === 'text') return await response.text()

  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function errorFromResponse(response: Response): Promise<DriveRequestError> {
  let details: unknown
  let message = `${response.status} ${response.statusText}`.trim()

  try {
    const text = await response.text()
    if (text) {
      try {
        details = JSON.parse(text)
        const apiMessage =
          (details as any)?.error?.message ||
          (details as any)?.error_description ||
          (typeof (details as any)?.error === 'string' ? (details as any).error : null)
        if (apiMessage) message = `${message}: ${apiMessage}`
      } catch {
        details = text
        message = `${message}: ${text.slice(0, 300)}`
      }
    }
  } catch {
    // Keep the status-only message.
  }

  return new DriveRequestError(message, response.status, details)
}

export async function driveRequest<T = any>(
  opts: DriveRequestOptions,
  getAccessToken: () => Promise<string | null | undefined>
): Promise<DriveResponse<T>> {
  const accessToken = await getAccessToken()
  const { body, duplex, contentType } = buildRequestBody(opts)
  const headers = normalizeHeaders(opts.headers)

  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (contentType && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = contentType
  }

  const response = await fetch(buildRequestUrl(opts), {
    method: (opts.method || 'GET').toUpperCase(),
    headers,
    body,
    ...(duplex ? { duplex } : {})
  } as RequestInit)

  if (!response.ok) throw await errorFromResponse(response)

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })

  return {
    data: (await readResponseBody(response, opts.responseType)) as T,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    config: opts
  }
}
