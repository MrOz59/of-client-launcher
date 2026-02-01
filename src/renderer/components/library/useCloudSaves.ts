import { useState, useRef, useCallback, useEffect } from 'react'
import type { CloudSavesBannerState, SaveSyncJobState } from './types'

export function useCloudSaves() {
  const [cloudSavesBanner, setCloudSavesBanner] = useState<CloudSavesBannerState | null>(null)
  const cloudBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [saveSyncJobs, setSaveSyncJobs] = useState<Record<string, SaveSyncJobState>>({})
  const saveSyncLockRef = useRef<Record<string, boolean>>({})

  const openCloudBackupsForBanner = useCallback(async () => {
    try {
      if (!cloudSavesBanner?.gameUrl) return
      const api: any = (window as any).electronAPI
      const res = await api?.cloudSavesOpenBackups?.(cloudSavesBanner.gameUrl)
      if (res && res.success === false) alert(res.error || 'Falha ao abrir pasta de backups')
    } catch (e: any) {
      alert(e?.message || 'Falha ao abrir pasta de backups')
    }
  }, [cloudSavesBanner?.gameUrl])

  const runSaveSync = useCallback(async (gameUrl: string, reason: 'manual' | 'game_exited') => {
    if (!gameUrl) return
    if (saveSyncLockRef.current[gameUrl]) return

    saveSyncLockRef.current[gameUrl] = true
    setSaveSyncJobs(prev => ({
      ...prev,
      [gameUrl]: { status: 'syncing', message: reason === 'manual' ? 'Sincronizando...' : 'Backup de saves (ao fechar)...', updatedAt: Date.now() }
    }))

    try {
      const fn = window.electronAPI?.syncGameSaves
      if (typeof fn !== 'function') throw new Error('API de sincronização de saves não existe no preload (syncGameSaves).')

      const res: any = await fn(gameUrl)

      if (!res?.success) {
        throw new Error(res?.error || 'Falha ao sincronizar saves')
      }

      setSaveSyncJobs(prev => ({
        ...prev,
        [gameUrl]: { status: 'done', message: 'Saves sincronizados', updatedAt: Date.now() }
      }))

      // Clear badge after a while
      setTimeout(() => {
        setSaveSyncJobs(p => {
          const cur = p[gameUrl]
          if (!cur || cur.status === 'syncing') return p
          const next = { ...p }
          delete next[gameUrl]
          return next
        })
      }, 2500)
    } catch (err: any) {
      setSaveSyncJobs(prev => ({
        ...prev,
        [gameUrl]: { status: 'error', message: err?.message || 'Erro ao sincronizar saves', updatedAt: Date.now() }
      }))
    } finally {
      saveSyncLockRef.current[gameUrl] = false
    }
  }, [])

  const closeBanner = useCallback(() => {
    setCloudSavesBanner(null)
  }, [])

  // Listen for cloud saves status
  useEffect(() => {
    const api: any = (window as any).electronAPI
    if (!api?.onCloudSavesStatus) return

    const off = api.onCloudSavesStatus((data: any) => {
      try {
        if (!data?.message) return
        const level = (data.level || 'info') as any
        setCloudSavesBanner({
          level,
          message: String(data.message),
          gameUrl: data.gameUrl ? String(data.gameUrl) : undefined,
          at: Number(data.at || Date.now()),
          conflict: !!data.conflict
        })
        if (cloudBannerTimerRef.current) {
          clearTimeout(cloudBannerTimerRef.current)
          cloudBannerTimerRef.current = null
        }
        const ms = level === 'warning' || level === 'error' ? 12000 : 6000
        cloudBannerTimerRef.current = setTimeout(() => {
          setCloudSavesBanner(null)
          cloudBannerTimerRef.current = null
        }, ms)
      } catch {
        // ignore
      }
    })

    return () => {
      try { off?.() } catch {}
      if (cloudBannerTimerRef.current) {
        clearTimeout(cloudBannerTimerRef.current)
        cloudBannerTimerRef.current = null
      }
    }
  }, [])

  return {
    cloudSavesBanner,
    setCloudSavesBanner,
    saveSyncJobs,
    setSaveSyncJobs,
    openCloudBackupsForBanner,
    runSaveSync,
    closeBanner
  }
}
