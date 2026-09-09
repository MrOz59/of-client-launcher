import React, { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, BookOpen, Check, ChevronLeft, ChevronRight, Download, Images, Languages, Loader2, PlayCircle, RotateCcw, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useToast } from './ToastHost'
import { ipcErrorText } from '../../shared/ipcErrors'
import { useModalA11y } from '../hooks/useModalA11y'
import type { StoreItem, LibraryEntry } from './StoreNextTab'

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
  unavailableNotice?: string
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
  trailer?: { name?: string; thumbnail?: string; hls?: string; webm?: string; mp4?: string }
}

/**
 * What the gallery shows. The trailer comes first: it is the one thing on this
 * screen the player has not seen yet.
 */
type GalleryItem =
  | { kind: 'trailer'; label: string; poster?: string; hls?: string; webm?: string; mp4?: string }
  | { kind: 'screenshot'; url: string }

/**
 * The game page, composed rather than mirrored.
 *
 * The site supplies what only it has — the version, the torrent and the
 * instructions for the fix. Everything that makes a page worth looking at —
 * artwork, description, screenshots, genres — comes from Steam, matched by
 * title. When there is no match the page still works, just plainer.
 */
export default function StoreGameDialog({
  item,
  libraryEntry,
  onClose
}: {
  item: StoreItem
  libraryEntry?: LibraryEntry
  onClose: () => void
}) {
  const { t, language } = useI18n()
  const toast = useToast()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [details, setDetails] = useState<StoreGameDetails | null>(null)
  const [metadata, setMetadata] = useState<StoreGameMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [showOriginal, setShowOriginal] = useState(false)
  const [selectedShot, setSelectedShot] = useState(0)
  const [brokenShots, setBrokenShots] = useState<Set<string>>(() => new Set())
  const bodyRef = useRef<HTMLDivElement | null>(null)
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
      if (res?.success && res.translated && Array.isArray(res.instructions) && res.instructions.length === instructions.length) {
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

  // The site retires a guide by adding a line to the page, not by taking the
  // article or its download buttons down: say so before anyone downloads it.
  const unavailableNotice = details?.unavailableNotice
  const hero = metadata?.backgroundImage || metadata?.headerImage || item.imageUrl || details?.imageUrl
  const description = metadata?.description || details?.description
  const instructions = (!showOriginal && translatedInstructions) || details?.instructions || []
  const screenshots = (metadata?.screenshots || []).filter((shot) => !brokenShots.has(shot)).slice(0, 6)
  const trailer = metadata?.trailer
  const gallery: GalleryItem[] = [
    ...(trailer?.hls || trailer?.webm || trailer?.mp4
      ? [{
          kind: 'trailer' as const,
          label: trailer.name || t('storeNext.detail.trailer'),
          poster: trailer.thumbnail,
          hls: trailer.hls,
          webm: trailer.webm,
          mp4: trailer.mp4
        }]
      : []),
    ...screenshots.map((url) => ({ kind: 'screenshot' as const, url }))
  ]
  const shotIndex = Math.min(selectedShot, Math.max(0, gallery.length - 1))
  const current = gallery[shotIndex]
  const tabs = [
    { id: 'overview', label: t('storeNext.detail.overview'), icon: BookOpen },
    { id: 'instructions', label: t('storeNext.detail.howTo'), icon: Languages },
    { id: 'gallery', label: t('storeNext.detail.media'), icon: Images }
  ]
  const selectTab = (tab: string) => {
    setActiveTab(tab)
    bodyRef.current?.scrollTo({ top: 0 })
  }
  const release = metadata?.releaseDate || details?.releaseDate || (item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(language) : undefined)
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
            {libraryEntry?.installed && <span className="store-next-detail-status"><Check size={11} />{t(libraryEntry.hasUpdate ? 'storeNext.detail.updateAvailable' : 'storeNext.card.installed')}</span>}
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

        <div className="store-next-detail-tabs" role="tablist" aria-label={t('storeNext.detail.navigation')}>
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              id={`store-detail-tab-${id}`}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`store-detail-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={(event) => {
                const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
                if (next < 0) return
                event.preventDefault()
                selectTab(tabs[next].id)
                document.getElementById(`store-detail-tab-${tabs[next].id}`)?.focus()
              }}
            >
              <Icon size={15} aria-hidden="true" />{label}
              {id === 'instructions' && translationStatus === 'loading' && <Loader2 size={12} className="of-spin" aria-hidden="true" />}
            </button>
          ))}
        </div>

        <div className="store-next-detail-body" ref={bodyRef}>
          {loading && !details && (
            <div className="store-next-detail-loading" role="status">
              <Loader2 size={16} className="of-spin" aria-hidden="true" />
              {t('storeNext.detail.loading')}
            </div>
          )}

          {unavailableNotice && (
            <div className="store-next-notice warning" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <strong>{t('storeNext.detail.unavailable')}</strong>
                <span>{t('storeNext.detail.unavailableHint')}</span>
                <span className="store-next-notice-quote" lang={/[\u0400-\u04ff]/.test(unavailableNotice) ? 'ru' : undefined}>“{unavailableNotice}”</span>
              </div>
            </div>
          )}

          <section id="store-detail-panel-overview" role="tabpanel" aria-labelledby="store-detail-tab-overview" hidden={activeTab !== 'overview'} tabIndex={0}>
          <h4 className="store-next-section-title">{t('storeNext.detail.about')}</h4>
          {description
            ? <p className="store-next-detail-description">{description}</p>
            : <p className="store-next-detail-description">{t('storeNext.detail.noDescription')}</p>}

          <dl className="store-next-detail-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button className="store-next-howto-link" onClick={() => { selectTab('instructions'); document.getElementById('store-detail-tab-instructions')?.focus() }}>
            <Languages size={20} aria-hidden="true" />
            <span><strong>{t('storeNext.detail.howTo')}</strong><small>{t('storeNext.detail.howToHint')}</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          </section>

          <section id="store-detail-panel-gallery" role="tabpanel" aria-labelledby="store-detail-tab-gallery" hidden={activeTab !== 'gallery'} tabIndex={0}>
            {current ? (
              <div className="store-next-gallery">
                <div className="store-next-gallery-preview">
                  {current.kind === 'trailer' ? (
                    <TrailerPlayer trailer={current} />
                  ) : (
                    <img
                      src={current.url}
                      alt={t('storeNext.detail.screenshot', { title: item.title })}
                      onError={() => setBrokenShots((broken) => new Set([...broken, (current as { url: string }).url]))}
                    />
                  )}
                  {gallery.length > 1 && <>
                    <button className="store-next-gallery-prev" onClick={() => setSelectedShot((shotIndex + gallery.length - 1) % gallery.length)} aria-label={t('storeNext.detail.previousScreenshot')}><ChevronLeft size={22} /></button>
                    <button className="store-next-gallery-next" onClick={() => setSelectedShot((shotIndex + 1) % gallery.length)} aria-label={t('storeNext.detail.nextScreenshot')}><ChevronRight size={22} /></button>
                  </>}
                  <span className="store-next-gallery-count" aria-live="polite">{shotIndex + 1} / {gallery.length}</span>
                </div>
                <div className="store-next-shots" role="group" aria-label={t('storeNext.detail.gallery')}>
                  {gallery.map((entry, index) => (
                    <button
                      key={entry.kind === 'trailer' ? 'trailer' : entry.url}
                      className={entry.kind === 'trailer' ? 'store-next-shot-video' : undefined}
                      aria-pressed={shotIndex === index}
                      aria-label={entry.kind === 'trailer' ? entry.label : t('storeNext.detail.selectScreenshot', { index: index + 1 })}
                      onClick={() => setSelectedShot(index)}
                    >
                      {entry.kind === 'trailer'
                        ? <>
                            {entry.poster
                              ? <img src={entry.poster} alt="" loading="lazy" decoding="async" />
                              : <span className="store-next-shot-blank" />}
                            <PlayCircle size={20} aria-hidden="true" />
                          </>
                        : <img src={entry.url} alt="" loading="lazy" decoding="async" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : <p className="store-next-detail-description">{t('storeNext.detail.noScreenshots')}</p>}
          </section>

          <section id="store-detail-panel-instructions" role="tabpanel" aria-labelledby="store-detail-tab-instructions" hidden={activeTab !== 'instructions'} tabIndex={0}>
          {details?.instructions && details.instructions.length > 0 ? (
            <div className="store-next-instructions">
              <div className="store-next-instructions-heading">
                <div><h4 className="store-next-section-title">{t('storeNext.detail.stepsTitle')}</h4><p>{t('storeNext.detail.stepsHint')}</p></div>
                {translatedInstructions && <button className="settings-btn secondary sm" onClick={() => setShowOriginal((current) => !current)} aria-pressed={showOriginal}>
                  <Languages size={13} aria-hidden="true" />{t(showOriginal ? 'storeNext.detail.showTranslation' : 'storeNext.detail.showOriginal')}
                </button>}
              </div>
                  {translationStatus === 'loading' && (
                    <div className="store-next-translation-status" role="status">
                      <Loader2 size={13} className="of-spin" aria-hidden="true" />
                      {t('storeNext.detail.translatingInstructions')}
                    </div>
                  )}
                  <div className="store-next-steps" lang={translatedInstructions && !showOriginal ? language : 'ru'}>
                    {groupSteps(instructions).map((group, index) => (
                      <section key={index}>
                        {group.heading && <h5>{group.heading}</h5>}
                        {group.items.length > 0 && (
                          <ol>{group.items.map((step, position) => <li key={position}>{step}</li>)}</ol>
                        )}
                      </section>
                    ))}
                  </div>
                  <p className="store-next-source">
                    {translationStatus === 'translated' && !showOriginal
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
            </div>
          ) : !loading && <p className="store-next-detail-description">{t('storeNext.detail.noInstructions')}</p>}
          </section>

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
          {!loading && (unavailableNotice || !details?.torrentUrl) && (
            <p className="store-next-download-hint">
              {t(unavailableNotice ? 'storeNext.detail.unavailableDownloadHint' : 'storeNext.detail.noTorrentHint')}
            </p>
          )}
          <button
            className={`settings-btn ${unavailableNotice ? 'secondary' : 'primary'}`}
            onClick={startDownload}
            disabled={loading || downloading || !details?.torrentUrl}
            title={!loading && !details?.torrentUrl ? t('storeNext.detail.noTorrent') : undefined}
          >
            {downloading ? <Loader2 size={15} className="of-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {downloading
              ? t('storeNext.detail.downloading')
              : libraryEntry?.hasUpdate ? t('storeNext.detail.update') : t('storeNext.detail.download')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Steam serves its trailers as an adaptive HLS stream, and Chromium plays HLS
 * only through Media Source Extensions. hls.js does that, and is loaded on
 * demand — the first time someone opens a trailer — so it stays out of the
 * bundle for everyone who never does. Entries old enough to still carry a plain
 * file play it directly, with no player to load at all.
 */
function TrailerPlayer({ trailer }: { trailer: Extract<GalleryItem, { kind: 'trailer' }> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { hls, mp4, webm, poster, label } = trailer

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const file = mp4 || webm
    if (!hls) {
      if (file) video.src = file
      return
    }

    // Where HLS plays on its own there is nothing to load.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hls
      return
    }

    let player: { destroy: () => void } | null = null
    let disposed = false

    import('hls.js')
      .then(({ default: Hls }) => {
        if (disposed) return
        if (!Hls.isSupported()) {
          if (file) video.src = file
          return
        }
        // The preview is a fraction of the window: 1080p would be wasted bytes.
        const instance = new Hls({ capLevelToPlayerSize: true })
        player = instance
        instance.loadSource(hls)
        instance.attachMedia(video)
      })
      .catch(() => {
        if (!disposed && file) video.src = file
      })

    return () => {
      disposed = true
      try { player?.destroy() } catch { /* the element is going away anyway */ }
    }
  }, [hls, mp4, webm])

  return <video ref={videoRef} controls preload="metadata" poster={poster} aria-label={label} />
}

/**
 * The page writes its steps as a flat run of lines that mixes sub-headings
 * ("В игре:", "Подключение:") with the steps under them, and numbers the steps
 * itself. The list supplies the numbering here, so the site's own "1." is
 * dropped and headings are lifted out instead of being numbered as steps.
 */
function groupSteps(lines: string[]): Array<{ heading?: string; items: string[] }> {
  const groups: Array<{ heading?: string; items: string[] }> = []

  for (const line of lines) {
    if (line.endsWith(':') && line.length <= 40) {
      groups.push({ heading: line.replace(/\s*:$/, ''), items: [] })
      continue
    }
    if (groups.length === 0) groups.push({ items: [] })
    groups[groups.length - 1].items.push(line.replace(/^\d+\s*[.)]\s*/, ''))
  }

  return groups
}
