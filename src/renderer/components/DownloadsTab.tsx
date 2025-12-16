import React, { useState, useEffect, useRef } from 'react'
import { Download, Pause, Play, X } from 'lucide-react'

interface DownloadItem {
  id: string
  dbId?: number
  title: string
  type: 'http' | 'torrent'
  url: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'extracting'
  errorMessage?: string
  speed?: number
  eta?: number
  size?: number
  downloaded?: number
  total?: number
  infoHash?: string
  destPath?: string
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
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map())

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
    completed: 5,
    extracting: 4,
    downloading: 3,
    pending: 3,
    paused: 2,
    error: 1
  }

  const mergeDownloads = (a: DownloadItem, b: DownloadItem): DownloadItem => {
    const chooseStatus =
      statusPriority[a.status] >= statusPriority[b.status] ? a.status : b.status
    const maxProgress = Math.max(a.progress ?? 0, b.progress ?? 0)
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
      progress: maxProgress,
      status: chooseStatus,
      speed: pick(a.speed, b.speed),
      eta: pick(a.eta, b.eta),
      downloaded: pick(a.downloaded, b.downloaded),
      total: pick(a.total, b.total),
      destPath: pick(a.destPath, b.destPath),
      stage: pick(a.stage, b.stage),
      extractProgress: pick(a.extractProgress, b.extractProgress)
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
                hasChanges = true
                const nextStatus: DownloadItem['status'] =
                  updateData.stage === 'extract'
                    ? 'extracting'
                    : updateData.progress >= 100
                      ? 'completed'
                      : d.status === 'paused'
                        ? 'paused'
                        : 'downloading'

                const merged = mergeDownloads(d, {
                  ...d,
                  progress: updateData.stage === 'extract' ? (updateData.extractProgress ?? updateData.progress) : updateData.progress,
                  status: nextStatus,
                  infoHash: updateData.infoHash || d.infoHash,
                  speed: updateData.speed ?? d.speed,
                  eta: updateData.stage === 'extract' ? d.eta : (updateData.eta ?? d.eta),
                  extractEta: updateData.stage === 'extract' ? (updateData.eta ?? d.extractEta) : d.extractEta,
                  downloaded: updateData.downloaded ?? d.downloaded,
                  total: updateData.total ?? d.total,
                  destPath: updateData.destPath || d.destPath,
                  stage: (updateData.stage as any) || d.stage,
                  extractProgress: updateData.extractProgress ?? d.extractProgress
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

            const newItem: DownloadItem = {
              id: url || key || Math.random().toString(36).slice(2),
              title: title.replace(/%20/g, ' '),
              type: type as 'http' | 'torrent',
              url: url || key,
              progress: updateData.stage === 'extract' ? (updateData.extractProgress ?? updateData.progress) : updateData.progress,
              status: updateData.stage === 'extract' ? 'extracting' : updateData.progress >= 100 ? 'completed' : 'downloading',
              infoHash: updateData.infoHash,
              speed: updateData.speed,
              eta: updateData.stage === 'extract' ? undefined : updateData.eta,
              extractEta: updateData.stage === 'extract' ? updateData.eta : undefined,
              downloaded: updateData.downloaded,
              total: updateData.total,
              destPath: updateData.destPath,
              stage: updateData.stage as any,
              extractProgress: updateData.extractProgress
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
          const active = updated.some(d => d.status === 'pending' || d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting')
          setHasActive(active)
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
    // Keep if in progress
    if (d.status === 'pending' || d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting') {
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
            destPath: dirFromPath(d.dest_path) || undefined
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
            destPath: d.dest_path || undefined
          }))
        : []

      // Filter downloads - only keep active ones and HTTP completed with pending extraction
      const merged = [...mappedCompleted, ...mappedActive].filter(shouldKeepDownload)
      const deduped = dedupeDownloads(merged)
      setDownloads(deduped)
      setHasActive(deduped.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting'))
    }
    loadDownloads()

    const sub = window.electronAPI.onDownloadProgress((data) => {
      // Use throttled update to prevent flickering
      scheduleThrottledUpdate(data)
    })

    const completeSub = window.electronAPI.onDownloadComplete((data) => {
      setDownloads(prev => {
        const updated: DownloadItem[] = prev.map(d => {
          const matchKey = data.infoHash || data.magnet
          if (matchKey && (d.infoHash === matchKey || d.url === matchKey || d.id === matchKey)) {
            return { ...d, status: 'completed' as const, progress: 100, destPath: data.destPath || d.destPath }
          }
          return d
        })
        // Filter out completed torrents (they don't need extraction)
        const filtered = updated.filter(shouldKeepDownload)
        const active = filtered.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting')
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
              destPath: dirFromPath(d.dest_path) || undefined
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
              destPath: d.dest_path || undefined
            }))
          : []

        const merged = [...mappedCompleted, ...mappedActive].filter(shouldKeepDownload)
        const deduped = dedupeDownloads(merged)
        setDownloads(deduped)
        setHasActive(deduped.some(d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting'))
      }).catch(() => {})
    })
    return () => {
      // Cleanup subscriptions
      if (typeof sub === 'function') sub()
      if (typeof completeSub === 'function') completeSub()
      if (typeof deleteSub === 'function') deleteSub()

      // Clear any pending throttle timer
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }

      // Clear pending updates
      pendingUpdatesRef.current.clear()
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
    <div className="downloads-list">
      {downloads.map((download) => (
        <div key={downloadKey(download)} className="download-item">
          <div className="download-header">
            <div>
              <div className="download-title">{download.title}</div>
              <div className="download-status" style={{ color: getStatusColor(download.status) }}>
                {getStatusText(download.status)}
                {download.type === 'torrent' && ' • Torrent'}
                {download.type === 'http' && ' • HTTP'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Active download controls: Pause/Resume and Cancel */}
              {download.status === 'downloading' && (
                <button
                  onClick={() => handlePause(download)}
                  style={{
                    padding: '8px',
                    background: '#f59e0b',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                  title="Pausar"
                >
                  <Pause size={16} />
                </button>
              )}
              {download.status === 'paused' && (
                <button
                  onClick={() => handleResume(download)}
                  style={{
                    padding: '8px',
                    background: '#3b82f6',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                  title="Continuar"
                >
                  <Play size={16} />
                </button>
              )}
              {/* Cancel button - show during active and error states */}
              {(download.status === 'pending' || download.status === 'downloading' || download.status === 'paused' || download.status === 'extracting' || download.status === 'error') && (
                <button
                  onClick={() => handleCancel(download)}
                  style={{
                    padding: '8px',
                    background: '#ef4444',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                  title="Cancelar"
                >
                  <X size={16} />
                </button>
              )}
              {/* Completed download controls: Extract and Open folder */}
              {download.status === 'completed' && (
                <>
                  <button
                    onClick={() => handleExtract(download)}
                    disabled={!download.destPath}
                    style={{
                      padding: '8px',
                      background: download.destPath ? '#8b5cf6' : '#2a2a2a',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      cursor: download.destPath ? 'pointer' : 'not-allowed',
                      opacity: download.destPath ? 1 : 0.6
                    }}
                    title={download.destPath ? 'Extrair' : 'Caminho indisponível'}
                  >
                    Extrair
                  </button>
                  <button
                    onClick={() => {
                      if (download.destPath) {
                        window.electronAPI.openPath(download.destPath)
                      }
                    }}
                    disabled={!download.destPath}
                    style={{
                      padding: '8px',
                      background: download.destPath ? '#16a34a' : '#2a2a2a',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      cursor: download.destPath ? 'pointer' : 'not-allowed',
                      opacity: download.destPath ? 1 : 0.6
                    }}
                    title={download.destPath ? 'Abrir pasta' : 'Caminho indisponível'}
                  >
                    Abrir pasta
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="download-progress">
            <div
              className="download-progress-bar"
              style={{ width: `${download.progress}%` }}
            />
          </div>

            <div className="download-info">
              <span>
                {download.status === 'extracting'
                  ? `Extraindo ${download.extractProgress?.toFixed(1) ?? download.progress.toFixed(1)}%`
                  : `${download.progress.toFixed(1)}%`}
              </span>
              {download.status === 'error' && download.errorMessage ? (
                <span title={download.errorMessage} style={{ color: '#ef4444' }}>
                  • {download.errorMessage}
                </span>
              ) : null}
              {download.status === 'extracting' ? (
                <>
                  <span>• ETA: {formatEta(download.extractEta)}</span>
                </>
              ) : (
                <>
                  <span>• {formatBytes(download.downloaded)} / {formatBytes(download.total)}</span>
                  <span>• {formatBytes(download.speed)}/s</span>
                  <span>• ETA: {formatEta(download.eta)}</span>
                </>
              )}
            </div>
        </div>
      ))}
    </div>
  )
}
