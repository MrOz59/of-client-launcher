import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Download, Pause, Play, X } from 'lucide-react'

interface DownloadItem {
  id: string
  dbId?: number
  title: string
  type: 'http' | 'torrent'
  url: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'extracting' | 'prefixing'
  errorMessage?: string
  speed?: number
  eta?: number
  size?: number
  downloaded?: number
  total?: number
  seeds?: number
  peers?: number
  infoHash?: string
  destPath?: string
  gameUrl?: string
  prefixPath?: string
  prefixMessage?: string
  stage?: 'download' | 'extract'
  extractProgress?: number
  extractEta?: number
}

interface DownloadsTabProps {
  onActivityChange?: (active: boolean) => void
}

export default function DownloadsTab({ onActivityChange }: DownloadsTabProps) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [hasActive, setHasActive] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map())
  const prefixDoneRemovalTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const downloadsRef = useRef<DownloadItem[]>([])
  const lastEventAtRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    downloadsRef.current = downloads
  }, [downloads])

  type RateStage = 'download' | 'extract'
  type RateSample = { t: number; stage: RateStage; v: number; p?: number }
  const rateHistoryRef = useRef<Map<string, RateSample[]>>(new Map())

  const isInProgressStatus = (s: DownloadItem['status']) =>
    s === 'pending' || s === 'downloading' || s === 'paused' || s === 'extracting' || s === 'prefixing'

  const pushRateSample = (key: string, data: any) => {
    if (!key) return
    const stage: RateStage = data?.stage === 'extract' ? 'extract' : 'download'
    const now = Date.now()

    const list = rateHistoryRef.current.get(key) || []
    const last = list.length ? list[list.length - 1] : undefined

    // Throttle to ~1s resolution per key.
    // Important: do NOT pop+push on every update (that keeps only 1 sample and makes Peak == Current).
    // Instead, update the last sample in-place when updates are too frequent.
    const shouldAppend = !last || now - last.t >= 900 || last.stage !== stage

    if (stage === 'download') {
      const vRaw = Number(data?.speed ?? data?.downloadSpeed ?? 0)
      const v = Number.isFinite(vRaw) ? vRaw : 0
      if (shouldAppend) {
        list.push({ t: now, stage, v })
      } else {
        // Keep timestamp stable so history grows; only refresh value.
        last.v = v
      }
    } else {
      const pRaw = Number(data?.extractProgress ?? data?.progress ?? 0)
      const p = Number.isFinite(pRaw) ? pRaw : 0
      const prev = [...list].reverse().find(s => s.stage === 'extract')
      const dt = prev ? Math.max(0.2, (now - prev.t) / 1000) : 1
      const dp = prev && Number.isFinite(prev.p) ? p - (prev.p as number) : 0
      const v = Number.isFinite(dp) ? Math.max(0, dp / dt) : 0 // % per second

      if (shouldAppend) {
        list.push({ t: now, stage, v, p })
      } else {
        last.v = v
        last.p = p
      }
    }

    // Keep last ~2 minutes at 1s resolution.
    if (list.length > 140) list.splice(0, list.length - 140)
    rateHistoryRef.current.set(key, list)
  }

  const RateGraph = ({ samples, stage }: { samples: RateSample[]; stage: RateStage }) => {
    const width = 240
    const height = 64
    const padding = 6

    if (!samples.length) {
      return (
        <div className="downloads-graph">
          <div className="downloads-graph-header">
            <div className="downloads-graph-title">Taxa de {stage === 'download' ? 'download' : 'extração'}</div>
          </div>
          <div className="downloads-graph-empty">Aguardando dados…</div>
        </div>
      )
    }

    const ys = samples.map(s => s.v)
    const max = Math.max(1e-6, ...ys)
    const peak = Math.max(0, ...ys)
    const last = ys.length ? ys[ys.length - 1] : 0
    const innerW = width - padding * 2
    const innerH = height - padding * 2

    const barW = innerW / Math.max(1, samples.length)
    const barColor = stage === 'download' ? 'rgba(59, 130, 246, 0.95)' : 'rgba(139, 92, 246, 0.95)'

    const formatRate = (v: number) => {
      if (!Number.isFinite(v) || v <= 0) return '--'
      return stage === 'download' ? `${formatBytes(v)}/s` : `${v.toFixed(2)}%/s`
    }

    return (
      <div className="downloads-graph">
        <div className="downloads-graph-header">
          <div className="downloads-graph-title">Taxa de {stage === 'download' ? 'download' : 'extração'}</div>
          <div className="downloads-graph-meta">Atual {formatRate(last)} • Pico {formatRate(peak)}</div>
        </div>
        <svg className="downloads-graph-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <g>
            {samples.map((s, i) => {
              const v = Number.isFinite(s.v) ? Math.max(0, s.v) : 0
              const h = Math.max(1, Math.round((Math.min(1, v / max) * innerH)))
              const x = padding + i * barW
              const y = padding + innerH - h
              return (
                <rect
                  key={s.t}
                  x={x}
                  y={y}
                  width={Math.max(1, barW - 1)}
                  height={h}
                  rx="1.2"
                  fill={barColor}
                  opacity={0.9}
                />
              )
            })}
          </g>
        </svg>
      </div>
    )
  }

  const formatBytes = (value?: number) => {
    if (value === undefined || value === null || Number.isNaN(value)) return '--'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let val = value
    let i = 0
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024
      i++
    }
    return `${val.toFixed(1)} ${units[i]}`
  }

  const formatEta = (seconds?: number) => {
    if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '--'
    const s = Math.max(0, Math.round(seconds))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  const downloadKey = (item: { infoHash?: string; url?: string; id?: string; dbId?: number }) =>
    item.infoHash || item.url || (item.dbId != null ? String(item.dbId) : item.id) || ''

  const getTorrentId = (item: DownloadItem) => item.infoHash || item.url || String(item.dbId ?? item.id)

  const statusPriority: Record<DownloadItem['status'], number> = {
    // Higher means “wins” when merging.
    error: 7,
    prefixing: 6,
    extracting: 6,
    downloading: 5,
    pending: 4,
    paused: 3,
    completed: 1
  }

  const parsePercentFromMessage = (msg?: string): number | undefined => {
    const text = String(msg || '')
    const m = text.match(/(\d{1,3}(?:[\.,]\d+)?)\s*%/)
    if (!m) return undefined
    const n = Number(String(m[1]).replace(',', '.'))
    if (!Number.isFinite(n)) return undefined
    return Math.max(0, Math.min(100, n))
  }

  const prefixKey = (gameUrl: string) => `prefix:${String(gameUrl || '').trim()}`

  const mergeDownloads = (a: DownloadItem, b: DownloadItem): DownloadItem => {
    const chooseStatus =
      statusPriority[a.status] >= statusPriority[b.status] ? a.status : b.status
    const aIsExtract = a.stage === 'extract' || a.status === 'extracting' || a.extractProgress !== undefined
    const bIsExtract = b.stage === 'extract' || b.status === 'extracting' || b.extractProgress !== undefined
    const mergedProgress = (aIsExtract || bIsExtract)
      ? (b.extractProgress ?? b.progress ?? a.extractProgress ?? a.progress ?? 0)
      : Math.max(a.progress ?? 0, b.progress ?? 0)
    const pick = <T,>(first: T | undefined, second: T | undefined) =>
      second !== undefined && second !== null ? second : first

    return {
      ...a,
      ...b,
      id: a.id || b.id,
      title: pick(a.title, b.title) || 'Download',
      type: (pick(a.type, b.type) as any) || 'torrent',
      url: pick(a.url, b.url) || a.url,
      infoHash: pick(a.infoHash, b.infoHash) || a.infoHash,
      progress: mergedProgress,
      status: chooseStatus,
      speed: pick(a.speed, b.speed),
      eta: pick(a.eta, b.eta),
      downloaded: pick(a.downloaded, b.downloaded),
      total: pick(a.total, b.total),
      destPath: pick(a.destPath, b.destPath),
      stage: pick(a.stage, b.stage),
      extractProgress: pick(a.extractProgress, b.extractProgress),
      extractEta: pick(a.extractEta, b.extractEta),
      seeds: pick(a.seeds, b.seeds),
      peers: pick(a.peers, b.peers)
    }
  }

  const canonicalKey = (d: { infoHash?: string; url?: string; id?: string; dbId?: number }) =>
    d.infoHash || d.url || (d.dbId != null ? String(d.dbId) : d.id) || ''

  const dedupeDownloads = (list: DownloadItem[]) => {
    const map = new Map<string, DownloadItem>()
    for (const item of list) {
      const key = canonicalKey(item)
      if (!key) continue
      if (!map.has(key)) {
        map.set(key, item)
      } else {
        const merged = mergeDownloads(map.get(key) as DownloadItem, item)
        map.set(key, merged)
      }
    }
    return Array.from(map.values())
  }

  const findExistingForUpdate = (list: DownloadItem[], data: any): DownloadItem | undefined => {
    const keys = [data.infoHash, data.magnet, data.url].filter(Boolean)
    return list.find(d =>
      keys.some((k: string) =>
        d.infoHash === k || d.url === k || d.id === k
      )
    )
  }

  // Throttled update function to prevent flickering
  const scheduleThrottledUpdate = (data: any) => {
    const matchKey = String(data?.infoHash || data?.magnet || data?.url || '').trim()
    if (!matchKey) return

    try { lastEventAtRef.current.set(matchKey, Date.now()) } catch {}

    // Check if this is a new download (not in current list) - trigger activity immediately
    if (data.progress < 100) setHasActive(true)

    // Store the latest update for this download
    pendingUpdatesRef.current.set(matchKey, data)

    // If we already have a timer running, don't schedule another one
    if (throttleTimerRef.current) return

    // Schedule the update to happen after 500ms
    throttleTimerRef.current = setTimeout(() => {
      setDownloads(prev => {
        let updated = dedupeDownloads([...prev])
        let hasChanges = false

        for (const [key, updateData] of pendingUpdatesRef.current.entries()) {
          // Record a rate sample for the speed graph (best-effort).
          try { pushRateSample(key, updateData) } catch {}

          const existing = findExistingForUpdate(updated, updateData) ||
            updated.find(d => (key && (d.infoHash === key || d.url === key || d.id === key)))

          if (existing) {
            updated = updated.map(d => {
              if (
                d === existing ||
                d.infoHash === (updateData.infoHash || key) ||
                d.url === (updateData.url || key) ||
                d.id === key
              ) {
                // Se o download já está em prefixing ou completed, ignorar eventos de progresso de extração
                if (d.status === 'prefixing' || d.status === 'completed') {
                  return d
                }

                hasChanges = true
                const isExtract =
                  updateData.stage === 'extract' ||
                  updateData.stage === 'extracting' ||
                  updateData.status === 'extracting' ||
                  updateData.extractProgress !== undefined ||
                  d.status === 'extracting' // Se já está extraindo, continuar tratando como extração

                // Check if extraction just finished (progress is 100%)
                // Considerar tanto extractProgress quanto progress quando em modo extração
                const extractFinished = isExtract && (
                  (updateData.extractProgress ?? 0) >= 100 ||
                  (d.status === 'extracting' && updateData.progress >= 100)
                )

                const nextStatus: DownloadItem['status'] =
                  extractFinished
                    ? 'completed'
                    : isExtract
                      ? 'extracting'
                      : updateData.progress >= 100
                        ? 'completed'
                        : d.status === 'paused'
                          ? 'paused'
                          : 'downloading'

                const merged = mergeDownloads(d, {
                  ...d,
                  progress: isExtract ? (updateData.extractProgress ?? updateData.progress) : updateData.progress,
                  status: nextStatus,
                  infoHash: updateData.infoHash || d.infoHash,
                  speed: updateData.speed ?? d.speed,
                  eta: isExtract ? d.eta : (updateData.eta ?? d.eta),
                  extractEta: isExtract ? (updateData.eta ?? d.extractEta) : d.extractEta,
                  downloaded: updateData.downloaded ?? d.downloaded,
                  total: updateData.total ?? d.total,
                  destPath: updateData.destPath || d.destPath,
                  stage: (isExtract ? 'extract' : (updateData.stage as any)) || d.stage,
                  extractProgress: updateData.extractProgress ?? d.extractProgress,
                  seeds: updateData.seeds ?? d.seeds,
                  peers: updateData.peers ?? d.peers
                })
                return merged
              }
              return d
            })
          } else {
            hasChanges = true
            const url = updateData.url || updateData.magnet || ''
            const title = url.split('/').pop() || 'Download'
            const type = url.includes('/torrents/') || url.endsWith('.torrent') ? 'torrent' : 'http'

            const isExtract =
              updateData.stage === 'extract' ||
              updateData.stage === 'extracting' ||
              updateData.status === 'extracting' ||
              updateData.extractProgress !== undefined

            // Check if extraction just finished (progress is 100%)
            const extractFinished = isExtract && (
              (updateData.extractProgress ?? 0) >= 100 ||
              updateData.progress >= 100
            )

            const newItem: DownloadItem = {
              id: url || key || Math.random().toString(36).slice(2),
              title: title.replace(/%20/g, ' '),
              type: type as 'http' | 'torrent',
              url: url || key,
              progress: isExtract ? (updateData.extractProgress ?? updateData.progress) : updateData.progress,
              status: extractFinished ? 'completed' : isExtract ? 'extracting' : updateData.progress >= 100 ? 'completed' : 'downloading',
              infoHash: updateData.infoHash,
              speed: updateData.speed,
              eta: isExtract ? undefined : updateData.eta,
              extractEta: isExtract ? updateData.eta : undefined,
              downloaded: updateData.downloaded,
              total: updateData.total,
              destPath: updateData.destPath,
              stage: extractFinished ? undefined : (isExtract ? 'extract' : updateData.stage) as any,
              extractProgress: extractFinished ? undefined : updateData.extractProgress,
              seeds: updateData.seeds,
              peers: updateData.peers
            }

            const mergeTarget = findExistingForUpdate(updated, newItem)
            if (mergeTarget) {
              updated = updated.map(d => (d === mergeTarget ? mergeDownloads(d, newItem) : d))
            } else {
              updated.push(newItem)
            }
          }
        }

        updated = dedupeDownloads(updated)

        pendingUpdatesRef.current.clear()
        throttleTimerRef.current = null

        if (hasChanges) {
          const active = updated.some(d => d.status === 'pending' || d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting' || d.status === 'prefixing')
          setHasActive(active)
          setHistoryTick(t => t + 1)
        }

        return hasChanges ? updated : prev
      })
    }, 500) // Update every 500ms max
  }

  const handlePause = async (item: DownloadItem) => {
    const torrentId = getTorrentId(item)
    const result = await window.electronAPI.pauseDownload(torrentId)
    if (result.success) {
      const key = downloadKey(item)
      setDownloads(prev => prev.map(d => (downloadKey(d) === key ? { ...d, status: 'paused' } : d)))
    }
  }

  const handleResume = async (item: DownloadItem) => {
    const torrentId = getTorrentId(item)
    const result = await window.electronAPI.resumeDownload(torrentId)
    if (result.success) {
      const key = downloadKey(item)
      setDownloads(prev => prev.map(d => (downloadKey(d) === key ? { ...d, status: 'downloading' } : d)))
    }
  }

  const handleCancel = async (item: DownloadItem) => {
    const torrentId = getTorrentId(item)
    const key = downloadKey(item)
    // Prevent stale progress updates from re-adding the cancelled download.
    try { pendingUpdatesRef.current.delete(key) } catch {}
    const result = await window.electronAPI.cancelDownload(torrentId)
    if (result.success) {
      // Prefer a full refresh (multiple downloads can be active and throttled updates may race).
      try { pendingUpdatesRef.current.delete(key) } catch {}
      // Optimistic remove by stable key (never by index/id).
      setDownloads(prev => prev.filter(d => downloadKey(d) !== key))
    }
  }

  const handleExtract = async (item: DownloadItem) => {
    const key = downloadKey(item)
    setDownloads(prev => prev.map(d =>
      downloadKey(d) === key ? { ...d, status: 'extracting', stage: 'extract', progress: 0 } : d
    ))
    const res = await window.electronAPI.extractDownload(item.dbId ?? item.id, item.destPath)
    if (res.success && res.destPath) {
      // Remove from list after successful extraction
      setDownloads(prev => prev.filter(d => downloadKey(d) !== key))
      // Also delete from database
      if (item.dbId) {
        window.electronAPI.deleteDownload?.(item.dbId).catch(() => {})
      }
    } else {
      console.warn('Extrair falhou', res.error)
      // Revert status on failure
      setDownloads(prev => prev.map(d =>
        downloadKey(d) === key ? { ...d, status: 'completed', stage: undefined } : d
      ))
    }
  }

  // Check if a download should be kept in the list
  const shouldKeepDownload = (d: DownloadItem): boolean => {
    // Keep if in progress (including prefixing)
    if (d.status === 'pending' || d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting' || d.status === 'prefixing') {
      return true
    }
    // Keep if completed but has a zip file to extract (HTTP downloads)
    if (d.status === 'completed' && d.type === 'http' && d.destPath) {
      return true
    }
    // Keep if error (user might want to retry)
    if (d.status === 'error') {
      return true
    }
    // Remove completed torrents (they don't need extraction)
    // Remove completed HTTP downloads that have been extracted
    return false
  }

  useEffect(() => {
    const loadDownloads = async () => {
      const [active, completed] = await Promise.all([
        window.electronAPI.getActiveDownloads(),
        window.electronAPI.getCompletedDownloads()
      ])

      const dirFromPath = (p?: string | null) => {
        if (!p) return undefined
        // Keep directories as-is; only strip if it's clearly an archive file path.
        if (!/\.(zip|rar|7z)$/i.test(p)) return p
        const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
        if (lastSlash <= 0) return p
        return p.slice(0, lastSlash)
      }

      const mappedActive = active.success
        ? (active.downloads || []).map(d => ({
            id: String(d.id),
            dbId: Number(d.id),
            title: d.title || d.download_url.split('/').pop() || 'Download',
            type: d.type,
            url: d.download_url,
            progress: d.progress || 0,
            status: (d.status as any) || 'downloading',
            errorMessage: d.error_message || undefined,
            infoHash: d.info_hash || undefined,
            downloaded: d.downloaded ? Number(d.downloaded) : undefined,
            total: d.size ? Number(d.size) : undefined,
            speed: d.speed ? Number(d.speed) : undefined,
            eta: d.eta ? Number(d.eta) : undefined,
            destPath: dirFromPath(d.dest_path) || undefined,
            gameUrl: d.game_url || undefined,
            stage: String(d.status || '').toLowerCase() === 'extracting' ? ('extract' as any) : ('download' as any),
            extractProgress: String(d.status || '').toLowerCase() === 'extracting' ? Number(d.progress || 0) : undefined,
            extractEta: String(d.status || '').toLowerCase() === 'extracting' && d.eta ? Number(d.eta) : undefined,
            seeds: d.seeds != null ? Number(d.seeds) : undefined,
            peers: d.peers != null ? Number(d.peers) : undefined
          }))
        : []

      const mappedCompleted = completed.success
        ? (completed.downloads || []).map(d => ({
            id: `c-${d.id}`,
            dbId: Number(d.id),
            title: d.title || d.download_url.split('/').pop() || 'Download',
            type: d.type as 'http' | 'torrent',
            url: d.download_url,
            progress: d.progress || 100,
            status: 'completed' as const,
            errorMessage: d.error_message || undefined,
            infoHash: d.info_hash || undefined,
            downloaded: d.downloaded ? Number(d.downloaded) : undefined,
            total: d.size ? Number(d.size) : undefined,
            speed: d.speed ? Number(d.speed) : undefined,
            eta: d.eta ? Number(d.eta) : undefined,
            destPath: d.dest_path || undefined,
            gameUrl: d.game_url || undefined,
            seeds: d.seeds != null ? Number(d.seeds) : undefined,
            peers: d.peers != null ? Number(d.peers) : undefined
          }))
        : []

      // Filter downloads - only keep active ones and HTTP completed with pending extraction
      const merged = [...mappedCompleted, ...mappedActive].filter(shouldKeepDownload)
      const deduped = dedupeDownloads(merged)
      const preserveVirtual = downloadsRef.current.filter(d =>
        String(d.id || '').startsWith('prefix:') || String(d.url || '').startsWith('prefix:')
      )

      const next = dedupeDownloads([...deduped, ...preserveVirtual])
      setDownloads(next)
      setHasActive(next.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting' || d.status === 'prefixing'))
    }
    loadDownloads()

    // Safety net: sometimes IPC progress/complete events can be missed.
    // To avoid UI flicker, only reconcile *stale extractions* (not a full refresh).
    const reconcileStaleExtractions = async () => {
      const now = Date.now()
      const cur = downloadsRef.current
      const extracting = cur.filter(d => d.status === 'extracting')
      if (!extracting.length) return

      // Only reconcile if any extracting item hasn't received events recently.
      const isStale = (d: DownloadItem) => {
        const k = downloadKey(d)
        const last = lastEventAtRef.current.get(k) || 0
        return now - last > 6500
      }
      if (!extracting.some(isStale)) return

      const [active, completed] = await Promise.all([
        window.electronAPI.getActiveDownloads(),
        window.electronAPI.getCompletedDownloads()
      ])
      if (!active.success && !completed.success) return

      const activeById = new Map<number, any>()
      for (const d of (active.success ? (active.downloads || []) : [])) {
        const id = Number((d as any).id)
        if (!Number.isNaN(id)) activeById.set(id, d)
      }
      const completedById = new Map<number, any>()
      for (const d of (completed.success ? (completed.downloads || []) : [])) {
        const id = Number((d as any).id)
        if (!Number.isNaN(id)) completedById.set(id, d)
      }

      const normStatus = (s: any) => String(s || '').toLowerCase()

      setDownloads(prev => {
        let changed = false
        let next = [...prev]

        for (const it of extracting) {
          if (!isStale(it)) continue
          const id = it.dbId != null ? Number(it.dbId) : Number.NaN
          const a = Number.isFinite(id) ? activeById.get(id) : undefined
          const c = Number.isFinite(id) ? completedById.get(id) : undefined

          const statusA = a ? normStatus((a as any).status) : ''
          const statusC = c ? 'completed' : ''

          // If DB says it's no longer extracting, update UI accordingly.
          if (a && statusA === 'extracting') {
            // Refresh progress from DB (best-effort).
            const p = Number((a as any).progress || 0)
            next = next.map(x => {
              if (downloadKey(x) !== downloadKey(it)) return x
              changed = true
              return {
                ...x,
                status: 'extracting',
                stage: 'extract',
                extractProgress: Number.isFinite(p) ? p : x.extractProgress,
                extractEta: (a as any).eta != null ? Number((a as any).eta) : x.extractEta,
                destPath: (a as any).install_path || (a as any).dest_path || x.destPath
              }
            })
            continue
          }

          if (c || (a && statusA === 'completed')) {
            // Mark completed: torrents will disappear via shouldKeepDownload, HTTP keeps “Extrair” if applicable.
            next = next.map(x => {
              if (downloadKey(x) !== downloadKey(it)) return x
              changed = true
              return {
                ...x,
                status: 'completed',
                progress: 100,
                stage: undefined,
                extractProgress: undefined,
                extractEta: undefined
              }
            })
            continue
          }

          // If DB doesn't know it as extracting anymore and it's missing from completed, keep as-is.
        }

        if (!changed) return prev
        // Apply the normal filter to drop completed torrents if needed.
        const filtered = next.filter(shouldKeepDownload)
        return dedupeDownloads(filtered)
      })
    }

    const poll = setInterval(() => {
      reconcileStaleExtractions().catch(() => {})
    }, 3000)

    const sub = window.electronAPI.onDownloadProgress((data) => {
      // Use throttled update to prevent flickering
      scheduleThrottledUpdate(data)
    })

    const completeSub = window.electronAPI.onDownloadComplete((data) => {
      setDownloads(prev => {
        const updated: DownloadItem[] = prev.map(d => {
          const matchKey = data.infoHash || data.magnet
          if (matchKey && (d.infoHash === matchKey || d.url === matchKey || d.id === matchKey)) {
            // Se está em prefixing, não mudar o status - deixar o onPrefixJobStatus controlar
            if (d.status === 'prefixing') {
              return d
            }
            return { ...d, status: 'completed' as const, progress: 100, destPath: data.destPath || d.destPath }
          }
          return d
        })
        // Filter out completed torrents (they don't need extraction)
        const filtered = updated.filter(shouldKeepDownload)
        const active = filtered.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting' || d.status === 'prefixing')
        setHasActive(active)
        return filtered
      })
    })

    const deleteSub = window.electronAPI.onDownloadDeleted?.(() => {
      // Cancel any pending throttled UI updates before reloading from DB.
      try {
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current)
          throttleTimerRef.current = null
        }
        pendingUpdatesRef.current.clear()
      } catch {}
      // Reload from source to ensure no stale entries remain after deletion/cancel
      Promise.all([
        window.electronAPI.getActiveDownloads(),
        window.electronAPI.getCompletedDownloads()
      ]).then(([active, completed]) => {
        const dirFromPath = (p?: string | null) => {
          if (!p) return undefined
          if (!/\.(zip|rar|7z)$/i.test(p)) return p
          const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
          if (lastSlash <= 0) return p
          return p.slice(0, lastSlash)
        }

        const mappedActive = active.success
          ? (active.downloads || []).map(d => ({
              id: String(d.id),
              dbId: Number(d.id),
              title: d.title || d.download_url.split('/').pop() || 'Download',
              type: d.type,
              url: d.download_url,
              progress: d.progress || 0,
              status: (d.status as any) || 'downloading',
              errorMessage: d.error_message || undefined,
              infoHash: d.info_hash || undefined,
              downloaded: d.downloaded ? Number(d.downloaded) : undefined,
              total: d.size ? Number(d.size) : undefined,
              speed: d.speed ? Number(d.speed) : undefined,
              eta: d.eta ? Number(d.eta) : undefined,
              destPath: dirFromPath(d.dest_path) || undefined,
              gameUrl: d.game_url || undefined,
              stage: String(d.status || '').toLowerCase() === 'extracting' ? ('extract' as any) : ('download' as any),
              extractProgress: String(d.status || '').toLowerCase() === 'extracting' ? Number(d.progress || 0) : undefined,
              extractEta: String(d.status || '').toLowerCase() === 'extracting' && d.eta ? Number(d.eta) : undefined,
              seeds: d.seeds != null ? Number(d.seeds) : undefined,
              peers: d.peers != null ? Number(d.peers) : undefined
            }))
          : []

        const mappedCompleted = completed.success
          ? (completed.downloads || []).map(d => ({
              id: `c-${d.id}`,
              dbId: Number(d.id),
              title: d.title || d.download_url.split('/').pop() || 'Download',
              type: d.type as 'http' | 'torrent',
              url: d.download_url,
              progress: d.progress || 100,
              status: 'completed' as const,
              errorMessage: d.error_message || undefined,
              infoHash: d.info_hash || undefined,
              downloaded: d.downloaded ? Number(d.downloaded) : undefined,
              total: d.size ? Number(d.size) : undefined,
              speed: d.speed ? Number(d.speed) : undefined,
              eta: d.eta ? Number(d.eta) : undefined,
              destPath: d.dest_path || undefined,
              gameUrl: d.game_url || undefined,
              seeds: d.seeds != null ? Number(d.seeds) : undefined,
              peers: d.peers != null ? Number(d.peers) : undefined
            }))
          : []

        const merged = [...mappedCompleted, ...mappedActive].filter(shouldKeepDownload)
        const deduped = dedupeDownloads(merged)
        const preserveVirtual = downloadsRef.current.filter(d =>
          String(d.id || '').startsWith('prefix:') || String(d.url || '').startsWith('prefix:')
        )
        const next = dedupeDownloads([...deduped, ...preserveVirtual])
        setDownloads(next)
        setHasActive(next.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting' || d.status === 'prefixing'))
      }).catch(() => {})
    })

    const prefixSub = window.electronAPI.onPrefixJobStatus?.((data) => {
      const gameUrl = String(data?.gameUrl || '').trim()
      if (!gameUrl) return

      const key = prefixKey(gameUrl)
      const status = String(data?.status || '').toLowerCase()
      const message = data?.message != null ? String(data.message) : undefined
      const prefix = data?.prefix != null ? String(data.prefix) : undefined

      // Cancel any pending auto-removal if we get new updates.
      const pendingRemoval = prefixDoneRemovalTimersRef.current.get(key)
      if (pendingRemoval) {
        clearTimeout(pendingRemoval)
        prefixDoneRemovalTimersRef.current.delete(key)
      }

      // Tentar encontrar o download existente pelo gameUrl
      const findDownloadByGameUrl = (list: DownloadItem[]) =>
        list.find(d => d.gameUrl === gameUrl || d.url === gameUrl)

      if (status === 'done') {
        // Prefixo concluído - remover o download da lista (já está instalado)
        setDownloads(prev => {
          const existing = findDownloadByGameUrl(prev)
          const existingKey = existing ? downloadKey(existing) : null

          // Remover tanto o download real quanto qualquer item virtual de prefixo
          const filtered = prev.filter(d => {
            if (downloadKey(d) === key) return false // remove item virtual prefix:...
            if (existing && downloadKey(d) === existingKey) return false // remove download real
            return true
          })

          return filtered
        })
        setHasActive(false)
        return
      }

      if (status === 'error') {
        setDownloads(prev => {
          const existing = findDownloadByGameUrl(prev)
          const virtualPrefix = prev.find(d => downloadKey(d) === key)

          // Se encontrou um download existente, marcar como erro
          if (existing) {
            return prev.map(d => {
              if (d === existing) {
                return {
                  ...d,
                  status: 'error' as const,
                  errorMessage: message || 'Falha ao preparar prefixo',
                  prefixPath: prefix,
                  prefixMessage: message
                }
              }
              return d
            }).filter(d => downloadKey(d) !== key)
          }

          // Fallback: criar/atualizar item virtual
          const next: DownloadItem = virtualPrefix
            ? {
                ...virtualPrefix,
                status: 'error',
                errorMessage: message || virtualPrefix.errorMessage || 'Falha ao preparar prefixo',
                prefixPath: prefix || virtualPrefix.prefixPath,
                prefixMessage: message || virtualPrefix.prefixMessage
              }
            : {
                id: key,
                title: 'Prefixo do Proton',
                type: 'http',
                url: key,
                gameUrl,
                progress: parsePercentFromMessage(message) ?? 0,
                status: 'error',
                errorMessage: message || 'Falha ao preparar prefixo',
                prefixPath: prefix,
                prefixMessage: message
              }
          return dedupeDownloads([...prev.filter(d => downloadKey(d) !== key), next])
        })
        return
      }

      // starting/progress - atualizar status para prefixing
      const p = parsePercentFromMessage(message)
      setDownloads(prev => {
        const existing = findDownloadByGameUrl(prev)
        const virtualPrefix = prev.find(d => downloadKey(d) === key)

        // Se encontrou um download existente, atualizar para prefixing
        if (existing) {
          return prev.map(d => {
            if (d === existing) {
              return {
                ...d,
                status: 'prefixing' as const,
                progress: p ?? d.progress ?? 0,
                prefixMessage: message,
                prefixPath: prefix
              }
            }
            return d
          }).filter(d => downloadKey(d) !== key) // remover item virtual se existir
        }

        // Fallback: criar/atualizar item virtual de prefixo
        const next: DownloadItem = virtualPrefix
          ? {
              ...virtualPrefix,
              status: 'prefixing',
              progress: p ?? virtualPrefix.progress ?? 0,
              prefixMessage: message || virtualPrefix.prefixMessage,
              prefixPath: prefix || virtualPrefix.prefixPath
            }
          : {
              id: key,
              title: 'Prefixo do Proton',
              type: 'http',
              url: key,
              gameUrl,
              progress: p ?? 0,
              status: 'prefixing',
              prefixMessage: message,
              prefixPath: prefix
            }

        const updated = dedupeDownloads([...prev.filter(d => downloadKey(d) !== key), next])
        return updated
      })
      setHasActive(true)
    })

    return () => {
      // Cleanup subscriptions
      if (typeof sub === 'function') sub()
      if (typeof completeSub === 'function') completeSub()
      if (typeof deleteSub === 'function') deleteSub()
      if (typeof prefixSub === 'function') prefixSub()

      clearInterval(poll)

      // Clear any pending throttle timer
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }

      // Clear pending updates
      pendingUpdatesRef.current.clear()

      // Clear any pending prefix removal timers
      for (const t of prefixDoneRemovalTimersRef.current.values()) clearTimeout(t)
      prefixDoneRemovalTimersRef.current.clear()
    }
  }, [onActivityChange])

  // Notify parent when activity changes, but only after render commit
  useEffect(() => {
    if (typeof onActivityChange === 'function') {
      onActivityChange(hasActive)
    }
  }, [hasActive, onActivityChange])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#3b82f6'
      case 'downloading':
        return '#3b82f6'
      case 'extracting':
        return '#8b5cf6'
      case 'prefixing':
        return '#a855f7'
      case 'paused':
        return '#f59e0b'
      case 'completed':
        return '#10b981'
      case 'error':
        return '#ef4444'
      default:
        return '#6b7280'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendente'
      case 'downloading':
        return 'Baixando'
      case 'extracting':
        return 'Extraindo'
      case 'prefixing':
        return 'Preparando prefixo'
      case 'paused':
        return 'Pausado'
      case 'completed':
        return 'Concluído'
      case 'error':
        return 'Erro'
      default:
        return status
    }
  }

  const activeSortRank = (d: DownloadItem) => {
    switch (d.status) {
      case 'prefixing':
        return 0
      case 'extracting':
        return 1
      case 'downloading':
        return 2
      case 'paused':
        return 3
      case 'pending':
        return 4
      case 'error':
        return 5
      case 'completed':
        return 6
      default:
        return 9
    }
  }

  const sortedDownloads = [...downloads].sort((a, b) => {
    const ra = activeSortRank(a)
    const rb = activeSortRank(b)
    if (ra !== rb) return ra - rb
    const pa = Number.isFinite(a.progress) ? a.progress : 0
    const pb = Number.isFinite(b.progress) ? b.progress : 0
    if (pa !== pb) return pb - pa
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
  })

  const primary =
    sortedDownloads.find(d => isInProgressStatus(d.status)) ||
    sortedDownloads[0]

  const primaryKey = primary ? downloadKey(primary) : ''
  const queue = primary ? sortedDownloads.filter(d => downloadKey(d) !== primaryKey) : []

  const primaryStage: RateStage = primary?.status === 'extracting' || primary?.stage === 'extract' ? 'extract' : 'download'
  const primaryRateSamples = useMemo(() => {
    if (!primaryKey) return [] as RateSample[]
    const list = rateHistoryRef.current.get(primaryKey) || []
    const filtered = list.filter(s => s.stage === primaryStage)
    return filtered.slice(-90)
  }, [primaryKey, primaryStage, historyTick])

  const primaryRateLast = primaryRateSamples.length ? primaryRateSamples[primaryRateSamples.length - 1].v : 0
  const primaryRatePeak = primaryRateSamples.reduce((m, s) => (s.v > m ? s.v : m), 0)
  const formatStageRate = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return '--'
    return primaryStage === 'download' ? `${formatBytes(v)}/s` : `${v.toFixed(2)}%/s`
  }

  const primaryNetwork = primary?.status === 'prefixing'
    ? '--'
    : primaryStage === 'download'
      ? formatStageRate(Number(primary?.speed ?? 0))
      : formatStageRate(primaryRateLast)

  const primaryEta = primaryStage === 'download' ? primary?.eta : primary?.extractEta
  const primaryUiProgress = primary?.status === 'extracting'
    ? (primary.extractProgress ?? primary.progress)
    : primary?.progress

  const DownloadCard = ({ item, variant }: { item: DownloadItem; variant: 'primary' | 'queue' }) => {
    const statusColor = getStatusColor(item.status)
    const showCancel =
      item.status === 'pending' ||
      item.status === 'downloading' ||
      item.status === 'paused' ||
      item.status === 'extracting' ||
      item.status === 'error'

    return (
      <div className={`download-item ${variant === 'primary' ? 'download-item--primary' : 'download-item--queue'}`}>
        <div className="download-header">
          <div className="download-header-left">
            <div className="download-title">{item.title}</div>
            <div className="download-status" style={{ color: statusColor }}>
              {getStatusText(item.status)}
              {item.status === 'prefixing' && ' • Proton'}
              {item.status !== 'extracting' && item.type === 'torrent' && ' • Torrent'}
              {item.status !== 'extracting' && item.type === 'http' && ' • HTTP'}
            </div>
            {variant === 'primary' && item.status === 'prefixing' && item.gameUrl ? (
              <div className="download-dest" title={item.gameUrl}>Jogo: {item.gameUrl}</div>
            ) : null}
            {variant === 'primary' && item.destPath ? (
              <div className="download-dest" title={item.destPath}>Destino: {item.destPath}</div>
            ) : null}
          </div>

          <div className="download-actions">
            {item.status === 'downloading' && (
              <button onClick={() => handlePause(item)} className="btn warning btn-icon" title="Pausar">
                <Pause size={16} />
              </button>
            )}
            {item.status === 'paused' && (
              <button onClick={() => handleResume(item)} className="btn accent btn-icon" title="Continuar">
                <Play size={16} />
              </button>
            )}
            {showCancel && (
              <button onClick={() => handleCancel(item)} className="btn danger btn-icon" title="Cancelar">
                <X size={16} />
              </button>
            )}

            {item.status === 'completed' && (
              <>
                <button
                  onClick={() => handleExtract(item)}
                  disabled={!item.destPath}
                  className="btn accent"
                  title={item.destPath ? 'Extrair' : 'Caminho indisponível'}
                >
                  Extrair
                </button>
                <button
                  onClick={() => {
                    if (item.destPath) window.electronAPI.openPath(item.destPath)
                  }}
                  disabled={!item.destPath}
                  className="btn primary"
                  title={item.destPath ? 'Abrir pasta' : 'Caminho indisponível'}
                >
                  Abrir pasta
                </button>
              </>
            )}
          </div>
        </div>

        <div className={`download-progress ${variant === 'primary' ? 'download-progress--primary' : ''}`}>
          <div
            className="download-progress-bar"
            style={{
              width: `${(item.status === 'extracting' ? (item.extractProgress ?? item.progress) : item.progress) ?? 0}%`,
              background: item.status === 'extracting'
                ? 'linear-gradient(90deg, #8b5cf6, #7c3aed)'
                : item.status === 'prefixing'
                  ? 'linear-gradient(90deg, #a855f7, #9333ea)'
                  : undefined
            }}
          />
        </div>

        <div className={`download-info ${variant === 'primary' ? 'download-info--primary' : ''}`}>
          <span>
            {item.status === 'prefixing'
              ? `Prefixo ${(item.progress ?? 0).toFixed(1)}%`
              : item.status === 'extracting'
              ? `Extraindo ${item.extractProgress?.toFixed(1) ?? item.progress.toFixed(1)}%`
              : `${item.progress.toFixed(1)}%`}
          </span>

          {item.status === 'error' && item.errorMessage ? (
            <span title={item.errorMessage} className="download-error">
              • {item.errorMessage}
            </span>
          ) : null}

          {item.status === 'prefixing' ? (
            <>
              {item.prefixMessage ? <span title={item.prefixMessage}>• {item.prefixMessage}</span> : <span>• Preparando…</span>}
            </>
          ) : item.status === 'extracting' ? (
            <>
              <span>• ETA: {formatEta(item.extractEta)}</span>
            </>
          ) : (
            <>
              <span>• {formatBytes(item.downloaded)} / {formatBytes(item.total)}</span>
              <span>• {formatBytes(item.speed)}/s</span>
              <span>• ETA: {formatEta(item.eta)}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  if (downloads.length === 0) {
    return (
      <div className="empty-state">
        <Download size={64} />
        <h3>Nenhum download ativo</h3>
        <p>Seus downloads aparecerão aqui</p>
      </div>
    )
  }

  return (
    <div className="downloads-page">
      {primary ? (
        <div className="downloads-section downloads-section--active">
          <div className="downloads-hero">
            <div className="downloads-hero-top">
              <div className="downloads-hero-heading">
                <div className="downloads-hero-kicker">Download ativo</div>
                <div className="downloads-hero-title" title={primary.status === 'prefixing' ? (primary.gameUrl || primary.title) : primary.title}>
                  {primary.status === 'prefixing' ? 'Preparando prefixo' : primary.title}
                </div>
                {primary.status === 'prefixing' && primary.gameUrl ? (
                  <div className="downloads-hero-sub" title={primary.gameUrl}>Jogo: {primary.gameUrl}</div>
                ) : primary.destPath ? (
                  <div className="downloads-hero-sub" title={primary.destPath}>Destino: {primary.destPath}</div>
                ) : null}
              </div>

              <div className="downloads-hero-actions">
                {primary.status === 'downloading' && (
                  <button onClick={() => handlePause(primary)} className="btn warning btn-icon" title="Pausar">
                    <Pause size={16} />
                  </button>
                )}
                {primary.status === 'paused' && (
                  <button onClick={() => handleResume(primary)} className="btn accent btn-icon" title="Continuar">
                    <Play size={16} />
                  </button>
                )}
                {(primary.status === 'pending' ||
                  primary.status === 'downloading' ||
                  primary.status === 'paused' ||
                  primary.status === 'extracting' ||
                  primary.status === 'error') && (
                  <button onClick={() => handleCancel(primary)} className="btn danger btn-icon" title="Cancelar">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="downloads-hero-body">
              <div className="downloads-hero-left">
                <div className="downloads-hero-pills">
                  <span className="downloads-pill" style={{ color: getStatusColor(primary.status) }}>
                    {getStatusText(primary.status)}
                  </span>
                  {primary.status !== 'extracting' && primary.status !== 'prefixing' ? (
                    <span className="downloads-pill">{primary.type === 'torrent' ? 'Torrent' : 'HTTP'}</span>
                  ) : null}
                  {primary.status === 'prefixing' ? <span className="downloads-pill">Proton</span> : null}
                  {(primary.status === 'downloading' || primary.status === 'extracting')
                    ? <span className="downloads-pill">ETA: {formatEta(primaryEta)}</span>
                    : null}
                </div>

                <div className="downloads-metrics">
                  <div className="downloads-metric">
                    <div className="downloads-metric-label">
                      {primary.status === 'prefixing' ? 'PREFIX' : primary.status === 'extracting' ? 'EXTRACT' : 'NETWORK'}
                    </div>
                    <div className="downloads-metric-value">{primaryNetwork}</div>
                  </div>
                  <div className="downloads-metric">
                    <div className="downloads-metric-label">PEAK</div>
                    <div className="downloads-metric-value">{primary.status === 'prefixing' ? '--' : formatStageRate(primaryRatePeak)}</div>
                  </div>
                  {primary.status !== 'extracting' && primary.status !== 'prefixing' ? (
                    <div className="downloads-metric">
                      <div className="downloads-metric-label">SEEDS</div>
                      <div className="downloads-metric-value">{Number.isFinite(primary.seeds) ? String(primary.seeds) : '--'}</div>
                    </div>
                  ) : (
                    <div className="downloads-metric">
                      <div className="downloads-metric-label">SEEDS</div>
                      <div className="downloads-metric-value">--</div>
                    </div>
                  )}
                  {primary.status !== 'extracting' && primary.status !== 'prefixing' ? (
                    <div className="downloads-metric">
                      <div className="downloads-metric-label">PEERS</div>
                      <div className="downloads-metric-value">{Number.isFinite(primary.peers) ? String(primary.peers) : '--'}</div>
                    </div>
                  ) : (
                    <div className="downloads-metric">
                      <div className="downloads-metric-label">PEERS</div>
                      <div className="downloads-metric-value">--</div>
                    </div>
                  )}
                </div>

                <div className="downloads-hero-progress">
                  <div className="downloads-hero-progress-top">
                    <div className="downloads-hero-progress-main">
                      {primary.status === 'prefixing'
                        ? `Prefixo ${(primaryUiProgress ?? 0).toFixed(1)}%`
                        : primary.status === 'extracting'
                        ? `Extraindo ${(primaryUiProgress ?? 0).toFixed(1)}%`
                        : `${(primary.progress ?? 0).toFixed(1)}%`}
                    </div>
                    <div className="downloads-hero-progress-sub">
                      {primary.status === 'prefixing'
                        ? <span>{primary.prefixMessage ? primary.prefixMessage : 'Preparando…'}</span>
                        : primary.status === 'extracting'
                        ? <span>ETA: {formatEta(primary.extractEta)}</span>
                        : <span>{formatBytes(primary.downloaded)} / {formatBytes(primary.total)}</span>}
                    </div>
                  </div>
                  <div className="download-progress download-progress--primary">
                    <div
                      className="download-progress-bar"
                      style={{
                        width: `${(primaryUiProgress ?? 0)}%`,
                        background: primary.status === 'extracting'
                          ? 'linear-gradient(90deg, #8b5cf6, #7c3aed)'
                          : primary.status === 'prefixing'
                            ? 'linear-gradient(90deg, #a855f7, #9333ea)'
                            : undefined
                      }}
                    />
                  </div>
                  {primary.status === 'error' && primary.errorMessage ? (
                    <div className="download-error" title={primary.errorMessage}>• {primary.errorMessage}</div>
                  ) : null}
                </div>
              </div>

              <div className="downloads-hero-right">
                <RateGraph samples={primary.status === 'prefixing' ? [] : primaryRateSamples} stage={primaryStage} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {queue.length > 0 ? (
        <div className="downloads-section downloads-section--queue">
          <div className="downloads-section-header">
            <div className="downloads-section-title">Fila</div>
            <div className="downloads-section-meta">
              <span className="downloads-pill">{queue.length} item(s)</span>
            </div>
          </div>
          <div className="downloads-list">
            {queue.map(d => (
              <DownloadCard key={downloadKey(d)} item={d} variant="queue" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
