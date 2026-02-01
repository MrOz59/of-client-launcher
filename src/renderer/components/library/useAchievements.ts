import { useState, useRef, useEffect, useCallback } from 'react'
import type { AchievementProgress } from './types'

export interface AchievementsState {
  // Modal state
  modalGameUrl: string | null
  modalTitle: string
  modalLoading: boolean
  modalError: string | null
  modalSources: any[]
  modalItems: any[]
  revealedHiddenIds: Record<string, boolean>
  schemaRefreshedOnce: boolean

  // Schema editor
  schemaEditorOpen: boolean
  schemaEditorValue: string
  schemaEditorError: string | null
  schemaEditorBusy: boolean

  // Progress cache by game
  progressByGameUrl: Record<string, AchievementProgress>
}

export function useAchievements() {
  // Modal state
  const [modalGameUrl, setModalGameUrl] = useState<string | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSources, setModalSources] = useState<any[]>([])
  const [modalItems, setModalItems] = useState<any[]>([])
  const [revealedHiddenIds, setRevealedHiddenIds] = useState<Record<string, boolean>>({})
  const [schemaRefreshedOnce, setSchemaRefreshedOnce] = useState(false)

  // Schema editor
  const [schemaEditorOpen, setSchemaEditorOpen] = useState(false)
  const [schemaEditorValue, setSchemaEditorValue] = useState('')
  const [schemaEditorError, setSchemaEditorError] = useState<string | null>(null)
  const [schemaEditorBusy, setSchemaEditorBusy] = useState(false)

  // Progress cache by game
  const [progressByGameUrl, setProgressByGameUrl] = useState<Record<string, AchievementProgress>>({})
  const achvRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const updateProgress = useCallback((gameUrl: string, items: any[]) => {
    const url = String(gameUrl || '').trim()
    if (!url) return
    const list = Array.isArray(items) ? items : []
    const total = list.length
    const unlocked = list.filter((a: any) => !!a?.unlocked).length
    const complete = total > 0 && unlocked === total

    setProgressByGameUrl((prev) => {
      const cur = prev[url]
      if (cur && cur.complete === complete && cur.total === total && cur.unlocked === unlocked) return prev
      return { ...prev, [url]: { complete, total, unlocked, updatedAt: Date.now() } }
    })
  }, [])

  const loadAchievementsForGameUrl = useCallback(async (gameUrl: string) => {
    setModalLoading(true)
    setModalError(null)
    try {
      const res: any = await window.electronAPI.getGameAchievements(gameUrl)
      if (!res?.success) {
        setModalError(res?.error || 'Falha ao carregar conquistas')
        setModalSources([])
        setModalItems([])
        return
      }
      setModalSources(Array.isArray(res.sources) ? res.sources : [])
      const items = Array.isArray(res.achievements) ? res.achievements : []
      setModalItems(items)
      updateProgress(gameUrl, items)
    } catch (e: any) {
      setModalError(e?.message || 'Falha ao carregar conquistas')
      setModalSources([])
      setModalItems([])
    } finally {
      setModalLoading(false)
    }
  }, [updateProgress])

  const closeModal = useCallback(() => {
    setModalGameUrl(null)
    setModalTitle('')
    setModalLoading(false)
    setModalError(null)
    setModalSources([])
    setModalItems([])
    setRevealedHiddenIds({})
    setSchemaRefreshedOnce(false)
  }, [])

  const openModal = useCallback((gameUrl: string, gameTitle: string) => {
    setModalGameUrl(gameUrl)
    setModalTitle(gameTitle || 'Jogo')
    setRevealedHiddenIds({})
    setSchemaRefreshedOnce(false)
    void loadAchievementsForGameUrl(gameUrl)
  }, [loadAchievementsForGameUrl])

  const buildSchemaTemplate = useCallback((items: any[]) => {
    const list = Array.isArray(items) ? items : []
    const mapped = list
      .map((it) => ({
        id: String(it?.id || '').trim(),
        name: String(it?.name || it?.title || '').trim(),
        description: it?.description ? String(it.description).trim() : undefined,
        iconUrl: it?.iconUrl ? String(it.iconUrl).trim() : undefined,
        hidden: typeof it?.hidden === 'boolean' ? it.hidden : undefined
      }))
      .filter((it) => it.id && it.name)
    return { items: mapped }
  }, [])

  const openSchemaEditor = useCallback((useTemplate: boolean) => {
    const template = useTemplate ? buildSchemaTemplate(modalItems) : { items: [] as any[] }
    setSchemaEditorValue(JSON.stringify(template, null, 2))
    setSchemaEditorError(null)
    setSchemaEditorOpen(true)
  }, [buildSchemaTemplate, modalItems])

  const revealHiddenAchievement = useCallback((achievementId: string) => {
    setRevealedHiddenIds(prev => ({ ...prev, [achievementId]: true }))
  }, [])

  // Listen for achievement unlocks
  useEffect(() => {
    const api: any = (window as any).electronAPI
    if (!api?.onAchievementUnlocked || !api?.getGameAchievements) return

    const off = api.onAchievementUnlocked((ev: any) => {
      const gameUrl = String(ev?.gameUrl || '').trim()
      if (!gameUrl) return

      // Debounce by game (avoid multiple refetches if events come in sequence)
      const prev = achvRefreshTimersRef.current.get(gameUrl)
      if (prev) clearTimeout(prev)
      const t = setTimeout(async () => {
        achvRefreshTimersRef.current.delete(gameUrl)
        try {
          const res: any = await api.getGameAchievements(gameUrl)
          if (res?.success && Array.isArray(res.achievements)) {
            updateProgress(gameUrl, res.achievements)
            // If modal is open for this game, update list too
            if (modalGameUrl === gameUrl) {
              setModalItems(res.achievements)
            }
          }
        } catch {
          // ignore
        }
      }, 700)
      achvRefreshTimersRef.current.set(gameUrl, t)
    })

    return () => {
      try { off?.() } catch {}
      for (const t of achvRefreshTimersRef.current.values()) {
        try { clearTimeout(t) } catch {}
      }
      achvRefreshTimersRef.current.clear()
    }
  }, [modalGameUrl, updateProgress])

  return {
    // Modal state
    modalGameUrl,
    modalTitle,
    modalLoading,
    modalError,
    modalSources,
    modalItems,
    revealedHiddenIds,
    schemaRefreshedOnce,
    setSchemaRefreshedOnce,

    // Schema editor
    schemaEditorOpen,
    setSchemaEditorOpen,
    schemaEditorValue,
    setSchemaEditorValue,
    schemaEditorError,
    setSchemaEditorError,
    schemaEditorBusy,
    setSchemaEditorBusy,

    // Progress
    progressByGameUrl,
    setProgressByGameUrl,

    // Actions
    openModal,
    closeModal,
    loadAchievementsForGameUrl,
    updateProgress,
    buildSchemaTemplate,
    openSchemaEditor,
    revealHiddenAchievement
  }
}
