import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Play, Trash2, RefreshCw, Folder, Library, AlertCircle, Settings, Download, Square, FileText, Trophy, Star, MoreVertical, Search } from 'lucide-react'

interface Game {
  id: number
  title: string
  url: string
  installed_version: string | null
  latest_version: string | null
  install_path?: string
  image_url?: string
  executable_path?: string | null
  proton_runtime?: string | null
  proton_options?: string | null
  download_url?: string | null
  torrent_magnet?: string | null
  proton_prefix?: string | null
  steam_app_id?: string | null
  lan_mode?: string | null
  lan_network_id?: string | null
  lan_autoconnect?: number | null

  // DB metadata
  last_played?: string | null
  file_size?: string | null
  is_favorite?: number | boolean | null
}

export default function LibraryTab() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [librarySearch, setLibrarySearch] = useState<string>('')
  const [libraryCategory, setLibraryCategory] = useState<'all' | 'favorites' | 'installed' | 'updating'>('all')
  const [librarySort, setLibrarySort] = useState<'recent' | 'name' | 'size'>('recent')
  const [openActionMenuGameUrl, setOpenActionMenuGameUrl] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [versionValue, setVersionValue] = useState<string>('')
  const [titleValue, setTitleValue] = useState<string>('')
  const [protonVersion, setProtonVersion] = useState<string>('')
  const [protonOptions, setProtonOptions] = useState({
    esync: true,
    fsync: true,
    dxvk: true,
    mesa_glthread: false,
    locale: '',
    gamemode: false,
    mangohud: false,
    logging: false,
    launchArgs: ''
  })
  const [showConfig, setShowConfig] = useState<string | null>(null)
  type GameConfigTab = 'geral' | 'onlinefix' | 'proton' | 'lan'
  const [configTab, setConfigTab] = useState<GameConfigTab>('geral')
  const [configSaveState, setConfigSaveState] = useState<{
    status: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
    message?: string
    updatedAt: number
  }>({ status: 'idle', updatedAt: 0 })
  const configAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configAutosaveQueueRef = useRef(Promise.resolve())
  const suppressConfigAutosaveRef = useRef(false)
  const lastSavedConfigRef = useRef<{
    title: string
    version: string
    protonRuntime: string
    protonOptionsJson: string
    protonPrefix: string
    steamAppId: string | null
    lanMode: 'steam' | 'ofvpn'
    lanNetworkId: string
    lanAutoconnect: boolean
  } | null>(null)
  const [protonRuntimes, setProtonRuntimes] = useState<Array<{ name: string; path: string; runner: string; source: string }>>([])
  const [protonRootInput, setProtonRootInput] = useState('')
  const [iniContent, setIniContent] = useState('')
  const [iniPath, setIniPath] = useState<string | null>(null)
  const [iniLoading, setIniLoading] = useState(false)
  const [iniSaving, setIniSaving] = useState(false)
  const [iniError, setIniError] = useState<string | null>(null)
  const [iniDirty, setIniDirty] = useState(false)
  const [iniFields, setIniFields] = useState<Array<{ key: string; value: string }>>([])
  const [iniOriginalContent, setIniOriginalContent] = useState('')
  const [bannerLoading, setBannerLoading] = useState<string | null>(null)
  const [bannerManualUrl, setBannerManualUrl] = useState<string>('')
  const [bannerManualBusy, setBannerManualBusy] = useState<boolean>(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [scanningInstalled, setScanningInstalled] = useState(false)
  const [updateQueue, setUpdateQueue] = useState<{ running: boolean; queued: number; currentGameUrl?: string | null; lastError?: string | null; updatedAt: number }>(
    { running: false, queued: 0, currentGameUrl: null, lastError: null, updatedAt: 0 }
  )
  const [updatingGames, setUpdatingGames] = useState<Record<string, { status: 'starting' | 'downloading'; id?: string }>>({})
  const gamesRef = useRef<Game[]>([])
  const downloadKeyToGameUrlRef = useRef<Map<string, string>>(new Map())
  const [protonPrefix, setProtonPrefix] = useState<string>('')
  const [steamAppId, setSteamAppId] = useState<string>('')
  type LanMode = 'steam' | 'ofvpn'
  const [lanMode, setLanMode] = useState<LanMode>('steam')
  const [lanNetworkId, setLanNetworkId] = useState<string>('')
  const [lanAutoconnect, setLanAutoconnect] = useState<boolean>(false)
  const [lanDefaultNetworkId, setLanDefaultNetworkId] = useState<string>('')
  const [lanRoomCode, setLanRoomCode] = useState<string>('')
  const [lanRoomBusy, setLanRoomBusy] = useState<boolean>(false)
  const [lanRoomLastCode, setLanRoomLastCode] = useState<string>('')

  const [vpnLoading, setVpnLoading] = useState(false)
  const [vpnHasLoaded, setVpnHasLoaded] = useState(false)
  const vpnHasLoadedRef = useRef(false)
  const [vpnError, setVpnError] = useState<string | null>(null)
  const [vpnStatus, setVpnStatus] = useState<any>(null)
  const [vpnPeers, setVpnPeers] = useState<any[]>([])
  const [vpnActionBusy, setVpnActionBusy] = useState(false)
  const [vpnConfig, setVpnConfig] = useState<string>('')
  const [vpnLocalIp, setVpnLocalIp] = useState<string>('')
  const [vpnHostIp, setVpnHostIp] = useState<string>('')
  const [vpnConnected, setVpnConnected] = useState<boolean>(false)
  const [iniLastSavedAt, setIniLastSavedAt] = useState<number | null>(null)
  const iniAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [launchingGames, setLaunchingGames] = useState<Record<string, { status: 'starting' | 'running' | 'exited' | 'error'; pid?: number; code?: number | null; message?: string; stderrTail?: string; protonLogPath?: string; updatedAt: number }>>({})
  const [prefixJobs, setPrefixJobs] = useState<Record<string, { status: 'starting' | 'progress' | 'done' | 'error'; message?: string; prefix?: string; updatedAt: number }>>({})

  // ✅ NOVO: Jobs de sync de saves (manual + automático)
  const [saveSyncJobs, setSaveSyncJobs] = useState<Record<string, { status: 'syncing' | 'done' | 'error'; message?: string; updatedAt: number }>>({})
  const saveSyncLockRef = useRef<Record<string, boolean>>({})

  // ✅ NOVO: cache de progresso de conquistas por jogo (para pintar o ícone quando 100%)
  const [achievementsProgressByGameUrl, setAchievementsProgressByGameUrl] = useState<Record<string, { complete: boolean; total: number; unlocked: number; updatedAt: number }>>({})
  const achvRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const [cloudSavesBanner, setCloudSavesBanner] = useState<{
    level: 'info' | 'success' | 'warning' | 'error'
    message: string
    gameUrl?: string
    at: number
    conflict?: boolean
  } | null>(null)
  const cloudBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ✅ NOVO: tela (modal) de conquistas por jogo
  const [achievementsModalGameUrl, setAchievementsModalGameUrl] = useState<string | null>(null)
  const [achievementsModalTitle, setAchievementsModalTitle] = useState<string>('')
  const [achievementsModalLoading, setAchievementsModalLoading] = useState(false)
  const [achievementsModalError, setAchievementsModalError] = useState<string | null>(null)
  const [achievementsModalSources, setAchievementsModalSources] = useState<any[]>([])
  const [achievementsModalItems, setAchievementsModalItems] = useState<any[]>([])
  const [revealedHiddenAchievementIds, setRevealedHiddenAchievementIds] = useState<Record<string, boolean>>({})
  const [achievementSchemaRefreshedOnce, setAchievementSchemaRefreshedOnce] = useState(false)

  // FIX: Use refs to ensure we always have the latest values when saving
  const iniFieldsRef = useRef<Array<{ key: string; value: string }>>([])
  const iniOriginalContentRef = useRef<string>('')

  useEffect(() => { iniFieldsRef.current = iniFields }, [iniFields])
  useEffect(() => { iniOriginalContentRef.current = iniOriginalContent }, [iniOriginalContent])
  useEffect(() => {
    gamesRef.current = games
    const next = new Map<string, string>()
    try {
      for (const g of games || []) {
        const url = String((g as any)?.url || '').trim()
        if (!url) continue
        const magnet = String((g as any)?.torrent_magnet || '').trim()
        const dl = String((g as any)?.download_url || '').trim()
        if (magnet) next.set(magnet, url)
        if (dl) next.set(dl, url)
      }
    } catch {}
    downloadKeyToGameUrlRef.current = next
  }, [games])

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

  useEffect(() => {
    if (!openActionMenuGameUrl) return
    const onDocClick = () => setOpenActionMenuGameUrl(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenActionMenuGameUrl(null)
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [openActionMenuGameUrl])

  const openCloudBackupsForBanner = async () => {
    try {
      if (!cloudSavesBanner?.gameUrl) return
      const api: any = (window as any).electronAPI
      const res = await api?.cloudSavesOpenBackups?.(cloudSavesBanner.gameUrl)
      if (res && res.success === false) alert(res.error || 'Falha ao abrir pasta de backups')
    } catch (e: any) {
      alert(e?.message || 'Falha ao abrir pasta de backups')
    }
  }

  const closeAchievementsModal = () => {
    setAchievementsModalGameUrl(null)
    setAchievementsModalTitle('')
    setAchievementsModalLoading(false)
    setAchievementsModalError(null)
    setAchievementsModalSources([])
    setAchievementsModalItems([])
    setRevealedHiddenAchievementIds({})
    setAchievementSchemaRefreshedOnce(false)
  }

  const updateAchievementsProgress = (gameUrl: string, items: any[]) => {
    const url = String(gameUrl || '').trim()
    if (!url) return
    const list = Array.isArray(items) ? items : []
    const total = list.length
    const unlocked = list.filter((a: any) => !!a?.unlocked).length
    const complete = total > 0 && unlocked === total

    setAchievementsProgressByGameUrl((prev) => {
      const cur = prev[url]
      if (cur && cur.complete === complete && cur.total === total && cur.unlocked === unlocked) return prev
      return { ...prev, [url]: { complete, total, unlocked, updatedAt: Date.now() } }
    })
  }

  const loadAchievementsForGameUrl = async (gameUrl: string) => {
    setAchievementsModalLoading(true)
    setAchievementsModalError(null)
    try {
      const res: any = await window.electronAPI.getGameAchievements(gameUrl)
      if (!res?.success) {
        setAchievementsModalError(res?.error || 'Falha ao carregar conquistas')
        setAchievementsModalSources([])
        setAchievementsModalItems([])
        return
      }
      setAchievementsModalSources(Array.isArray(res.sources) ? res.sources : [])
      const items = Array.isArray(res.achievements) ? res.achievements : []
      setAchievementsModalItems(items)
      updateAchievementsProgress(gameUrl, items)
    } catch (e: any) {
      setAchievementsModalError(e?.message || 'Falha ao carregar conquistas')
      setAchievementsModalSources([])
      setAchievementsModalItems([])
    } finally {
      setAchievementsModalLoading(false)
    }
  }

  // Atualiza o cache de 100% quando uma conquista é desbloqueada (evento raro, pode refetchar sem pesar)
  useEffect(() => {
    const api: any = (window as any).electronAPI
    if (!api?.onAchievementUnlocked || !api?.getGameAchievements) return

    const off = api.onAchievementUnlocked((ev: any) => {
      const gameUrl = String(ev?.gameUrl || '').trim()
      if (!gameUrl) return

      // Debounce por jogo (evita múltiplos refetch se vierem eventos em sequência)
      const prev = achvRefreshTimersRef.current.get(gameUrl)
      if (prev) clearTimeout(prev)
      const t = setTimeout(async () => {
        achvRefreshTimersRef.current.delete(gameUrl)
        try {
          const res: any = await api.getGameAchievements(gameUrl)
          if (res?.success && Array.isArray(res.achievements)) {
            updateAchievementsProgress(gameUrl, res.achievements)
            // Se o modal estiver aberto nesse jogo, atualiza a lista também.
            if (achievementsModalGameUrl === gameUrl) {
              setAchievementsModalItems(res.achievements)
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
  }, [achievementsModalGameUrl])

  const openAchievementsModal = (game: Game) => {
    setAchievementsModalGameUrl(game.url)
    setAchievementsModalTitle(game.title || 'Jogo')
    setRevealedHiddenAchievementIds({})
    setAchievementSchemaRefreshedOnce(false)
    void loadAchievementsForGameUrl(game.url)
  }

  const spinnerStyles = `
    @keyframes of-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .of-spin { animation: of-spin 0.9s linear infinite; }

    /* Achievements 100%: mantém o SVG nítido (sem scale) e anima um "ring" no botão */
    .action-btn.achievements { position: relative; }
    .action-btn.achievements svg { shape-rendering: geometricPrecision; }

    @keyframes of-achv-ring {
      0%, 100% { transform: scale(1); opacity: 0.35; }
      50% { transform: scale(1.18); opacity: 0.0; }
    }
    .action-btn.achievements.of-achv-complete-btn {
      background: rgba(245, 158, 11, 0.14);
    }
    .action-btn.achievements.of-achv-complete-btn:hover {
      background: rgba(245, 158, 11, 0.18);
      color: #fff;
    }
    .action-btn.achievements.of-achv-complete-btn::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 10px;
      border: 1px solid rgba(245, 158, 11, 0.55);
      pointer-events: none;
      transform-origin: 50% 50%;
      animation: of-achv-ring 1.8s ease-out infinite;
    }
    .of-achv-complete {
      color: #f59e0b;
      filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.28));
    }

    .action-btn.favorite.active {
      background: rgba(245, 158, 11, 0.14);
      color: #f59e0b;
    }
    .action-btn.favorite.active:hover {
      background: rgba(245, 158, 11, 0.18);
      color: #fff;
    }
  `

  const filteredGames = useMemo(() => {
    const norm = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')

    const parseSizeToBytes = (raw: any): number => {
      const s = String(raw || '').trim()
      if (!s) return 0
      if (/^\d+$/.test(s)) return Number(s) || 0
      const m = s.replace(',', '.').match(/([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)/i)
      if (!m) return 0
      const n = Number(m[1])
      if (!Number.isFinite(n)) return 0
      const unit = String(m[2]).toLowerCase()
      const isI = unit.endsWith('ib')
      const base = isI ? 1024 : 1000
      const pow = unit.startsWith('t') ? 4 : unit.startsWith('g') ? 3 : unit.startsWith('m') ? 2 : unit.startsWith('k') ? 1 : 0
      return Math.round(n * Math.pow(base, pow))
    }

    const safeDateMs = (v: any) => {
      if (v == null) return 0
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return 0
        // Suporta timestamps em ms (13 dígitos) ou em segundos (10 dígitos)
        return v > 1e12 ? v : Math.round(v * 1000)
      }
      const s = String(v).trim()
      if (!s) return 0
      if (/^\d+$/.test(s)) {
        const n = Number(s)
        if (!Number.isFinite(n)) return 0
        return n > 1e12 ? n : Math.round(n * 1000)
      }
      const t = Date.parse(s)
      return Number.isFinite(t) ? t : 0
    }

    const isUpdating = (gameUrl: string) => {
      if (!gameUrl) return false
      if ((updatingGames as any)?.[gameUrl]) return true
      if (updateQueue?.running && updateQueue?.currentGameUrl === gameUrl) return true
      return false
    }

    const qRaw = String(librarySearch || '').trim()
    let list = (games || []).slice()

    if (qRaw) {
      const q = norm(qRaw)
      list = list.filter((g) => norm(String(g?.title || '')).includes(q))
    }

    if (libraryCategory !== 'all') {
      list = list.filter((g) => {
        const url = String(g?.url || '')
        const installed = !!(g as any)?.install_path || !!(g as any)?.installed_version
        const fav = !!(g as any)?.is_favorite
        if (libraryCategory === 'favorites') return fav
        if (libraryCategory === 'installed') return installed
        if (libraryCategory === 'updating') return isUpdating(url)
        return true
      })
    }

    list.sort((a, b) => {
      if (librarySort === 'name') {
        return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
      }
      if (librarySort === 'size') {
        const av = parseSizeToBytes((a as any)?.file_size)
        const bv = parseSizeToBytes((b as any)?.file_size)
        if (bv !== av) return bv - av
        return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
      }
      const am = safeDateMs((a as any)?.last_played)
      const bm = safeDateMs((b as any)?.last_played)
      if (bm !== am) return bm - am
      return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
    })

    return list
  }, [games, librarySearch, libraryCategory, librarySort, updatingGames, updateQueue])

  const toggleFavorite = async (gameUrl: string) => {
    try {
      const fn = (window.electronAPI as any)?.toggleGameFavorite
      if (typeof fn !== 'function') throw new Error('API toggleGameFavorite não existe no preload')
      const res: any = await fn(gameUrl)
      if (!res?.success) throw new Error(res?.error || 'Falha ao atualizar favorito')
      setGames((prev) => (prev || []).map((g) => (g.url === gameUrl ? { ...g, is_favorite: res.isFavorite ? 1 : 0 } : g)))
    } catch (e: any) {
      alert(e?.message || 'Falha ao atualizar favorito')
    }
  }

  // FIX: força o seletor de abas do modal a ser "botão de verdade" (evita virar slider/barrinha por CSS global)
  const tabFixStyles = `
    .config-modal .config-tabs {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 8px !important;
      margin-top: 12px !important;
      background: rgba(255,255,255,0.03) !important;
      border: 1px solid rgba(255,255,255,0.08) !important;
      border-radius: 12px !important;
      min-height: 44px !important;
      overflow-x: auto !important;
      overflow-y: hidden !important;
    }
    .config-modal .config-tab-btn {
      appearance: none !important;
      -webkit-appearance: none !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      padding: 10px 12px !important;
      border-radius: 10px !important;
      background: transparent !important;
      border: 1px solid transparent !important;
      color: #e5e7eb !important;
      font-weight: 600 !important;
      font-size: 13px !important;
      line-height: 1 !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      user-select: none !important;
    }
    .config-modal .config-tab-btn:hover { background: rgba(255,255,255,0.04) !important; }
    .config-modal .config-tab-btn.active {
      background: rgba(255,255,255,0.10) !important;
      border-color: rgba(255,255,255,0.14) !important;
      color: #ffffff !important;
    }
    .config-modal .config-tabs::-webkit-scrollbar { height: 6px; }
    .config-modal .config-tabs::-webkit-scrollbar-track { background: transparent; }
    .config-modal .config-tabs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: 999px; }
  `

  // ✅ NOVO: função central de sync de saves (manual + game_exited)
  const runSaveSync = async (gameUrl: string, reason: 'manual' | 'game_exited') => {
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

      // limpa badge depois de um tempo
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
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.electronAPI.getSettings()
        if (cancelled) return
        if (res?.success && res.settings) {
          setLanDefaultNetworkId(String(res.settings?.lanDefaultNetworkId || '').trim())
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const resetIniState = () => {
    setIniContent('')
    setIniOriginalContent('')
    iniOriginalContentRef.current = ''
    setIniPath(null)
    setIniDirty(false)
    setIniError(null)
    setIniLoading(false)
    setIniSaving(false)
    setIniFields([])
    iniFieldsRef.current = []
    setIniLastSavedAt(null)
  }

  const parseIniFields = (text: string): Array<{ key: string; value: string }> => {
    const fields: Array<{ key: string; value: string }> = []
    const lines = (text || '').split(/\r?\n/)
    const kvRegex = /^\s*([^=;\[#]+?)\s*=\s*(.*)$/

    lines.forEach((line) => {
      const match = line.match(kvRegex)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim()
        if (key) fields.push({ key, value })
      }
    })
    return fields
  }

  const buildIniContent = (originalContent: string, fields: Array<{ key: string; value: string }>): string => {
    const validFields = fields.filter(f => f.key && f.key.trim())
    if (validFields.length === 0) return originalContent || ''
    if (!originalContent || originalContent.trim() === '') {
      return validFields.map(f => `${f.key}=${f.value}`).join('\n')
    }

    const fieldMap = new Map<string, string>()
    validFields.forEach(f => fieldMap.set(f.key.toLowerCase().trim(), f.value))

    const lines = originalContent.split(/\r?\n/)
    const kvRegex = /^(\s*)([^=;\[#]+?)(\s*=\s*)(.*)$/
    const usedKeys = new Set<string>()

    const updatedLines = lines.map(line => {
      const match = line.match(kvRegex)
      if (match) {
        const [, indent, key, separator] = match
        const keyLower = key.trim().toLowerCase()
        if (fieldMap.has(keyLower)) {
          usedKeys.add(keyLower)
          return `${indent}${key.trim()}${separator}${fieldMap.get(keyLower)}`
        }
      }
      return line
    })

    validFields.forEach(f => {
      const keyLower = f.key.toLowerCase().trim()
      if (!usedKeys.has(keyLower)) updatedLines.push(`${f.key}=${f.value}`)
    })

    return updatedLines.join('\n')
  }

  const buildCurrentIniText = (): string => {
    const currentFields = iniFieldsRef.current
    const currentOriginal = iniOriginalContentRef.current
    const validFields = currentFields.filter(f => f.key && f.key.trim())

    if (validFields.length === 0) return currentOriginal || iniContent || ''
    if (currentOriginal && currentOriginal.trim()) return buildIniContent(currentOriginal, validFields)
    return validFields.map(f => `${f.key}=${f.value}`).join('\n')
  }

  const updateIniField = (index: number, newValue: string) => {
    const newFields = [...iniFields]
    newFields[index] = { ...newFields[index], value: newValue }
    setIniFields(newFields)
    iniFieldsRef.current = newFields
    setIniDirty(true)
  }

  const updateIniFieldKey = (index: number, newKey: string) => {
    const newFields = [...iniFields]
    newFields[index] = { ...newFields[index], key: newKey }
    setIniFields(newFields)
    iniFieldsRef.current = newFields
    setIniDirty(true)
  }

  const addIniField = () => {
    const newFields = [...iniFields, { key: '', value: '' }]
    setIniFields(newFields)
    iniFieldsRef.current = newFields
    setIniDirty(true)
  }

  const removeIniField = (index: number) => {
    const newFields = iniFields.filter((_, i) => i !== index)
    setIniFields(newFields)
    iniFieldsRef.current = newFields
    setIniDirty(true)
  }

  useEffect(() => {
    loadGames()
    loadProtonRuntimes()
    refreshActiveUpdates()

    // Atualizações: o launcher verifica automaticamente ao iniciar.
    // (sem alertas pop-up aqui; só atualiza o DB/estado)
    ;(async () => {
      try {
        await window.electronAPI.checkAllUpdates?.()
        try { void loadGames() } catch {}
      } catch {
        // ignore
      }
    })()

    // Hydrate update queue status + subscribe to changes.
    ;(async () => {
      try {
        const res = await window.electronAPI.getUpdateQueueStatus?.()
        if (res?.success && res.status) setUpdateQueue(res.status)
      } catch {}
    })()

    const unsubQueue = window.electronAPI.onUpdateQueueStatus?.((data: any) => {
      try {
        if (!data) return
        const next = {
          running: !!data.running,
          queued: Number(data.queued) || 0,
          currentGameUrl: data.currentGameUrl ?? null,
          lastError: data.lastError ?? null,
          updatedAt: Number(data.updatedAt) || Date.now()
        }
        setUpdateQueue((prev) => {
          if (
            prev.running === next.running &&
            prev.queued === next.queued &&
            prev.currentGameUrl === next.currentGameUrl &&
            prev.lastError === next.lastError
          ) {
            return prev
          }
          return next
        })
      } catch {}
    })

    const refreshTimerRef = { current: null as any }

    const unsubVersion = window.electronAPI.onGameVersionUpdate((data) => {
      if (!data?.url) return
      setGames(prev => prev.map(g => g.url === data.url ? { ...g, latest_version: data.latest ?? g.latest_version } : g))
    })

    const unsubDownloadComplete = window.electronAPI.onDownloadComplete((data) => {
      const idKey = data?.infoHash || data?.magnet
      if (!idKey) return
      setUpdatingGames(prev => {
        const entry = Object.entries(prev).find(([, info]) => info.id === idKey)
        if (!entry) return prev
        const next = { ...prev }
        delete next[entry[0]]
        return next
      })

      // If an install path is provided, a game likely finished installing/extracting.
      // Reload library so the new installed entry appears.
      if (data?.destPath) {
        try {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = setTimeout(() => {
            try { void loadGames() } catch {}
          }, 600)
        } catch {
          // ignore
        }
      }
    })

    const unsubDownloadProgress = window.electronAPI.onDownloadProgress?.((data) => {
      const key = data?.infoHash || data?.magnet || data?.url
      if (!key) return
      setUpdatingGames(prev => {
        const keyStr = String(key)
        const gameUrl = downloadKeyToGameUrlRef.current.get(keyStr) || ''
        if (!gameUrl) return prev
        const cur = prev[gameUrl]
        if (cur && cur.status === 'downloading' && String(cur.id || '') === keyStr) return prev
        return { ...prev, [gameUrl]: { status: 'downloading', id: keyStr } }
      })
    })

    return () => {
      if (typeof unsubVersion === 'function') unsubVersion()
      if (typeof unsubDownloadComplete === 'function') unsubDownloadComplete()
      if (typeof unsubDownloadProgress === 'function') unsubDownloadProgress()
      if (typeof unsubQueue === 'function') unsubQueue()
      try {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      } catch {}
    }
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onGameLaunchStatus?.((data) => {
      if (!data?.gameUrl) return

      setLaunchingGames(prev => ({
        ...prev,
        [data.gameUrl]: {
          status: data.status,
          pid: data.pid,
          code: data.code,
          message: data.message,
          stderrTail: data.stderrTail,
          protonLogPath: data.protonLogPath,
          updatedAt: Date.now()
        }
      }))

      // ✅ NOVO: quando o jogo fechar (exit OK), sincroniza/backup do save no drive
      if (data.status === 'exited') {
        const ok = data.code == null || Number(data.code) === 0
        if (ok) {
          // pequeno delay pra garantir que o jogo terminou de escrever o save no disco
          setTimeout(() => { void runSaveSync(data.gameUrl, 'game_exited') }, 600)
        }
      }

      // Auto-clear successful exits after a short delay
      if (data.status === 'exited' && (data.code == null || Number(data.code) === 0)) {
        const url = data.gameUrl
        setTimeout(() => {
          setLaunchingGames(p => {
            const cur = p[url]
            if (!cur) return p
            if (cur.status !== 'exited') return p
            if (cur.code != null && Number(cur.code) !== 0) return p
            const next = { ...p }
            delete next[url]
            return next
          })
        }, 2500)
      }
    })
    return () => { try { unsub?.() } catch {} }
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onPrefixJobStatus?.((data) => {
      if (!data?.gameUrl) return
      setPrefixJobs(prev => ({
        ...prev,
        [data.gameUrl]: {
          status: data.status,
          message: data.message,
          prefix: data.prefix,
          updatedAt: Date.now()
        }
      }))

      if (data.status === 'done') {
        const url = data.gameUrl
        setTimeout(() => {
          setPrefixJobs(p => {
            const cur = p[url]
            if (!cur) return p
            if (cur.status !== 'done') return p
            const next = { ...p }
            delete next[url]
            return next
          })
        }, 2000)
      }
    })
    return () => { try { unsub?.() } catch {} }
  }, [])

  const loadGames = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getGames()
      if (result.success) {
        const list = result.games || []
        setGames(list)
        refreshActiveUpdates(list)
      } else {
        setError(result.error || 'Falha ao carregar jogos')
      }
    } catch (error: any) {
      console.error('Failed to load games:', error)
      setError(error?.message || 'Erro ao carregar biblioteca')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (games.length) refreshActiveUpdates(games)
  }, [games])

  const refreshActiveUpdates = async (gameList?: Game[]) => {
    try {
      const res = await window.electronAPI.getActiveDownloads()
      if (!res.success) return
      const list = gameList || gamesRef.current
      const map: Record<string, { status: 'starting' | 'downloading'; id?: string }> = {}
      ;(res.downloads || []).forEach((d: any) => {
        const key = d.info_hash || d.download_url
        if (!key) return
        const match = list.find(g => g.torrent_magnet === key || g.download_url === key || g.url === d.game_url)
        if (match) map[match.url] = { status: 'downloading', id: key }
      })
      if (Object.keys(map).length) setUpdatingGames(prev => ({ ...prev, ...map }))
    } catch {}
  }

  const loadProtonRuntimes = async () => {
    try {
      const res = await window.electronAPI.protonListRuntimes()
      if (res.success) setProtonRuntimes(res.runtimes || [])
    } catch (err) {
      console.warn('Failed to load proton runtimes', err)
    }
  }

  const addProtonRoot = async () => {
    const root = protonRootInput.trim()
    if (!root) return
    const res = await window.electronAPI.protonSetRoot(root)
    if (res.success) setProtonRuntimes(res.runtimes || [])
    else alert(res.error || 'Falha ao salvar pasta de Proton')
  }

  const playGame = async (game: Game) => {
    try {
      setLaunchingGames(prev => ({
        ...prev,
        [game.url]: { status: 'starting', message: 'Iniciando...', updatedAt: Date.now() }
      }))

      console.log('[playGame] Iniciando:', { url: game.url, exe: game.executable_path, proton: game.proton_runtime, prefix: game.proton_prefix })
      const launch = await window.electronAPI.launchGame(game.url)
      console.log('[playGame] Resultado:', launch)

      if (!launch.success && launch.error === 'missing_exe') {
        setLaunchingGames(prev => ({ ...prev, [game.url]: { status: 'error', message: 'Executável não configurado', updatedAt: Date.now() } }))
        alert('Executável não configurado. Configure o jogo para jogar.')
        return
      }
      if (!launch.success) {
        setLaunchingGames(prev => ({ ...prev, [game.url]: { status: 'error', message: launch.error || 'Falha ao iniciar', updatedAt: Date.now() } }))
        alert(launch.error || 'Falha ao iniciar o jogo')
      }
    } catch (err: any) {
      console.error('[Library] Falha ao iniciar jogo', err)
      setLaunchingGames(prev => ({ ...prev, [game.url]: { status: 'error', message: err?.message || 'Falha ao iniciar', updatedAt: Date.now() } }))
      alert(err?.message || 'Falha ao iniciar o jogo')
    }
  }

  const updateGame = async (game: Game) => {
    if (updateQueue.running) {
      alert('A fila de updates está em andamento. Aguarde terminar ou cancele a fila para atualizar manualmente.')
      return
    }
    if (updatingGames[game.url]) return
    if (!hasUpdate(game)) {
      alert('Nenhuma atualização disponível.')
      return
    }

    setUpdatingGames(prev => ({ ...prev, [game.url]: { status: 'starting' } }))
    try {
      // Always refetch update info to avoid using stale magnet/URL.
      let torrentUrl = ''
      const info = await window.electronAPI.fetchGameUpdateInfo(game.url)
      if (!info.success) throw new Error(info.error || 'Falha ao obter dados da atualização')
      if (info.latest) setGames(prev => prev.map(g => g.url === game.url ? { ...g, latest_version: info.latest ?? g.latest_version } : g))
      if (info.torrentUrl) {
        torrentUrl = info.torrentUrl
        setGames(prev => prev.map(g => g.url === game.url ? { ...g, torrent_magnet: info.torrentUrl, download_url: info.torrentUrl } : g))
      }

      if (!torrentUrl) {
        alert('Link do torrent não encontrado. Verifique se está logado e tente novamente.')
        setUpdatingGames(prev => { const next = { ...prev }; delete next[game.url]; return next })
        return
      }

      const res = await window.electronAPI.startTorrentDownload(torrentUrl, game.url)
      if (!res.success) {
        alert(res.error || 'Falha ao iniciar a atualização')
        setUpdatingGames(prev => { const next = { ...prev }; delete next[game.url]; return next })
      } else {
        setUpdatingGames(prev => ({ ...prev, [game.url]: { status: 'downloading', id: torrentUrl } }))
        loadGames()
      }
    } catch (err: any) {
      console.error('[UpdateGame] Failed to start update', err)
      alert(err?.message || 'Falha ao iniciar a atualização')
    }
  }

  const scanInstalledGames = async () => {
    if (scanningInstalled) return
    setScanningInstalled(true)
    try {
      const res = await window.electronAPI.scanInstalledGames()
      if (!res.success) throw new Error(res.error || 'Falha ao escanear jogos instalados')
      await loadGames()
      alert(`Scan concluído: ${res.added || 0} jogo(s) adicionado(s) (${res.scanned || 0} pastas analisadas).`)
    } catch (err: any) {
      alert(err?.message || 'Falha ao escanear jogos instalados')
    } finally {
      setScanningInstalled(false)
    }
  }

  const queueAllUpdates = async () => {
    try {
      const targets = (gamesRef.current || []).filter(g => hasUpdate(g)).map(g => g.url)
      if (!targets.length) {
        alert('Nenhuma atualização disponível.')
        return
      }
      const res = await window.electronAPI.queueGameUpdates(targets)
      if (!res.success) throw new Error(res.error || 'Falha ao enfileirar atualizações')
      alert(`Fila de updates: ${res.queuedAdded || 0} jogo(s) adicionado(s).`)
      refreshActiveUpdates(gamesRef.current)
    } catch (err: any) {
      alert(err?.message || 'Falha ao enfileirar atualizações')
    }
  }

  const clearUpdateQueue = async () => {
    try {
      const res = await window.electronAPI.clearUpdateQueue()
      if (!res.success) throw new Error(res.error || 'Falha ao limpar fila')
    } catch (err: any) {
      alert(err?.message || 'Falha ao limpar fila')
    }
  }

  const deleteGame = async (game: Game) => {
    if (confirm(`Deseja realmente desinstalar ${game.title}?`)) {
      const res = await window.electronAPI.deleteGame(game.url)
      if (res.success) setGames(prev => prev.filter(g => g.url !== game.url))
      else alert(res.error || 'Erro ao remover jogo')
    }
  }

  const openGameFolder = async (game: Game) => {
    if (!game.install_path) { alert('Pasta do jogo não encontrada'); return }
    const res = await window.electronAPI.openGameFolder(game.install_path)
    if (!res.success) alert(res.error || 'Não foi possível abrir a pasta')
  }

  const configureExe = async (game: Game) => {
    setConfiguring(game.url)
    const res = await window.electronAPI.configureGameExe(game.url)
    setConfiguring(null)
    if (res.success && res.exePath) setGames(prev => prev.map(g => g.url === game.url ? { ...g, executable_path: res.exePath } : g))
    else alert(res.error || 'Nenhum executável configurado')
  }

  const hasUpdate = (game: Game) => {
    if (!game.latest_version || !game.installed_version) return false
    const v1 = String(game.installed_version).trim().toLowerCase()
    const v2 = String(game.latest_version).trim().toLowerCase()
    if (v1 === v2) return false

    // Parse Build DDMMYYYY format to comparable number
    const parseBuildDate = (v: string): number | null => {
      const match = v.match(/build[.\s]*(\d{2})(\d{2})(\d{4})/i)
      if (match) {
        // DDMMYYYY -> YYYYMMDD for proper comparison
        return parseInt(match[3] + match[2] + match[1], 10)
      }
      const match2 = v.match(/build[.\s]*(\d{8})/i)
      if (match2) {
        const d = match2[1]
        return parseInt(d.slice(4, 8) + d.slice(2, 4) + d.slice(0, 2), 10)
      }
      return null
    }

    const build1 = parseBuildDate(v1)
    const build2 = parseBuildDate(v2)

    // If both are Build dates, compare them
    if (build1 !== null && build2 !== null) {
      return build2 > build1
    }

    // For semantic versions or other formats, different = update available
    return true
  }

  const loadProtonFromGame = (game: Game) => {
    setProtonVersion(game.proton_runtime || '')
    let parsed: any = {}
    try { parsed = game.proton_options ? JSON.parse(game.proton_options) : {} } catch { parsed = {} }
    setProtonOptions({
      esync: parsed.esync !== false,
      fsync: parsed.fsync !== false,
      dxvk: parsed.dxvk !== false,
      mesa_glthread: !!parsed.mesa_glthread,
      locale: parsed.locale || '',
      gamemode: !!parsed.gamemode,
      mangohud: !!parsed.mangohud,
      logging: !!parsed.logging,
      launchArgs: parsed.launchArgs || ''
    })
  }

  const buildProtonOptionsForSave = () => ({
    esync: protonOptions.esync,
    fsync: protonOptions.fsync,
    dxvk: protonOptions.dxvk,
    mesa_glthread: protonOptions.mesa_glthread,
    locale: protonOptions.locale || undefined,
    gamemode: protonOptions.gamemode,
    mangohud: protonOptions.mangohud,
    logging: protonOptions.logging,
    launchArgs: protonOptions.launchArgs
  })

  const getConfigSnapshot = (game: Game) => {
    const opts = buildProtonOptionsForSave()
    const protonOptionsJson = JSON.stringify(opts || {})
    const cleanAppId = steamAppId.trim() ? steamAppId.trim() : null

    return {
      title: titleValue.trim(),
      version: versionValue.trim(),
      protonRuntime: protonVersion,
      protonOptionsJson,
      protonPrefix: protonPrefix || '',
      steamAppId: cleanAppId,
      lanMode,
      lanNetworkId: lanNetworkId.trim(),
      lanAutoconnect,
      opts
    }
  }

  const performConfigAutosave = async (game: Game, snapshot: ReturnType<typeof getConfigSnapshot>) => {
    const lastFallback = () => ({
      title: (game.title || '').trim(),
      version: (game.installed_version || '').trim(),
      protonRuntime: game.proton_runtime || '',
      protonOptionsJson: game.proton_options || JSON.stringify({}),
      protonPrefix: game.proton_prefix || '',
      steamAppId: game.steam_app_id ? String(game.steam_app_id) : null,
      lanMode: ((game.lan_mode as LanMode) || 'steam') as LanMode,
      lanNetworkId: (game.lan_network_id || '').trim(),
      lanAutoconnect: !!(game.lan_autoconnect || 0)
    })

    configAutosaveQueueRef.current = configAutosaveQueueRef.current
      .then(async () => {
        setConfigSaveState({ status: 'saving', updatedAt: Date.now() })
        const last = lastSavedConfigRef.current || lastFallback()

        const patch: Partial<Game> = {}
        const nextSaved = { ...last }

        if (snapshot.title && snapshot.title !== last.title) {
          const resTitle = await window.electronAPI.setGameTitle(game.url, snapshot.title)
          if (!resTitle.success) throw new Error(resTitle.error || 'Falha ao salvar título')
          patch.title = snapshot.title
          nextSaved.title = snapshot.title
        }

        if (snapshot.version && snapshot.version !== last.version) {
          const resVersion = await window.electronAPI.setGameVersion(game.url, snapshot.version)
          if (!resVersion.success) throw new Error(resVersion.error || 'Falha ao salvar versão')
          patch.installed_version = snapshot.version
          nextSaved.version = snapshot.version
        }

        if ((last.steamAppId || null) !== snapshot.steamAppId) {
          const appRes = await window.electronAPI.setGameSteamAppId(game.url, snapshot.steamAppId)
          if (!appRes.success) throw new Error(appRes.error || 'Falha ao salvar Steam AppID')
          patch.steam_app_id = snapshot.steamAppId
          nextSaved.steamAppId = snapshot.steamAppId
        }

        if (snapshot.protonRuntime !== last.protonRuntime || snapshot.protonOptionsJson !== last.protonOptionsJson) {
          const res = await window.electronAPI.setGameProtonOptions(game.url, snapshot.protonRuntime, snapshot.opts)
          if (!res.success) throw new Error(res.error || 'Falha ao salvar Proton')
          patch.proton_runtime = snapshot.protonRuntime || null
          patch.proton_options = snapshot.protonOptionsJson
          nextSaved.protonRuntime = snapshot.protonRuntime
          nextSaved.protonOptionsJson = snapshot.protonOptionsJson
        }

        if (snapshot.protonPrefix !== last.protonPrefix) {
          const resPrefix = await window.electronAPI.setGameProtonPrefix(game.url, snapshot.protonPrefix ? snapshot.protonPrefix : null)
          if (!resPrefix.success) throw new Error(resPrefix.error || 'Falha ao salvar prefixo')
          patch.proton_prefix = snapshot.protonPrefix ? snapshot.protonPrefix : null
          nextSaved.protonPrefix = snapshot.protonPrefix
        }

        if (snapshot.lanMode !== last.lanMode || snapshot.lanNetworkId !== last.lanNetworkId || snapshot.lanAutoconnect !== last.lanAutoconnect) {
          const lanRes = await window.electronAPI.setGameLanSettings(game.url, {
            mode: snapshot.lanMode,
            networkId: snapshot.lanNetworkId || null,
            autoconnect: snapshot.lanAutoconnect
          })
          if (!lanRes.success) throw new Error(lanRes.error || 'Falha ao salvar LAN')
          patch.lan_mode = snapshot.lanMode
          patch.lan_network_id = snapshot.lanNetworkId || null
          patch.lan_autoconnect = snapshot.lanAutoconnect ? 1 : 0
          nextSaved.lanMode = snapshot.lanMode
          nextSaved.lanNetworkId = snapshot.lanNetworkId
          nextSaved.lanAutoconnect = snapshot.lanAutoconnect
        }

        if (Object.keys(patch).length) setGames(prev => prev.map(g => (g.url === game.url ? { ...g, ...patch } : g)))
        lastSavedConfigRef.current = nextSaved

        if (!snapshot.title) {
          setConfigSaveState({ status: 'pending', message: 'Título não pode ficar vazio', updatedAt: Date.now() })
        } else {
          setConfigSaveState({ status: 'saved', updatedAt: Date.now() })
        }
      })
      .catch((err: any) => {
        setConfigSaveState({ status: 'error', message: err?.message || 'Falha ao salvar', updatedAt: Date.now() })
      })
  }

  const scheduleConfigAutosave = (game: Game) => {
    const snapshot = getConfigSnapshot(game)
    const last = lastSavedConfigRef.current
    const titleForDiff = snapshot.title || (last?.title ?? '')
    const versionForDiff = snapshot.version || (last?.version ?? '')
    const isDifferent =
      !last ||
      last.title !== titleForDiff ||
      last.version !== versionForDiff ||
      last.protonRuntime !== snapshot.protonRuntime ||
      last.protonOptionsJson !== snapshot.protonOptionsJson ||
      last.protonPrefix !== snapshot.protonPrefix ||
      (last.steamAppId || null) !== snapshot.steamAppId ||
      last.lanMode !== snapshot.lanMode ||
      last.lanNetworkId !== snapshot.lanNetworkId ||
      last.lanAutoconnect !== snapshot.lanAutoconnect

    if (!isDifferent) {
      if (!snapshot.title && last?.title) {
        setConfigSaveState(s => s.status === 'saving' ? s : { status: 'pending', message: 'Título não pode ficar vazio', updatedAt: Date.now() })
      }
      return
    }

    setConfigSaveState(s => s.status === 'saving' ? s : { status: 'pending', message: !snapshot.title ? 'Título não pode ficar vazio' : undefined, updatedAt: Date.now() })

    if (configAutosaveTimerRef.current) clearTimeout(configAutosaveTimerRef.current)
    configAutosaveTimerRef.current = setTimeout(() => {
      configAutosaveTimerRef.current = null
      void performConfigAutosave(game, snapshot)
    }, 650)
  }

  const openConfig = (game: Game) => {
    suppressConfigAutosaveRef.current = true
    setConfigTab('geral')
    setConfigSaveState({ status: 'idle', updatedAt: Date.now() })
    setIniLastSavedAt(null)

    setShowConfig(game.url)
    setVersionValue(game.installed_version || '')
    setTitleValue(game.title || '')
    loadProtonFromGame(game)
    loadProtonRuntimes()
    setProtonPrefix(game.proton_prefix || '')
    setSteamAppId(game.steam_app_id ? String(game.steam_app_id) : '')
    setLanMode(((game.lan_mode as LanMode) || 'steam') as LanMode)
    setLanNetworkId(game.lan_network_id || '')
    setLanAutoconnect(!!(game.lan_autoconnect || 0))
    setBannerManualUrl(game.image_url || '')
    setLanRoomCode('')
    setLanRoomLastCode('')
    vpnHasLoadedRef.current = false
    setVpnLoading(false)
    setVpnHasLoaded(false)
    setVpnError(null)
    setVpnStatus(null)
    setVpnPeers([])
    setVpnActionBusy(false)
    setVpnConfig('')
    setVpnLocalIp('')
    setVpnHostIp('')
    setVpnConnected(false)

    lastSavedConfigRef.current = {
      title: (game.title || '').trim(),
      version: (game.installed_version || '').trim(),
      protonRuntime: game.proton_runtime || '',
      protonOptionsJson: game.proton_options || JSON.stringify({}),
      protonPrefix: game.proton_prefix || '',
      steamAppId: game.steam_app_id ? String(game.steam_app_id) : null,
      lanMode: ((game.lan_mode as LanMode) || 'steam') as LanMode,
      lanNetworkId: (game.lan_network_id || '').trim(),
      lanAutoconnect: !!(game.lan_autoconnect || 0)
    }

    resetIniState()
    loadOnlineFixIni(game)

    setTimeout(() => { suppressConfigAutosaveRef.current = false }, 0)
  }

  const closeConfig = () => {
    if (configAutosaveTimerRef.current) { clearTimeout(configAutosaveTimerRef.current); configAutosaveTimerRef.current = null }
    if (iniAutosaveTimerRef.current) { clearTimeout(iniAutosaveTimerRef.current); iniAutosaveTimerRef.current = null }
    setShowConfig(null)
    setConfigTab('geral')
  }

  useEffect(() => {
    if (!showConfig) return
    if (suppressConfigAutosaveRef.current) return
    const game = gamesRef.current.find(g => g.url === showConfig)
    if (!game) return
    scheduleConfigAutosave(game)
  }, [showConfig, titleValue, versionValue, protonVersion, protonOptions, steamAppId, protonPrefix, lanMode, lanNetworkId, lanAutoconnect])

  useEffect(() => {
    if (!showConfig) return
    if (configTab !== 'lan') return
    if (lanMode !== 'ofvpn') return

    let cancelled = false
    let timer: any = null
    let lastStatusJson = ''
    let lastPeersJson = ''

    const refresh = async () => {
      if (cancelled) return
      if (!vpnHasLoadedRef.current) setVpnLoading(true)
      try {
        const st = await window.electronAPI.vpnStatus?.()
        if (cancelled) return
        if (!st?.success) { setVpnError(st?.error || 'Falha ao consultar VPN'); return }

        setVpnError(null)
        const nextStatus = { controller: st.controller || null, installed: !!st.installed, installError: st.installError || null }
        const statusJson = JSON.stringify(nextStatus)
        if (statusJson !== lastStatusJson) { lastStatusJson = statusJson; setVpnStatus(nextStatus) }

        const code = String(lanNetworkId || '').trim()
        if (code) {
          const peersRes = await window.electronAPI.vpnRoomPeers?.(code)
          if (cancelled) return
          if (peersRes?.success) {
            const nextPeers = Array.isArray(peersRes.peers) ? peersRes.peers : []
            const peersJson = JSON.stringify(nextPeers)
            if (peersJson !== lastPeersJson) { lastPeersJson = peersJson; setVpnPeers(nextPeers) }
          }
        }
      } catch (err: any) {
        if (cancelled) return
        setVpnError(err?.message || 'Falha ao consultar VPN')
      } finally {
        if (!cancelled) {
          setVpnLoading(false)
          if (!vpnHasLoadedRef.current) { vpnHasLoadedRef.current = true; setVpnHasLoaded(true) }
        }
      }
    }

    void refresh()
    timer = setInterval(refresh, 4000)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [showConfig, configTab, lanMode, lanNetworkId])

  useEffect(() => {
    if (!showConfig) return
    const game = gamesRef.current.find(g => g.url === showConfig)
    if (!game?.install_path) return
    if (!iniDirty) return
    if (iniLoading || iniSaving) return

    if (iniAutosaveTimerRef.current) clearTimeout(iniAutosaveTimerRef.current)
    iniAutosaveTimerRef.current = setTimeout(() => {
      iniAutosaveTimerRef.current = null
      void saveOnlineFixIni(game)
    }, 1200)
  }, [showConfig, iniDirty, iniFields, iniLoading, iniSaving])

  const loadOnlineFixIni = async (game: Game) => {
    if (!game.install_path) {
      setIniError('Jogo precisa estar instalado para editar o OnlineFix.ini')
      setIniContent('')
      setIniOriginalContent('')
      iniOriginalContentRef.current = ''
      setIniPath(null)
      setIniFields([])
      iniFieldsRef.current = []
      return
    }
    setIniLoading(true)
    setIniError(null)
    try {
      const res = await window.electronAPI.getOnlineFixIni(game.url)
      if (res.success) {
        const content = res.content || ''
        const fields = parseIniFields(content)
        setIniContent(content)
        setIniOriginalContent(content)
        iniOriginalContentRef.current = content
        setIniPath(res.path || null)
        setIniDirty(false)
        setIniFields(fields)
        iniFieldsRef.current = fields
      } else {
        setIniError(res.error || 'Não foi possível carregar OnlineFix.ini')
      }
    } catch (err: any) {
      setIniError(err?.message || 'Não foi possível carregar OnlineFix.ini')
    } finally {
      setIniLoading(false)
    }
  }

  const saveOnlineFixIni = async (game: Game) => {
    setIniSaving(true)
    setIniError(null)
    try {
      const finalContent = buildCurrentIniText()
      if (!finalContent && iniFieldsRef.current.filter(f => f.key).length > 0) {
        setIniError('Erro interno: conteúdo gerado está vazio mas existem campos. Tente recarregar.')
        setIniSaving(false)
        return
      }

      const res = await window.electronAPI.saveOnlineFixIni(game.url, finalContent)
      if (res.success) {
        setIniPath(res.path || iniPath)
        setIniContent(finalContent)
        setIniOriginalContent(finalContent)
        iniOriginalContentRef.current = finalContent
        setIniDirty(false)
        setIniLastSavedAt(Date.now())
      } else {
        setIniError(res.error || 'Falha ao salvar OnlineFix.ini')
      }
    } catch (err: any) {
      setIniError(err?.message || 'Falha ao salvar OnlineFix.ini')
    } finally {
      setIniSaving(false)
    }
  }

  const fetchBanner = async (game: Game) => {
    setBannerLoading(game.url)
    try {
      const res = await window.electronAPI.fetchGameImage(game.url, titleValue || game.title)
      if (res.success && res.imageUrl) {
        setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: res.imageUrl } : g))
        setBannerManualUrl(res.imageUrl)
      } else {
        alert(res.error || 'Nenhuma imagem encontrada')
      }
    } catch (err: any) {
      alert(err?.message || 'Falha ao buscar imagem')
    } finally {
      setBannerLoading(null)
    }
  }

  const applyBannerUrl = async (game: Game) => {
    const value = bannerManualUrl.trim()
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.setGameImageUrl(game.url, value || null)
      if (!res.success) { alert(res.error || 'Falha ao definir banner'); return }
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: (res.imageUrl as any) || undefined } : g))
    } finally {
      setBannerManualBusy(false)
    }
  }

  const pickBannerFile = async (game: Game) => {
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.pickGameBannerFile(game.url)
      if (!res.success) { if (!res.canceled) alert(res.error || 'Falha ao selecionar imagem'); return }
      if (res.imageUrl) {
        setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: res.imageUrl } : g))
        setBannerManualUrl(res.imageUrl)
      }
    } finally {
      setBannerManualBusy(false)
    }
  }

  const clearBanner = async (game: Game) => {
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.setGameImageUrl(game.url, null)
      if (!res.success) { alert(res.error || 'Falha ao limpar banner'); return }
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: undefined } : g))
      setBannerManualUrl('')
    } finally {
      setBannerManualBusy(false)
    }
  }

  const checkAllUpdates = async () => {
    setCheckingUpdates(true)
    try {
      const res = await window.electronAPI.checkAllUpdates()
      if (!res.success) {
        alert(res.error || 'Falha ao verificar atualizações')
      } else {
        const results = res.results || []
        const foundUpdates = results.filter((r: any) => r?.latest).length
        const errors = results.filter((r: any) => r?.error).length
        await loadGames()
        if (foundUpdates > 0) alert(`Verificação concluída: ${foundUpdates} atualização(ões) encontrada(s).`)
        else if (errors > 0) { alert(`Verificação concluída com erros em ${errors} jogo(s). Consulte o console para detalhes.`); console.warn('[CheckAllUpdates] Erros', results.filter((r: any) => r?.error)) }
        else alert('Nenhuma atualização encontrada.')
      }
    } catch (err: any) {
      alert(err?.message || 'Falha ao verificar atualizações')
    } finally {
      setCheckingUpdates(false)
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <RefreshCw className="animate-spin" />
        <h3>Carregando...</h3>
      </div>
    )
  }

  if (games.length === 0) {
    return (
      <div className="empty-state">
        <Library size={64} />
        <h3>Nenhum jogo instalado</h3>
        <p>Visite a loja para baixar jogos</p>
      </div>
    )
  }

  return (
    <div className="library-container">
      <style>{spinnerStyles + tabFixStyles}</style>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {cloudSavesBanner && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background:
              cloudSavesBanner.level === 'error'
                ? 'rgba(185, 28, 28, 0.22)'
                : cloudSavesBanner.level === 'warning'
                  ? 'rgba(245, 158, 11, 0.18)'
                  : cloudSavesBanner.level === 'success'
                    ? 'rgba(34, 197, 94, 0.16)'
                    : 'rgba(59, 130, 246, 0.14)',
            border:
              cloudSavesBanner.level === 'error'
                ? '1px solid rgba(239, 68, 68, 0.35)'
                : cloudSavesBanner.level === 'warning'
                  ? '1px solid rgba(245, 158, 11, 0.30)'
                  : cloudSavesBanner.level === 'success'
                    ? '1px solid rgba(34, 197, 94, 0.26)'
                    : '1px solid rgba(59, 130, 246, 0.24)',
            color: '#fff'
          }}
        >
          <AlertCircle size={16} style={{
            color:
              cloudSavesBanner.level === 'error'
                ? '#ef4444'
                : cloudSavesBanner.level === 'warning'
                  ? '#f59e0b'
                  : cloudSavesBanner.level === 'success'
                    ? '#22c55e'
                    : '#3b82f6'
          }} />
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.2 }}>
            <strong style={{ marginRight: 6 }}>[Cloud Saves]</strong>
            {cloudSavesBanner.gameUrl
              ? `${(gamesRef.current.find(g => g.url === cloudSavesBanner.gameUrl)?.title || 'Jogo')}: ${cloudSavesBanner.message}`
              : cloudSavesBanner.message}
            {cloudSavesBanner.conflict && (
              <span style={{ marginLeft: 8, opacity: 0.9 }}>
                (Conflito detectado — nada foi sobrescrito)
              </span>
            )}
          </div>
          {cloudSavesBanner.gameUrl && (
            <button className="btn ghost" onClick={openCloudBackupsForBanner}>
              Abrir backups
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => setCloudSavesBanner(null)}
            title="Fechar"
            style={{ paddingInline: 10 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Topo da biblioteca: busca + filtros */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flex: '1 1 260px', minWidth: 220, flexWrap: 'wrap' }}>
          <div className="input-row" style={{ width: '100%', maxWidth: 420, gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>Buscar</span>
              {librarySearch?.trim() && (
                <button
                  className="btn ghost"
                  onClick={() => setLibrarySearch('')}
                  style={{ padding: '6px 10px', lineHeight: 1 }}
                  title="Limpar"
                >
                  Limpar
                </button>
              )}
            </label>
            <input
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              placeholder="Buscar jogo..."
              spellCheck={false}
            />
          </div>

          <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
            <label>Coleção</label>
            <select value={libraryCategory} onChange={(e) => setLibraryCategory(e.target.value as any)}>
              <option value="all">Todos</option>
              <option value="favorites">Favoritos</option>
              <option value="installed">Instalados</option>
              <option value="updating">Em atualização</option>
            </select>
          </div>

          <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
            <label>Ordenar</label>
            <select value={librarySort} onChange={(e) => setLibrarySort(e.target.value as any)}>
              <option value="recent">Jogado recentemente</option>
              <option value="name">Nome</option>
              <option value="size">Tamanho</option>
            </select>
          </div>

          <div className="input-row" style={{ width: 44, maxWidth: 44, gap: 6 }}>
            <label style={{ visibility: 'hidden' }}>Ação</label>
            <button
              className="btn ghost"
              onClick={scanInstalledGames}
              disabled={scanningInstalled}
              title="Escanear jogos instalados no disco"
              aria-label="Escanear jogos instalados no disco"
              style={{ padding: 8, opacity: 0.9, lineHeight: 1, minWidth: 44, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {scanningInstalled ? <RefreshCw size={16} className="of-spin" /> : <Search size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="library-grid-heroic">

        {filteredGames.map((game) => {
          const updateAvailable = hasUpdate(game)
          const isFavorite = !!(game as any)?.is_favorite
          return (
          <div key={game.id} className={`game-card-heroic ${updateAvailable ? 'has-update' : ''}`}>
            {(() => {
              const launchState = launchingGames[game.url]
              const prefixState = prefixJobs[game.url]
              const syncState = saveSyncJobs[game.url]
              const achv = achievementsProgressByGameUrl[game.url]
              const isAchvComplete = !!achv?.complete

              const isPrefixing = prefixState?.status === 'starting' || prefixState?.status === 'progress'
              const isLaunching = launchState?.status === 'starting' || launchState?.status === 'running'
              const isError = launchState?.status === 'error' || (launchState?.status === 'exited' && launchState?.code != null && Number(launchState.code) !== 0)
              const isSyncing = syncState?.status === 'syncing'

              const label = isSyncing
                ? (syncState?.message || 'Sincronizando saves...')
                : isPrefixing
                  ? (prefixState?.message || 'Preparando prefixo...')
                  : isLaunching
                    ? (launchState?.message || (launchState?.status === 'running' ? 'Abrindo jogo...' : 'Iniciando...'))
                    : isError
                      ? `Falha ao iniciar${launchState?.code != null ? ` (cód. ${launchState.code})` : ''}`
                      : ''

              return (
                <div style={{ position: 'relative' }}>
                  <div className="game-cover">
                    {game.image_url ? (
                      <img src={game.image_url} alt={game.title} loading="lazy" decoding="async" />
                    ) : (
                      <div className="game-cover-placeholder">
                        <Library size={48} />
                      </div>
                    )}

                    {(isLaunching || isPrefixing || isError || isSyncing) && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 10,
                          right: 10,
                          bottom: 10,
                          padding: '8px 10px',
                          borderRadius: 10,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: isError ? 'rgba(185, 28, 28, 0.85)' : 'rgba(17, 24, 39, 0.85)',
                          border: isError ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                          color: '#fff',
                          fontSize: 12,
                          backdropFilter: 'blur(6px)'
                        }}
                        title={syncState?.message || launchState?.stderrTail || prefixState?.message || launchState?.message || ''}
                      >
                        {(isSyncing || isLaunching || isPrefixing) ? <RefreshCw size={14} className="of-spin" /> : <AlertCircle size={14} />}
                        <span style={{ lineHeight: 1.1, flex: 1 }}>{label}</span>
                      </div>
                    )}

                    {updateAvailable && (
                      <div className="update-badge" title="Precisa de atualização">
                        <Download size={12} />
                      </div>
                    )}

                    <div className="platform-badge">
                      <span>OF</span>
                    </div>

                    <div className="game-overlay">
                      <div className="overlay-content">
                        {!game.executable_path && (
                          <div className="exe-warning">
                            <AlertCircle size={16} />
                            <span>Configurar .exe</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="game-action-bar">
                    <div className="action-menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="action-btn menu"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenActionMenuGameUrl((cur) => (cur === game.url ? null : game.url))
                        }}
                        title="Mais ações"
                      >
                        <MoreVertical size={18} />
                      </button>

                      {openActionMenuGameUrl === game.url && (
                        <div className="action-menu-panel" onClick={(e) => e.stopPropagation()}>
                          <button className="action-menu-item" onClick={() => { setOpenActionMenuGameUrl(null); openConfig(game) }}>
                            <Settings size={16} />
                            <span>Configurações</span>
                          </button>

                          <button className="action-menu-item" onClick={() => { setOpenActionMenuGameUrl(null); void toggleFavorite(game.url) }}>
                            <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
                            <span>{isFavorite ? 'Remover favorito' : 'Adicionar favorito'}</span>
                          </button>

                          {!!game.install_path && (
                            <button className="action-menu-item" onClick={() => { setOpenActionMenuGameUrl(null); void openGameFolder(game) }}>
                              <Folder size={16} />
                              <span>Abrir pasta</span>
                            </button>
                          )}

                          {updateAvailable && (
                            <button
                              className="action-menu-item"
                              onClick={() => { setOpenActionMenuGameUrl(null); void updateGame(game) }}
                              disabled={!!updatingGames[game.url] || updateQueue.running}
                            >
                              <Download size={16} />
                              <span>Atualizar</span>
                            </button>
                          )}

                          {!!launchState?.protonLogPath && (
                            <button
                              className="action-menu-item"
                              onClick={async () => {
                                setOpenActionMenuGameUrl(null)
                                const res = await window.electronAPI.openPath?.(launchState.protonLogPath as string)
                                if (res && res.success === false) alert(res.error || 'Falha ao abrir log')
                              }}
                            >
                              <FileText size={16} />
                              <span>Abrir logs</span>
                            </button>
                          )}

                          <div className="action-menu-sep" />

                          <button className="action-menu-item danger" onClick={() => { setOpenActionMenuGameUrl(null); void deleteGame(game) }}>
                            <Trash2 size={16} />
                            <span>Desinstalar</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      className={"action-btn achievements" + (isAchvComplete ? ' of-achv-complete-btn' : '')}
                      onMouseDown={(e) => {
                        // DEV helper: Shift/Alt + mouseDown alterna o estado "100%".
                        if (!import.meta.env.DEV) return
                        if (!(e.shiftKey || e.altKey)) return
                        e.preventDefault()
                        e.stopPropagation()
                        setOpenActionMenuGameUrl(null)
                        setAchievementsProgressByGameUrl((prev) => {
                          const cur = prev[game.url]
                          const nextComplete = !(cur?.complete)
                          const total = Math.max(1, Number(cur?.total || 1))
                          const unlocked = nextComplete ? total : Math.min(Number(cur?.unlocked || 0), total - 1)
                          return { ...prev, [game.url]: { complete: nextComplete, total, unlocked, updatedAt: Date.now() } }
                        })
                      }}
                      onContextMenu={(e) => {
                        // DEV helper: clique direito alterna o estado "100%" sem abrir o modal.
                        if (!import.meta.env.DEV) return
                        e.preventDefault()
                        e.stopPropagation()
                        setOpenActionMenuGameUrl(null)
                        setAchievementsProgressByGameUrl((prev) => {
                          const cur = prev[game.url]
                          const nextComplete = !(cur?.complete)
                          const total = Math.max(1, Number(cur?.total || 1))
                          const unlocked = nextComplete ? total : Math.min(Number(cur?.unlocked || 0), total - 1)
                          return { ...prev, [game.url]: { complete: nextComplete, total, unlocked, updatedAt: Date.now() } }
                        })
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenActionMenuGameUrl(null)
                        // DEV helper: Alt/Shift + clique alterna o estado "100%" pra testar o efeito visual.
                        if (import.meta.env.DEV && (e.altKey || e.shiftKey)) {
                          e.preventDefault()
                          setAchievementsProgressByGameUrl((prev) => {
                            const cur = prev[game.url]
                            const nextComplete = !(cur?.complete)
                            const total = Math.max(1, Number(cur?.total || 1))
                            const unlocked = nextComplete ? total : Math.min(Number(cur?.unlocked || 0), total - 1)
                            return { ...prev, [game.url]: { complete: nextComplete, total, unlocked, updatedAt: Date.now() } }
                          })
                          return
                        }
                        openAchievementsModal(game)
                      }}
                      title={isAchvComplete ? `Conquistas (100% - ${achv.unlocked}/${achv.total})` : (achv?.total ? `Conquistas (${achv.unlocked}/${achv.total})` : 'Conquistas')}
                    >
                      <Trophy size={18} className={isAchvComplete ? 'of-achv-complete' : undefined} />
                    </button>

                    {isLaunching ? (
                      <button
                        className="action-btn stop"
                        onClick={async (e) => {
                          e.stopPropagation()
                          setLaunchingGames(prev => ({
                            ...prev,
                            [game.url]: {
                              ...(prev[game.url] || { status: 'starting', updatedAt: Date.now() }),
                              status: 'starting',
                              message: 'Parando jogo...',
                              updatedAt: Date.now()
                            }
                          }))
                          const res = await window.electronAPI.stopGame?.(game.url, true)
                          if (!res?.success) alert(res?.error || 'Falha ao parar o jogo')
                        }}
                        disabled={!!updatingGames[game.url]}
                        title="Parar"
                      >
                        <Square size={18} />
                      </button>
                    ) : (
                      <button
                        className="action-btn play"
                        onClick={(e) => { e.stopPropagation(); if (!updatingGames[game.url] && !isPrefixing) playGame(game) }}
                        disabled={!!updatingGames[game.url] || isPrefixing}
                        style={(updatingGames[game.url] || isPrefixing) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        title={isPrefixing ? 'Aguardando preparo do prefixo' : 'Jogar'}
                      >
                        {isPrefixing ? <RefreshCw size={18} className="of-spin" /> : <Play size={20} fill="currentColor" />}
                      </button>
                    )}
                  </div>

                  <div className="game-info-tooltip">
                    <div className="game-title">{game.title}</div>
                    <div className="game-version">
                      v{game.installed_version || '---'}
                      {updateAvailable && <span className="new-version"> → v{game.latest_version}</span>}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
          )
        })}
      </div>

      {/* Achievements Modal */}
      {achievementsModalGameUrl && (
        <div className="modal-backdrop" onClick={closeAchievementsModal}>
          <div className="modal config-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="config-modal-body">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Conquistas</p>
                  <h3>{achievementsModalTitle}</h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="btn ghost"
                    onClick={() => achievementsModalGameUrl && loadAchievementsForGameUrl(achievementsModalGameUrl)}
                    disabled={achievementsModalLoading}
                    title="Recarregar"
                  >
                    {achievementsModalLoading ? <RefreshCw size={14} className="of-spin" /> : <RefreshCw size={14} />}
                  </button>

                  <button
                    className="btn ghost"
                    onClick={async () => {
                      if (!achievementsModalGameUrl) return
                      const res: any = await window.electronAPI.importAchievementSchema?.(achievementsModalGameUrl)
                      if (!res?.success) {
                        alert(res?.error || 'Falha ao importar schema')
                        return
                      }
                      await loadAchievementsForGameUrl(achievementsModalGameUrl)
                    }}
                    disabled={achievementsModalLoading}
                    title="Importar schema (JSON)"
                  >
                    Importar schema
                  </button>

                  <button
                    className="btn ghost"
                    onClick={async () => {
                      if (!achievementsModalGameUrl) return
                      const ok = confirm('Remover schema importado deste jogo?')
                      if (!ok) return
                      const res: any = await window.electronAPI.clearAchievementSchema?.(achievementsModalGameUrl)
                      if (!res?.success) {
                        alert(res?.error || 'Falha ao remover schema')
                        return
                      }
                      await loadAchievementsForGameUrl(achievementsModalGameUrl)
                    }}
                    disabled={achievementsModalLoading}
                    title="Remover schema importado"
                  >
                    Remover schema
                  </button>

                  <button className="btn ghost" onClick={closeAchievementsModal} title="Fechar">
                    ✕
                  </button>
                </div>
              </div>

              {achievementsModalError && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(185, 28, 28, 0.22)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fff' }}>
                  {achievementsModalError}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                  {(() => {
                    const items = Array.isArray(achievementsModalItems) ? achievementsModalItems : []
                    const unlockedCount = items.filter((x: any) => !!x?.unlocked).length
                    const total = items.length
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontWeight: 700 }}>Conquistas</div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>{unlockedCount}/{total}</div>
                      </div>
                    )
                  })()}

                  <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto', paddingRight: 6 }}>
                    {achievementsModalLoading ? (
                      <div style={{ opacity: 0.9, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RefreshCw size={14} className="of-spin" /> Carregando...
                      </div>
                    ) : achievementsModalItems?.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {achievementsModalItems.map((a: any) => (
                          <div
                            key={String(a.id)}
                            style={{
                              padding: '10px 10px',
                              borderRadius: 10,
                              border: '1px solid rgba(255,255,255,0.08)',
                              background: 'rgba(0,0,0,0.12)',
                              opacity: a?.unlocked ? 1 : 0.82
                            }}
                          >
                            {(() => {
                              const isHiddenLocked = Boolean(a?.hidden) && !a?.unlocked
                              const rawName = String(a?.name || '')
                              const rawId = String(a?.id || '')
                              const rawDesc = String(a?.description || '')
                              const percent = typeof a?.percent === 'number' && Number.isFinite(a.percent) ? Number(a.percent) : null

                              const revealed = isHiddenLocked && rawId ? !!revealedHiddenAchievementIds[rawId] : false

                              const reveal = () => {
                                if (!isHiddenLocked || revealed || !rawId) return
                                setRevealedHiddenAchievementIds(prev => ({ ...prev, [rawId]: true }))

                                // Best-effort: if schema metadata is missing, try a one-time force refresh.
                                // This can populate hidden descriptions/percentages when we previously cached a low-fidelity schema.
                                try {
                                  if (!achievementSchemaRefreshedOnce && (!hasMeaningfulName || !hasMeaningfulDesc) && achievementsModalGameUrl) {
                                    setAchievementSchemaRefreshedOnce(true)
                                    void window.electronAPI.forceRefreshAchievementSchema(achievementsModalGameUrl).then(() => {
                                      void loadAchievementsForGameUrl(achievementsModalGameUrl)
                                    })
                                  }
                                } catch {}
                              }

                              const nameLooksInternal = !rawName || rawName === rawId || rawName.startsWith('ACHIEVEMENT_')
                              const hasMeaningfulName = !nameLooksInternal
                              const hasMeaningfulDesc = Boolean(rawDesc.trim())

                              // Hidden achievements:
                              // - Mask by default while locked.
                              // - Allow user to reveal on click.
                              const displayName = (isHiddenLocked && !revealed)
                                ? 'Conquista escondida'
                                : (isHiddenLocked && !hasMeaningfulName ? 'Conquista escondida' : String(a?.name || a?.id || 'Conquista'))

                              const displayDescription = (isHiddenLocked && !revealed)
                                ? 'Clique para revelar.'
                                : (rawDesc || (a?.unlocked ? '' : 'Sem descrição disponível.'))

                              const shouldShowId = !a?.unlocked && rawId && (!rawName || rawName === rawId || rawName.startsWith('ACHIEVEMENT_'))

                              return (
                                <>
                            <div
                              style={{ display: 'flex', gap: 10, cursor: isHiddenLocked && !revealed ? 'pointer' : 'default' }}
                              onClick={reveal}
                              title={isHiddenLocked && !revealed ? 'Clique para revelar' : undefined}
                            >
                              <div style={{ width: 40, height: 40, flex: '0 0 auto' }}>
                                {a?.iconUrl || a?.iconPath ? (
                                  <img
                                    src={String(a.iconUrl || a.iconPath)}
                                    alt={displayName}
                                    style={{
                                      width: 40,
                                      height: 40,
                                      borderRadius: 8,
                                      objectFit: 'cover',
                                      filter: a?.unlocked ? 'none' : 'grayscale(1)'
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: 40,
                                      height: 40,
                                      borderRadius: 8,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      border: '1px solid rgba(255,255,255,0.10)',
                                      background: 'rgba(255,255,255,0.04)'
                                    }}
                                  >
                                    <Trophy size={18} />
                                  </div>
                                )}
                              </div>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {displayName}
                                    </div>
                                    {isHiddenLocked && (
                                      <div style={{ fontSize: 11, opacity: 0.72, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 8px', flex: '0 0 auto' }}>
                                        {revealed ? 'Revelada' : 'Escondida'}
                                      </div>
                                    )}
                                  </div>
                                  {a?.unlocked ? (
                                    a?.unlockedAt ? (
                                      <div style={{ fontSize: 12, opacity: 0.8 }}>{new Date(Number(a.unlockedAt)).toLocaleString()}</div>
                                    ) : (
                                      <div style={{ fontSize: 12, opacity: 0.7 }}>Desbloqueada</div>
                                    )
                                  ) : (
                                    <div style={{ fontSize: 12, opacity: 0.6 }}>Bloqueada</div>
                                  )}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85, lineHeight: 1.25 }}>
                                  {displayDescription}
                                </div>
                                {percent != null && (
                                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                                    {percent.toFixed(1)}% desbloquearam
                                  </div>
                                )}
                                {shouldShowId && (
                                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.55, wordBreak: 'break-all' }}>{rawId}</div>
                                )}
                              </div>
                            </div>
                                </>
                              )
                            })()}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ opacity: 0.8, fontSize: 13 }}>
                        Nenhuma conquista encontrada.
                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                          Possíveis causas:
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            <li>O jogo não possui conquistas no Steam</li>
                            <li>O jogo ainda não foi iniciado (o crack precisa criar os arquivos)</li>
                            <li>A Steam API Key não está configurada nas Configurações</li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 700 }}>Fontes detectadas</div>
                    <div style={{ opacity: 0.8, fontSize: 12 }}>{Array.isArray(achievementsModalSources) ? achievementsModalSources.length : 0}</div>
                  </div>
                  <div style={{ marginTop: 10, maxHeight: 180, overflow: 'auto', paddingRight: 6 }}>
                    {achievementsModalSources?.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {achievementsModalSources.map((s: any, idx: number) => (
                          <div key={`${idx}:${String(s.path || s.label || '')}`} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.12)' }}>
                            <div style={{ fontWeight: 700, fontSize: 12 }}>{String(s.label || s.kind || 'Fonte')}</div>
                            {s.path && <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }}>{String(s.path)}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ opacity: 0.8, fontSize: 13 }}>
                        Nenhuma fonte encontrada. Inicie o jogo uma vez para o crack/emulador criar os arquivos.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfig && (
        <div className="modal-backdrop" onClick={closeConfig}>
          <div className="modal config-modal" onClick={(e) => e.stopPropagation()}>
            {games.filter(g => g.url === showConfig).map(game => (
              <div key={game.url} className="config-modal-body">
                <div className="modal-header">
                  <div>
                    <p className="eyebrow">Configurações do jogo</p>
                    <h3>{game.title}</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="config-save-pill" data-status={configTab === 'onlinefix' ? (iniSaving ? 'saving' : iniDirty ? 'pending' : 'saved') : configSaveState.status}>
                      {configTab === 'onlinefix'
                        ? (iniSaving
                          ? 'Salvando OnlineFix.ini...'
                          : iniDirty
                            ? 'Alterações pendentes'
                            : iniLastSavedAt
                              ? 'OnlineFix.ini salvo'
                              : 'Sem alterações')
                        : (configSaveState.status === 'saving'
                          ? 'Salvando...'
                          : configSaveState.status === 'pending'
                            ? (configSaveState.message || 'Alterações pendentes')
                            : configSaveState.status === 'saved'
                              ? 'Salvo'
                              : configSaveState.status === 'error'
                                ? (configSaveState.message || 'Erro ao salvar')
                                : 'Sem alterações')}
                    </div>
                    <button className="btn ghost" onClick={closeConfig}>Fechar</button>
                  </div>
                </div>

                <div className="config-tabs">
                  <button className={configTab === 'geral' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => setConfigTab('geral')} type="button">Geral</button>
                  <button className={configTab === 'onlinefix' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => setConfigTab('onlinefix')} type="button">OnlineFix.ini</button>
                  <button className={configTab === 'proton' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => setConfigTab('proton')} type="button">Proton</button>
                  <button className={configTab === 'lan' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => setConfigTab('lan')} type="button">LAN</button>
                </div>

                {configTab === 'geral' && (
                  <div className="modal-section two-col">
                    <div>
                      <div className="section-title">Título do jogo</div>
                      <div className="input-row">
                        <label>Nome exibido na biblioteca</label>
                        <input
                          value={titleValue}
                          onChange={(e) => setTitleValue(e.target.value)}
                          placeholder="Digite o título"
                        />
                      </div>
                      <div className="input-inline" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn ghost"
                          onClick={() => fetchBanner(game)}
                          disabled={bannerLoading === game.url || bannerManualBusy}
                        >
                          {bannerLoading === game.url && <RefreshCw size={14} className="of-spin" style={{ marginRight: 6 }} />}
                          {bannerLoading === game.url ? 'Buscando banner...' : 'Buscar banner'}
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => pickBannerFile(game)}
                          disabled={bannerLoading === game.url || bannerManualBusy}
                        >
                          {bannerManualBusy ? 'Abrindo...' : 'Escolher arquivo'}
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => clearBanner(game)}
                          disabled={bannerLoading === game.url || bannerManualBusy || !game.image_url}
                        >
                          Limpar
                        </button>
                      </div>
                      <div className="input-row" style={{ marginTop: 8 }}>
                        <label>Banner manual (URL)</label>
                        <div className="input-inline">
                          <input
                            value={bannerManualUrl}
                            onChange={(e) => setBannerManualUrl(e.target.value)}
                            placeholder="https://... ou file://..."
                          />
                          <button className="btn accent" onClick={() => applyBannerUrl(game)} disabled={bannerLoading === game.url || bannerManualBusy}>
                            Aplicar
                          </button>
                        </div>
                        <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>
                          Dica: ao escolher um arquivo, ele é copiado para o launcher e vira um `file://`.
                        </div>
                      </div>
                      {game.image_url && (
                        <div className="banner-current" title={game.image_url}>
                          Banner atual: {game.image_url}
                        </div>
                      )}
                      <div className="section-title">Versão e pasta</div>
                      <div className="input-row">
                        <label>Versão instalada</label>
                        <div className="input-inline">
                          <input
                            value={versionValue}
                            onChange={(e) => setVersionValue(e.target.value)}
                            placeholder="Defina a versão manualmente"
                          />
                        </div>
                        <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>Salvamento automático</div>
                      </div>
                      <div className="input-row">
                        <label>Caminho do jogo</label>
                        <div className="path-box" title={game.install_path || 'Caminho não definido'}>
                          {game.install_path || 'Caminho não definido'}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="section-title">Executável</div>
                      <div className="input-row">
                        <label>Arquivo .exe</label>
                        <div className="input-inline">
                          <input value={game.executable_path || ''} readOnly placeholder="Não configurado" />
                          <button
                            className="btn accent"
                            onClick={() => configureExe(game)}
                            disabled={configuring === game.url}
                          >
                            Selecionar
                          </button>
                        </div>
                        {!game.executable_path && <div className="warning-text">Defina o executável para jogar</div>}
                      </div>
                      <div className="section-title" style={{ marginTop: '16px' }}>Ações</div>
                      <div className="input-row">
                        <button className="btn danger" onClick={() => deleteGame(game)} style={{ width: '100%' }}>
                          <Trash2 size={14} />
                          Desinstalar jogo
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {configTab === 'onlinefix' && (
                  <div className="modal-section">
                    <div className="section-title">Idioma / OnlineFix.ini</div>
                    {!game.install_path && (
                      <div className="warning-text">Instale o jogo para editar o OnlineFix.ini</div>
                    )}
                    {game.install_path && (
                      <>
                        <div className="input-row">
                          <label>Caminho do OnlineFix.ini</label>
                          <div className="path-box" title={iniPath || 'Não encontrado'}>
                            {iniPath || 'OnlineFix.ini não encontrado — será criado ao salvar'}
                          </div>
                        </div>
                        {iniError && <div className="error-banner" style={{ marginBottom: 10 }}><AlertCircle size={14} /> {iniError}</div>}
                        <div className="input-inline" style={{ gap: 10 }}>
                          <button className="btn ghost" onClick={() => loadOnlineFixIni(game)} disabled={iniLoading || !game.install_path} style={{ position: 'relative' }}>
                            <RefreshCw size={14} className={iniLoading ? 'of-spin' : ''} style={{ marginRight: 6 }} />
                            {iniLoading ? 'Recarregando...' : 'Recarregar'}
                          </button>
                        </div>
                        <div className="section-title" style={{ marginTop: 12 }}>Editar como formulário</div>
                        <div className="input-row">
                          <label>Chaves/valores detectados</label>
                          {iniFields.length === 0 && (
                            <div className="warning-text">Nenhum campo detectado. Adicione um novo campo ou edite o texto bruto.</div>
                          )}
                          <div className="ini-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', alignItems: 'flex-start', marginTop: 8 }}>
                            {iniFields.map((field, idx) => (
                              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#111', border: '1px solid #222', borderRadius: 10, padding: '10px 12px', position: 'relative' }}>
                                {/* FIX: Added remove button */}
                                <button
                                  onClick={() => removeIniField(idx)}
                                  style={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#666',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    fontSize: '12px'
                                  }}
                                  title="Remover campo"
                                >
                                  ✕
                                </button>
                                <label style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>
                                  {field.key || 'Nova chave'}
                                </label>
                                {!field.key && (
                                  <input
                                    value={field.key}
                                    onChange={(e) => updateIniFieldKey(idx, e.target.value)}
                                    placeholder="Nova chave (ex: language)"
                                    style={{ width: '100%' }}
                                  />
                                )}
                                {['true', 'false'].includes(String(field.value || '').toLowerCase()) ? (
                                  <select
                                    value={String(field.value || '').toLowerCase() === 'true' ? 'true' : 'false'}
                                    onChange={(e) => updateIniField(idx, e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2f2f2f', borderRadius: 8, color: '#fff' }}
                                  >
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                  </select>
                                ) : (
                                  <input
                                    value={field.value}
                                    onChange={(e) => updateIniField(idx, e.target.value)}
                                    placeholder="Valor (ex: English)"
                                    style={{ width: '100%' }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="input-inline" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                            <button
                              className="btn ghost"
                              onClick={addIniField}
                            >
                              Adicionar campo
                            </button>
                            <button
                              className="btn ghost"
                              onClick={() => {
                                const fields = parseIniFields(iniOriginalContent || iniContent)
                                setIniFields(fields)
                                iniFieldsRef.current = fields
                              }}
                              title="Reconstruir o formulário a partir do texto"
                            >
                              Reprocessar texto
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {configTab === 'proton' && (
                  <div className="modal-section">
                    <div className="section-title">Compatibilidade Proton</div>
                    <div className="input-row">
                      <label>Prefixo do jogo</label>
                      <div className="input-inline" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          value={protonPrefix || ''}
                          readOnly
                          placeholder="Nenhum prefixo criado ainda"
                          style={{ flex: 1 }}
                        />
                        <button
                          className="btn ghost"
                          onClick={async () => {
                            setPrefixJobs(prev => ({
                              ...prev,
                              [game.url]: { status: 'starting', message: 'Preparando prefixo...', updatedAt: Date.now() }
                            }))
                            const res = await window.electronAPI.protonCreateGamePrefix(game.url, game.title)
                            if (res.success && res.prefix) {
                              setProtonPrefix(res.prefix)
                            } else {
                              alert(res.error || 'Falha ao criar prefixo')
                            }
                          }}
                          disabled={prefixJobs[game.url]?.status === 'starting' || prefixJobs[game.url]?.status === 'progress'}
                        >
                          {(prefixJobs[game.url]?.status === 'starting' || prefixJobs[game.url]?.status === 'progress') ? 'Preparando...' : 'Criar/Atualizar prefixo'}
                        </button>
                      </div>
                      {(prefixJobs[game.url]?.status === 'starting' || prefixJobs[game.url]?.status === 'progress' || prefixJobs[game.url]?.status === 'error') && (
                        <div className="small text-muted" style={{ color: prefixJobs[game.url]?.status === 'error' ? '#fca5a5' : '#9ca3af', marginTop: 6 }}>
                          {prefixJobs[game.url]?.message || (prefixJobs[game.url]?.status === 'error' ? 'Falha ao preparar prefixo' : 'Preparando prefixo...')}
                        </div>
                      )}
                      <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>Um prefixo dedicado por jogo evita conflito de arquivos.</div>
                    </div>
                    <div className="input-row">
                      <label>Runtime Proton (opcional)</label>
                      <select
                        value={protonVersion}
                        onChange={(e) => setProtonVersion(e.target.value)}
                        style={{ padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2f2f2f', borderRadius: '8px', color: '#fff' }}
                      >
                        <option value="">Auto (Proton Experimental)</option>
                        {protonRuntimes.map(rt => (
                          <option key={rt.runner} value={rt.path}>
                            {rt.name} • {rt.path}
                          </option>
                        ))}
                      </select>
                      <div className="input-inline">
                        <input
                          value={protonRootInput}
                          onChange={(e) => setProtonRootInput(e.target.value)}
                          placeholder="Adicionar pasta de Protons (Steam/compatibilitytools.d)"
                        />
                        <button className="btn ghost" onClick={addProtonRoot}>Adicionar</button>
                      </div>
                    </div>
                    <div className="input-row">
                      <label>Steam AppID (compatibilidade)</label>
                      <input
                        value={steamAppId}
                        onChange={(e) => setSteamAppId(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="480"
                        style={{ padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2f2f2f', borderRadius: '8px', color: '#fff' }}
                      />
                      <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>
                        Controla cache/shader e comportamento do Proton. Deixe vazio para auto (480/OnlineFix.ini/steam_appid.txt).
                      </div>
                    </div>
                    <div className="options-grid">
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.esync} onChange={(e) => setProtonOptions(o => ({ ...o, esync: e.target.checked }))} />
                        <span>ESYNC</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.fsync} onChange={(e) => setProtonOptions(o => ({ ...o, fsync: e.target.checked }))} />
                        <span>FSYNC</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.dxvk} onChange={(e) => setProtonOptions(o => ({ ...o, dxvk: e.target.checked }))} />
                        <span>DXVK (desmarque para Wined3D)</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.mesa_glthread} onChange={(e) => setProtonOptions(o => ({ ...o, mesa_glthread: e.target.checked }))} />
                        <span>MESA_GLTHREAD</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.gamemode} onChange={(e) => setProtonOptions(o => ({ ...o, gamemode: e.target.checked }))} />
                        <span>Gamemode</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.mangohud} onChange={(e) => setProtonOptions(o => ({ ...o, mangohud: e.target.checked }))} />
                        <span>MangoHUD</span>
                      </label>
                      <label className="toggle">
                        <input type="checkbox" checked={protonOptions.logging} onChange={(e) => setProtonOptions(o => ({ ...o, logging: e.target.checked }))} />
                        <span>Logs Proton</span>
                      </label>
                    </div>
                    <div className="input-row two-col">
                      <div>
                        <label>Locale (ex: en_US.UTF-8)</label>
                        <input
                          value={protonOptions.locale}
                          onChange={(e) => setProtonOptions(o => ({ ...o, locale: e.target.value }))}
                          placeholder="Locale opcional"
                        />
                      </div>
                      <div>
                        <label>Opções de lançamento</label>
                        <input
                          value={protonOptions.launchArgs}
                          onChange={(e) => setProtonOptions(o => ({ ...o, launchArgs: e.target.value }))}
                          placeholder="Argumentos extras"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {configTab === 'lan' && (
                  <div className="modal-section">
                    <div className="section-title">Conectividade</div>
                    <div className="input-row">
                      <label>Modo</label>
                      <select
                        value={lanMode}
                        onChange={(e) => setLanMode((e.target.value as LanMode) || 'steam')}
                        style={{ padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2f2f2f', borderRadius: '8px', color: '#fff' }}
                      >
                        <option value="steam">Padrão (Steam/Epic/OnlineFix)</option>
                        <option value="ofvpn">VPN (OF)</option>
                      </select>
                      <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>
                        Use VPN (OF) apenas quando o multiplayer padrão não funcionar ou para jogos LAN/Direct IP.
                      </div>
                    </div>

                    {lanMode === 'ofvpn' && (
                      <>
                        <div className="input-row">
                          <label>Sala</label>
                          <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 4 }}>
                            Crie uma sala para jogar via LAN/Direct IP com seus amigos, ou entre usando um código. O launcher conecta automaticamente.
                          </div>

                          <div className="input-inline" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                            <input
                              value={lanRoomCode}
                              onChange={(e) =>
                                setLanRoomCode(
                                  e.target.value
                                    .toUpperCase()
                                    .replace(/[^A-HJ-NP-Z2-9]/g, '')
                                    .slice(0, 16)
                                )
                              }
                              placeholder="Código da sala (ex: ABCD2345EFGH)"
                              style={{ flex: 1, minWidth: 220 }}
                            />
                            <button
                              className="btn"
                              disabled={lanRoomBusy || vpnActionBusy}
                              onClick={async () => {
                                setLanRoomBusy(true)
                                setVpnActionBusy(true)
                                try {
                                  const res = await window.electronAPI.vpnRoomCreate?.({ name: `OF ${titleValue || ''}`.trim() })
                                  if (!res?.success) throw new Error(res?.error || 'Falha ao criar sala')
                                  const code = String(res.code || '').trim()
                                  const cfg = String(res.config || '').trim()
                                  if (!code || !cfg) throw new Error('Resposta inválida do servidor')
                                  setLanRoomLastCode(code)
                                  setLanRoomCode(code)
                                  setLanNetworkId(code)
                                  setVpnConfig(cfg)
                                  setVpnLocalIp(String(res.vpnIp || '').trim())
                                  setVpnHostIp(String(res.vpnIp || '').trim())

                                  const conn = await window.electronAPI.vpnConnect?.(cfg)
                                  if (!conn?.success) {
                                    if (conn?.needsInstall) throw new Error('WireGuard não instalado (clique em “Instalar VPN”)')
                                    if (conn?.needsAdmin) throw new Error('O Windows pediu permissão de administrador para conectar a VPN. Aceite o UAC e tente novamente.')
                                    throw new Error(conn?.error || 'Falha ao conectar')
                                  }
                                  setVpnConnected(true)
                                } catch (err: any) {
                                  alert(err?.message || 'Falha ao criar sala')
                                } finally {
                                  setLanRoomBusy(false)
                                  setVpnActionBusy(false)
                                }
                              }}
                            >
                              {lanRoomBusy ? 'Criando…' : 'Criar sala'}
                            </button>
                            <button
                              className="btn ghost"
                              disabled={lanRoomBusy || vpnActionBusy || !lanRoomCode.trim()}
                              onClick={async () => {
                                const code = lanRoomCode.trim().toUpperCase()
                                setLanRoomBusy(true)
                                setVpnActionBusy(true)
                                try {
                                  const res = await window.electronAPI.vpnRoomJoin?.(code, { name: `OF ${titleValue || ''}`.trim() })
                                  if (!res?.success) throw new Error(res?.error || 'Falha ao entrar na sala')
                                  const cfg = String(res.config || '').trim()
                                  if (!cfg) throw new Error('Resposta inválida do servidor')
                                  setLanRoomLastCode(code)
                                  setLanNetworkId(code)
                                  setVpnConfig(cfg)
                                  setVpnLocalIp(String(res.vpnIp || '').trim())
                                  setVpnHostIp(String(res.hostIp || '').trim())

                                  const conn = await window.electronAPI.vpnConnect?.(cfg)
                                  if (!conn?.success) {
                                    if (conn?.needsInstall) throw new Error('WireGuard não instalado (clique em “Instalar VPN”)')
                                    if (conn?.needsAdmin) throw new Error('O Windows pediu permissão de administrador para conectar a VPN. Aceite o UAC e tente novamente.')
                                    throw new Error(conn?.error || 'Falha ao conectar')
                                  }
                                  setVpnConnected(true)
                                } catch (err: any) {
                                  alert(err?.message || 'Falha ao entrar na sala')
                                } finally {
                                  setLanRoomBusy(false)
                                  setVpnActionBusy(false)
                                }
                              }}
                            >
                              Entrar
                            </button>
                          </div>

                          <div className="input-inline" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                            <button
                              className="btn ghost"
                              disabled={!lanNetworkId.trim()}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(lanNetworkId.trim())
                                } catch {
                                  alert('Não foi possível copiar')
                                }
                              }}
                            >
                              Copiar código
                            </button>
                            <button
                              className="btn ghost"
                              disabled={!vpnHostIp}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(vpnHostIp)
                                } catch {
                                  alert('Não foi possível copiar')
                                }
                              }}
                            >
                              Copiar IP do host
                            </button>
                            <button
                              className="btn ghost"
                              disabled={!vpnLocalIp}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(vpnLocalIp)
                                } catch {
                                  alert('Não foi possível copiar')
                                }
                              }}
                            >
                              Copiar meu IP
                            </button>
                          </div>

                          {(lanNetworkId || vpnLocalIp || vpnHostIp) ? (
                            <div className="small text-muted" style={{ color: '#9ca3af', marginTop: 10 }}>
                              Sala: <code>{lanNetworkId || '—'}</code>
                              {' • '}Meu IP: <code>{vpnLocalIp || '—'}</code>
                              {' • '}Host: <code>{vpnHostIp || '—'}</code>
                            </div>
                          ) : null}

                          <label className="toggle" style={{ marginTop: 12, display: 'inline-flex' }}>
                            <input type="checkbox" checked={lanAutoconnect} onChange={(e) => setLanAutoconnect(e.target.checked)} />
                            <span>Conectar automaticamente (ao abrir o jogo)</span>
                          </label>
                        </div>

                        <div className="input-row">
                          <label>Status VPN</label>
                          {vpnLoading ? (
                            <div className="small text-muted" style={{ color: '#9ca3af' }}>Atualizando…</div>
                          ) : vpnError ? (
                            <div className="warning-text">{vpnError}</div>
                          ) : (
                            <div className="small text-muted" style={{ color: '#9ca3af' }}>
                              {vpnStatus?.installed ? 'WireGuard instalado' : 'WireGuard não instalado'}
                              {vpnStatus?.installError ? ` • ${vpnStatus.installError}` : ''}
                              {vpnConnected ? ' • Conectado' : ''}
                            </div>
                          )}

                          <div className="input-inline" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            <button
                              className="btn"
                              disabled={vpnActionBusy}
                              onClick={async () => {
                                if (!confirm('Instalar/configurar WireGuard agora? (pode pedir senha/admin)')) return
                                setVpnActionBusy(true)
                                try {
                                  const res = await window.electronAPI.vpnInstall?.()
                                  if (!res?.success) {
                                    const url = (res as any)?.url
                                    if (url) {
                                      const open = confirm((res?.error || 'Falha ao instalar') + '\n\nAbrir página de instalação do WireGuard?')
                                      if (open) await window.electronAPI.openExternal?.(String(url))
                                    }
                                    throw new Error(res?.error || 'Falha ao instalar')
                                  }
                                  alert('VPN instalada/configurada. Tente criar/entrar na sala novamente.')
                                } catch (err: any) {
                                  alert(err?.message || 'Falha ao instalar')
                                } finally {
                                  setVpnActionBusy(false)
                                }
                              }}
                            >
                              Instalar VPN
                            </button>
                            <button
                              className="btn ghost"
                              disabled={vpnActionBusy || !vpnConfig}
                              onClick={async () => {
                                setVpnActionBusy(true)
                                try {
                                  const res = await window.electronAPI.vpnConnect?.(vpnConfig)
                                  if (!res?.success) {
                                    if (res?.needsInstall) throw new Error('WireGuard não instalado (clique em “Instalar VPN”)')
                                    if (res?.needsAdmin) throw new Error('O Windows pediu permissão de administrador para conectar a VPN. Aceite o UAC e tente novamente.')
                                    throw new Error(res?.error || 'Falha ao conectar')
                                  }
                                  setVpnConnected(true)
                                } catch (err: any) {
                                  alert(err?.message || 'Falha ao conectar')
                                } finally {
                                  setVpnActionBusy(false)
                                }
                              }}
                            >
                              Conectar
                            </button>
                            <button
                              className="btn ghost"
                              disabled={vpnActionBusy}
                              onClick={async () => {
                                setVpnActionBusy(true)
                                try {
                                  const res = await window.electronAPI.vpnDisconnect?.()
                                  if (!res?.success) {
                                    if (res?.needsAdmin) throw new Error('O Windows pediu permissão de administrador para desconectar a VPN. Aceite o UAC e tente novamente.')
                                    throw new Error(res?.error || 'Falha ao desconectar')
                                  }
                                  setVpnConnected(false)
                                } catch (err: any) {
                                  alert(err?.message || 'Falha ao desconectar')
                                } finally {
                                  setVpnActionBusy(false)
                                }
                              }}
                            >
                              Desconectar
                            </button>
                          </div>
                        </div>

                        {lanNetworkId.trim() ? (
                          <div className="input-row">
                            <label>Peers na sala</label>
                            <div className="small text-muted" style={{ color: '#9ca3af', marginBottom: 8 }}>
                              Atualiza automaticamente.
                            </div>
                            {vpnPeers.length ? (
                              <div className="small" style={{ color: '#e5e7eb' }}>
                                {vpnPeers.map((p: any) => (
                                  <div key={`${p?.ip || ''}-${p?.name || ''}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                    <span style={{ color: '#9ca3af' }}>{p?.name || 'peer'}</span>
                                    <span><code>{p?.ip || ''}</code>{p?.role ? ` • ${p.role}` : ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="small text-muted" style={{ color: '#9ca3af' }}>Nenhum peer listado ainda.</div>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
