import React, { useState, useEffect, useRef, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'

// Import types and hooks from library module
import {
  Game,
  UpdateQueueState,
  UpdatingGameState,
  LaunchState,
  PrefixJobState,
  useAchievements,
  useOnlineFixIni,
  useVpn,
  useGameConfig,
  useCloudSaves,
  useFilteredGames,
  hasUpdate
} from './library'

// Import components from library module
import { GameCard } from './library/GameCard'
import { CloudSavesBanner } from './library/CloudSavesBanner'
import { LibraryFilters } from './library/LibraryFilters'
import { AchievementsModal } from './library/AchievementsModal'
import { SchemaEditorModal } from './library/SchemaEditorModal'
import { ConfigModal } from './library/ConfigModal'

// Spinner and achievement styles
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

// Tab fix styles
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

export default function LibraryTab() {
  // Core state
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLinux, setIsLinux] = useState(false)

  // Library filters
  const [librarySearch, setLibrarySearch] = useState<string>('')
  const [libraryCategory, setLibraryCategory] = useState<'all' | 'favorites' | 'installed' | 'updating'>('all')
  const [librarySort, setLibrarySort] = useState<'recent' | 'name' | 'size'>('recent')

  // Action menu
  const [openActionMenuGameUrl, setOpenActionMenuGameUrl] = useState<string | null>(null)

  // Update state
  const [scanningInstalled, setScanningInstalled] = useState(false)
  const [updateQueue, setUpdateQueue] = useState<UpdateQueueState>({ running: false, queued: 0, currentGameUrl: null, lastError: null, updatedAt: 0 })
  const [updatingGames, setUpdatingGames] = useState<Record<string, UpdatingGameState>>({})

  // Launch/prefix state
  const [launchingGames, setLaunchingGames] = useState<Record<string, LaunchState>>({})
  const [prefixJobs, setPrefixJobs] = useState<Record<string, PrefixJobState>>({})

  // Configuring exe
  const [configuring, setConfiguring] = useState<string | null>(null)

  // Refs
  const gamesRef = useRef<Game[]>([])
  const downloadKeyToGameUrlRef = useRef<Map<string, string>>(new Map())

  // Custom hooks
  const achievements = useAchievements()
  const onlineFixIni = useOnlineFixIni()
  const cloudSaves = useCloudSaves()
  const gameConfig = useGameConfig(gamesRef)

  // VPN hook needs config state
  const vpn = useVpn(
    !!gameConfig.showConfig,
    gameConfig.configTab,
    gameConfig.lanMode,
    gameConfig.lanNetworkId
  )

  // Filtered games
  const filteredGames = useFilteredGames({
    games,
    search: librarySearch,
    category: libraryCategory,
    sort: librarySort,
    updatingGames,
    updateQueue
  })

  // Sync games ref
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

  // Close action menu on outside click
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

  // Load games function
  const loadGames = useCallback(async () => {
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
  }, [])

  // Refresh active updates
  const refreshActiveUpdates = useCallback(async (gameList?: Game[]) => {
    try {
      const res = await window.electronAPI.getActiveDownloads()
      if (!res.success) return
      const list = gameList || gamesRef.current
      const map: Record<string, UpdatingGameState> = {}
      ;(res.downloads || []).forEach((d: any) => {
        const key = d.info_hash || d.download_url
        if (!key) return
        const match = list.find(g => g.torrent_magnet === key || g.download_url === key || g.url === d.game_url)
        if (match) map[match.url] = { status: 'downloading', id: key }
      })
      if (Object.keys(map).length) setUpdatingGames(prev => ({ ...prev, ...map }))
    } catch {}
  }, [])

  // Toggle favorite
  const toggleFavorite = useCallback(async (gameUrl: string) => {
    try {
      const fn = (window.electronAPI as any)?.toggleGameFavorite
      if (typeof fn !== 'function') throw new Error('API toggleGameFavorite não existe no preload')
      const res: any = await fn(gameUrl)
      if (!res?.success) throw new Error(res?.error || 'Falha ao atualizar favorito')
      setGames((prev) => (prev || []).map((g) => (g.url === gameUrl ? { ...g, is_favorite: res.isFavorite ? 1 : 0 } : g)))
    } catch (e: any) {
      alert(e?.message || 'Falha ao atualizar favorito')
    }
  }, [])

  // Play game
  const playGame = useCallback(async (game: Game) => {
    try {
      setLaunchingGames(prev => ({
        ...prev,
        [game.url]: { status: 'starting', message: 'Iniciando...', updatedAt: Date.now() }
      }))

      const launch = await window.electronAPI.launchGame(game.url)

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
  }, [])

  // Stop game
  const stopGame = useCallback(async (game: Game) => {
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
  }, [])

  // Update game
  const updateGame = useCallback(async (game: Game) => {
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
  }, [updateQueue.running, updatingGames, loadGames])

  // Scan installed games
  const scanInstalledGames = useCallback(async () => {
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
  }, [scanningInstalled, loadGames])

  // Delete game
  const deleteGame = useCallback(async (game: Game) => {
    if (confirm(`Deseja realmente desinstalar ${game.title}?`)) {
      const res = await window.electronAPI.deleteGame(game.url)
      if (res.success) setGames(prev => prev.filter(g => g.url !== game.url))
      else alert(res.error || 'Erro ao remover jogo')
    }
  }, [])

  // Open game folder
  const openGameFolder = useCallback(async (game: Game) => {
    if (!game.install_path) { alert('Pasta do jogo não encontrada'); return }
    const res = await window.electronAPI.openGameFolder(game.install_path)
    if (!res.success) alert(res.error || 'Não foi possível abrir a pasta')
  }, [])

  // Configure exe
  const configureExe = useCallback(async (game: Game) => {
    setConfiguring(game.url)
    const res = await window.electronAPI.configureGameExe(game.url)
    setConfiguring(null)
    if (res.success && res.exePath) setGames(prev => prev.map(g => g.url === game.url ? { ...g, executable_path: res.exePath } : g))
    else alert(res.error || 'Nenhum executável configurado')
  }, [])

  // Open proton log
  const openProtonLog = useCallback(async (logPath: string) => {
    const res = await window.electronAPI.openPath?.(logPath)
    if (res && res.success === false) alert(res.error || 'Falha ao abrir log')
  }, [])

  // Create proton prefix
  const createProtonPrefix = useCallback(async (game: Game) => {
    setPrefixJobs(prev => ({
      ...prev,
      [game.url]: { status: 'starting', message: 'Preparando prefixo...', updatedAt: Date.now() }
    }))
    const res = await window.electronAPI.protonCreateGamePrefix(game.url, game.title)
    if (res.success && res.prefix) {
      gameConfig.setProtonPrefix(res.prefix)
    } else {
      alert(res.error || 'Falha ao criar prefixo')
    }
  }, [gameConfig])

  // Open config modal
  const openConfigModal = useCallback((game: Game) => {
    gameConfig.openConfig(game)
    onlineFixIni.resetState()
    onlineFixIni.loadIni(game)
    vpn.resetState()
  }, [gameConfig, onlineFixIni, vpn])

  // Close config modal
  const closeConfigModal = useCallback(() => {
    gameConfig.closeConfig()
    onlineFixIni.clearAutosaveTimer()
  }, [gameConfig, onlineFixIni])

  // Initial load
  useEffect(() => {
    loadGames()
    gameConfig.loadProtonRuntimes()
    refreshActiveUpdates()

    // Check platform
    ;(async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        setIsLinux(Boolean(settings?.isLinux || settings?.platform === 'linux'))
      } catch {}
    })()

    // Auto-check updates
    ;(async () => {
      try {
        await window.electronAPI.checkAllUpdates?.()
        try { void loadGames() } catch {}
      } catch {}
    })()

    // Hydrate update queue
    ;(async () => {
      try {
        const res = await window.electronAPI.getUpdateQueueStatus?.()
        if (res?.success && res.status) setUpdateQueue(res.status)
      } catch {}
    })()

    // Subscribe to update queue changes
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
          if (prev.running === next.running && prev.queued === next.queued && prev.currentGameUrl === next.currentGameUrl && prev.lastError === next.lastError) return prev
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

      if (data?.destPath) {
        try {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = setTimeout(() => {
            try { void loadGames() } catch {}
          }, 600)
        } catch {}
      }
    })

    const unsubDownloadProgress = window.electronAPI.onDownloadProgress?.((data) => {
      const keys = [data?.infoHash, data?.magnet, data?.url].filter(Boolean).map(k => String(k))
      if (!keys.length) return
      setUpdatingGames(prev => {
        let gameUrl = ''
        let idKey = ''
        for (const keyStr of keys) {
          const mapped = downloadKeyToGameUrlRef.current.get(keyStr)
          if (mapped) {
            gameUrl = mapped
            idKey = keyStr
            break
          }
        }
        if (!gameUrl) return prev
        const cur = prev[gameUrl]
        if (cur && cur.status === 'downloading' && String(cur.id || '') === idKey) return prev
        return { ...prev, [gameUrl]: { status: 'downloading', id: idKey } }
      })
    })

    const unsubDownloadDeleted = window.electronAPI.onDownloadDeleted?.(() => {
      setUpdatingGames({})
      try {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = setTimeout(() => {
          try {
            void loadGames()
            void refreshActiveUpdates()
          } catch {}
        }, 300)
      } catch {}
    })

    return () => {
      if (typeof unsubVersion === 'function') unsubVersion()
      if (typeof unsubDownloadComplete === 'function') unsubDownloadComplete()
      if (typeof unsubDownloadProgress === 'function') unsubDownloadProgress()
      if (typeof unsubDownloadDeleted === 'function') unsubDownloadDeleted()
      if (typeof unsubQueue === 'function') unsubQueue()
      try { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current) } catch {}
    }
  }, [])

  // Game launch status listener
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

      // When game exits OK, sync saves
      if (data.status === 'exited') {
        const ok = data.code == null || Number(data.code) === 0
        if (ok) {
          setTimeout(() => { void cloudSaves.runSaveSync(data.gameUrl, 'game_exited') }, 600)
        }
      }

      // Auto-clear successful exits
      if (data.status === 'exited' && (data.code == null || Number(data.code) === 0)) {
        const url = data.gameUrl
        setTimeout(() => {
          setLaunchingGames(p => {
            const cur = p[url]
            if (!cur || cur.status !== 'exited') return p
            if (cur.code != null && Number(cur.code) !== 0) return p
            const next = { ...p }
            delete next[url]
            return next
          })
        }, 2500)
      }
    })
    return () => { try { unsub?.() } catch {} }
  }, [cloudSaves])

  // Prefix job status listener
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
            if (!cur || cur.status !== 'done') return p
            const next = { ...p }
            delete next[url]
            return next
          })
        }, 2000)
      }
    })
    return () => { try { unsub?.() } catch {} }
  }, [])

  // Config autosave effect - use JSON.stringify for objects to avoid reference comparison issues
  const protonOptionsJson = JSON.stringify(gameConfig.protonOptions)
  useEffect(() => {
    if (!gameConfig.showConfig) return
    if (gameConfig.suppressConfigAutosaveRef.current) return
    const game = gamesRef.current.find(g => g.url === gameConfig.showConfig)
    if (!game) return
    gameConfig.scheduleConfigAutosave(game, setGames)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameConfig.showConfig,
    gameConfig.titleValue,
    gameConfig.versionValue,
    gameConfig.protonVersion,
    protonOptionsJson,
    gameConfig.steamAppId,
    gameConfig.protonPrefix,
    gameConfig.lanMode,
    gameConfig.lanNetworkId,
    gameConfig.lanAutoconnect,
    gameConfig.scheduleConfigAutosave
  ])

  // INI autosave effect
  useEffect(() => {
    if (!gameConfig.showConfig) return
    const game = gamesRef.current.find(g => g.url === gameConfig.showConfig)
    if (!game?.install_path) return
    if (!onlineFixIni.iniDirty) return
    if (onlineFixIni.iniLoading || onlineFixIni.iniSaving) return

    if (onlineFixIni.iniAutosaveTimerRef.current) clearTimeout(onlineFixIni.iniAutosaveTimerRef.current)
    onlineFixIni.iniAutosaveTimerRef.current = setTimeout(() => {
      onlineFixIni.iniAutosaveTimerRef.current = null
      void onlineFixIni.saveIni(game)
    }, 1200)
  }, [gameConfig.showConfig, onlineFixIni.iniDirty, onlineFixIni.iniFields, onlineFixIni.iniLoading, onlineFixIni.iniSaving, onlineFixIni])

  // Get current config game
  const configGame = gameConfig.showConfig ? games.find(g => g.url === gameConfig.showConfig) : null

  // Render
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>Carregando biblioteca...</p>
      </div>
    )
  }

  return (
    <div className="library-tab">
      <style>{spinnerStyles + tabFixStyles}</style>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Cloud Saves Banner */}
      {cloudSaves.cloudSavesBanner && (
        <CloudSavesBanner
          banner={cloudSaves.cloudSavesBanner}
          games={games}
          onOpenBackups={cloudSaves.openCloudBackupsForBanner}
          onClose={cloudSaves.closeBanner}
        />
      )}

      {/* Library Filters */}
      <LibraryFilters
        search={librarySearch}
        onSearchChange={setLibrarySearch}
        category={libraryCategory}
        onCategoryChange={setLibraryCategory}
        sort={librarySort}
        onSortChange={setLibrarySort}
        onScan={scanInstalledGames}
        scanning={scanningInstalled}
      />

      {/* Games Grid */}
      <div className="library-grid-heroic">
        {filteredGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            launchState={launchingGames[game.url]}
            prefixState={prefixJobs[game.url]}
            syncState={cloudSaves.saveSyncJobs[game.url]}
            achievementProgress={achievements.progressByGameUrl[game.url]}
            updatingGames={updatingGames}
            updateQueue={updateQueue}
            isActionMenuOpen={openActionMenuGameUrl === game.url}
            onToggleActionMenu={() => setOpenActionMenuGameUrl(cur => cur === game.url ? null : game.url)}
            onCloseActionMenu={() => setOpenActionMenuGameUrl(null)}
            onOpenConfig={() => openConfigModal(game)}
            onToggleFavorite={() => toggleFavorite(game.url)}
            onOpenFolder={() => openGameFolder(game)}
            onUpdate={() => updateGame(game)}
            onOpenProtonLog={() => launchingGames[game.url]?.protonLogPath && openProtonLog(launchingGames[game.url].protonLogPath!)}
            onDelete={() => deleteGame(game)}
            onOpenAchievements={() => achievements.openModal(game.url, game.title)}
            onPlay={() => playGame(game)}
            onStop={() => stopGame(game)}
          />
        ))}
      </div>

      {/* Achievements Modal */}
      {achievements.modalGameUrl && (
        <>
          <AchievementsModal
            gameUrl={achievements.modalGameUrl}
            title={achievements.modalTitle}
            loading={achievements.modalLoading}
            error={achievements.modalError}
            sources={achievements.modalSources}
            items={achievements.modalItems}
            revealedHiddenIds={achievements.revealedHiddenIds}
            schemaRefreshedOnce={achievements.schemaRefreshedOnce}
            onClose={achievements.closeModal}
            onReload={() => achievements.loadAchievementsForGameUrl(achievements.modalGameUrl!)}
            onImportSchema={async () => {
              if (!achievements.modalGameUrl) return
              const res: any = await window.electronAPI.importAchievementSchema?.(achievements.modalGameUrl)
              if (!res?.success) {
                alert(res?.error || 'Falha ao importar schema')
                return
              }
              await achievements.loadAchievementsForGameUrl(achievements.modalGameUrl)
            }}
            onCreateSchema={() => achievements.openSchemaEditor(true)}
            onRemoveSchema={async () => {
              if (!achievements.modalGameUrl) return
              const ok = confirm('Remover schema importado deste jogo?')
              if (!ok) return
              const res: any = await window.electronAPI.clearAchievementSchema?.(achievements.modalGameUrl)
              if (!res?.success) {
                alert(res?.error || 'Falha ao remover schema')
                return
              }
              await achievements.loadAchievementsForGameUrl(achievements.modalGameUrl)
            }}
            onRevealHidden={(id, hasMeaningfulName, hasMeaningfulDesc) => {
              achievements.revealHiddenAchievement(id)
              // Force refresh schema if needed
              if (!achievements.schemaRefreshedOnce && (!hasMeaningfulName || !hasMeaningfulDesc) && achievements.modalGameUrl) {
                achievements.setSchemaRefreshedOnce(true)
                void window.electronAPI.forceRefreshAchievementSchema(achievements.modalGameUrl).then(() => {
                  void achievements.loadAchievementsForGameUrl(achievements.modalGameUrl!)
                })
              }
            }}
            onForceRefreshSchema={async () => {
              if (!achievements.modalGameUrl) return
              await window.electronAPI.forceRefreshAchievementSchema(achievements.modalGameUrl)
              await achievements.loadAchievementsForGameUrl(achievements.modalGameUrl)
            }}
          />

          {/* Schema Editor Modal */}
          {achievements.schemaEditorOpen && (
            <SchemaEditorModal
              title={achievements.modalTitle}
              value={achievements.schemaEditorValue}
              error={achievements.schemaEditorError}
              busy={achievements.schemaEditorBusy}
              onValueChange={achievements.setSchemaEditorValue}
              onClose={() => achievements.setSchemaEditorOpen(false)}
              onGenerateTemplate={() => achievements.openSchemaEditor(true)}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(achievements.schemaEditorValue || '')
                } catch {}
              }}
              onClear={() => achievements.setSchemaEditorValue(JSON.stringify({ items: [] }, null, 2))}
              onSave={async () => {
                if (!achievements.modalGameUrl) return
                achievements.setSchemaEditorBusy(true)
                achievements.setSchemaEditorError(null)
                try {
                  const res: any = await window.electronAPI.saveAchievementSchema?.(achievements.modalGameUrl, achievements.schemaEditorValue)
                  if (!res?.success) {
                    achievements.setSchemaEditorError(res?.error || 'Falha ao salvar schema')
                    return
                  }
                  achievements.setSchemaEditorOpen(false)
                  await achievements.loadAchievementsForGameUrl(achievements.modalGameUrl)
                } catch (e: any) {
                  achievements.setSchemaEditorError(e?.message || 'Falha ao salvar schema')
                } finally {
                  achievements.setSchemaEditorBusy(false)
                }
              }}
            />
          )}
        </>
      )}

      {/* Config Modal */}
      {configGame && (
        <ConfigModal
          game={configGame}
          isLinux={isLinux}

          // Tab state
          configTab={gameConfig.configTab}
          onTabChange={gameConfig.setConfigTab}
          configSaveState={gameConfig.configSaveState}

          // General tab
          titleValue={gameConfig.titleValue}
          onTitleChange={gameConfig.setTitleValue}
          versionValue={gameConfig.versionValue}
          onVersionChange={gameConfig.setVersionValue}
          bannerLoading={gameConfig.bannerLoading}
          bannerManualUrl={gameConfig.bannerManualUrl}
          onBannerManualUrlChange={gameConfig.setBannerManualUrl}
          bannerManualBusy={gameConfig.bannerManualBusy}
          onFetchBanner={() => gameConfig.fetchBanner(configGame, setGames)}
          onApplyBannerUrl={() => gameConfig.applyBannerUrl(configGame, setGames)}
          onPickBannerFile={() => gameConfig.pickBannerFile(configGame, setGames)}
          onClearBanner={() => gameConfig.clearBanner(configGame, setGames)}
          configuring={configuring}
          onConfigureExe={() => configureExe(configGame)}
          onDelete={() => { closeConfigModal(); deleteGame(configGame) }}

          // OnlineFix.ini tab
          iniPath={onlineFixIni.iniPath}
          iniError={onlineFixIni.iniError}
          iniLoading={onlineFixIni.iniLoading}
          iniSaving={onlineFixIni.iniSaving}
          iniDirty={onlineFixIni.iniDirty}
          iniFields={onlineFixIni.iniFields}
          iniLastSavedAt={onlineFixIni.iniLastSavedAt}
          onReloadIni={() => onlineFixIni.loadIni(configGame)}
          onUpdateIniField={onlineFixIni.updateField}
          onUpdateIniFieldKey={onlineFixIni.updateFieldKey}
          onAddIniField={onlineFixIni.addField}
          onRemoveIniField={onlineFixIni.removeField}
          onReprocessIni={onlineFixIni.reprocessText}

          // Proton tab
          protonPrefix={gameConfig.protonPrefix}
          prefixJobs={prefixJobs}
          onCreatePrefix={() => createProtonPrefix(configGame)}
          protonVersion={gameConfig.protonVersion}
          onProtonVersionChange={gameConfig.setProtonVersion}
          protonRuntimes={gameConfig.protonRuntimes}
          protonRootInput={gameConfig.protonRootInput}
          onProtonRootInputChange={gameConfig.setProtonRootInput}
          onAddProtonRoot={gameConfig.addProtonRoot}
          steamAppId={gameConfig.steamAppId}
          onSteamAppIdChange={gameConfig.setSteamAppId}
          protonOptions={gameConfig.protonOptions}
          onProtonOptionsChange={gameConfig.setProtonOptions}

          // LAN tab
          lanMode={gameConfig.lanMode}
          onLanModeChange={gameConfig.setLanMode}
          lanRoomCode={vpn.lanRoomCode}
          onLanRoomCodeChange={vpn.setLanRoomCode}
          lanRoomBusy={vpn.lanRoomBusy}
          onCreateRoom={(options) => vpn.createRoom(gameConfig.titleValue, gameConfig.setLanNetworkId)}
          onJoinRoom={(password) => vpn.joinRoom(vpn.lanRoomCode, gameConfig.titleValue, gameConfig.setLanNetworkId, password)}
          onLeaveRoom={() => vpn.leaveRoom(gameConfig.setLanNetworkId)}
          lanNetworkId={gameConfig.lanNetworkId}
          lanRoomName={vpn.currentRoomName || gameConfig.lanNetworkId}
          vpnLocalIp={vpn.vpnLocalIp}
          vpnHostIp={vpn.vpnHostIp}
          vpnPeerId={vpn.vpnPeerId}
          lanAutoconnect={gameConfig.lanAutoconnect}
          onLanAutoconnectChange={gameConfig.setLanAutoconnect}
          vpnLoading={vpn.vpnLoading}
          vpnHasLoaded={vpn.vpnHasLoaded}
          vpnError={vpn.vpnError}
          vpnStatus={vpn.vpnStatus}
          vpnConnected={vpn.vpnConnected}
          vpnActionBusy={vpn.vpnActionBusy}
          onInstallVpn={vpn.installVpn}
          onConnectVpn={vpn.connect}
          onDisconnectVpn={vpn.disconnect}
          vpnPeers={vpn.vpnPeers}
          vpnRooms={vpn.publicRooms}
          onRefreshRooms={() => vpn.loadPublicRooms(gameConfig.titleValue)}
          onCopyToClipboard={vpn.copyToClipboard}
          vpnConfig={vpn.vpnConfig}

          // Close
          onClose={closeConfigModal}
        />
      )}
    </div>
  )
}
