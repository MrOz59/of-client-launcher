import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Folder } from 'lucide-react'

interface Settings {
  downloadPath: string
  autoExtract: boolean
  autoUpdate: boolean
  parallelDownloads: number
  steamWebApiKey?: string
  achievementSchemaBaseUrl?: string
  protonDefaultRuntimePath: string
  protonExtraPaths: string[]
  lanDefaultNetworkId?: string
  lanControllerUrl?: string
}

type DriveFile = { id: string; name: string; modifiedTime?: string }

function isLikelyOAuthJson(raw: string): boolean {
  try {
    const p = JSON.parse(raw)
    const has =
      Boolean(
        (p.installed && p.installed.client_id && p.installed.client_secret) ||
        (p.web && p.web.client_id && p.web.client_secret) ||
        (p.client_id && p.client_secret)
      )
    return has
  } catch {
    return false
  }
}

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
    autoExtract: true,
    autoUpdate: false,
    parallelDownloads: 3,
    steamWebApiKey: '',
    achievementSchemaBaseUrl: '',
    protonDefaultRuntimePath: '',
    protonExtraPaths: [],
    lanDefaultNetworkId: '',
    lanControllerUrl: 'https://vpn.mroz.dev.br',
  })

  const [runtimes, setRuntimes] = useState<Array<{ name: string; path: string; runner: string; source: string }>>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const [defaultPrefixBusy, setDefaultPrefixBusy] = useState(false)
  const [defaultPrefixPath, setDefaultPrefixPath] = useState<string | null>(null)

  // Drive UI state
  const [driveCredentials, setDriveCredentials] = useState<string>('')
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null)
  const [driveStatus, setDriveStatus] = useState<string | null>(null)

  const [driveModalOpen, setDriveModalOpen] = useState(false)
  const [driveModalMessage, setDriveModalMessage] = useState<string | null>(null)
  const [driveModalMessageType, setDriveModalMessageType] = useState<'info' | 'success' | 'error' | null>(null)
  const [driveModalBusy, setDriveModalBusy] = useState(false)
  const [driveHasOAuth, setDriveHasOAuth] = useState<boolean | null>(null)

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
      loadDriveCredentialsOnStart()
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
          protonDefaultRuntimePath: typeof raw?.protonDefaultRuntimePath === 'string' ? raw.protonDefaultRuntimePath : (typeof raw?.protonPath === 'string' ? raw.protonPath : prev.protonDefaultRuntimePath),
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

  const addProtonSearchPath = async () => {
    if (!platformInfo.isLinux) return
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      const p = String(res.path).trim()
      if (!p) return

      // Persiste no backend (acumula paths; não sobrescreve mais).
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

  const recreateDefaultPrefix = async () => {
    if (!platformInfo.isLinux) return
    setDefaultPrefixBusy(true)
    try {
      const res = await window.electronAPI.protonDefaultPrefix(true)
      if (res.success) {
        setDefaultPrefixPath(res.prefix || null)
        alert('Prefixo default recriado com sucesso')
      } else {
        alert(res.error || 'Falha ao recriar prefixo default')
      }
    } finally {
      setDefaultPrefixBusy(false)
    }
  }

  // =========================
  // DRIVE helpers
  // =========================
  // 🔧 Alterado: retorna boolean pra você não depender do setState async
  const loadDriveCredentialsOnStart = async (): Promise<boolean> => {
    try {
      const res = await window.electronAPI.driveGetCredentials()
      if (res?.success && res.content) {
        setDriveCredentials(res.content)
        const has = isLikelyOAuthJson(res.content)
        setDriveHasOAuth(has)
        return has
      } else {
        setDriveHasOAuth(false)
        return false
      }
    } catch {
      setDriveHasOAuth(false)
      return false
    }
  }

  const saveDriveCredentials = async () => {
    try {
      const res = await window.electronAPI.driveSaveCredentials(driveCredentials)
      if (!res.success) {
        alert('Falha ao salvar credenciais: ' + (res.message || ''))
      } else {
        setDriveHasOAuth(isLikelyOAuthJson(driveCredentials))
        alert('Credenciais salvas com sucesso')
      }
    } catch (e) {
      alert('Erro ao salvar credenciais: ' + String(e))
    }
  }

  const driveAuth = async () => {
    setDriveStatusTimed('Iniciando autenticação...')
    try {
      const res = await window.electronAPI.driveAuth()
      if (res.success) setDriveStatusTimed('Autenticado')
      else setDriveStatusTimed('Erro: ' + (res.message || ''))
    } catch (e) {
      setDriveStatusTimed('Erro: ' + String(e))
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

  const driveUiNote = useMemo(() => {
    if (driveHasOAuth === null) return null
    if (driveHasOAuth === true) return { type: 'success' as const, text: 'Credenciais OAuth detectadas.' }
    return { type: 'info' as const, text: 'Cole um JSON de OAuth Client (Desktop) para usar o Drive.' }
  }, [driveHasOAuth])

  const openDriveModal = async () => {
    setDriveModalOpen(true)
    setDriveModalMessage(null)
    setDriveModalMessageType(null)
    setDriveModalBusy(false)

    try {
      const res = await window.electronAPI.driveGetCredentials()
      if (res?.success && res.content) {
        setDriveCredentials(res.content)
        const has = isLikelyOAuthJson(res.content)
        setDriveHasOAuth(has)
        setDriveModalMessage('Credenciais carregadas a partir do sistema.')
        setDriveModalMessageType('success')
      } else {
        setDriveHasOAuth(false)
        setDriveModalMessage('Nenhuma credencial salva encontrada. Cole o JSON ou abra o Console para criar.')
        setDriveModalMessageType('info')
      }
    } catch {
      setDriveHasOAuth(false)
      setDriveModalMessage('Falha ao ler credenciais salvas.')
      setDriveModalMessageType('error')
    }
  }

  return (
    <div>
      {loading && <div style={{ marginBottom: 12, color: '#aaa' }}>Carregando configurações...</div>}

      <div className="settings-section">
        <h3>Downloads</h3>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Pasta de downloads</div>
            <div className="settings-label-description">
              Local onde os jogos serão baixados e instalados
            </div>
          </div>
          <div className="settings-control" style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={settings.downloadPath}
              onChange={(e) => setSettings({ ...settings, downloadPath: e.target.value })}
            />
            <button onClick={selectDownloadPath}>
              <Folder size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              Selecionar
            </button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Extrair automaticamente</div>
            <div className="settings-label-description">
              Extrai arquivos comprimidos automaticamente após o download
            </div>
          </div>
          <div className="settings-control">
            <input
              type="checkbox"
              checked={settings.autoExtract}
              onChange={(e) => setSettings({ ...settings, autoExtract: e.target.checked })}
            />
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Downloads paralelos</div>
            <div className="settings-label-description">
              Número máximo de downloads simultâneos
            </div>
          </div>
          <div className="settings-control">
            <input
              type="number"
              min="1"
              max="10"
              value={Number.isFinite(settings.parallelDownloads) ? settings.parallelDownloads : 3}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setSettings({ ...settings, parallelDownloads: Number.isFinite(n) && n > 0 ? n : 1 })
              }}
              style={{ width: '80px' }}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Atualizações</h3>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Atualizar jogos automaticamente</div>
            <div className="settings-label-description">
              Verifica e baixa atualizações automaticamente
            </div>
          </div>
          <div className="settings-control">
            <input
              type="checkbox"
              checked={settings.autoUpdate}
              onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
            />
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Steam Web API Key (conquistas)</div>
            <div className="settings-label-description">
              Necessária para baixar o schema completo de conquistas via API oficial da Steam.
            </div>
          </div>
          <div className="settings-control">
            <input
              type="password"
              value={settings.steamWebApiKey || ''}
              onChange={(e) => setSettings({ ...settings, steamWebApiKey: e.target.value })}
              placeholder="Cole sua Steam Web API Key aqui"
            />
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Schema comunitário (conquistas escondidas)</div>
            <div className="settings-label-description">
              Opcional. URL base que disponibiliza <code>&lt;appid&gt;.json</code> com nome/descrição das conquistas.
            </div>
          </div>
          <div className="settings-control">
            <input
              type="text"
              value={settings.achievementSchemaBaseUrl || ''}
              onChange={(e) => setSettings({ ...settings, achievementSchemaBaseUrl: e.target.value })}
              placeholder="Ex: https://meu-servidor/schemas"
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        {platformInfo.isLinux && (
          <>
            <h3>Proton (Linux)</h3>

            <div className="settings-item">
              <div className="settings-label">
                <div className="settings-label-title">Proton padrão</div>
                <div className="settings-label-description">
                  No Linux, jogos Windows rodam via Proton automaticamente. Usamos os Protons instalados na Steam (steamapps/common e compatibilitytools.d).
                </div>
              </div>
              <div className="settings-control" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={settings.protonDefaultRuntimePath}
                  onChange={(e) => setSettings({ ...settings, protonDefaultRuntimePath: e.target.value })}
                  title={selectedRuntimeTitle}
                  style={{
                    flex: 1,
                    minWidth: '260px',
                    maxWidth: '100%',
                    padding: '8px',
                    background: '#2a2a2a',
                    color: '#fff',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <option value="">Auto (recomendado)</option>
                  {runtimes.map((rt) => (
                    <option key={rt.runner} value={rt.path}>
                      {rt.name} • {shortenPathForLabel(rt.path)}
                    </option>
                  ))}
                </select>
                <button onClick={() => refreshRuntimes(true)}>Recarregar</button>
                <button onClick={addProtonSearchPath}>Adicionar caminho</button>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-label">
                <div className="settings-label-title">Caminhos extras (opcional)</div>
                <div className="settings-label-description">
                  Adicione diretórios adicionais onde existam instalações do Proton (ex.: outra Steam, Wine/Proton custom). Isso só afeta a lista acima.
                </div>
              </div>
              <div className="settings-control" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(settings.protonExtraPaths || []).length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>Nenhum caminho extra adicionado.</div>
                ) : (
                  (settings.protonExtraPaths || []).map((p) => (
                    <div key={p} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <code style={{ color: '#9ca3af', fontSize: 12, wordBreak: 'break-all' }}>{p}</code>
                      <button
                        onClick={() => setSettings((prev) => ({
                          ...prev,
                          protonExtraPaths: (prev.protonExtraPaths || []).filter((x) => x !== p)
                        }))}
                      >
                        Remover
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-label">
                <div className="settings-label-title">Prefixo Proton default (manutenção)</div>
                <div className="settings-label-description">
                  Cria/Recria um prefixo base com pré-requisitos para clonar em jogos.
                </div>
              </div>
              <div className="settings-control" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={recreateDefaultPrefix} disabled={defaultPrefixBusy}>
                  {defaultPrefixBusy ? 'Recriando...' : 'Recriar prefixo default'}
                </button>
                {defaultPrefixPath && (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>({defaultPrefixPath})</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>VPN (OF)</h3>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Sala padrão (código)</div>
            <div className="settings-label-description">
              Usado para conectar automaticamente ao abrir o jogo (se habilitado por jogo). Deixe vazio se você só cria/entra manualmente.
            </div>
          </div>
          <div className="settings-control">
            <input
              type="text"
              placeholder="(opcional) Código da sala"
              value={settings.lanDefaultNetworkId || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, lanDefaultNetworkId: e.target.value }))}
            />
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">VPN Controller URL</div>
            <div className="settings-label-description">
              Por padrão: <code>https://vpn.mroz.dev.br</code>. Só altere se você estiver rodando seu próprio controller.
            </div>
          </div>
          <div className="settings-control">
            <input
              type="text"
              placeholder="https://vpn.mroz.dev.br"
              value={settings.lanControllerUrl || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, lanControllerUrl: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Sobre</h3>
        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">VoidLauncher</div>
            <div className="settings-label-description">
              Versão 0.1.0 • Protótipo em desenvolvimento
            </div>
          </div>
        </div>
      </div>

      {/* =========================
          Cloud Saves (Google Drive)
         ========================= */}
      <div className="settings-section">
        <h3>Cloud Saves (Google Drive)</h3>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Status & Ações</div>
            <div className="settings-label-description">
              Conecte sua conta Google para salvar/restaurar backups.
              {driveUiNote && (
                <div style={{ marginTop: 6, color: driveUiNote.type === 'success' ? '#10b981' : '#9ca3af' }}>
                  {driveUiNote.text}
                </div>
              )}
              {driveStatus && (
                <div style={{ marginTop: 6, color: '#9ca3af' }}>
                  {driveStatus}
                </div>
              )}
            </div>
          </div>

          <div className="settings-control" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={openDriveModal}>Configurar credenciais</button>

            <button
              onClick={async () => {
                const has = await loadDriveCredentialsOnStart()
                if (!has) {
                  setDriveStatusTimed('Cole um OAuth Client JSON (Desktop) antes de conectar.', 4500)
                  openDriveModal()
                  return
                }
                await driveAuth()
              }}
              title={driveHasOAuth === false ? 'Cole um OAuth Client JSON antes de conectar.' : ''}
            >
              Conectar Google Drive
            </button>

            <button onClick={driveList}>Listar backups</button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Backups no Drive</div>
            <div className="settings-label-description">
              Lista dos arquivos dentro da pasta <code>OF-Client-Saves</code> no seu Drive.
            </div>
          </div>

          <div className="settings-control" style={{ width: '100%' }}>
            {!driveFiles && (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>
                Nenhuma lista carregada ainda. Clique em <b>“Listar backups”</b>.
              </div>
            )}

            {driveFiles && driveFiles.length === 0 && (
              <div style={{ color: '#9ca3af', fontSize: 13 }}>
                Nenhum backup encontrado no Drive.
              </div>
            )}

            {driveFiles && driveFiles.length > 0 && (
              <div style={{ border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 190px 110px',
                    padding: '10px 12px',
                    background: '#2a2a2a',
                    color: '#9ca3af',
                    fontSize: 12,
                    fontWeight: 600,
                    borderBottom: '1px solid #333'
                  }}
                >
                  <div>Arquivo</div>
                  <div>Modificado</div>
                  <div style={{ textAlign: 'right' }}>Ações</div>
                </div>

                {driveFiles.map(f => (
                  <div
                    key={f.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 190px 110px',
                      gap: 8,
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: '#1f1f1f',
                      borderBottom: '1px solid #333'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name}
                      </div>
                    </div>

                    <div style={{ color: '#9ca3af', fontSize: 12 }}>
                      {formatMaybeDate(f.modifiedTime)}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => driveDownload(f.id, f.name)}>Baixar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal do Drive - agora com cara de “settings” */}
        {driveModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ width: 760, maxWidth: '94%', background: '#111827', borderRadius: 10, padding: 18, border: '1px solid #334155', color: '#e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Configurar Google Drive</h3>
                <button onClick={() => setDriveModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
                  Fechar ✕
                </button>
              </div>

              <div style={{ marginBottom: 12, color: '#9ca3af', fontSize: 13 }}>
                Cole o JSON do <b>OAuth Client ID (Desktop)</b> do Google Cloud Console. Depois salve e conecte.
              </div>

              <div className="settings-item" style={{ marginBottom: 12 }}>
                <div className="settings-label">
                  <div className="settings-label-title">Credenciais OAuth (JSON)</div>
                  <div className="settings-label-description">
                    Dica: no Console, crie credenciais do tipo <b>OAuth Client ID</b> e selecione <b>Desktop app</b>.
                  </div>
                </div>
                <div className="settings-control" style={{ width: '100%' }}>
                  <textarea
                    value={driveCredentials}
                    onChange={(e) => setDriveCredentials(e.target.value)}
                    style={{
                      minHeight: 180,
                      width: '100%',
                      padding: 10,
                      background: '#0b1220',
                      color: '#e5e7eb',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                  {driveModalMessage && (
                    <div style={{ marginTop: 8, color: driveModalMessageType === 'success' ? '#10b981' : driveModalMessageType === 'error' ? '#ef4444' : '#9ca3af' }}>
                      {driveModalMessage}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => window.electronAPI.openExternal('https://console.cloud.google.com/apis/credentials')}>
                  Abrir Console
                </button>

                <button
                  onClick={async () => {
                    setDriveModalBusy(true)
                    try {
                      const res = await window.electronAPI.driveSaveCredentials(driveCredentials)
                      if (res.success) {
                        const has = isLikelyOAuthJson(driveCredentials)
                        setDriveHasOAuth(has)
                        setDriveModalMessage('Credenciais salvas com sucesso.')
                        setDriveModalMessageType('success')
                      } else {
                        setDriveModalMessage('Falha ao salvar credenciais: ' + (res.message || ''))
                        setDriveModalMessageType('error')
                      }
                    } catch {
                      setDriveModalMessage('Erro ao salvar credenciais.')
                      setDriveModalMessageType('error')
                    } finally {
                      setDriveModalBusy(false)
                    }
                  }}
                  disabled={driveModalBusy}
                >
                  {driveModalBusy ? 'Salvando...' : 'Salvar credenciais'}
                </button>

                <button
                  onClick={async () => {
                    const res = await window.electronAPI.driveOpenCredentials()
                    if (!res.success) {
                      setDriveModalMessage('Não foi possível abrir o arquivo de credenciais: ' + (res.message || ''))
                      setDriveModalMessageType('error')
                    }
                  }}
                >
                  Abrir arquivo salvo
                </button>

                <button
                  onClick={async () => {
                    const ok = isLikelyOAuthJson(driveCredentials)
                    if (!ok) {
                      setDriveModalMessage('Credenciais OAuth ausentes/ inválidas. Cole um JSON de OAuth Client (Desktop).')
                      setDriveModalMessageType('error')
                      setDriveHasOAuth(false)
                      return
                    }
                    setDriveModalBusy(true)
                    setDriveModalMessage('Iniciando autenticação...')
                    setDriveModalMessageType('info')
                    try {
                      // garante salvar antes de autenticar
                      const saveRes = await window.electronAPI.driveSaveCredentials(driveCredentials)
                      if (!saveRes.success) {
                        setDriveModalMessage('Falha ao salvar credenciais: ' + (saveRes.message || ''))
                        setDriveModalMessageType('error')
                        return
                      }
                      const res = await window.electronAPI.driveAuth()
                      if (res.success) {
                        setDriveModalMessage('Autenticado com sucesso.')
                        setDriveModalMessageType('success')
                        setDriveHasOAuth(true)
                      } else {
                        setDriveModalMessage('Erro: ' + (res.message || ''))
                        setDriveModalMessageType('error')
                      }
                    } catch {
                      setDriveModalMessage('Erro durante autenticação.')
                      setDriveModalMessageType('error')
                    } finally {
                      setDriveModalBusy(false)
                    }
                    setTimeout(() => setDriveModalMessage(null), 4000)
                  }}
                  disabled={driveModalBusy}
                >
                  {driveModalBusy ? 'Conectando...' : 'Conectar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '24px' }}>
        <button
          onClick={saveSettings}
          style={{
            padding: '12px 24px',
            background: '#3b82f6',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          disabled={saving}
        >
          {saving ? 'Salvando...' : 'Salvar Configurações'}
        </button>
      </div>
    </div>
  )
}
