import React, { useState } from 'react'
import { RefreshCw, Trash2, AlertCircle, Users, Globe, Lock, Unlock, Copy, Check, Wifi, WifiOff, Plus, LogIn, LogOut, Settings2, Crown, User, Image, FolderOpen, Play, FileText, Wrench, Gamepad2, Monitor, Terminal, ChevronDown, X } from 'lucide-react'
import type { Game, GameConfigTab, ConfigSaveState, ProtonOptions, ProtonRuntime, LanMode, IniField, VpnStatusState, VpnPeer, PrefixJobState, VpnRoom } from './types'

export interface ConfigModalProps {
  game: Game
  isLinux: boolean

  // Tab state
  configTab: GameConfigTab
  onTabChange: (tab: GameConfigTab) => void
  configSaveState: ConfigSaveState

  // General tab
  titleValue: string
  onTitleChange: (value: string) => void
  versionValue: string
  onVersionChange: (value: string) => void
  bannerLoading: string | null
  bannerManualUrl: string
  onBannerManualUrlChange: (value: string) => void
  bannerManualBusy: boolean
  onFetchBanner: () => void
  onApplyBannerUrl: () => void
  onPickBannerFile: () => void
  onClearBanner: () => void
  configuring: string | null
  onConfigureExe: () => void
  onDelete: () => void

  // OnlineFix.ini tab
  iniPath: string | null
  iniError: string | null
  iniLoading: boolean
  iniSaving: boolean
  iniDirty: boolean
  iniFields: IniField[]
  iniLastSavedAt: number | null
  onReloadIni: () => void
  onUpdateIniField: (index: number, value: string) => void
  onUpdateIniFieldKey: (index: number, key: string) => void
  onAddIniField: () => void
  onRemoveIniField: (index: number) => void
  onReprocessIni: () => void

  // Proton tab
  protonPrefix: string
  prefixJobs: Record<string, PrefixJobState>
  onCreatePrefix: () => void
  protonVersion: string
  onProtonVersionChange: (value: string) => void
  protonRuntimes: ProtonRuntime[]
  protonRootInput: string
  onProtonRootInputChange: (value: string) => void
  onAddProtonRoot: () => void
  steamAppId: string
  onSteamAppIdChange: (value: string) => void
  protonOptions: ProtonOptions
  onProtonOptionsChange: (options: ProtonOptions) => void

  // LAN tab
  lanMode: LanMode
  onLanModeChange: (mode: LanMode) => void
  lanRoomCode: string
  onLanRoomCodeChange: (code: string) => void
  lanRoomBusy: boolean
  onCreateRoom: (options?: { roomName?: string; password?: string; isPublic?: boolean; maxPlayers?: number }) => void
  onJoinRoom: (password?: string) => void
  onLeaveRoom: () => void
  lanNetworkId: string
  lanRoomName: string
  vpnLocalIp: string
  vpnHostIp: string
  vpnPeerId: string
  lanAutoconnect: boolean
  onLanAutoconnectChange: (value: boolean) => void
  vpnLoading: boolean
  vpnHasLoaded: boolean
  vpnError: string | null
  vpnStatus: VpnStatusState | null
  vpnConnected: boolean
  vpnActionBusy: boolean
  onInstallVpn: () => void
  onConnectVpn: () => void
  onDisconnectVpn: () => void
  vpnPeers: VpnPeer[]
  vpnRooms: VpnRoom[]
  onRefreshRooms: () => void
  onCopyToClipboard: (text: string) => void
  vpnConfig: string

  // Close
  onClose: () => void
}

export function ConfigModal(props: ConfigModalProps) {
  const { game, isLinux, configTab, onTabChange, configSaveState, onClose } = props

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-body">
          <div className="modal-header config-modal-header">
            <div className="config-modal-title">
              <div className="config-modal-icon">
                <Settings2 size={20} />
              </div>
              <div>
                <p className="eyebrow">Configurações</p>
                <h3>{game.title}</h3>
              </div>
            </div>
            <div className="config-modal-actions">
              <div className="config-save-pill" data-status={configTab === 'onlinefix' ? (props.iniSaving ? 'saving' : props.iniDirty ? 'pending' : 'saved') : configSaveState.status}>
                {configTab === 'onlinefix'
                  ? (props.iniSaving
                    ? 'Salvando...'
                    : props.iniDirty
                      ? 'Alterações pendentes'
                      : props.iniLastSavedAt
                        ? 'Salvo'
                        : 'Sem alterações')
                  : (configSaveState.status === 'saving'
                    ? 'Salvando...'
                    : configSaveState.status === 'pending'
                      ? 'Pendente'
                      : configSaveState.status === 'saved'
                        ? 'Salvo'
                        : configSaveState.status === 'error'
                          ? 'Erro'
                          : 'Sem alterações')}
              </div>
              <button className="config-close-btn" onClick={onClose} title="Fechar">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="config-tabs">
            <button className={configTab === 'geral' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('geral')} type="button">
              <Gamepad2 size={14} />
              <span>Geral</span>
            </button>
            <button className={configTab === 'onlinefix' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('onlinefix')} type="button">
              <FileText size={14} />
              <span>OnlineFix.ini</span>
            </button>
            {isLinux && <button className={configTab === 'proton' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('proton')} type="button">
              <Monitor size={14} />
              <span>Proton</span>
            </button>}
            <button className={configTab === 'lan' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('lan')} type="button">
              <Users size={14} />
              <span>LAN</span>
            </button>
          </div>

          {configTab === 'geral' && <GeneralTab {...props} />}
          {configTab === 'onlinefix' && <OnlineFixTab {...props} />}
          {isLinux && configTab === 'proton' && <ProtonTab {...props} />}
          {configTab === 'lan' && <LanTab {...props} />}
        </div>
      </div>
    </div>
  )
}

function GeneralTab(props: ConfigModalProps) {
  const { game, titleValue, onTitleChange, versionValue, onVersionChange, bannerLoading, bannerManualUrl, onBannerManualUrlChange, bannerManualBusy, onFetchBanner, onApplyBannerUrl, onPickBannerFile, onClearBanner, configuring, onConfigureExe, onDelete } = props

  const [showBannerUrl, setShowBannerUrl] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="modal-section">
      {/* Game Info Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Gamepad2 size={18} />
          <h4>Informações do Jogo</h4>
        </div>
        <div className="config-section-content">
          <div className="config-form-group">
            <label>Nome do jogo</label>
            <input
              value={titleValue}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Digite o título do jogo"
              className="config-input"
            />
            <span className="config-hint">Este nome será exibido na sua biblioteca</span>
          </div>

          <div className="config-form-row">
            <div className="config-form-group">
              <label>Versão instalada</label>
              <input
                value={versionValue}
                onChange={(e) => onVersionChange(e.target.value)}
                placeholder="Ex: 1.0.0"
                className="config-input"
              />
            </div>
            <div className="config-form-group">
              <label>Caminho do jogo</label>
              <div className="config-path-display">
                <FolderOpen size={14} />
                <span title={game.install_path || 'Não definido'}>{game.install_path || 'Não definido'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Banner Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Image size={18} />
          <h4>Banner do Jogo</h4>
        </div>
        <div className="config-section-content">
          <div className="config-banner-preview">
            {game.image_url ? (
              <img src={game.image_url} alt={game.title} />
            ) : (
              <div className="config-banner-placeholder">
                <Image size={32} />
                <span>Sem banner</span>
              </div>
            )}
          </div>

          <div className="config-btn-group">
            <button
              className="config-btn secondary"
              onClick={onFetchBanner}
              disabled={bannerLoading === game.url || bannerManualBusy}
            >
              {bannerLoading === game.url ? (
                <><RefreshCw size={14} className="of-spin" /> Buscando...</>
              ) : (
                <>Buscar automático</>
              )}
            </button>
            <button
              className="config-btn secondary"
              onClick={onPickBannerFile}
              disabled={bannerLoading === game.url || bannerManualBusy}
            >
              Escolher arquivo
            </button>
            <button
              className="config-btn secondary"
              onClick={() => setShowBannerUrl(!showBannerUrl)}
            >
              URL manual
            </button>
            {game.image_url && (
              <button
                className="config-btn ghost"
                onClick={onClearBanner}
                disabled={bannerLoading === game.url || bannerManualBusy}
              >
                Limpar
              </button>
            )}
          </div>

          {showBannerUrl && (
            <div className="config-form-group" style={{ marginTop: 12 }}>
              <label>URL do banner</label>
              <div className="config-input-action">
                <input
                  value={bannerManualUrl}
                  onChange={(e) => onBannerManualUrlChange(e.target.value)}
                  placeholder="https://... ou file://..."
                  className="config-input"
                />
                <button 
                  className="config-btn primary"
                  onClick={onApplyBannerUrl}
                  disabled={bannerLoading === game.url || bannerManualBusy || !bannerManualUrl}
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Executable Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Play size={18} />
          <h4>Executável</h4>
        </div>
        <div className="config-section-content">
          <div className="config-exe-card">
            <div className="config-exe-info">
              <div className="config-exe-icon">
                {game.executable_path ? <Play size={20} /> : <AlertCircle size={20} />}
              </div>
              <div className="config-exe-details">
                <span className="config-exe-label">
                  {game.executable_path ? 'Executável configurado' : 'Executável não configurado'}
                </span>
                <span className="config-exe-path" title={game.executable_path || ''}>
                  {game.executable_path || 'Clique em selecionar para definir o .exe do jogo'}
                </span>
              </div>
            </div>
            <button
              className="config-btn primary"
              onClick={onConfigureExe}
              disabled={configuring === game.url}
            >
              {configuring === game.url ? 'Selecionando...' : 'Selecionar'}
            </button>
          </div>
          {!game.executable_path && (
            <div className="config-warning">
              <AlertCircle size={14} />
              <span>Defina o executável para poder jogar</span>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="config-section danger">
        <div className="config-section-header">
          <Trash2 size={18} />
          <h4>Zona de Perigo</h4>
        </div>
        <div className="config-section-content">
          {!confirmDelete ? (
            <div className="config-danger-card">
              <div className="config-danger-info">
                <span className="config-danger-title">Desinstalar jogo</span>
                <span className="config-danger-desc">Remove o jogo da biblioteca e apaga os arquivos</span>
              </div>
              <button className="config-btn danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Desinstalar
              </button>
            </div>
          ) : (
            <div className="config-confirm-delete">
              <AlertCircle size={20} />
              <p>Tem certeza que deseja desinstalar <strong>{game.title}</strong>?</p>
              <p className="config-hint">Esta ação não pode ser desfeita.</p>
              <div className="config-btn-group">
                <button className="config-btn ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                <button className="config-btn danger" onClick={onDelete}>Confirmar exclusão</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OnlineFixTab(props: ConfigModalProps) {
  const { game, iniPath, iniError, iniLoading, iniFields, onReloadIni, onUpdateIniField, onUpdateIniFieldKey, onAddIniField, onRemoveIniField, onReprocessIni } = props

  return (
    <div className="modal-section">
      {!game.install_path ? (
        <div className="config-empty-state">
          <FileText size={40} />
          <h4>Jogo não instalado</h4>
          <p>Instale o jogo para editar as configurações do OnlineFix.ini</p>
        </div>
      ) : (
        <>
          {/* File Info Section */}
          <div className="config-section">
            <div className="config-section-header">
              <FileText size={18} />
              <h4>Arquivo de Configuração</h4>
              <button 
                className="config-section-action"
                onClick={onReloadIni}
                disabled={iniLoading}
                title="Recarregar arquivo"
              >
                <RefreshCw size={14} className={iniLoading ? 'of-spin' : ''} />
              </button>
            </div>
            <div className="config-section-content">
              <div className="config-file-card">
                <div className="config-file-icon">
                  <FileText size={20} />
                </div>
                <div className="config-file-info">
                  <span className="config-file-name">OnlineFix.ini</span>
                  <span className="config-file-path" title={iniPath || ''}>
                    {iniPath || 'Arquivo será criado ao salvar'}
                  </span>
                </div>
                <div className={`config-file-status ${iniPath ? 'exists' : 'new'}`}>
                  {iniPath ? 'Encontrado' : 'Novo'}
                </div>
              </div>

              {iniError && (
                <div className="config-error">
                  <AlertCircle size={14} />
                  <span>{iniError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Fields Editor Section */}
          <div className="config-section">
            <div className="config-section-header">
              <Settings2 size={18} />
              <h4>Configurações</h4>
            </div>
            <div className="config-section-content">
              {iniFields.length === 0 ? (
                <div className="config-ini-empty">
                  <p>Nenhuma configuração encontrada no arquivo.</p>
                  <button className="config-btn secondary" onClick={onAddIniField}>
                    <Plus size={14} />
                    Adicionar campo
                  </button>
                </div>
              ) : (
                <>
                  <div className="config-ini-grid">
                    {iniFields.map((field, idx) => (
                      <div key={idx} className="config-ini-field">
                        <button
                          className="config-ini-remove"
                          onClick={() => onRemoveIniField(idx)}
                          title="Remover campo"
                        >
                          <X size={12} />
                        </button>
                        <label className="config-ini-label">
                          {field.key || 'Nova chave'}
                        </label>
                        {!field.key && (
                          <input
                            value={field.key}
                            onChange={(e) => onUpdateIniFieldKey(idx, e.target.value)}
                            placeholder="Nome da chave (ex: language)"
                            className="config-input"
                          />
                        )}
                        {['true', 'false'].includes(String(field.value || '').toLowerCase()) ? (
                          <div className="config-ini-toggle">
                            <button
                              className={`config-toggle-btn ${String(field.value).toLowerCase() === 'true' ? 'active' : ''}`}
                              onClick={() => onUpdateIniField(idx, 'true')}
                            >
                              True
                            </button>
                            <button
                              className={`config-toggle-btn ${String(field.value).toLowerCase() === 'false' ? 'active' : ''}`}
                              onClick={() => onUpdateIniField(idx, 'false')}
                            >
                              False
                            </button>
                          </div>
                        ) : (
                          <input
                            value={field.value}
                            onChange={(e) => onUpdateIniField(idx, e.target.value)}
                            placeholder="Valor (ex: English)"
                            className="config-input"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="config-btn-group" style={{ marginTop: 14 }}>
                    <button className="config-btn secondary" onClick={onAddIniField}>
                      <Plus size={14} />
                      Adicionar campo
                    </button>
                    <button className="config-btn ghost" onClick={onReprocessIni} title="Reprocessar arquivo">
                      <RefreshCw size={14} />
                      Reprocessar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Tips Section */}
          <div className="config-section">
            <div className="config-section-header">
              <AlertCircle size={18} />
              <h4>Dicas</h4>
            </div>
            <div className="config-section-content">
              <div className="config-tips">
                <p><strong>language</strong> — Define o idioma do jogo (ex: Portuguese, English, Spanish)</p>
                <p><strong>nickname</strong> — Nome exibido para outros jogadores online</p>
                <p><strong>steamid</strong> — ID Steam personalizado para identificação</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ProtonTab(props: ConfigModalProps) {
  const { game, protonPrefix, prefixJobs, onCreatePrefix, protonVersion, onProtonVersionChange, protonRuntimes, protonRootInput, onProtonRootInputChange, onAddProtonRoot, steamAppId, onSteamAppIdChange, protonOptions, onProtonOptionsChange } = props

  const prefixJob = prefixJobs[game.url]
  const isPrefixBusy = prefixJob?.status === 'starting' || prefixJob?.status === 'progress'
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="modal-section">
      {/* Wine Prefix Section */}
      <div className="config-section">
        <div className="config-section-header">
          <FolderOpen size={18} />
          <h4>Prefixo Wine</h4>
        </div>
        <div className="config-section-content">
          <div className="config-prefix-card">
            <div className="config-prefix-info">
              <div className={`config-prefix-status ${protonPrefix ? 'ready' : 'none'}`}>
                {protonPrefix ? (
                  <><Check size={16} /> Configurado</>
                ) : (
                  <><AlertCircle size={16} /> Não configurado</>
                )}
              </div>
              <span className="config-prefix-path" title={protonPrefix || ''}>
                {protonPrefix || 'Nenhum prefixo dedicado criado'}
              </span>
            </div>
            <button
              className={`config-btn ${protonPrefix ? 'secondary' : 'primary'}`}
              onClick={onCreatePrefix}
              disabled={isPrefixBusy}
            >
              {isPrefixBusy ? (
                <><RefreshCw size={14} className="of-spin" /> Preparando...</>
              ) : protonPrefix ? (
                'Atualizar'
              ) : (
                'Criar prefixo'
              )}
            </button>
          </div>
          
          {(prefixJob?.status === 'starting' || prefixJob?.status === 'progress') && (
            <div className="config-progress">
              <RefreshCw size={14} className="of-spin" />
              <span>{prefixJob?.message || 'Preparando prefixo...'}</span>
            </div>
          )}
          
          {prefixJob?.status === 'error' && (
            <div className="config-error">
              <AlertCircle size={14} />
              <span>{prefixJob?.message || 'Falha ao preparar prefixo'}</span>
            </div>
          )}
          
          <div className="config-hint">
            Um prefixo dedicado por jogo evita conflitos de DLLs e configurações.
          </div>
        </div>
      </div>

      {/* Runtime Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Monitor size={18} />
          <h4>Runtime Proton</h4>
        </div>
        <div className="config-section-content">
          <div className="config-form-group">
            <label>Versão do Proton</label>
            <select
              value={protonVersion}
              onChange={(e) => onProtonVersionChange(e.target.value)}
              className="config-select"
            >
              <option value="">Automático (Proton Experimental)</option>
              {protonRuntimes.map(rt => (
                <option key={rt.runner} value={rt.path}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="config-form-group">
            <label>Adicionar pasta de runtimes</label>
            <div className="config-input-action">
              <input
                value={protonRootInput}
                onChange={(e) => onProtonRootInputChange(e.target.value)}
                placeholder="/path/to/compatibilitytools.d"
                className="config-input"
              />
              <button className="config-btn secondary" onClick={onAddProtonRoot}>
                <Plus size={14} />
                Adicionar
              </button>
            </div>
          </div>

          <div className="config-form-group">
            <label>Steam AppID</label>
            <input
              value={steamAppId}
              onChange={(e) => onSteamAppIdChange(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="480 (padrão)"
              className="config-input"
              style={{ maxWidth: 200 }}
            />
            <span className="config-hint">Usado para cache de shaders e comportamento do Proton</span>
          </div>
        </div>
      </div>

      {/* Performance Options */}
      <div className="config-section">
        <div className="config-section-header">
          <Wrench size={18} />
          <h4>Opções de Performance</h4>
        </div>
        <div className="config-section-content">
          <div className="config-toggle-grid">
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.esync} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, esync: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">ESYNC</span>
                <span className="config-toggle-desc">Sincronização de eventos via eventfd</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.fsync} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, fsync: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">FSYNC</span>
                <span className="config-toggle-desc">Sincronização via futex (requer kernel compatível)</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.dxvk} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, dxvk: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">DXVK</span>
                <span className="config-toggle-desc">Tradução D3D9/10/11 para Vulkan</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.gamemode} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, gamemode: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">GameMode</span>
                <span className="config-toggle-desc">Otimizações de CPU pelo Feral GameMode</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.mangohud} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, mangohud: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">MangoHUD</span>
                <span className="config-toggle-desc">Overlay com métricas de performance</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.mesa_glthread} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, mesa_glthread: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">MESA GL Thread</span>
                <span className="config-toggle-desc">Thread dedicada para OpenGL (Mesa)</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Advanced Options */}
      <div className="config-section">
        <div 
          className="config-section-header clickable"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <Terminal size={18} />
          <h4>Opções Avançadas</h4>
          <ChevronDown size={16} className={`config-chevron ${showAdvanced ? 'open' : ''}`} />
        </div>
        {showAdvanced && (
          <div className="config-section-content">
            <label className="config-toggle-item" style={{ marginBottom: 14 }}>
              <input 
                type="checkbox" 
                checked={protonOptions.logging} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, logging: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">Logs do Proton</span>
                <span className="config-toggle-desc">Habilita logs detalhados para debug</span>
              </div>
            </label>

            <div className="config-form-row">
              <div className="config-form-group">
                <label>Locale</label>
                <input
                  value={protonOptions.locale}
                  onChange={(e) => onProtonOptionsChange({ ...protonOptions, locale: e.target.value })}
                  placeholder="en_US.UTF-8"
                  className="config-input"
                />
              </div>
              <div className="config-form-group">
                <label>Argumentos de lançamento</label>
                <input
                  value={protonOptions.launchArgs}
                  onChange={(e) => onProtonOptionsChange({ ...protonOptions, launchArgs: e.target.value })}
                  placeholder="-windowed -noborder"
                  className="config-input"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LanTab(props: ConfigModalProps) {
  const {
    game,
    titleValue,
    lanMode,
    onLanModeChange,
    lanRoomCode,
    onLanRoomCodeChange,
    lanRoomBusy,
    onCreateRoom,
    onJoinRoom,
    onLeaveRoom,
    lanNetworkId,
    lanRoomName,
    vpnLocalIp,
    vpnHostIp,
    vpnPeerId,
    lanAutoconnect,
    onLanAutoconnectChange,
    vpnLoading,
    vpnHasLoaded,
    vpnError,
    vpnStatus,
    vpnConnected,
    vpnActionBusy,
    onInstallVpn,
    onConnectVpn,
    onDisconnectVpn,
    vpnPeers,
    vpnRooms,
    onRefreshRooms,
    onCopyToClipboard,
    vpnConfig
  } = props

  // Local state for room creation form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createRoomName, setCreateRoomName] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createIsPublic, setCreateIsPublic] = useState(false)
  const [createMaxPlayers, setCreateMaxPlayers] = useState(8)
  const [joinPassword, setJoinPassword] = useState('')
  const [showJoinPassword, setShowJoinPassword] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showRoomBrowser, setShowRoomBrowser] = useState(false)

  const handleCopy = (text: string, field: string) => {
    onCopyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleCreateRoom = () => {
    onCreateRoom({
      roomName: createRoomName.trim() || undefined,
      password: createPassword.trim() || undefined,
      isPublic: createIsPublic,
      maxPlayers: createMaxPlayers
    })
    setShowCreateForm(false)
    setCreateRoomName('')
    setCreatePassword('')
    setCreateIsPublic(false)
    setCreateMaxPlayers(8)
  }

  const handleJoinRoom = () => {
    onJoinRoom(joinPassword.trim() || undefined)
    setJoinPassword('')
    setShowJoinPassword(false)
  }

  const isInRoom = !!(lanNetworkId && vpnConnected)
  const isHost = vpnPeers.find(p => p.id === vpnPeerId)?.role === 'host'

  return (
    <div className="modal-section">
      {/* Mode selector */}
      <div className="section-title">Modo de Conectividade</div>
      <div className="lan-mode-cards">
        <button
          className={`lan-mode-card ${lanMode === 'steam' ? 'active' : ''}`}
          onClick={() => onLanModeChange('steam')}
        >
          <Globe size={24} />
          <div className="lan-mode-card-content">
            <strong>Padrão</strong>
            <span>Steam/Epic/OnlineFix</span>
          </div>
        </button>
        <button
          className={`lan-mode-card ${lanMode === 'ofvpn' ? 'active' : ''}`}
          onClick={() => onLanModeChange('ofvpn')}
        >
          <Users size={24} />
          <div className="lan-mode-card-content">
            <strong>VPN (Salas)</strong>
            <span>LAN virtual com amigos</span>
          </div>
        </button>
      </div>

      {lanMode === 'steam' && (
        <div className="lan-info-box">
          <p>O modo padrão utiliza os servidores do OnlineFix/Steam/Epic para multiplayer online.</p>
          <p style={{ marginTop: 8, color: '#9ca3af' }}>Use o modo VPN apenas se o multiplayer padrão não funcionar ou para jogos que precisam de LAN/Direct IP.</p>
        </div>
      )}

      {lanMode === 'ofvpn' && (
        <>
          {/* VPN Status Bar */}
          <div className={`vpn-status-bar ${vpnStatus?.installed ? (vpnConnected ? 'connected' : 'ready') : 'not-installed'}`}>
            <div className="vpn-status-icon">
              {vpnConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
            </div>
            <div className="vpn-status-text">
              {vpnLoading ? (
                <span>Verificando...</span>
              ) : !vpnStatus?.installed ? (
                <span>WireGuard não instalado</span>
              ) : vpnConnected ? (
                <span>Conectado à VPN</span>
              ) : (
                <span>VPN pronta</span>
              )}
            </div>
            {!vpnStatus?.installed && (
              <button className="btn small accent" onClick={onInstallVpn} disabled={vpnActionBusy}>
                Instalar
              </button>
            )}
            {vpnStatus?.installed && !vpnConnected && vpnConfig && (
              <button className="btn small" onClick={onConnectVpn} disabled={vpnActionBusy}>
                Conectar
              </button>
            )}
            {vpnConnected && (
              <button className="btn small ghost" onClick={onDisconnectVpn} disabled={vpnActionBusy}>
                Desconectar
              </button>
            )}
          </div>

          {vpnError && (
            <div className="vpn-error-box">
              <AlertCircle size={16} />
              <span>{vpnError}</span>
            </div>
          )}

          {/* Current Room */}
          {isInRoom ? (
            <div className="vpn-room-active">
              <div className="vpn-room-header">
                <div className="vpn-room-info">
                  <h4>{lanRoomName || 'Sala'}</h4>
                  <div className="vpn-room-code">
                    <code>{lanNetworkId}</code>
                    <button
                      className="copy-btn"
                      onClick={() => handleCopy(lanNetworkId, 'code')}
                      title="Copiar código"
                    >
                      {copiedField === 'code' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                <button
                  className="btn small danger"
                  onClick={onLeaveRoom}
                  disabled={lanRoomBusy || vpnActionBusy}
                >
                  <LogOut size={14} />
                  Sair
                </button>
              </div>

              <div className="vpn-room-ips">
                <div className="vpn-ip-card">
                  <span className="vpn-ip-label">Meu IP</span>
                  <div className="vpn-ip-value">
                    <code>{vpnLocalIp || '—'}</code>
                    {vpnLocalIp && (
                      <button className="copy-btn" onClick={() => handleCopy(vpnLocalIp, 'local')} title="Copiar">
                        {copiedField === 'local' ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="vpn-ip-card">
                  <span className="vpn-ip-label">IP do Host</span>
                  <div className="vpn-ip-value">
                    <code>{vpnHostIp || '—'}</code>
                    {vpnHostIp && (
                      <button className="copy-btn" onClick={() => handleCopy(vpnHostIp, 'host')} title="Copiar">
                        {copiedField === 'host' ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Peers list */}
              <div className="vpn-peers-section">
                <div className="vpn-peers-header">
                  <span>Jogadores na sala ({vpnPeers.length})</span>
                </div>
                <div className="vpn-peers-list">
                  {vpnPeers.length === 0 ? (
                    <div className="vpn-peers-empty">Carregando jogadores...</div>
                  ) : (
                    vpnPeers.map((peer) => (
                      <div key={peer.id || peer.ip} className={`vpn-peer-item ${peer.online === false ? 'offline' : ''}`}>
                        <div className="vpn-peer-icon">
                          {peer.role === 'host' ? <Crown size={14} /> : <User size={14} />}
                        </div>
                        <div className="vpn-peer-info">
                          <span className="vpn-peer-name">{peer.name || 'Jogador'}</span>
                          <span className="vpn-peer-ip">{peer.ip}</span>
                        </div>
                        <div className={`vpn-peer-status ${peer.online !== false ? 'online' : 'offline'}`}>
                          {peer.online !== false ? '●' : '○'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <label className="toggle" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={lanAutoconnect} onChange={(e) => onLanAutoconnectChange(e.target.checked)} />
                <span>Conectar automaticamente ao abrir o jogo</span>
              </label>
            </div>
          ) : (
            /* Not in room - show options */
            <div className="vpn-room-options">
              {/* Quick actions */}
              {!showCreateForm && !showRoomBrowser && (
                <div className="vpn-quick-actions">
                  <button
                    className="vpn-action-card"
                    onClick={() => setShowCreateForm(true)}
                    disabled={lanRoomBusy || vpnActionBusy || !vpnStatus?.installed}
                  >
                    <Plus size={24} />
                    <strong>Criar Sala</strong>
                    <span>Hospede uma sala para seus amigos</span>
                  </button>

                  <button
                    className="vpn-action-card"
                    onClick={() => setShowRoomBrowser(true)}
                    disabled={lanRoomBusy || vpnActionBusy || !vpnStatus?.installed}
                  >
                    <Globe size={24} />
                    <strong>Procurar Salas</strong>
                    <span>Encontre salas públicas</span>
                  </button>
                </div>
              )}

              {/* Create Room Form */}
              {showCreateForm && (
                <div className="vpn-create-form">
                  <div className="vpn-form-header">
                    <h4>Criar Nova Sala</h4>
                    <button className="btn ghost small" onClick={() => setShowCreateForm(false)}>Cancelar</button>
                  </div>

                  <div className="vpn-form-field">
                    <label>Nome da sala (opcional)</label>
                    <input
                      value={createRoomName}
                      onChange={(e) => setCreateRoomName(e.target.value)}
                      placeholder={`Sala de ${titleValue || 'Jogo'}`}
                      maxLength={64}
                    />
                  </div>

                  <div className="vpn-form-field">
                    <label>Senha (opcional)</label>
                    <input
                      type="password"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="Deixe vazio para sem senha"
                      maxLength={32}
                    />
                  </div>

                  <div className="vpn-form-row">
                    <div className="vpn-form-field" style={{ flex: 1 }}>
                      <label>Máximo de jogadores</label>
                      <select
                        value={createMaxPlayers}
                        onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
                      >
                        {[2, 4, 6, 8, 12, 16, 24, 32].map(n => (
                          <option key={n} value={n}>{n} jogadores</option>
                        ))}
                      </select>
                    </div>

                    <label className="toggle vpn-public-toggle">
                      <input
                        type="checkbox"
                        checked={createIsPublic}
                        onChange={(e) => setCreateIsPublic(e.target.checked)}
                      />
                      <span>Sala pública</span>
                    </label>
                  </div>

                  <div className="vpn-form-info">
                    {createIsPublic ? (
                      <><Unlock size={14} /> Qualquer pessoa poderá ver e entrar na sala</>
                    ) : (
                      <><Lock size={14} /> Apenas quem tiver o código poderá entrar</>
                    )}
                  </div>

                  <button
                    className="btn accent full-width"
                    onClick={handleCreateRoom}
                    disabled={lanRoomBusy || vpnActionBusy}
                  >
                    {lanRoomBusy ? <><RefreshCw size={14} className="of-spin" /> Criando...</> : 'Criar Sala'}
                  </button>
                </div>
              )}

              {/* Room Browser */}
              {showRoomBrowser && (
                <div className="vpn-room-browser">
                  <div className="vpn-form-header">
                    <h4>Salas Públicas</h4>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn ghost small" onClick={onRefreshRooms} disabled={vpnLoading}>
                        <RefreshCw size={14} className={vpnLoading ? 'of-spin' : ''} />
                      </button>
                      <button className="btn ghost small" onClick={() => setShowRoomBrowser(false)}>Fechar</button>
                    </div>
                  </div>

                  <div className="vpn-rooms-list">
                    {vpnRooms.length === 0 ? (
                      <div className="vpn-rooms-empty">
                        <Users size={32} />
                        <span>Nenhuma sala pública encontrada</span>
                        <span className="vpn-rooms-empty-sub">Crie uma sala ou entre com um código</span>
                      </div>
                    ) : (
                      vpnRooms.map((room) => (
                        <button
                          key={room.code}
                          className="vpn-room-item"
                          onClick={() => {
                            onLanRoomCodeChange(room.code)
                            setShowRoomBrowser(false)
                            if (room.hasPassword) {
                              setShowJoinPassword(true)
                            } else {
                              onJoinRoom()
                            }
                          }}
                          disabled={lanRoomBusy || vpnActionBusy}
                        >
                          <div className="vpn-room-item-info">
                            <strong>{room.name}</strong>
                            <span className="vpn-room-item-host">por {room.hostName || 'Anônimo'}</span>
                          </div>
                          <div className="vpn-room-item-meta">
                            <span className="vpn-room-item-players">
                              <Users size={12} />
                              {room.onlineCount}/{room.maxPlayers}
                            </span>
                            {room.hasPassword && <Lock size={12} />}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Join with code */}
              {!showCreateForm && !showRoomBrowser && (
                <div className="vpn-join-section">
                  <div className="vpn-join-divider">
                    <span>ou entre com código</span>
                  </div>

                  <div className="vpn-join-form">
                    <input
                      value={lanRoomCode}
                      onChange={(e) => onLanRoomCodeChange(
                        e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 16)
                      )}
                      placeholder="Código da sala (ex: ABCD2345EF)"
                    />
                    {showJoinPassword && (
                      <input
                        type="password"
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        placeholder="Senha da sala"
                      />
                    )}
                    <button
                      className="btn accent"
                      onClick={handleJoinRoom}
                      disabled={lanRoomBusy || vpnActionBusy || !lanRoomCode.trim() || !vpnStatus?.installed}
                    >
                      <LogIn size={14} />
                      Entrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
