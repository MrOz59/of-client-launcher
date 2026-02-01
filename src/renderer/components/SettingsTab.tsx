import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Folder, Download, HardDrive, RefreshCw, Gamepad2, Cloud, Globe, Info, Settings2, ChevronDown, Plus, Trash2, Key, Link, Monitor, FolderPlus, Check, X, CloudOff, Bell, Minimize2 } from 'lucide-react'

interface Settings {
  downloadPath: string
  gamesPath: string
  downloadPathDefault?: string
  gamesPathDefault?: string
  autoExtract: boolean
  autoUpdate: boolean
  parallelDownloads: number
  steamWebApiKey?: string
  achievementSchemaBaseUrl?: string
  protonDefaultRuntimePath: string
  protonExtraPaths: string[]
  lanDefaultNetworkId?: string
  lanControllerUrl?: string
  cloudSavesEnabled: boolean
  notificationsEnabled: boolean
  minimizeToTray: boolean
}

type DriveFile = { id: string; name: string; modifiedTime?: string }

function formatMaybeDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

export default function SettingsTab() {
  const [platformInfo, setPlatformInfo] = useState<{ platform: string; isLinux: boolean }>({
    platform: 'unknown',
    isLinux: false
  })

  const [settings, setSettings] = useState<Settings>({
    downloadPath: '',
    gamesPath: '',
    autoExtract: true,
    autoUpdate: false,
    parallelDownloads: 3,
    steamWebApiKey: '',
    achievementSchemaBaseUrl: '',
    protonDefaultRuntimePath: '',
    protonExtraPaths: [],
    lanDefaultNetworkId: '',
    lanControllerUrl: 'https://vpn.mroz.dev.br',
    cloudSavesEnabled: true,
    notificationsEnabled: true,
    minimizeToTray: false,
  })

  const [runtimes, setRuntimes] = useState<Array<{ name: string; path: string; runner: string; source: string }>>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Drive UI state
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null)
  const [driveStatus, setDriveStatus] = useState<string | null>(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const driveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setDriveStatusTimed = (msg: string | null, ms = 4000) => {
    if (driveStatusTimeoutRef.current) {
      clearTimeout(driveStatusTimeoutRef.current)
      driveStatusTimeoutRef.current = null
    }
    setDriveStatus(msg)
    if (msg) {
      driveStatusTimeoutRef.current = setTimeout(() => {
        setDriveStatus(null)
        driveStatusTimeoutRef.current = null
      }, ms)
    }
  }

  useEffect(() => {
    ;(async () => {
      const isLinux = await loadSettings()
      if (isLinux) {
        refreshRuntimes(false)
      }
      try {
        const res = await (window as any).electronAPI.driveStatus?.()
        if (res && typeof res.connected === 'boolean') setDriveConnected(res.connected)
      } catch {
        // ignore
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (driveStatusTimeoutRef.current) {
        clearTimeout(driveStatusTimeoutRef.current)
        driveStatusTimeoutRef.current = null
      }
    }
  }, [])

  const loadSettings = async (): Promise<boolean> => {
    try {
      const res = await window.electronAPI.getSettings()
      if (res.success && res.settings) {
        const raw: any = res.settings
        setSettings((prev) => ({
          ...prev,
          ...raw,
          gamesPath: typeof raw?.gamesPath === 'string' ? raw.gamesPath : prev.gamesPath,
          protonDefaultRuntimePath: typeof raw?.protonDefaultRuntimePath === 'string'
            ? raw.protonDefaultRuntimePath
            : (typeof raw?.protonPath === 'string' ? raw.protonPath : prev.protonDefaultRuntimePath),
          protonExtraPaths: Array.isArray(raw?.protonExtraPaths)
            ? raw.protonExtraPaths.filter((p: any) => typeof p === 'string' && p.trim()).map((p: string) => p.trim())
            : prev.protonExtraPaths,
        }))
      }
      const isLinux = Boolean(res?.isLinux || res?.platform === 'linux')
      setPlatformInfo({ platform: String(res?.platform || 'unknown'), isLinux })
      return isLinux
    } finally {
      setLoading(false)
    }
  }

  const refreshRuntimes = async (force = false) => {
    try {
      const res = await window.electronAPI.protonListRuntimes(force)
      if (res.success) {
        setRuntimes(res.runtimes || [])
      }
    } catch (err) {
      console.warn('Failed to list proton runtimes', err)
    }
  }

  const shortenPathForLabel = (p: string) => {
    const raw = String(p || '').trim()
    if (!raw) return ''
    const parts = raw.split('/').filter(Boolean)
    if (parts.length <= 3) return raw
    return `…/${parts.slice(-3).join('/')}`
  }

  const selectedRuntimeTitle = useMemo(() => {
    const selected = String(settings.protonDefaultRuntimePath || '').trim()
    if (!selected) return ''
    const rt = runtimes.find((r) => String(r.path) === selected)
    return rt ? `${rt.name} • ${rt.path}` : selected
  }, [runtimes, settings.protonDefaultRuntimePath])

  const selectDownloadPath = async () => {
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      setSettings(prev => ({ ...prev, downloadPath: res.path || prev.downloadPath }))
    }
  }

  const selectGamesPath = async () => {
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      setSettings(prev => ({ ...prev, gamesPath: res.path || prev.gamesPath }))
    }
  }

  const addProtonSearchPath = async () => {
    if (!platformInfo.isLinux) return
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      const p = String(res.path).trim()
      if (!p) return

      try {
        const update = await window.electronAPI.protonSetRoot(p)
        if (update.success) setRuntimes(update.runtimes || [])
      } catch {
        // ignore
      }

      setSettings((prev) => ({
        ...prev,
        protonExtraPaths: Array.from(new Set([...(prev.protonExtraPaths || []), p]))
      }))
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res = await window.electronAPI.saveSettings(settings)
      if (!res.success) {
        alert(res.error || 'Falha ao salvar configurações')
      } else {
        if (platformInfo.isLinux) {
          refreshRuntimes()
        }
        alert('Configurações salvas')
      }
    } finally {
      setSaving(false)
    }
  }

  // =========================
  // DRIVE helpers
  // =========================

  const driveAuth = async () => {
    setDriveStatusTimed('Iniciando autenticação...')
    try {
      const res = await window.electronAPI.driveAuth()
      if (res.success) {
        setDriveConnected(true)
        const prepared = (res as any)?.ludusaviPrepared
        const downloaded = (res as any)?.ludusaviDownloaded
        const err = String((res as any)?.ludusaviError || '').trim()

        if (prepared === true) {
          setDriveStatusTimed(downloaded ? 'Autenticado (Ludusavi baixado e pronto)' : 'Autenticado (Ludusavi pronto)')
        } else if (prepared === false) {
          setDriveStatusTimed('Autenticado, mas falhou preparar Ludusavi' + (err ? ': ' + err : ''), 9000)
        } else {
          setDriveStatusTimed('Autenticado')
        }
      } else {
        setDriveStatusTimed('Erro: ' + (res.message || ''))
        setDriveConnected(false)
      }
    } catch (e) {
      setDriveStatusTimed('Erro: ' + String(e))
      setDriveConnected(false)
    }
  }

  const driveList = async () => {
    setDriveStatusTimed('Listando...')
    try {
      const res = await window.electronAPI.driveListSaves()

      // Compat: alguns handlers retornam array direto, outros retornam {success, files}
      if (Array.isArray(res)) {
        setDriveFiles(res as DriveFile[])
        setDriveStatusTimed('OK')
      } else if (res && typeof res === 'object' && res.success && Array.isArray(res.files)) {
        setDriveFiles(res.files as DriveFile[])
        setDriveStatusTimed('OK')
      } else if (res && typeof res === 'object' && res.error) {
        setDriveFiles(null)
        setDriveStatusTimed('Erro: ' + String(res.error))
      } else if (res && typeof res === 'object' && res.success === false) {
        setDriveFiles(null)
        setDriveStatusTimed('Erro: ' + String(res.message || res.error || 'Falha ao listar'))
      } else {
        setDriveFiles(null)
        setDriveStatusTimed('Erro: resposta inesperada')
      }
    } catch (e) {
      setDriveFiles(null)
      setDriveStatusTimed('Erro: ' + String(e))
    }
  }

  const driveDownload = async (fileId: string, fileName: string) => {
    setDriveStatusTimed('Baixando...', 4500)
    try {
      const safeName = String(fileName || 'save.zip').replace(/[\/\\]/g, '_')
      const dest = `${settings.downloadPath}/${safeName}`
      const res = await window.electronAPI.driveDownloadSave(fileId, dest)
      if (res.success) setDriveStatusTimed('Baixado em: ' + dest, 4500)
      else setDriveStatusTimed('Erro: ' + (res.message || ''), 4500)
    } catch (e) {
      setDriveStatusTimed('Erro: ' + String(e), 4500)
    }
  }

  const gamesPathHint = settings.gamesPathDefault
    ? `Padrão: ${settings.gamesPathDefault}`
    : 'Padrão: ~/Games/VoidLauncher'
  const downloadPathHint = settings.downloadPathDefault
    ? `Padrão: ${settings.downloadPathDefault}`
    : 'Padrão: ~/Downloads'
  return (
    <div className="settings-page">
      {loading && (
        <div className="settings-loading">
          <RefreshCw size={20} className="of-spin" />
          <span>Carregando configurações...</span>
        </div>
      )}

      {/* Header */}
      <div className="settings-header">
        <div className="settings-header-icon">
          <Settings2 size={24} />
        </div>
        <div>
          <h1>Configurações</h1>
          <p>Personalize o VoidLauncher de acordo com suas preferências</p>
        </div>
      </div>

      {/* General Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Settings2 size={18} />
          <h3>Geral</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Bell size={16} />
                Notificações
              </div>
              <div className="settings-card-description">
                Exibir notificações quando downloads completarem ou falharem
              </div>
            </div>
            <div className="settings-card-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.notificationsEnabled !== false}
                  onChange={(e) => setSettings({ ...settings, notificationsEnabled: e.target.checked })}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Minimize2 size={16} />
                Minimizar para bandeja
              </div>
              <div className="settings-card-description">
                Ao fechar a janela, manter o launcher rodando na bandeja do sistema
              </div>
            </div>
            <div className="settings-card-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.minimizeToTray === true}
                  onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {/* Notification Test Section (DEV) */}
          <div className="settings-card-item vertical">
            <div className="settings-card-info">
              <div className="settings-card-title">
                🧪 Testar Notificações (Dev)
              </div>
              <div className="settings-card-description">
                Clique nos botões abaixo para testar os diferentes tipos de notificação overlay
              </div>
            </div>
            <div className="settings-card-control" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('achievement')}
              >
                🏆 Conquista
              </button>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('download-complete')}
              >
                ✅ Download OK
              </button>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('download-error')}
              >
                ❌ Download Erro
              </button>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('update-available')}
              >
                🔄 Atualização
              </button>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('game-ready')}
              >
                🎮 Jogo Pronto
              </button>
              <button
                className="settings-btn secondary"
                onClick={() => window.electronAPI.testNotification?.('cloud-sync')}
              >
                ☁️ Cloud Sync
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Downloads Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Download size={18} />
          <h3>Downloads</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <HardDrive size={16} />
                Pasta de jogos
              </div>
              <div className="settings-card-description">
                Local onde os jogos serão instalados. {gamesPathHint}
              </div>
            </div>
            <div className="settings-card-control">
              <div className="settings-input-group">
                <input
                  type="text"
                  className="settings-input"
                  value={settings.gamesPath}
                  onChange={(e) => setSettings({ ...settings, gamesPath: e.target.value })}
                  placeholder={settings.gamesPathDefault || ''}
                />
                <button className="settings-btn secondary" onClick={selectGamesPath}>
                  <Folder size={14} />
                  Selecionar
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Download size={16} />
                Pasta de downloads
              </div>
              <div className="settings-card-description">
                Local onde os arquivos serão baixados. {downloadPathHint}
              </div>
            </div>
            <div className="settings-card-control">
              <div className="settings-input-group">
                <input
                  type="text"
                  className="settings-input"
                  value={settings.downloadPath}
                  onChange={(e) => setSettings({ ...settings, downloadPath: e.target.value })}
                  placeholder={settings.downloadPathDefault || ''}
                />
                <button className="settings-btn secondary" onClick={selectDownloadPath}>
                  <Folder size={14} />
                  Selecionar
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">Extrair automaticamente</div>
              <div className="settings-card-description">
                Extrai arquivos comprimidos automaticamente após o download
              </div>
            </div>
            <div className="settings-card-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoExtract}
                  onChange={(e) => setSettings({ ...settings, autoExtract: e.target.checked })}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">Downloads paralelos</div>
              <div className="settings-card-description">
                Número máximo de downloads simultâneos
              </div>
            </div>
            <div className="settings-card-control">
              <input
                type="number"
                className="settings-input settings-input-sm"
                min="1"
                max="10"
                value={Number.isFinite(settings.parallelDownloads) ? settings.parallelDownloads : 3}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setSettings({ ...settings, parallelDownloads: Number.isFinite(n) && n > 0 ? n : 1 })
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Updates Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <RefreshCw size={18} />
          <h3>Atualizações & Steam</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">Atualizar jogos automaticamente</div>
              <div className="settings-card-description">
                Verifica e baixa atualizações automaticamente
              </div>
            </div>
            <div className="settings-card-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoUpdate}
                  onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Key size={16} />
                Steam Web API Key
              </div>
              <div className="settings-card-description">
                Necessária para baixar o schema completo de conquistas via API oficial da Steam.
              </div>
            </div>
            <div className="settings-card-control">
              <input
                type="password"
                className="settings-input"
                value={settings.steamWebApiKey || ''}
                onChange={(e) => setSettings({ ...settings, steamWebApiKey: e.target.value })}
                placeholder="Cole sua Steam Web API Key aqui"
              />
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Link size={16} />
                Schema comunitário (conquistas)
              </div>
              <div className="settings-card-description">
                Opcional. URL base que disponibiliza <code>&lt;appid&gt;.json</code> com nome/descrição das conquistas.
              </div>
            </div>
            <div className="settings-card-control">
              <input
                type="text"
                className="settings-input"
                value={settings.achievementSchemaBaseUrl || ''}
                onChange={(e) => setSettings({ ...settings, achievementSchemaBaseUrl: e.target.value })}
                placeholder="Ex: https://meu-servidor/schemas"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Proton Section (Linux only) */}
      {platformInfo.isLinux && (
        <div className="settings-section">
          <div className="settings-section-header">
            <Monitor size={18} />
            <h3>Proton (Linux)</h3>
          </div>

          <div className="settings-card">
            <div className="settings-card-item vertical">
              <div className="settings-card-info">
                <div className="settings-card-title">
                  <Gamepad2 size={16} />
                  Proton padrão
                </div>
                <div className="settings-card-description">
                  No Linux, jogos Windows rodam via Proton automaticamente. Usamos os Protons instalados na Steam.
                </div>
              </div>
              <div className="settings-proton-control">
                <div className="settings-select-wrapper">
                  <select
                    className="settings-select"
                    value={settings.protonDefaultRuntimePath}
                    onChange={(e) => setSettings({ ...settings, protonDefaultRuntimePath: e.target.value })}
                    title={selectedRuntimeTitle}
                  >
                    <option value="">Auto (recomendado)</option>
                    {runtimes.map((rt) => (
                      <option key={rt.runner} value={rt.path}>
                        {rt.name} • {shortenPathForLabel(rt.path)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="settings-select-icon" />
                </div>
                <div className="settings-btn-row">
                  <button className="settings-btn ghost" onClick={() => refreshRuntimes(true)}>
                    <RefreshCw size={14} />
                    Recarregar
                  </button>
                  <button className="settings-btn ghost" onClick={addProtonSearchPath}>
                    <FolderPlus size={14} />
                    Adicionar caminho
                  </button>
                </div>
              </div>
            </div>

            {(settings.protonExtraPaths || []).length > 0 && (
              <div className="settings-card-item vertical">
                <div className="settings-card-info">
                  <div className="settings-card-title">Caminhos extras</div>
                  <div className="settings-card-description">
                    Diretórios adicionais onde existam instalações do Proton.
                  </div>
                </div>
                <div className="settings-paths-list">
                  {(settings.protonExtraPaths || []).map((p) => (
                    <div key={p} className="settings-path-item">
                      <code>{p}</code>
                      <button
                        className="settings-btn-icon"
                        onClick={() => setSettings((prev) => ({
                          ...prev,
                          protonExtraPaths: (prev.protonExtraPaths || []).filter((x) => x !== p)
                        }))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VPN Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Globe size={18} />
          <h3>VPN / LAN Online</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">Sala padrão (código)</div>
              <div className="settings-card-description">
                Usado para conectar automaticamente ao abrir o jogo (se habilitado por jogo). Deixe vazio se você só cria/entra manualmente.
              </div>
            </div>
            <div className="settings-card-control">
              <input
                type="text"
                className="settings-input"
                placeholder="(opcional) Código da sala"
                value={settings.lanDefaultNetworkId || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, lanDefaultNetworkId: e.target.value }))}
              />
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                <Link size={16} />
                VPN Controller URL
              </div>
              <div className="settings-card-description">
                Por padrão: <code>https://vpn.mroz.dev.br</code>. Só altere se você estiver rodando seu próprio controller.
              </div>
            </div>
            <div className="settings-card-control">
              <input
                type="text"
                className="settings-input"
                placeholder="https://vpn.mroz.dev.br"
                value={settings.lanControllerUrl || ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, lanControllerUrl: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Cloud Saves Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Cloud size={18} />
          <h3>Cloud Saves (Google Drive)</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">
                {driveConnected ? <Cloud size={16} /> : <CloudOff size={16} />}
                Status da conexão
              </div>
              <div className="settings-card-description">
                Conecte sua conta Google para salvar/restaurar backups.
              </div>
            </div>
            <div className="settings-card-control" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
              <div className={`settings-status-badge ${driveConnected ? 'connected' : 'disconnected'}`}>
                {driveConnected ? <Check size={14} /> : <X size={14} />}
                {driveConnected ? 'Conectado ao Google Drive' : 'Não conectado'}
              </div>
              {driveStatus && (
                <div className="settings-status-message">{driveStatus}</div>
              )}
              <div className="settings-btn-row">
                <button className="settings-btn secondary" onClick={driveAuth}>
                  <Cloud size={14} />
                  Conectar
                </button>
                <button
                  className="settings-btn ghost"
                  onClick={async () => {
                    try {
                      const res = await (window as any).electronAPI.driveDisconnect?.()
                      if (res?.success) {
                        setDriveConnected(false)
                        setDriveStatusTimed('Desconectado')
                      } else {
                        setDriveStatusTimed('Erro: ' + (res?.message || 'Falha ao desconectar'))
                      }
                    } catch (e: any) {
                      setDriveStatusTimed('Erro: ' + (e?.message || String(e)))
                    }
                  }}
                  disabled={!driveConnected}
                >
                  Desconectar
                </button>
                <button className="settings-btn ghost" onClick={driveList}>
                  <RefreshCw size={14} />
                  Listar backups
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">Sincronização automática</div>
              <div className="settings-card-description">
                Sincroniza saves automaticamente ao iniciar e fechar jogos (estilo Steam Cloud).
              </div>
            </div>
            <div className="settings-card-control">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.cloudSavesEnabled}
                  onChange={(e) => setSettings({ ...settings, cloudSavesEnabled: e.target.checked })}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {driveFiles && driveFiles.length > 0 && (
            <div className="settings-card-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="settings-card-info" style={{ marginBottom: '12px' }}>
                <div className="settings-card-title">Backups no Drive</div>
                <div className="settings-card-description">
                  Lista dos arquivos dentro da pasta <code>OF-Client-Saves</code> no seu Drive.
                </div>
              </div>
              <div className="settings-drive-list">
                <div className="settings-drive-list-header">
                  <div>Arquivo</div>
                  <div>Modificado</div>
                  <div></div>
                </div>
                {driveFiles.map(f => (
                  <div key={f.id} className="settings-drive-list-item">
                    <div className="settings-drive-file-name">{f.name}</div>
                    <div className="settings-drive-file-date">{formatMaybeDate(f.modifiedTime)}</div>
                    <div>
                      <button className="settings-btn ghost sm" onClick={() => driveDownload(f.id, f.name)}>
                        <Download size={12} />
                        Baixar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {driveFiles && driveFiles.length === 0 && (
            <div className="settings-empty-state">
              <CloudOff size={32} />
              <span>Nenhum backup encontrado no Drive</span>
            </div>
          )}
        </div>
      </div>

      {/* About Section */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Info size={18} />
          <h3>Sobre</h3>
        </div>

        <div className="settings-card">
          <div className="settings-card-item">
            <div className="settings-card-info">
              <div className="settings-card-title">VoidLauncher</div>
              <div className="settings-card-description">
                Versão 0.2.0 • Protótipo em desenvolvimento
              </div>
            </div>
            <div className="settings-version-badge">v0.2.0</div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="settings-footer">
        <button
          className="settings-btn primary lg"
          onClick={saveSettings}
          disabled={saving}
        >
          {saving ? (
            <><RefreshCw size={16} className="of-spin" /> Salvando...</>
          ) : (
            <><Check size={16} /> Salvar Configurações</>
          )}
        </button>
      </div>
    </div>
  )
}
