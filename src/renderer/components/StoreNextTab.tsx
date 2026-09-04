import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownAZ,
  CalendarDays,
  Check,
  Download,
  ExternalLink,
  Heart,
  Languages,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react'
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

type LibraryGame = {
  id?: string | number
  url?: string
  title?: string
  image_url?: string
  install_path?: string
  installed_version?: string
  latest_version?: string
  install_date?: string
  update_date?: string
}

type StoreNextTabProps = {
  onOpenInClassicStore: (url: string) => void
}

type StoreFilter = 'all' | 'installed' | 'updates' | 'favorites'
type StoreSort = 'recent' | 'name'

const FAVORITES_STORAGE_KEY = 'voidlauncher.storeFavorites'

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
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [library, setLibrary] = useState<Record<string, LibraryEntry>>({})
  const [libraryItems, setLibraryItems] = useState<StoreItem[]>([])
  const [selected, setSelected] = useState<StoreItem | null>(null)
  const [brokenCovers, setBrokenCovers] = useState<Record<string, true>>({})
  const [filter, setFilter] = useState<StoreFilter>('all')
  const [sort, setSort] = useState<StoreSort>('recent')
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const requestIdRef = useRef(0)
  const activeQueryRef = useRef('')

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      const res = await window.electronAPI.getGames()
      if (!res?.success || !Array.isArray(res.games)) return
      const map: Record<string, LibraryEntry> = {}
      const localItems: StoreItem[] = []
      for (const game of res.games as LibraryGame[]) {
        if (!game?.url) continue
        const url = String(game.url)
        const installed = Boolean(game.install_path || game.installed_version)
        map[storeUrlKey(url)] = {
          installed,
          hasUpdate: Boolean(
            game.latest_version && game.installed_version && game.latest_version !== game.installed_version
          )
        }

        if (installed) {
          localItems.push({
            id: `library-${game.id ?? storeUrlKey(url)}`,
            url,
            title: String(game.title || '').trim() || t('storeNext.card.untitled'),
            imageUrl: toRendererStoreImageUrl(game.image_url),
            publishedAt: game.install_date || undefined,
            updatedAt: game.update_date || undefined
          })
        }
      }
      setLibrary(map)
      setLibraryItems(localItems)
    } catch {
      // The catalog remains usable even when the local library cannot be read.
    } finally {
      setLibraryLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (event.key !== '/' || isTyping || selected) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [selected])

  const load = useCallback(async (targetPage: number, searchQuery: string, options?: { append?: boolean; force?: boolean }) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    if (!options?.append && targetPage === 1 && searchQuery !== activeQueryRef.current) {
      activeQueryRef.current = searchQuery
      setItems([])
      setHasMore(false)
      setPage(1)
      setSourceUrl('')
    }

    try {
      const res = await window.electronAPI.storeListing({
        page: targetPage,
        query: searchQuery || undefined,
        force: options?.force
      })

      if (requestId !== requestIdRef.current) return

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
      if (requestId !== requestIdRef.current) return
      setError(err?.message || t('storeNext.error.generic'))
      if (!options?.append) setItems([])
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [t])

  useEffect(() => {
    if (filter === 'all') {
      load(1, query)
      return
    }

    // Installed, updates and favorites are local views. Invalidate any remote
    // request still in flight and never paginate the site to fill these grids.
    requestIdRef.current += 1
    setLoading(false)
    setError(null)
  }, [filter, load, query])
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const nextQuery = queryInput.trim()
    if (nextQuery === query && filter === 'all') load(1, nextQuery)
    else setQuery(nextQuery)
  }

  const clearSearch = () => {
    setQueryInput('')
    if (query) setQuery('')
    else searchInputRef.current?.focus()
  }

  const openDetails = (item: StoreItem) => setSelected(item)

  const captureFixture = async () => {
    if (!sourceUrl) return
    const res = await window.electronAPI.storeCaptureFixture(sourceUrl, query ? `search-${query}` : `listing-page-${page}`)
    if (res?.success) toast.success(t('storeNext.capture.saved'), res.path)
    else toast.error(t('storeNext.capture.failed'), res?.error || undefined)
  }

  const toggleFavorite = (item: StoreItem) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(item.url)) next.delete(item.url)
      else next.add(item.url)
      writeFavorites(next)
      return next
    })
  }

  const libraryEntryFor = (item: StoreItem) => library[storeUrlKey(item.url)]

  const refresh = () => {
    if (filter === 'all') load(1, query, { force: true })
    else loadLibrary()
  }

  const badgeFor = (item: StoreItem) => {
    const entry = libraryEntryFor(item)
    if (!entry) return null
    if (entry.hasUpdate) return <span className="store-next-badge update"><RefreshCw size={10} />{t('storeNext.card.update')}</span>
    if (entry.installed) return <span className="store-next-badge installed"><Check size={10} />{t('storeNext.card.installed')}</span>
    return null
  }

  const visibleItems = useMemo(() => {
    const listingByUrl = new Map(items.map((item) => [storeUrlKey(item.url), item]))
    const installedItems = libraryItems.map((item) => {
      const listingItem = listingByUrl.get(storeUrlKey(item.url))
      return listingItem ? { ...item, ...listingItem, id: item.id } : item
    })
    const source = filter === 'installed' || filter === 'updates' ? installedItems : items
    const normalizedQuery = query.toLocaleLowerCase()

    const filtered = source.filter((item) => {
      const entry = library[storeUrlKey(item.url)]
      if (filter === 'installed') return Boolean(entry?.installed)
      if (filter === 'updates') return Boolean(entry?.hasUpdate)
      if (filter === 'favorites') return favorites.has(item.url)
      return true
    }).filter((item) => filter === 'all' || !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery))

    if (sort === 'name') {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    }
    return filtered
  }, [favorites, filter, items, library, libraryItems, query, sort])

  const filterCounts = useMemo(() => ({
    all: items.length,
    installed: libraryItems.length,
    updates: libraryItems.filter((item) => library[storeUrlKey(item.url)]?.hasUpdate).length,
    favorites: items.filter((item) => favorites.has(item.url)).length
  }), [favorites, items, library, libraryItems])

  const showEmpty = filter === 'all' && !loading && !error && items.length === 0
  const showFilteredEmpty = filter !== 'all' && !loading && !libraryLoading && !error && visibleItems.length === 0
  const initialLoading = filter === 'all' && loading && items.length === 0

  return (
    <main className="store-next" aria-busy={loading || libraryLoading}>
      <section className="store-next-discovery" aria-labelledby="store-next-title">
        <div className="store-next-heading">
          <span className="store-next-eyebrow"><Sparkles size={13} aria-hidden="true" />{t('storeNext.hero.eyebrow')}</span>
          <h3 id="store-next-title">{t('storeNext.hero.title')}</h3>
          <p>{t('storeNext.hero.description')}</p>
        </div>

        <div className="store-next-actions">
          <button
            className="store-next-icon-button"
            onClick={refresh}
            disabled={loading || libraryLoading}
            title={t('storeNext.refresh')}
            aria-label={t('storeNext.refresh')}
          >
            <RefreshCw size={17} className={loading || libraryLoading ? 'of-spin' : ''} aria-hidden="true" />
          </button>
          {import.meta.env.DEV && (
            <button className="settings-btn ghost sm" onClick={captureFixture} disabled={!sourceUrl || loading}>
              <Download size={14} aria-hidden="true" />
              {t('storeNext.capture.button')}
            </button>
          )}
        </div>

        <form className="store-next-search" onSubmit={submitSearch} role="search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={t('storeNext.searchPlaceholder')}
            aria-label={t('storeNext.searchPlaceholder')}
            aria-keyshortcuts="/"
          />
          {queryInput && (
            <button type="button" className="store-next-search-clear" onClick={clearSearch} aria-label={t('storeNext.searchClear')}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
          {!queryInput && <kbd aria-hidden="true">/</kbd>}
          <button type="submit" className="settings-btn primary" disabled={loading && initialLoading}>
            {loading && initialLoading ? <Loader2 size={15} className="of-spin" aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
            {t('storeNext.search')}
          </button>
        </form>
      </section>

      <div className="store-next-controls">
        <div className="store-next-filter-wrap">
          <span className="store-next-controls-label"><SlidersHorizontal size={13} aria-hidden="true" />{t('storeNext.filter.label')}</span>
          <div className="store-next-filters" role="group" aria-label={t('storeNext.filter.label')}>
            {(['all', 'installed', 'updates', 'favorites'] as StoreFilter[]).map((value) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {t(`storeNext.filter.${value}`)}
                <span>{filterCounts[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="store-next-sort">
          <ArrowDownAZ size={14} aria-hidden="true" />
          <span>{t('storeNext.sort.label')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as StoreSort)}>
            <option value="recent">{t('storeNext.sort.recent')}</option>
            <option value="name">{t('storeNext.sort.name')}</option>
          </select>
        </label>
      </div>

      {!initialLoading && !error && (filter === 'all' ? items.length > 0 : visibleItems.length > 0) && (
        <div className="store-next-results" role="status" aria-live="polite">
          <span>
            {query
              ? t('storeNext.results.query', { count: String(visibleItems.length), query })
              : t('storeNext.results.loaded', { count: String(visibleItems.length) })}
          </span>
          {filter === 'all' && hasMore && <small>{t('storeNext.results.more')}</small>}
        </div>
      )}

      {error && (
        <div className="store-next-notice error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{t('storeNext.error.title')}</strong>
            <span>{error}</span>
          </div>
          <div className="store-next-notice-actions">
            <button className="settings-btn primary sm" onClick={() => load(1, query, { force: true })}>
              <RotateCcw size={14} aria-hidden="true" />
              {t('storeNext.retry')}
            </button>
            <button className="settings-btn secondary sm" onClick={() => onOpenInClassicStore(sourceUrl || '')}>
              <ExternalLink size={14} aria-hidden="true" />
              {t('storeNext.openClassic')}
            </button>
          </div>
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

      {showFilteredEmpty && (
        <div className="store-next-empty">
          <div className="store-next-empty-icon"><Search size={22} aria-hidden="true" /></div>
          <strong>{t('storeNext.emptyFiltered.title')}</strong>
          <p>{t('storeNext.emptyFiltered.description')}</p>
          <button className="settings-btn secondary sm" onClick={() => { setFilter('all'); setQueryInput(''); setQuery('') }}>
            <RotateCcw size={13} aria-hidden="true" />
            {t('storeNext.emptyFiltered.clear')}
          </button>
        </div>
      )}

      <div className="store-next-grid" aria-live="polite">
        {initialLoading && Array.from({ length: 10 }, (_, index) => <StoreCardSkeleton key={index} />)}
        {visibleItems.map((item) => (
          <article key={item.id} className="store-next-card">
            <button
              className="store-next-cover"
              onClick={() => openDetails(item)}
              title={t('storeNext.card.details')}
              aria-label={t('storeNext.card.open', { title: item.title })}
            >
              {item.imageUrl && !brokenCovers[item.id]
                ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setBrokenCovers((current) => ({ ...current, [item.id]: true }))}
                  />
                )
                : <div className="store-next-cover-placeholder">{item.title.slice(0, 1)}</div>}
              {badgeFor(item)}
            </button>

            <button
              className={`store-next-favorite ${favorites.has(item.url) ? 'active' : ''}`}
              onClick={() => toggleFavorite(item)}
              aria-pressed={favorites.has(item.url)}
              aria-label={favorites.has(item.url)
                ? t('storeNext.favorite.remove', { title: item.title })
                : t('storeNext.favorite.add', { title: item.title })}
              title={favorites.has(item.url) ? t('storeNext.favorite.removeShort') : t('storeNext.favorite.addShort')}
            >
              <Heart size={15} fill={favorites.has(item.url) ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>

            <div className="store-next-info">
              <button className="store-next-card-title" onClick={() => openDetails(item)} title={item.title}>
                {item.title}
              </button>
              <div className="store-next-meta">
                <CalendarDays size={12} aria-hidden="true" />
                {item.updatedAt
                  ? <span title={item.updatedAt}>{item.updatedAt}</span>
                  : item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
              </div>
              <div className="store-next-card-actions">
                <button className="settings-btn secondary sm store-next-details-button" onClick={() => openDetails(item)}>
                  {t('storeNext.card.details')}
                </button>
                <button
                  className="store-next-card-external"
                  onClick={() => onOpenInClassicStore(item.url)}
                  aria-label={t('storeNext.card.classic', { title: item.title })}
                  title={t('storeNext.openClassic')}
                >
                  <ExternalLink size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {loading && !initialLoading && (
        <div className="store-next-loading">
          <Loader2 size={18} className="of-spin" aria-hidden="true" />
          {t('storeNext.loading')}
        </div>
      )}

      {selected && (
        <StoreGameDialog
          item={selected}
          libraryEntry={libraryEntryFor(selected)}
          onClose={() => setSelected(null)}
          onOpenInClassicStore={onOpenInClassicStore}
        />
      )}

      {filter === 'all' && hasMore && !loading && (
        <div className="store-next-more">
          <button className="settings-btn secondary" onClick={() => load(page + 1, query, { append: true })}>
            <Download size={15} aria-hidden="true" />
            {t('storeNext.loadMore')}
          </button>
        </div>
      )}
    </main>
  )
}

function StoreCardSkeleton() {
  return (
    <div className="store-next-card store-next-card-skeleton" aria-hidden="true">
      <div className="store-next-skeleton-cover" />
      <div className="store-next-skeleton-info">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

function readFavorites(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]))
  } catch {
    // Favorites remain available for this session when storage is unavailable.
  }
}

function storeUrlKey(value: string): string {
  const raw = value.trim()
  try {
    const url = new URL(raw)
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().toLocaleLowerCase()
  } catch {
    return raw.replace(/\/+$/, '').toLocaleLowerCase()
  }
}

function toRendererStoreImageUrl(value?: string): string | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    if (url.protocol === 'ofimg:' || !/(^|\.)online-fix\.me$/i.test(url.hostname)) return raw

    const bytes = new TextEncoder().encode(raw)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    return `ofimg://i/${encoded}`
  } catch {
    return raw
  }
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
  instructions?: string[]
  description?: string
}

type StoreGameMetadata = {
  source: 'steam' | 'none'
  steamAppId?: string
  name?: string
  description?: string
  headerImage?: string
  backgroundImage?: string
  screenshots?: string[]
  genres?: string[]
  categories?: string[]
  developers?: string[]
  publishers?: string[]
  releaseDate?: string
}

/**
 * The game page, composed rather than mirrored.
 *
 * The site supplies what only it has — the version, the torrent and the
 * instructions for the fix. Everything that makes a page worth looking at —
 * artwork, description, screenshots, genres — comes from Steam, matched by
 * title. When there is no match the page still works, just plainer.
 */
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
  const { t, language } = useI18n()
  const toast = useToast()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [details, setDetails] = useState<StoreGameDetails | null>(null)
  const [metadata, setMetadata] = useState<StoreGameMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [translatedInstructions, setTranslatedInstructions] = useState<string[] | null>(null)
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'loading' | 'translated' | 'error'>('idle')
  const [translationRetryKey, setTranslationRetryKey] = useState(0)

  useEffect(() => {
    let disposed = false

    setLoading(true)
    setError(null)

    window.electronAPI.storeGame(item.url, reloadKey > 0).then((res) => {
      if (disposed) return
      if (!res?.success || !res.game) setError(ipcErrorText(t, res, t('storeNext.error.details')))
      else setDetails(res.game)
    }).catch((err: any) => {
      if (!disposed) setError(err?.message || t('storeNext.error.details'))
    }).finally(() => {
      if (!disposed) setLoading(false)
    })

    // Independent of the page read: a slow Steam lookup must not hold the page.
    window.electronAPI.storeGameMetadata(item.url, item.title).then((res) => {
      if (!disposed && res?.success && res.metadata) setMetadata(res.metadata)
    }).catch(() => {})

    return () => { disposed = true }
  }, [item.url, item.title, reloadKey, t])

  useEffect(() => {
    const instructions = details?.instructions
    if (!instructions?.length) {
      setTranslatedInstructions(null)
      setTranslationStatus('idle')
      return
    }

    let disposed = false
    setTranslatedInstructions(null)
    setTranslationStatus('loading')

    window.electronAPI.storeTranslateInstructions(item.url, instructions, language, translationRetryKey > 0).then((res) => {
      if (disposed) return
      if (res?.success && res.translated && Array.isArray(res.instructions) && res.instructions.length > 0) {
        setTranslatedInstructions(res.instructions)
        setTranslationStatus('translated')
      } else if (res?.success) {
        setTranslationStatus('idle')
      } else {
        setTranslationStatus('error')
      }
    }).catch(() => {
      if (!disposed) setTranslationStatus('error')
    })

    return () => { disposed = true }
  }, [details?.instructions, item.url, language, translationRetryKey])

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

  const hero = metadata?.headerImage || item.imageUrl || details?.imageUrl
  const description = metadata?.description || details?.description
  const instructions = translatedInstructions || details?.instructions || []
  const release = metadata?.releaseDate || details?.releaseDate || (item.publishedAt ? formatDate(item.publishedAt) : undefined)
  const facts: Array<[string, string]> = [
    [t('storeNext.detail.version'), loading ? '…' : details?.version || t('storeNext.card.noVersion')],
    ...(release ? [[t('storeNext.detail.release'), release] as [string, string]] : []),
    ...(item.updatedAt ? [[t('storeNext.detail.updated'), item.updatedAt] as [string, string]] : []),
    ...(metadata?.developers?.length ? [[t('storeNext.detail.developer'), metadata.developers.join(', ')] as [string, string]] : []),
    ...(libraryEntry?.installed
      ? [[t('storeNext.detail.library'), libraryEntry.hasUpdate ? t('storeNext.card.update') : t('storeNext.card.installed')] as [string, string]]
      : [])
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal store-next-detail"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-next-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="store-next-hero" style={hero ? { backgroundImage: `url("${hero}")` } : undefined}>
          <div className="store-next-hero-shade">
            {libraryEntry?.hasUpdate && <span className="store-next-detail-status"><RefreshCw size={11} />{t('storeNext.detail.updateAvailable')}</span>}
            <h3 id="store-next-detail-title">{metadata?.name || item.title}</h3>
            {metadata?.genres && metadata.genres.length > 0 && (
              <div className="store-next-chips">
                {metadata.genres.map((genre) => <span key={genre}>{genre}</span>)}
              </div>
            )}
          </div>
          <button className="settings-btn-icon store-next-close" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="store-next-detail-body">
          {loading && !details && (
            <div className="store-next-detail-loading" role="status">
              <Loader2 size={16} className="of-spin" aria-hidden="true" />
              {t('storeNext.detail.loading')}
            </div>
          )}

          {description && <p className="store-next-detail-description">{description}</p>}

          <dl className="store-next-detail-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {metadata?.screenshots && metadata.screenshots.length > 0 && (
            <section className="store-next-gallery" aria-labelledby="store-next-gallery-title">
              <h4 id="store-next-gallery-title">{t('storeNext.detail.gallery')}</h4>
              <div className="store-next-shots">
              {metadata.screenshots.slice(0, 6).map((shot) => (
                  <img key={shot} src={shot} alt={t('storeNext.detail.screenshot', { title: item.title })} loading="lazy" decoding="async" />
              ))}
              </div>
            </section>
          )}

          {details?.instructions && details.instructions.length > 0 && (
            <div className="store-next-instructions">
              <button
                className="settings-btn ghost sm"
                onClick={() => setShowInstructions((current) => !current)}
                aria-expanded={showInstructions}
              >
                {translationStatus === 'loading'
                  ? <Loader2 size={13} className="of-spin" aria-hidden="true" />
                  : <Languages size={13} aria-hidden="true" />}
                {t('storeNext.detail.howTo')}
              </button>
              {showInstructions && (
                <>
                  {translationStatus === 'loading' && (
                    <div className="store-next-translation-status" role="status">
                      <Loader2 size={13} className="of-spin" aria-hidden="true" />
                      {t('storeNext.detail.translatingInstructions')}
                    </div>
                  )}
                  <ol>
                    {instructions.map((step, index) => <li key={index}>{step}</li>)}
                  </ol>
                  <p className="store-next-source">
                    {translationStatus === 'translated'
                      ? t('storeNext.detail.instructionsTranslatedSource')
                      : t('storeNext.detail.instructionsSource')}
                  </p>
                  {translationStatus === 'error' && (
                    <div className="store-next-translation-error" role="status">
                      <span>{t('storeNext.detail.instructionsTranslationFailed')}</span>
                      <button className="settings-btn ghost sm" onClick={() => setTranslationRetryKey((current) => current + 1)}>
                        <RotateCcw size={12} aria-hidden="true" />
                        {t('storeNext.detail.retryTranslation')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="store-next-notice error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
              <button className="settings-btn secondary sm" onClick={() => setReloadKey((current) => current + 1)}>
                <RotateCcw size={13} aria-hidden="true" />
                {t('storeNext.retry')}
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer store-next-detail-actions">
          <button
            className="settings-btn primary"
            onClick={startDownload}
            disabled={loading || downloading || !details?.torrentUrl}
            title={!loading && !details?.torrentUrl ? t('storeNext.detail.noTorrent') : undefined}
          >
            {downloading ? <Loader2 size={15} className="of-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {downloading
              ? t('storeNext.detail.downloading')
              : libraryEntry?.hasUpdate ? t('storeNext.detail.update') : t('storeNext.detail.download')}
          </button>

          {details?.directUrl && (
            <button className="settings-btn secondary" onClick={() => window.electronAPI.openExternal(details.directUrl!)}>
              <ExternalLink size={15} aria-hidden="true" />
              {t('storeNext.detail.directDownload')}
            </button>
          )}

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
