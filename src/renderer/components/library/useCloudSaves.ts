import { useState, useRef, useCallback, useEffect } from 'react'
import type { CloudSavesBannerState, SaveSyncJobState } from './types'
import { useI18n } from '../../i18n'

export function useCloudSaves() {
  const { t } = useI18n()
  const [cloudSavesBanner, setCloudSavesBanner] = useState<CloudSavesBannerState | null>(null)
  const cloudBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [saveSyncJobs, setSaveSyncJobs] = useState<Record<string, SaveSyncJobState>>({})
  const saveSyncLockRef = useRef<Record<string, boolean>>({})

  const openCloudBackupsForBanner = useCallback(async () => {
    try {
      if (!cloudSavesBanner?.gameUrl) return
      const api: any = (window as any).electronAPI
      const res = await api?.cloudSavesOpenBackups?.(cloudSavesBanner.gameUrl)
      if (res && res.success === false) alert(res.error || t('library.cloudSaves.openBackupsFailed'))
    } catch (e: any) {
      alert(e?.message || t('library.cloudSaves.openBackupsFailed'))
    }
  }, [cloudSavesBanner?.gameUrl, t])

  const runSaveSync = useCallback(async (gameUrl: string, reason: 'manual' | 'game_exited') => {
    if (!gameUrl) return
    if (saveSyncLockRef.current[gameUrl]) return

    saveSyncLockRef.current[gameUrl] = true
    setSaveSyncJobs(prev => ({
      ...prev,
      [gameUrl]: { status: 'syncing', message: reason === 'manual' ? t('library.cloudSaves.syncing') : t('library.cloudSaves.backupOnExit'), updatedAt: Date.now() }
    }))

    try {
      const fn = window.electronAPI?.syncGameSaves
      if (typeof fn !== 'function') throw new Error(t('library.cloudSaves.apiMissing'))

      const res: any = await fn(gameUrl)

      if (!res?.success) {
        throw new Error(res?.error || t('library.cloudSaves.syncFailed'))
      }

      setSaveSyncJobs(prev => ({
        ...prev,
        [gameUrl]: { status: 'done', message: t('library.cloudSaves.synced'), updatedAt: Date.now() }
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
        [gameUrl]: { status: 'error', message: err?.message || t('library.cloudSaves.syncError'), updatedAt: Date.now() }
      }))
    } finally {
      saveSyncLockRef.current[gameUrl] = false
    }
  }, [t])

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
