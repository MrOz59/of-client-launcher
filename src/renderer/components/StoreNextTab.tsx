import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Download, ExternalLink, Loader2, PlayCircle, RefreshCw, Search, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useToast } from './ToastHost'
import { ipcErrorText } from '../../shared/ipcErrors'
import { useModalA11y } from '../hooks/useModalA11y'

/**
 * Native store (work in progress).
 *
 * Reads the same pages as the classic tab, but through the store session in the
 * main process, and renders the result as our own grid. The classic webview
 * stays untouched: anything this screen cannot model yet — download flow,
 * comments, login — is handed over to it.
 */

type StoreItem = {
  id: string
  url: string
  title: string
  imageUrl?: string
  publishedAt?: string
  updatedAt?: string
}

type LibraryEntry = {
  installed: boolean
  hasUpdate: boolean
}

type StoreNextTabProps = {
  onOpenInClassicStore: (url: string) => void
}

export default function StoreNextTab({ onOpenInClassicStore }: StoreNextTabProps) {
  const { t } = useI18n()
  const toast = useToast()

  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<StoreItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [library, setLibrary] = useState<Record<string, LibraryEntry>>({})
  const [selected, setSelected] = useState<StoreItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  useEffect(() => {
    let disposed = false

    window.electronAPI.getGames().then((res) => {
      if (disposed || !res?.success || !Array.isArray(res.games)) return
      const map: Record<string, LibraryEntry> = {}
      for (const game of res.games) {
        if (!game?.url) continue
        map[String(game.url)] = {
          installed: Boolean(game.install_path || game.installed_version),
          hasUpdate: Boolean(
            game.latest_version && game.installed_version && game.latest_version !== game.installed_version
          )
        }
      }
      setLibrary(map)
    }).catch(() => {})

    return () => { disposed = true }
  }, [])

  const load = useCallback(async (targetPage: number, searchQuery: string, options?: { append?: boolean; force?: boolean }) => {
    setLoading(true)
    setError(null)

    try {
      const res = await window.electronAPI.storeListing({
        page: targetPage,
        query: searchQuery || undefined,
        force: options?.force
      })

      if (!res?.success || !res.listing) {
        setError(ipcErrorText(t, res, t('storeNext.error.generic')))
        if (!options?.append) setItems([])
        return
      }

      const listing = res.listing
      setItems((current) => (options?.append ? dedupe([...current, ...listing.items]) : listing.items))
      setHasMore(Boolean(listing.nextPageUrl))
      setSourceUrl(listing.sourceUrl)
      setPage(listing.page)
    } catch (err: any) {
      setError(err?.message || t('storeNext.error.generic'))
      if (!options?.append) setItems([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load(1, query)
  }, [load, query])

  // The site paginates every ~20 games; the grid stitches those pages together
  // as the user scrolls, one request at a time so the site is never hammered.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return
        load(page + 1, query, { append: true })
      },
      { rootMargin: '500px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, page, query, load])

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setQuery(queryInput.trim())
  }

  const openDetails = (item: StoreItem) => setSelected(item)

  const captureFixture = async () => {
    if (!sourceUrl) return
    const res = await window.electronAPI.storeCaptureFixture(sourceUrl, query ? `search-${query}` : `listing-page-${page}`)
    if (res?.success) toast.success(t('storeNext.capture.saved'), res.path)
    else toast.error(t('storeNext.capture.failed'), res?.error || undefined)
  }

  const badgeFor = (item: StoreItem) => {
    const entry = library[item.url]
    if (!entry) return null
    if (entry.hasUpdate) return <span className="store-next-badge update">{t('storeNext.card.update')}</span>
    if (entry.installed) return <span className="store-next-badge installed">{t('storeNext.card.installed')}</span>
    return null
  }

  const showEmpty = !loading && !error && items.length === 0

  return (
    <div className="store-next">
      <div className="store-next-toolbar">
        <form className="store-next-search" onSubmit={submitSearch}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={t('storeNext.searchPlaceholder')}
            aria-label={t('storeNext.searchPlaceholder')}
          />
          <button type="submit" className="settings-btn secondary sm" disabled={loading}>
            {t('storeNext.search')}
          </button>
        </form>

        <div className="store-next-actions">
          <button
            className="settings-btn ghost sm"
            onClick={() => load(page, query, { force: true })}
            disabled={loading}
            title={t('storeNext.refresh')}
            aria-label={t('storeNext.refresh')}
          >
            <RefreshCw size={14} className={loading ? 'of-spin' : ''} aria-hidden="true" />
          </button>
          <button className="settings-btn ghost sm" onClick={captureFixture} disabled={!sourceUrl || loading}>
            <Download size={14} aria-hidden="true" />
            {t('storeNext.capture.button')}
          </button>
        </div>
      </div>

      {error && (
        <div className="store-next-notice error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{t('storeNext.error.title')}</strong>
            <span>{error}</span>
          </div>
          <button className="settings-btn secondary sm" onClick={() => onOpenInClassicStore(sourceUrl || '')}>
            <ExternalLink size={14} aria-hidden="true" />
            {t('storeNext.openClassic')}
          </button>
        </div>
      )}

      {showEmpty && (
        <div className="store-next-notice">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{t('storeNext.empty.title')}</strong>
            <span>{t('storeNext.empty.description')}</span>
          </div>
          <button className="settings-btn secondary sm" onClick={() => onOpenInClassicStore(sourceUrl || '')}>
            <ExternalLink size={14} aria-hidden="true" />
            {t('storeNext.openClassic')}
          </button>
        </div>
      )}

      <div className="store-next-grid">
        {items.map((item) => (
          <article key={item.id} className="store-next-card">
            <button
              className="store-next-cover"
              onClick={() => openDetails(item)}
              title={t('storeNext.card.details')}
              aria-label={t('storeNext.card.open', { title: item.title })}
            >
              {item.imageUrl
                ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                : <div className="store-next-cover-placeholder">{item.title.slice(0, 1)}</div>}
              {badgeFor(item)}
            </button>

            <div className="store-next-info">
              <h3 title={item.title}>{item.title}</h3>
              <div className="store-next-meta">
                {item.updatedAt
                  ? <span title={item.updatedAt}>{item.updatedAt}</span>
                  : item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
              </div>
              <div className="store-next-card-actions">
                <button className="settings-btn ghost sm" onClick={() => openDetails(item)}>
                  {t('storeNext.card.details')}
                </button>
                <button className="settings-btn secondary sm" onClick={() => onOpenInClassicStore(item.url)}>
                  <ExternalLink size={13} aria-hidden="true" />
                  {t('storeNext.card.openShort')}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {loading && (
        <div className="store-next-loading">
          <Loader2 size={18} className="of-spin" aria-hidden="true" />
          {t('storeNext.loading')}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden="true" />

      {selected && (
        <StoreGameDialog
          item={selected}
          libraryEntry={library[selected.url]}
          onClose={() => setSelected(null)}
          onOpenInClassicStore={onOpenInClassicStore}
        />
      )}

      {hasMore && !loading && (
        <div className="store-next-more">
          <button className="settings-btn secondary" onClick={() => load(page + 1, query, { append: true })}>
            {t('storeNext.loadMore')}
          </button>
        </div>
      )}
    </div>
  )
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString()
}

function dedupe(items: StoreItem[]): StoreItem[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

type StoreGameDetails = {
  url: string
  title: string
  version?: string
  imageUrl?: string
  videoUrl?: string
  releaseDate?: string
  torrentUrl?: string
  directUrl?: string
  description?: string
}

/** Detail view: reads the game page and offers the existing download flow. */
function StoreGameDialog({
  item,
  libraryEntry,
  onClose,
  onOpenInClassicStore
}: {
  item: StoreItem
  libraryEntry?: LibraryEntry
  onClose: () => void
  onOpenInClassicStore: (url: string) => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [details, setDetails] = useState<StoreGameDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let disposed = false

    window.electronAPI.storeGame(item.url).then((res) => {
      if (disposed) return
      if (!res?.success || !res.game) {
        setError(ipcErrorText(t, res, t('storeNext.error.details')))
      } else {
        setDetails(res.game)
      }
    }).catch((err: any) => {
      if (!disposed) setError(err?.message || t('storeNext.error.details'))
    }).finally(() => {
      if (!disposed) setLoading(false)
    })

    return () => { disposed = true }
  }, [item.url, t])

  const startDownload = async () => {
    if (!details?.torrentUrl) return
    setDownloading(true)
    try {
      const res = await window.electronAPI.startTorrentDownload(details.torrentUrl, item.url)
      if (res?.success) {
        toast.success(t('storeNext.detail.downloadStarted', { title: item.title }))
        onClose()
      } else {
        toast.error(t('storeNext.detail.downloadFailed'), ipcErrorText(t, res as any) || undefined)
      }
    } catch (err: any) {
      toast.error(t('storeNext.detail.downloadFailed'), err?.message || undefined)
    } finally {
      setDownloading(false)
    }
  }

  // The article carries no poster, only a trailer, so the cover comes from the listing.
  const cover = item.imageUrl || details?.imageUrl

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal store-next-detail"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{item.title}</h3>
          <button className="settings-btn-icon" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="store-next-detail-body">
          {cover && <img className="store-next-detail-cover" src={cover} alt="" />}

          <dl className="store-next-detail-facts">
            <div>
              <dt>{t('storeNext.detail.version')}</dt>
              <dd>{loading ? '…' : details?.version || t('storeNext.card.noVersion')}</dd>
            </div>
            {(details?.releaseDate || item.publishedAt) && (
              <div>
                <dt>{t('storeNext.detail.release')}</dt>
                <dd>{details?.releaseDate || formatDate(item.publishedAt || '')}</dd>
              </div>
            )}
            {item.updatedAt && (
              <div>
                <dt>{t('storeNext.detail.updated')}</dt>
                <dd>{item.updatedAt}</dd>
              </div>
            )}
            {libraryEntry?.installed && (
              <div>
                <dt>{t('storeNext.detail.library')}</dt>
                <dd>{libraryEntry.hasUpdate ? t('storeNext.card.update') : t('storeNext.card.installed')}</dd>
              </div>
            )}
          </dl>

          {error && <div className="store-next-notice error" role="alert"><AlertCircle size={15} aria-hidden="true" /><span>{error}</span></div>}
        </div>

        <div className="modal-footer store-next-detail-actions">
          <button
            className="settings-btn primary"
            onClick={startDownload}
            disabled={loading || downloading || !details?.torrentUrl}
            title={!loading && !details?.torrentUrl ? t('storeNext.detail.noTorrent') : undefined}
          >
            {downloading ? <Loader2 size={15} className="of-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {downloading ? t('storeNext.detail.downloading') : t('storeNext.detail.download')}
          </button>

          {details?.videoUrl && (
            <button className="settings-btn ghost" onClick={() => window.electronAPI.openExternal(details.videoUrl!)}>
              <PlayCircle size={15} aria-hidden="true" />
              {t('storeNext.detail.trailer')}
            </button>
          )}

          <button className="settings-btn secondary" onClick={() => { onClose(); onOpenInClassicStore(item.url) }}>
            <ExternalLink size={15} aria-hidden="true" />
            {t('storeNext.openClassic')}
          </button>
        </div>
      </div>
    </div>
  )
}
