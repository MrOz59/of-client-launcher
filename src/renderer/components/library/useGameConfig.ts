import { useState, useRef, useCallback, useEffect } from 'react'
import type { Game, ProtonOptions, ProtonRuntime, LanMode, ConfigSaveState, SavedConfigState, GameConfigTab } from './types'

const DEFAULT_PROTON_OPTIONS: ProtonOptions = {
  esync: true,
  fsync: true,
  dxvk: true,
  mesa_glthread: false,
  locale: '',
  gamemode: false,
  mangohud: false,
  logging: false,
  launchArgs: '',
  useGamescope: false
}

export function useGameConfig(gamesRef: React.RefObject<Game[]>) {
  // Config modal state
  const [showConfig, setShowConfig] = useState<string | null>(null)
  const [configTab, setConfigTab] = useState<GameConfigTab>('geral')
  const [configSaveState, setConfigSaveState] = useState<ConfigSaveState>({ status: 'idle', updatedAt: 0 })

  // Form values
  const [titleValue, setTitleValue] = useState<string>('')
  const [versionValue, setVersionValue] = useState<string>('')
  const [protonVersion, setProtonVersion] = useState<string>('')
  const [protonOptions, setProtonOptions] = useState<ProtonOptions>(DEFAULT_PROTON_OPTIONS)
  const [protonPrefix, setProtonPrefix] = useState<string>('')
  const [steamAppId, setSteamAppId] = useState<string>('')
  const [protonRuntimes, setProtonRuntimes] = useState<ProtonRuntime[]>([])
  const [protonRootInput, setProtonRootInput] = useState('')

  // LAN settings
  const [lanMode, setLanMode] = useState<LanMode>('steam')
  const [lanNetworkId, setLanNetworkId] = useState<string>('')
  const [lanAutoconnect, setLanAutoconnect] = useState<boolean>(false)
  const [lanDefaultNetworkId, setLanDefaultNetworkId] = useState<string>('')

  // Banner settings
  const [bannerLoading, setBannerLoading] = useState<string | null>(null)
  const [bannerManualUrl, setBannerManualUrl] = useState<string>('')
  const [bannerManualBusy, setBannerManualBusy] = useState<boolean>(false)

  // Refs for autosave
  const configAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configAutosaveQueueRef = useRef(Promise.resolve())
  const suppressConfigAutosaveRef = useRef(false)
  const lastSavedConfigRef = useRef<SavedConfigState | null>(null)

  const buildProtonOptionsForSave = useCallback(() => ({
    esync: protonOptions.esync,
    fsync: protonOptions.fsync,
    dxvk: protonOptions.dxvk,
    mesa_glthread: protonOptions.mesa_glthread,
    locale: protonOptions.locale || undefined,
    gamemode: protonOptions.gamemode,
    mangohud: protonOptions.mangohud,
    logging: protonOptions.logging,
    launchArgs: protonOptions.launchArgs,
    useGamescope: protonOptions.useGamescope
  }), [protonOptions])

  const getConfigSnapshot = useCallback(() => {
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
  }, [buildProtonOptionsForSave, titleValue, versionValue, protonVersion, protonPrefix, steamAppId, lanMode, lanNetworkId, lanAutoconnect])

  const loadProtonFromGame = useCallback((game: Game) => {
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
      launchArgs: parsed.launchArgs || '',
      useGamescope: !!parsed.useGamescope
    })
  }, [])

  const loadProtonRuntimes = useCallback(async () => {
    try {
      const res = await window.electronAPI.protonListRuntimes()
      if (res.success) setProtonRuntimes(res.runtimes || [])
    } catch (err) {
      console.warn('Failed to load proton runtimes', err)
    }
  }, [])

  const addProtonRoot = useCallback(async () => {
    const root = protonRootInput.trim()
    if (!root) return
    const res = await window.electronAPI.protonSetRoot(root)
    if (res.success) setProtonRuntimes(res.runtimes || [])
    else alert(res.error || 'Falha ao salvar pasta de Proton')
  }, [protonRootInput])

  const performConfigAutosave = useCallback(async (game: Game, snapshot: ReturnType<typeof getConfigSnapshot>, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
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
  }, [])

  const scheduleConfigAutosave = useCallback((game: Game, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
    const snapshot = getConfigSnapshot()
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
      void performConfigAutosave(game, snapshot, setGames)
    }, 650)
  }, [getConfigSnapshot, performConfigAutosave])

  const openConfig = useCallback((game: Game) => {
    suppressConfigAutosaveRef.current = true
    setConfigTab('geral')
    setConfigSaveState({ status: 'idle', updatedAt: Date.now() })

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

    setTimeout(() => { suppressConfigAutosaveRef.current = false }, 0)
  }, [loadProtonFromGame, loadProtonRuntimes])

  const closeConfig = useCallback(() => {
    if (configAutosaveTimerRef.current) { clearTimeout(configAutosaveTimerRef.current); configAutosaveTimerRef.current = null }
    setShowConfig(null)
    setConfigTab('geral')
  }, [])

  // Banner actions
  const fetchBanner = useCallback(async (game: Game, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
    setBannerLoading(game.url)
    try {
      const res = await window.electronAPI.fetchGameImage(game.url, game.title)
      if (res.success && res.imageUrl) {
        setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: res.imageUrl } : g))
        setBannerManualUrl(res.imageUrl)
      } else {
        alert(res.error || 'Nenhuma imagem encontrada')
      }
    } catch (e: any) {
      alert(e?.message || 'Falha ao buscar banner')
    } finally {
      setBannerLoading(null)
    }
  }, [])

  const applyBannerUrl = useCallback(async (game: Game, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
    const url = bannerManualUrl.trim()
    if (!url) return
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.setGameImageUrl(game.url, url)
      if (!res.success) { alert(res.error || 'Falha ao definir banner'); return }
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: (res.imageUrl as any) || undefined } : g))
    } catch (e: any) {
      alert(e?.message || 'Falha ao aplicar banner')
    } finally {
      setBannerManualBusy(false)
    }
  }, [bannerManualUrl])

  const pickBannerFile = useCallback(async (game: Game, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
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
  }, [])

  const clearBanner = useCallback(async (game: Game, setGames: React.Dispatch<React.SetStateAction<Game[]>>) => {
    setBannerManualBusy(true)
    try {
      const res = await window.electronAPI.setGameImageUrl(game.url, null)
      if (!res.success) { alert(res.error || 'Falha ao limpar banner'); return }
      setGames(prev => prev.map(g => g.url === game.url ? { ...g, image_url: undefined } : g))
      setBannerManualUrl('')
    } catch (e: any) {
      alert(e?.message || 'Falha ao limpar banner')
    } finally {
      setBannerManualBusy(false)
    }
  }, [])

  // Load default LAN network ID
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

  return {
    // Modal state
    showConfig,
    setShowConfig,
    configTab,
    setConfigTab,
    configSaveState,
    setConfigSaveState,
    suppressConfigAutosaveRef,

    // Form values
    titleValue,
    setTitleValue,
    versionValue,
    setVersionValue,
    protonVersion,
    setProtonVersion,
    protonOptions,
    setProtonOptions,
    protonPrefix,
    setProtonPrefix,
    steamAppId,
    setSteamAppId,
    protonRuntimes,
    protonRootInput,
    setProtonRootInput,

    // LAN settings
    lanMode,
    setLanMode,
    lanNetworkId,
    setLanNetworkId,
    lanAutoconnect,
    setLanAutoconnect,
    lanDefaultNetworkId,

    // Banner
    bannerLoading,
    bannerManualUrl,
    setBannerManualUrl,
    bannerManualBusy,

    // Actions
    openConfig,
    closeConfig,
    loadProtonRuntimes,
    addProtonRoot,
    scheduleConfigAutosave,
    fetchBanner,
    applyBannerUrl,
    pickBannerFile,
    clearBanner
  }
}
