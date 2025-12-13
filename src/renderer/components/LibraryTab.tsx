import React, { useState, useEffect, useRef } from 'react'
import { Play, Trash2, RefreshCw, Folder, Library, AlertCircle, Settings, Download, Square, FileText } from 'lucide-react'

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
}

export default function LibraryTab() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  type GameConfigTab = 'geral' | 'onlinefix' | 'proton'
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
  const [updatingGames, setUpdatingGames] = useState<Record<string, { status: 'starting' | 'downloading'; id?: string }>>({})
  const gamesRef = useRef<Game[]>([])
  const [protonPrefix, setProtonPrefix] = useState<string>('')
  const [steamAppId, setSteamAppId] = useState<string>('')
  const [iniLastSavedAt, setIniLastSavedAt] = useState<number | null>(null)
  const iniAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [launchingGames, setLaunchingGames] = useState<Record<string, { status: 'starting' | 'running' | 'exited' | 'error'; pid?: number; code?: number | null; message?: string; stderrTail?: string; protonLogPath?: string; updatedAt: number }>>({})
  const [prefixJobs, setPrefixJobs] = useState<Record<string, { status: 'starting' | 'progress' | 'done' | 'error'; message?: string; prefix?: string; updatedAt: number }>>({})

  // FIX: Use refs to ensure we always have the latest values when saving
  const iniFieldsRef = useRef<Array<{ key: string; value: string }>>([])
  const iniOriginalContentRef = useRef<string>('')
  
  // Keep refs in sync with state
  useEffect(() => {
    iniFieldsRef.current = iniFields
  }, [iniFields])
  
  useEffect(() => {
    iniOriginalContentRef.current = iniOriginalContent
  }, [iniOriginalContent])

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

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  const spinnerStyles = `
    @keyframes of-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .of-spin { animation: of-spin 0.9s linear infinite; }
  `

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

  // Simple INI parser - extracts key=value pairs
  const parseIniFields = (text: string): Array<{ key: string; value: string }> => {
    const fields: Array<{ key: string; value: string }> = []
    const lines = (text || '').split(/\r?\n/)
    const kvRegex = /^\s*([^=;\[#]+?)\s*=\s*(.*)$/

    lines.forEach((line) => {
      const match = line.match(kvRegex)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim()
        if (key) {
          fields.push({ key, value })
        }
      }
    })
    return fields
  }

  // FIX: Improved buildIniContent that handles empty originalContent correctly
  const buildIniContent = (originalContent: string, fields: Array<{ key: string; value: string }>): string => {
    // Filter out fields with empty keys
    const validFields = fields.filter(f => f.key && f.key.trim())
    
    // If no valid fields, return original or empty
    if (validFields.length === 0) {
      return originalContent || ''
    }
    
    // If no original content, just build from fields directly
    if (!originalContent || originalContent.trim() === '') {
      return validFields.map(f => `${f.key}=${f.value}`).join('\n')
    }
    
    const fieldMap = new Map<string, string>()
    validFields.forEach(f => {
      fieldMap.set(f.key.toLowerCase().trim(), f.value)
    })

    const lines = originalContent.split(/\r?\n/)
    const kvRegex = /^(\s*)([^=;\[#]+?)(\s*=\s*)(.*)$/
    const usedKeys = new Set<string>()

    const updatedLines = lines.map(line => {
      const match = line.match(kvRegex)
      if (match) {
        const [, indent, key, separator, ] = match
        const keyLower = key.trim().toLowerCase()
        if (fieldMap.has(keyLower)) {
          usedKeys.add(keyLower)
          return `${indent}${key.trim()}${separator}${fieldMap.get(keyLower)}`
        }
      }
      return line
    })

    // Add any new fields that weren't in the original
    validFields.forEach(f => {
      const keyLower = f.key.toLowerCase().trim()
      if (!usedKeys.has(keyLower)) {
        updatedLines.push(`${f.key}=${f.value}`)
      }
    })

    return updatedLines.join('\n')
  }

  // FIX: Updated to use refs and handle edge cases better
  const buildCurrentIniText = (): string => {
    // Use refs to get the most current values
    const currentFields = iniFieldsRef.current
    const currentOriginal = iniOriginalContentRef.current
    
    // Filter valid fields (non-empty keys)
    const validFields = currentFields.filter(f => f.key && f.key.trim())
    
    // If no valid fields, return original content or empty
    if (validFields.length === 0) {
      return currentOriginal || iniContent || ''
    }
    
    // If we have original content, try to preserve its structure
    if (currentOriginal && currentOriginal.trim()) {
      return buildIniContent(currentOriginal, validFields)
    }
    
    // FIX: Fallback - build directly from fields if no original content
    // This is the key fix - when iniOriginalContent is empty, we still produce valid output
    return validFields.map(f => `${f.key}=${f.value}`).join('\n')
  }

  // Update a single field value
  const updateIniField = (index: number, newValue: string) => {
    const newFields = [...iniFields]
    newFields[index] = { ...newFields[index], value: newValue }
    setIniFields(newFields)
    iniFieldsRef.current = newFields // FIX: Update ref immediately
    setIniDirty(true)
  }

  // Update a field key (for new fields)
  const updateIniFieldKey = (index: number, newKey: string) => {
    const newFields = [...iniFields]
    newFields[index] = { ...newFields[index], key: newKey }
    setIniFields(newFields)
    iniFieldsRef.current = newFields // FIX: Update ref immediately
    setIniDirty(true)
  }

  // Add a new empty field
  const addIniField = () => {
    const newFields = [...iniFields, { key: '', value: '' }]
    setIniFields(newFields)
    iniFieldsRef.current = newFields // FIX: Update ref immediately
    setIniDirty(true)
  }
  
  // FIX: Remove a field
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
    })

    const unsubDownloadProgress = window.electronAPI.onDownloadProgress?.((data) => {
      const key = data?.infoHash || data?.magnet || data?.url
      if (!key) return
      setUpdatingGames(prev => {
        const match = gamesRef.current.find(g => g.torrent_magnet === key || g.download_url === key)
        if (!match) return prev
        return {
          ...prev,
          [match.url]: { status: 'downloading', id: key }
        }
      })
    })

    return () => {
      if (typeof unsubVersion === 'function') unsubVersion()
      if (typeof unsubDownloadComplete === 'function') unsubDownloadComplete()
      if (typeof unsubDownloadProgress === 'function') unsubDownloadProgress()
    }
  }, [])

  const loadGames = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getGames()
      if (result.success) {
        const list = result.games || []
        setGames(list)
        // Sync active downloads mapping with fresh games list
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
    // Whenever games change, try to re-associate any active downloads
    if (games.length) {
      refreshActiveUpdates(games)
    }
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
        const match = list.find(g =>
          g.torrent_magnet === key ||
          g.download_url === key ||
          g.url === d.game_url
        )
        if (match) {
          map[match.url] = { status: 'downloading', id: key }
        }
      })
      if (Object.keys(map).length) {
        setUpdatingGames(prev => ({ ...prev, ...map }))
      }
    } catch {
      // ignore
    }
  }

  const loadProtonRuntimes = async () => {
    try {
      const res = await window.electronAPI.protonListRuntimes()
      if (res.success) {
        setProtonRuntimes(res.runtimes || [])
      }
    } catch (err) {
      console.warn('Failed to load proton runtimes', err)
    }
  }

  const addProtonRoot = async () => {
    const root = protonRootInput.trim()
    if (!root) return
    const res = await window.electronAPI.protonSetRoot(root)
    if (res.success) {
      setProtonRuntimes(res.runtimes || [])
    } else {
      alert(res.error || 'Falha ao salvar pasta de Proton')
    }
  }

  const playGame = async (game: Game) => {
    try {
    setLaunchingGames(prev => ({
      ...prev,
      [game.url]: { status: 'starting', message: 'Iniciando...', updatedAt: Date.now() }
    }))
    // Adicione log detalhado
    console.log('[playGame] Iniciando:', {
      url: game.url,
      exe: game.executable_path,
      proton: game.proton_runtime,
      prefix: game.proton_prefix
    })
    
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
    if (updatingGames[game.url]) return
    if (!hasUpdate(game)) {
      alert('Nenhuma atualização disponível.')
      return
    }

    setUpdatingGames(prev => ({ ...prev, [game.url]: { status: 'starting' } }))
    try {
      let torrentUrl = (game.torrent_magnet || game.download_url || '').trim()

      if (!torrentUrl) {
        const info = await window.electronAPI.fetchGameUpdateInfo(game.url)
        if (!info.success) {
          throw new Error(info.error || 'Falha ao obter dados da atualização')
        }
        if (info.latest) {
          setGames(prev => prev.map(g => g.url === game.url ? { ...g, latest_version: info.latest ?? g.latest_version } : g))
        }
        if (info.torrentUrl) {
          torrentUrl = info.torrentUrl
          setGames(prev => prev.map(g => g.url === game.url ? { ...g, torrent_magnet: info.torrentUrl, download_url: info.torrentUrl } : g))
        }
      }

      if (!torrentUrl) {
        alert('Link do torrent não encontrado. Verifique se está logado e tente novamente.')
        setUpdatingGames(prev => {
          const next = { ...prev }
          delete next[game.url]
          return next
        })
        return
      }

      const res = await window.electronAPI.startTorrentDownload(torrentUrl, game.url)
      if (!res.success) {
        alert(res.error || 'Falha ao iniciar a atualização')
        setUpdatingGames(prev => {
          const next = { ...prev }
          delete next[game.url]
          return next
        })
      } else {
        setUpdatingGames(prev => ({ ...prev, [game.url]: { status: 'downloading', id: torrentUrl } }))
        // Refresh games to reflect any changes
        loadGames()
      }
    } catch (err: any) {
      console.error('[UpdateGame] Failed to start update', err)
      alert(err?.message || 'Falha ao iniciar a atualização')
    } finally {
      // Keep spinner while downloading; only clear on completion/error paths above
    }
  }

  const deleteGame = async (game: Game) => {
    if (confirm(`Deseja realmente desinstalar ${game.title}?`)) {
      const res = await window.electronAPI.deleteGame(game.url)
      if (res.success) {
        setGames(prev => prev.filter(g => g.url !== game.url))
      } else {
        alert(res.error || 'Erro ao remover jogo')
      }
    }
  }

  const openGameFolder = async (game: Game) => {
    if (!game.install_path) {
      alert('Pasta do jogo não encontrada')
      return
    }
    const res = await window.electronAPI.openGameFolder(game.install_path)
    if (!res.success) {
      alert(res.error || 'Não foi possível abrir a pasta')
    }
  }

  const configureExe = async (game: Game) => {
    setConfiguring(game.url)
    const res = await window.electronAPI.configureGameExe(game.url)
    setConfiguring(null)
    if (res.success && res.exePath) {
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, executable_path: res.exePath } : g))
    } else {
      alert(res.error || 'Nenhum executável configurado')
    }
  }

  const hasUpdate = (game: Game) => {
    return game.latest_version && game.installed_version &&
           game.latest_version !== game.installed_version
  }

  const loadProtonFromGame = (game: Game) => {
    setProtonVersion(game.proton_runtime || '')
    let parsed: any = {}
    try {
      parsed = game.proton_options ? JSON.parse(game.proton_options) : {}
    } catch {
      parsed = {}
    }
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

  const buildProtonOptionsForSave = () => {
    return {
      esync: protonOptions.esync,
      fsync: protonOptions.fsync,
      dxvk: protonOptions.dxvk,
      mesa_glthread: protonOptions.mesa_glthread,
      locale: protonOptions.locale || undefined,
      gamemode: protonOptions.gamemode,
      mangohud: protonOptions.mangohud,
      logging: protonOptions.logging,
      launchArgs: protonOptions.launchArgs
    }
  }

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
      steamAppId: game.steam_app_id ? String(game.steam_app_id) : null
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

        // Allow leaving the version empty (don't save empty string).
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

        if (Object.keys(patch).length) {
          setGames(prev => prev.map(g => (g.url === game.url ? { ...g, ...patch } : g)))
        }

        lastSavedConfigRef.current = nextSaved

        // If title is empty, keep as pending so the user knows it's not saved yet.
        if (!snapshot.title) {
          setConfigSaveState({
            status: 'pending',
            message: 'Título não pode ficar vazio',
            updatedAt: Date.now()
          })
        } else {
          setConfigSaveState({ status: 'saved', updatedAt: Date.now() })
        }
      })
      .catch((err: any) => {
        setConfigSaveState({
          status: 'error',
          message: err?.message || 'Falha ao salvar',
          updatedAt: Date.now()
        })
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
      (last.steamAppId || null) !== snapshot.steamAppId

    if (!isDifferent) {
      if (!snapshot.title && last?.title) {
        setConfigSaveState(s =>
          s.status === 'saving'
            ? s
            : { status: 'pending', message: 'Título não pode ficar vazio', updatedAt: Date.now() }
        )
      }
      return
    }

    setConfigSaveState(s =>
      s.status === 'saving'
        ? s
        : {
            status: 'pending',
            message: !snapshot.title ? 'Título não pode ficar vazio' : undefined,
            updatedAt: Date.now()
          }
    )

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
    setBannerManualUrl(game.image_url || '')

    lastSavedConfigRef.current = {
      title: (game.title || '').trim(),
      version: (game.installed_version || '').trim(),
      protonRuntime: game.proton_runtime || '',
      protonOptionsJson: game.proton_options || JSON.stringify({}),
      protonPrefix: game.proton_prefix || '',
      steamAppId: game.steam_app_id ? String(game.steam_app_id) : null
    }

    resetIniState()
    loadOnlineFixIni(game)

    setTimeout(() => {
      suppressConfigAutosaveRef.current = false
    }, 0)
  }

  const closeConfig = () => {
    if (configAutosaveTimerRef.current) {
      clearTimeout(configAutosaveTimerRef.current)
      configAutosaveTimerRef.current = null
    }
    if (iniAutosaveTimerRef.current) {
      clearTimeout(iniAutosaveTimerRef.current)
      iniAutosaveTimerRef.current = null
    }
    setShowConfig(null)
    setConfigTab('geral')
  }

  useEffect(() => {
    if (!showConfig) return
    if (suppressConfigAutosaveRef.current) return
    const game = gamesRef.current.find(g => g.url === showConfig)
    if (!game) return
    scheduleConfigAutosave(game)
  }, [showConfig, titleValue, versionValue, protonVersion, protonOptions, steamAppId, protonPrefix])

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
        iniOriginalContentRef.current = content // FIX: Update ref immediately
        setIniPath(res.path || null)
        setIniDirty(false)
        setIniFields(fields)
        iniFieldsRef.current = fields // FIX: Update ref immediately
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

      // FIX: Validate before saving
      if (!finalContent && iniFieldsRef.current.filter(f => f.key).length > 0) {
        setIniError('Erro interno: conteúdo gerado está vazio mas existem campos. Tente recarregar.')
        setIniSaving(false)
        return
      }
      
      const res = await window.electronAPI.saveOnlineFixIni(game.url, finalContent)
      if (res.success) {
        setIniPath(res.path || iniPath)
        setIniContent(finalContent)
        // FIX: Update original content after save so subsequent saves work correctly
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
      if (!res.success) {
        alert(res.error || 'Falha ao definir banner')
        return
      }
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: (res.imageUrl as any) || undefined } : g))
    } finally {
      setBannerManualBusy(false)
    }
  }

  const pickBannerFile = async (game: Game) => {
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.pickGameBannerFile(game.url)
      if (!res.success) {
        if (!res.canceled) alert(res.error || 'Falha ao selecionar imagem')
        return
      }
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
      if (!res.success) {
        alert(res.error || 'Falha ao limpar banner')
        return
      }
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
        if (foundUpdates > 0) {
          alert(`Verificação concluída: ${foundUpdates} atualização(ões) encontrada(s).`)
        } else if (errors > 0) {
          alert(`Verificação concluída com erros em ${errors} jogo(s). Consulte o console para detalhes.`)
          console.warn('[CheckAllUpdates] Erros', results.filter((r: any) => r?.error))
        } else {
          alert('Nenhuma atualização encontrada.')
        }
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
      <style>{spinnerStyles}</style>
      {error && (
        <div className="error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      <div className="library-grid-heroic">
        <div className="library-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <button className="btn ghost" onClick={checkAllUpdates} disabled={checkingUpdates}>
            {checkingUpdates && <RefreshCw size={14} className="of-spin" style={{ marginRight: 6 }} />}
            {checkingUpdates ? 'Verificando...' : 'Verificar atualizações'}
          </button>
        </div>
        {games.map((game) => (
          <div key={game.id} className={`game-card-heroic ${hasUpdate(game) ? 'has-update' : ''}`}>
	            {(() => {
	              const launchState = launchingGames[game.url]
                const prefixState = prefixJobs[game.url]
                const isPrefixing = prefixState?.status === 'starting' || prefixState?.status === 'progress'
	              const isLaunching = launchState?.status === 'starting' || launchState?.status === 'running'
	              const isError = launchState?.status === 'error' || (launchState?.status === 'exited' && launchState?.code != null && Number(launchState.code) !== 0)
	              const label = isPrefixing
                  ? (prefixState?.message || 'Preparando prefixo...')
                  : isLaunching
	                  ? (launchState?.message || (launchState?.status === 'running' ? 'Abrindo jogo...' : 'Iniciando...'))
	                : isError
	                  ? `Falha ao iniciar${launchState?.code != null ? ` (cód. ${launchState.code})` : ''}`
	                  : ''
              return (
                <div style={{ position: 'relative' }}>
            {/* Game Cover Image */}
            <div className="game-cover">
              {game.image_url ? (
                <img src={game.image_url} alt={game.title} />
              ) : (
                <div className="game-cover-placeholder">
                  <Library size={48} />
                </div>
              )}

	              {(isLaunching || isPrefixing || isError) && (
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
	                  title={launchState?.stderrTail || prefixState?.message || launchState?.message || ''}
	                >
	                  {(isLaunching || isPrefixing) ? <RefreshCw size={14} className="of-spin" /> : <AlertCircle size={14} />}
	                  <span style={{ lineHeight: 1.1, flex: 1 }}>{label}</span>
	                </div>
	              )}

              {/* Update Badge */}
              {hasUpdate(game) && (
                <div className="update-badge">
                  <Download size={12} />
                </div>
              )}

              {/* Platform Badge */}
              <div className="platform-badge">
                <span>OF</span>
              </div>

              {/* Hover Overlay */}
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

            {/* Action Bar */}
	            <div className="game-action-bar">
              <button
                className="action-btn config"
                onClick={(e) => { e.stopPropagation(); openConfig(game) }}
                title="Configurações"
              >
                <Settings size={18} />
              </button>

              {!!launchState?.protonLogPath && (
                <button
                  className="action-btn log"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const res = await window.electronAPI.openPath?.(launchState.protonLogPath as string)
                    if (res && res.success === false) alert(res.error || 'Falha ao abrir log')
                  }}
                  title={isError ? 'Abrir logs do Proton (erro)' : 'Abrir logs do Proton'}
                >
                  <FileText size={18} />
                </button>
              )}

              {hasUpdate(game) ? (
                <button
                  className="action-btn update"
                  onClick={(e) => { e.stopPropagation(); updateGame(game) }}
                  disabled={!!updatingGames[game.url]}
                  title="Atualizar jogo"
                >
                  {updatingGames[game.url] ? (
                    <RefreshCw size={16} className="of-spin" />
                  ) : (
                    <Download size={18} />
                  )}
                </button>
              ) : (
                <button
                  className="action-btn folder"
                  onClick={(e) => { e.stopPropagation(); openGameFolder(game) }}
                  title="Abrir pasta"
                >
                  <Folder size={18} />
                </button>
              )}

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

            {/* Game Info (shown on hover) */}
            <div className="game-info-tooltip">
              <div className="game-title">{game.title}</div>
              <div className="game-version">
                v{game.installed_version || '---'}
                {hasUpdate(game) && <span className="new-version"> → v{game.latest_version}</span>}
              </div>
            </div>
                </div>
              )
            })()}
          </div>
        ))}
      </div>

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
                  <button
                    className="btn ghost"
                      onClick={closeConfig}
                  >
                    Fechar
                  </button>
                  </div>
                </div>

                <div className="config-tabs">
                  <button
                    className={configTab === 'geral' ? 'config-tab-btn active' : 'config-tab-btn'}
                    onClick={() => setConfigTab('geral')}
                    type="button"
                  >
                    Geral
                  </button>
                  <button
                    className={configTab === 'onlinefix' ? 'config-tab-btn active' : 'config-tab-btn'}
                    onClick={() => setConfigTab('onlinefix')}
                    type="button"
                  >
                    OnlineFix.ini
                  </button>
                  <button
                    className={configTab === 'proton' ? 'config-tab-btn active' : 'config-tab-btn'}
                    onClick={() => setConfigTab('proton')}
                    type="button"
                  >
                    Proton
                  </button>
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
