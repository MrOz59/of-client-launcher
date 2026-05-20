import React, { useState } from 'react'
import { RefreshCw, Trash2, AlertCircle, Users, Globe, Lock, Unlock, Copy, Check, Wifi, WifiOff, Plus, LogIn, LogOut, Settings2, Crown, User, Image, FolderOpen, Play, FileText, Wrench, Gamepad2, Monitor, Terminal, ChevronDown, X } from 'lucide-react'
import type { Game, GameConfigTab, ConfigSaveState, ProtonOptions, ProtonRuntime, LanMode, IniField, VpnStatusState, VpnPeer, PrefixJobState, VpnRoom } from './types'
import { useI18n } from '../../i18n'

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
  onJoinRoom: (password?: string, codeOverride?: string) => void
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
  const { t } = useI18n()

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
                <p className="eyebrow">{t('library.card.settings')}</p>
                <h3>{game.title}</h3>
              </div>
            </div>
            <div className="config-modal-actions">
              <div className="config-save-pill" data-status={configTab === 'onlinefix' ? (props.iniSaving ? 'saving' : props.iniDirty ? 'pending' : 'saved') : configSaveState.status}>
                {configTab === 'onlinefix'
                  ? (props.iniSaving
                    ? t('common.saving')
                    : props.iniDirty
                      ? t('settings.save.pending')
                      : props.iniLastSavedAt
                        ? t('library.configModal.save.saved')
                        : t('settings.save.idle'))
                  : (configSaveState.status === 'saving'
                    ? t('common.saving')
                    : configSaveState.status === 'pending'
                      ? t('library.configModal.save.pending')
                      : configSaveState.status === 'saved'
                        ? t('library.configModal.save.saved')
                        : configSaveState.status === 'error'
                          ? t('downloads.status.error')
                          : t('settings.save.idle'))}
              </div>
              <button className="config-close-btn" onClick={onClose} title={t('login.close')}>
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="config-tabs">
            <button className={configTab === 'geral' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('geral')} type="button">
              <Gamepad2 size={14} />
              <span>{t('library.configModal.tabs.general')}</span>
            </button>
            <button className={configTab === 'onlinefix' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('onlinefix')} type="button">
              <FileText size={14} />
              <span>OnlineFix.ini</span>
            </button>
            {isLinux && <button className={configTab === 'proton' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('proton')} type="button">
              <Monitor size={14} />
              <span>Proton</span>
            </button>}
            <button className={configTab === 'diagnostico' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('diagnostico')} type="button">
              <Terminal size={14} />
              <span>{t('library.configModal.tabs.diagnostics')}</span>
            </button>
            <button className={configTab === 'lan' ? 'config-tab-btn active' : 'config-tab-btn'} onClick={() => onTabChange('lan')} type="button">
              <Users size={14} />
              <span>LAN</span>
            </button>
          </div>

          {configTab === 'geral' && <GeneralTab {...props} />}
          {configTab === 'onlinefix' && <OnlineFixTab {...props} />}
          {isLinux && configTab === 'proton' && <ProtonTab {...props} />}
          {configTab === 'diagnostico' && <DiagnosticsTab {...props} />}
          {configTab === 'lan' && <LanTab {...props} />}
        </div>
      </div>
    </div>
  )
}

function GeneralTab(props: ConfigModalProps) {
  const { game, titleValue, onTitleChange, versionValue, onVersionChange, bannerLoading, bannerManualUrl, onBannerManualUrlChange, bannerManualBusy, onFetchBanner, onApplyBannerUrl, onPickBannerFile, onClearBanner, configuring, onConfigureExe, onDelete } = props
  const { t } = useI18n()

  const [showBannerUrl, setShowBannerUrl] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="modal-section">
      {/* Game Info Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Gamepad2 size={18} />
          <h4>{t('library.configModal.general.gameInfo')}</h4>
        </div>
        <div className="config-section-content">
          <div className="config-form-group">
            <label>{t('library.configModal.general.gameName')}</label>
            <input
              value={titleValue}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={t('library.configModal.general.gameNamePlaceholder')}
              className="config-input"
            />
            <span className="config-hint">{t('library.configModal.general.gameNameHint')}</span>
          </div>

          <div className="config-form-row">
            <div className="config-form-group">
              <label>{t('library.configModal.general.installedVersion')}</label>
              <input
                value={versionValue}
                onChange={(e) => onVersionChange(e.target.value)}
                placeholder="Ex: 1.0.0"
                className="config-input"
              />
            </div>
            <div className="config-form-group">
              <label>{t('library.configModal.general.gamePath')}</label>
              <div className="config-path-display">
                <FolderOpen size={14} />
                <span title={game.install_path || t('common.notSet')}>{game.install_path || t('common.notSet')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Banner Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Image size={18} />
          <h4>{t('library.configModal.general.banner')}</h4>
        </div>
        <div className="config-section-content">
          <div className="config-banner-preview">
            {game.image_url ? (
              <img src={game.image_url} alt={game.title} />
            ) : (
              <div className="config-banner-placeholder">
                <Image size={32} />
                <span>{t('library.configModal.general.noBanner')}</span>
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
                <><RefreshCw size={14} className="of-spin" /> {t('library.configModal.general.fetching')}</>
              ) : (
                <>{t('library.configModal.general.autoFetch')}</>
              )}
            </button>
            <button
              className="config-btn secondary"
              onClick={onPickBannerFile}
              disabled={bannerLoading === game.url || bannerManualBusy}
            >
              {t('library.configModal.general.pickFile')}
            </button>
            <button
              className="config-btn secondary"
              onClick={() => setShowBannerUrl(!showBannerUrl)}
            >
              {t('library.configModal.general.manualUrl')}
            </button>
            {game.image_url && (
              <button
                className="config-btn ghost"
                onClick={onClearBanner}
                disabled={bannerLoading === game.url || bannerManualBusy}
              >
                {t('common.clear')}
              </button>
            )}
          </div>

          {showBannerUrl && (
            <div className="config-form-group" style={{ marginTop: 12 }}>
              <label>{t('library.configModal.general.bannerUrl')}</label>
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
                  {t('library.configModal.general.apply')}
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
          <h4>{t('library.configModal.general.executable')}</h4>
        </div>
        <div className="config-section-content">
          <div className="config-exe-card">
            <div className="config-exe-info">
              <div className="config-exe-icon">
                {game.executable_path ? <Play size={20} /> : <AlertCircle size={20} />}
              </div>
              <div className="config-exe-details">
                <span className="config-exe-label">
                  {game.executable_path ? t('library.configModal.general.exeConfigured') : t('library.configModal.general.exeMissing')}
                </span>
                <span className="config-exe-path" title={game.executable_path || ''}>
                  {game.executable_path || t('library.configModal.general.exeHint')}
                </span>
              </div>
            </div>
            <button
              className="config-btn primary"
              onClick={onConfigureExe}
              disabled={configuring === game.url}
            >
              {configuring === game.url ? t('library.configModal.general.selecting') : t('common.select')}
            </button>
          </div>
          {!game.executable_path && (
            <div className="config-warning">
              <AlertCircle size={14} />
              <span>{t('library.configModal.general.exeWarning')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="config-section danger">
        <div className="config-section-header">
          <Trash2 size={18} />
          <h4>{t('library.configModal.general.dangerZone')}</h4>
        </div>
        <div className="config-section-content">
          {!confirmDelete ? (
            <div className="config-danger-card">
              <div className="config-danger-info">
                <span className="config-danger-title">{t('library.configModal.general.uninstallGame')}</span>
                <span className="config-danger-desc">{t('library.configModal.general.uninstallDesc')}</span>
              </div>
              <button className="config-btn danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                {t('library.card.uninstall')}
              </button>
            </div>
          ) : (
            <div className="config-confirm-delete">
              <AlertCircle size={20} />
              <p>{t('library.configModal.general.uninstallConfirm', { title: game.title })}</p>
              <p className="config-hint">{t('library.configModal.general.irreversible')}</p>
              <div className="config-btn-group">
                <button className="config-btn ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
                <button className="config-btn danger" onClick={onDelete}>{t('library.configModal.general.confirmDelete')}</button>
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
  const { t } = useI18n()

  return (
    <div className="modal-section">
      {!game.install_path ? (
        <div className="config-empty-state">
          <FileText size={40} />
          <h4>{t('library.configModal.onlineFix.notInstalled')}</h4>
          <p>{t('library.configModal.onlineFix.installToEdit')}</p>
        </div>
      ) : (
        <>
          {/* File Info Section */}
          <div className="config-section">
            <div className="config-section-header">
              <FileText size={18} />
              <h4>{t('library.configModal.onlineFix.configFile')}</h4>
              <button 
                className="config-section-action"
                onClick={onReloadIni}
                disabled={iniLoading}
                title={t('library.configModal.onlineFix.reloadFile')}
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
                    {iniPath || t('library.configModal.onlineFix.createdOnSave')}
                  </span>
                </div>
                <div className={`config-file-status ${iniPath ? 'exists' : 'new'}`}>
                  {iniPath ? t('library.configModal.onlineFix.found') : t('library.configModal.onlineFix.new')}
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
              <h4>{t('library.configModal.onlineFix.settings')}</h4>
            </div>
            <div className="config-section-content">
              {iniFields.length === 0 ? (
                <div className="config-ini-empty">
                  <p>{t('library.configModal.onlineFix.empty')}</p>
                  <button className="config-btn secondary" onClick={onAddIniField}>
                    <Plus size={14} />
                    {t('library.configModal.onlineFix.addField')}
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
                          title={t('library.configModal.onlineFix.removeField')}
                        >
                          <X size={12} />
                        </button>
                        <label className="config-ini-label">
                          {field.key || t('library.configModal.onlineFix.newKey')}
                        </label>
                        {!field.key && (
                          <input
                            value={field.key}
                            onChange={(e) => onUpdateIniFieldKey(idx, e.target.value)}
                            placeholder={t('library.configModal.onlineFix.keyPlaceholder')}
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
                            placeholder={t('library.configModal.onlineFix.valuePlaceholder')}
                            className="config-input"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="config-btn-group" style={{ marginTop: 14 }}>
                    <button className="config-btn secondary" onClick={onAddIniField}>
                      <Plus size={14} />
                      {t('library.configModal.onlineFix.addField')}
                    </button>
                    <button className="config-btn ghost" onClick={onReprocessIni} title={t('library.configModal.onlineFix.reprocessFile')}>
                      <RefreshCw size={14} />
                      {t('library.configModal.onlineFix.reprocess')}
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
              <h4>{t('library.configModal.onlineFix.tips')}</h4>
            </div>
            <div className="config-section-content">
              <div className="config-tips">
                <p><strong>language</strong> - {t('library.configModal.onlineFix.tipLanguage')}</p>
                <p><strong>nickname</strong> - {t('library.configModal.onlineFix.tipNickname')}</p>
                <p><strong>steamid</strong> - {t('library.configModal.onlineFix.tipSteamId')}</p>
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
  const { t } = useI18n()

  const prefixJob = prefixJobs[game.url]
  const isPrefixBusy = prefixJob?.status === 'starting' || prefixJob?.status === 'progress'
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Winetricks/Protontricks state
  const [tricksInput, setTricksInput] = useState('')
  const [tricksTool, setTricksTool] = useState<'winetricks' | 'protontricks'>('winetricks')
  const [tricksRunning, setTricksRunning] = useState(false)
  const [tricksToolStatus, setTricksToolStatus] = useState<{ winetricks?: boolean; protontricks?: boolean } | null>(null)

  // Check tool availability on mount
  React.useEffect(() => {
    window.electronAPI.protonTricksStatus().then((res) => {
      if (res.success) setTricksToolStatus({ winetricks: res.winetricks, protontricks: res.protontricks })
    }).catch(() => {})
  }, [])

  const handleRunTricks = async () => {
    const components = tricksInput.trim().split(/[\s,]+/).filter(Boolean)
    if (!components.length) return
    setTricksRunning(true)
    try {
      await window.electronAPI.protonRunTricks(game.url, tricksTool, components)
    } catch {}
    setTricksRunning(false)
  }

  return (
    <div className="modal-section">
      {/* Wine Prefix Section */}
      <div className="config-section">
        <div className="config-section-header">
          <FolderOpen size={18} />
          <h4>{t('library.configModal.proton.prefix')}</h4>
        </div>
        <div className="config-section-content">
          <div className="config-prefix-card">
            <div className="config-prefix-info">
              <div className={`config-prefix-status ${protonPrefix ? 'ready' : 'none'}`}>
                {protonPrefix ? (
                  <><Check size={16} /> {t('common.configured')}</>
                ) : (
                  <><AlertCircle size={16} /> {t('common.notConfigured')}</>
                )}
              </div>
              <span className="config-prefix-path" title={protonPrefix || ''}>
                {protonPrefix || t('library.configModal.proton.noDedicatedPrefix')}
              </span>
            </div>
            <button
              className={`config-btn ${protonPrefix ? 'secondary' : 'primary'}`}
              onClick={onCreatePrefix}
              disabled={isPrefixBusy}
            >
              {isPrefixBusy ? (
                <><RefreshCw size={14} className="of-spin" /> {t('library.configModal.proton.creating')}</>
              ) : protonPrefix ? (
                t('library.card.update')
              ) : (
                t('library.configModal.proton.createPrefix')
              )}
            </button>
          </div>
          
          {(prefixJob?.status === 'starting' || prefixJob?.status === 'progress') && (
            <div className="config-progress">
              <RefreshCw size={14} className="of-spin" />
              <span>{prefixJob?.message || t('library.prefix.preparing')}</span>
            </div>
          )}
          
          {prefixJob?.status === 'error' && (
            <div className="config-error">
              <AlertCircle size={14} />
              <span>{prefixJob?.message || t('library.configModal.proton.prefixFailed')}</span>
            </div>
          )}
          
          <div className="config-hint">
            {t('library.configModal.proton.prefixHint')}
          </div>
        </div>
      </div>

      {/* Winetricks / Protontricks Section */}
      {protonPrefix && (
        <div className="config-section">
          <div className="config-section-header">
            <Settings2 size={18} />
            <h4>Winetricks / Protontricks</h4>
          </div>
          <div className="config-section-content">
            <div className="config-form-group">
              <label>{t('library.configModal.proton.tool')}</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <label className="config-toggle-item" style={{ flex: 1 }}>
                  <input
                    type="radio"
                    name="tricks-tool"
                    checked={tricksTool === 'winetricks'}
                    onChange={() => setTricksTool('winetricks')}
                    disabled={isPrefixBusy || tricksRunning}
                  />
                  <div className="config-toggle-info">
                    <span className="config-toggle-name">winetricks</span>
                    <span className="config-toggle-desc">
                      {tricksToolStatus?.winetricks === false ? t('common.notInstalled') : t('common.available')}
                    </span>
                  </div>
                </label>
                <label className="config-toggle-item" style={{ flex: 1 }}>
                  <input
                    type="radio"
                    name="tricks-tool"
                    checked={tricksTool === 'protontricks'}
                    onChange={() => setTricksTool('protontricks')}
                    disabled={isPrefixBusy || tricksRunning}
                  />
                  <div className="config-toggle-info">
                    <span className="config-toggle-name">protontricks</span>
                    <span className="config-toggle-desc">
                      {tricksToolStatus?.protontricks === false ? t('common.notInstalled') : t('common.available')}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="config-form-group">
              <label>{t('library.configModal.proton.components')}</label>
              <div className="config-input-action">
                <input
                  value={tricksInput}
                  onChange={(e) => setTricksInput(e.target.value)}
                  placeholder="vcrun2022 d3dx9 dotnet48"
                  className="config-input"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  disabled={isPrefixBusy || tricksRunning}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRunTricks() }}
                />
                <button
                  className="config-btn primary"
                  onClick={handleRunTricks}
                  disabled={isPrefixBusy || tricksRunning || !tricksInput.trim()}
                >
                  {tricksRunning ? (
                    <><RefreshCw size={14} className="of-spin" /> {t('library.configModal.proton.running')}</>
                  ) : (
                    <><Play size={14} /> {t('library.configModal.proton.run')}</>
                  )}
                </button>
              </div>
              <span className="config-hint">
                {t('library.configModal.proton.componentsHint')}
              </span>
            </div>

            {(prefixJob?.status === 'starting' || prefixJob?.status === 'progress') && tricksRunning && (
              <div className="config-progress">
                <RefreshCw size={14} className="of-spin" />
                <span>{prefixJob?.message || t('library.configModal.proton.running')}</span>
              </div>
            )}

            <div className="config-form-group" style={{ marginTop: 12 }}>
              <label>{t('library.configModal.proton.wineTools')}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="config-btn secondary"
                  onClick={async () => {
                    const res = await window.electronAPI.protonOpenTricksGui(game.url)
                    if (!res.success) alert(res.error || t('library.configModal.proton.openWinetricksFailed'))
                  }}
                  disabled={isPrefixBusy || tricksRunning}
                  title={t('library.configModal.proton.openWinetricks')}
                >
                  <Settings2 size={14} /> Winetricks GUI
                </button>
                <button
                  className="config-btn secondary"
                  onClick={async () => {
                    const res = await window.electronAPI.protonOpenWinecfg(game.url)
                    if (!res.success) alert(res.error || t('library.configModal.proton.openWinecfgFailed'))
                  }}
                  disabled={isPrefixBusy || tricksRunning}
                  title={t('library.configModal.proton.openWinecfg')}
                >
                  <Wrench size={14} /> Winecfg
                </button>
                <button
                  className="config-btn secondary"
                  onClick={async () => {
                    const res = await window.electronAPI.protonOpenRegedit(game.url)
                    if (!res.success) alert(res.error || t('library.configModal.proton.openRegeditFailed'))
                  }}
                  disabled={isPrefixBusy || tricksRunning}
                  title={t('library.configModal.proton.openRegedit')}
                >
                  <Terminal size={14} /> Regedit
                </button>
                <button
                  className="config-btn secondary"
                  onClick={async () => {
                    const res = await window.electronAPI.protonOpenFileManager(game.url)
                    if (!res.success) alert(res.error || t('library.configModal.proton.openExplorerFailed'))
                  }}
                  disabled={isPrefixBusy || tricksRunning}
                  title={t('library.configModal.proton.openExplorer')}
                >
                  <FolderOpen size={14} /> Explorer
                </button>
              </div>
              <span className="config-hint">
                {t('library.configModal.proton.toolsHint')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Runtime Section */}
      <div className="config-section">
        <div className="config-section-header">
          <Monitor size={18} />
          <h4>{t('library.configModal.proton.runtime')}</h4>
        </div>
        <div className="config-section-content">
          <div className="config-form-group">
            <label>{t('library.configModal.proton.version')}</label>
            <select
              value={protonVersion}
              onChange={(e) => onProtonVersionChange(e.target.value)}
              className="config-select"
            >
              <option value="">{t('library.configModal.proton.autoExperimental')}</option>
              {protonRuntimes.map(rt => (
                <option key={rt.runner} value={rt.path}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="config-form-group">
            <label>{t('library.configModal.proton.addRuntimeFolder')}</label>
            <div className="config-input-action">
              <input
                value={protonRootInput}
                onChange={(e) => onProtonRootInputChange(e.target.value)}
                placeholder="/path/to/compatibilitytools.d"
                className="config-input"
              />
              <button className="config-btn secondary" onClick={onAddProtonRoot}>
                <Plus size={14} />
                {t('library.configModal.proton.add')}
              </button>
            </div>
          </div>

          <div className="config-form-group">
            <label>Steam AppID</label>
            <input
              value={steamAppId}
              onChange={(e) => onSteamAppIdChange(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={`480 (${t('common.default').toLowerCase()})`}
              className="config-input"
              style={{ maxWidth: 200 }}
            />
            <span className="config-hint">{t('library.configModal.proton.steamAppIdHint')}</span>
          </div>
        </div>
      </div>

      {/* Performance Options */}
      <div className="config-section">
        <div className="config-section-header">
          <Wrench size={18} />
          <h4>{t('library.configModal.proton.performanceOptions')}</h4>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.esyncDesc')}</span>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.fsyncDesc')}</span>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.dxvkDesc')}</span>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.gamemodeDesc')}</span>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.mangohudDesc')}</span>
              </div>
            </label>

            <label className="config-toggle-item">
              <input
                type="checkbox"
                checked={protonOptions.steamOverlay !== false}
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, steamOverlay: e.target.checked })}
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">Steam Overlay</span>
                <span className="config-toggle-desc">{t('library.configModal.proton.steamOverlayDesc')}</span>
              </div>
            </label>
            
            <label className="config-toggle-item">
              <input 
                type="checkbox" 
                checked={protonOptions.useGamescope || false} 
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, useGamescope: e.target.checked })} 
              />
              <div className="config-toggle-info">
                <span className="config-toggle-name">Gamescope</span>
                <span className="config-toggle-desc">{t('library.configModal.proton.gamescopeDesc')}</span>
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
                <span className="config-toggle-desc">{t('library.configModal.proton.mesaDesc')}</span>
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
          <h4>{t('library.configModal.proton.advancedOptions')}</h4>
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
                <span className="config-toggle-name">{t('library.logs.title')}</span>
                <span className="config-toggle-desc">{t('library.configModal.proton.logsDesc')}</span>
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
                <label>{t('library.configModal.proton.launchArgs')}</label>
                <input
                  value={protonOptions.launchArgs}
                  onChange={(e) => onProtonOptionsChange({ ...protonOptions, launchArgs: e.target.value })}
                  placeholder="-windowed -noborder"
                  className="config-input"
                />
              </div>
            </div>

            <div className="config-form-group" style={{ marginTop: 10 }}>
              <label>WINEDLLOVERRIDES</label>
              <input
                value={protonOptions.wineDllOverrides}
                onChange={(e) => onProtonOptionsChange({ ...protonOptions, wineDllOverrides: e.target.value })}
                placeholder="steam_api=n;steam_api64=n;winmm=n,b;winhttp=n,b"
                className="config-input"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              <span className="config-toggle-desc" style={{ marginTop: 4, display: 'block' }}>
                {t('library.configModal.proton.dllOverridesHint')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DiagnosticsTab(props: ConfigModalProps) {
  const { game } = props
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repairResult, setRepairResult] = useState<any[] | null>(null)
  const [diagnostics, setDiagnostics] = useState<any | null>(null)

  const loadDiagnostics = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.getGameDiagnostics(game.url)
      if (!res.success) {
        setError(res.error || t('library.configModal.diagnostics.generateFailed'))
        setDiagnostics(null)
      } else {
        setDiagnostics(res.diagnostics || null)
        setRepairResult(null)
      }
    } catch (err: any) {
      setError(err?.message || t('library.configModal.diagnostics.generateFailed'))
      setDiagnostics(null)
    } finally {
      setLoading(false)
    }
  }, [game.url, t])

  React.useEffect(() => {
    loadDiagnostics()
  }, [loadDiagnostics])

  const copyJson = async () => {
    if (!diagnostics) return
    await navigator.clipboard?.writeText(JSON.stringify(diagnostics, null, 2)).catch(() => {})
  }

  const runRepair = async () => {
    if (!diagnostics || repairing) return
    setRepairing(true)
    setError(null)
    setRepairResult(null)
    try {
      const res = await window.electronAPI.repairGameDiagnostics(game.url)
      if (!res.success) {
        setError(res.error || t('library.configModal.diagnostics.repairFailed'))
        setRepairResult(res.actions || null)
      } else {
        setDiagnostics(res.diagnostics || null)
        setRepairResult(res.actions || [])
      }
    } catch (err: any) {
      setError(err?.message || t('library.configModal.diagnostics.repairFailed'))
    } finally {
      setRepairing(false)
    }
  }

  const renderValue = (value: any) => {
    if (value === null || value === undefined || value === '') return '—'
    if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
    return String(value)
  }

  const summaryItems = diagnostics ? [
    [t('library.configModal.diagnostics.executable'), diagnostics.paths?.executable?.exists ? 'OK' : t('common.missing')],
    [t('library.configModal.diagnostics.prefix'), diagnostics.paths?.prefix?.exists ? 'OK' : t('library.configModal.diagnostics.pending')],
    [t('library.configModal.diagnostics.store'), diagnostics.overlayCompatibility?.store ? String(diagnostics.overlayCompatibility.store).toUpperCase() : '—'],
    [t('library.configModal.diagnostics.overlay'), diagnostics.overlayCompatibility?.selectedOverlay ? String(diagnostics.overlayCompatibility.selectedOverlay).toUpperCase() : t('library.configModal.diagnostics.inactive')]
  ] : []
  const repairActions = diagnostics?.repairActions || []

  return (
    <div className="modal-section">
      <div className="config-section">
        <div className="config-section-header">
          <Terminal size={18} />
          <h4>{t('library.configModal.diagnostics.gameDiagnostics')}</h4>
          <button className="config-section-action" onClick={loadDiagnostics} disabled={loading} title={t('library.configModal.diagnostics.refresh')}>
            <RefreshCw size={14} className={loading ? 'of-spin' : ''} />
          </button>
          <button className="config-section-action" onClick={runRepair} disabled={!diagnostics || repairing || repairActions.length === 0} title={t('library.configModal.diagnostics.repairProblems')}>
            <Wrench size={14} className={repairing ? 'of-spin' : ''} />
          </button>
          <button className="config-section-action" onClick={copyJson} disabled={!diagnostics} title={t('library.configModal.diagnostics.copyJson')}>
            <Copy size={14} />
          </button>
        </div>
        <div className="config-section-content">
          {error ? (
            <div className="config-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          {!diagnostics && !error ? (
            <div className="config-progress">
              <RefreshCw size={14} className="of-spin" />
              <span>{t('library.configModal.diagnostics.collecting')}</span>
            </div>
          ) : null}

          {diagnostics ? (
            <>
              <div className="diagnostic-summary">
                {summaryItems.map(([label, value]) => (
                  <div className="diagnostic-summary-item" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>

              {repairActions.length > 0 ? (
                <div className="diagnostic-repair-panel">
                  <div className="diagnostic-repair-header">
                    <div>
                      <strong>{repairActions.length === 1 ? t('library.configModal.diagnostics.repairAvailable', { count: repairActions.length }) : t('library.configModal.diagnostics.repairsAvailable', { count: repairActions.length })}</strong>
                      <span>{t('library.configModal.diagnostics.repairHint')}</span>
                    </div>
                    <button className="config-btn primary" onClick={runRepair} disabled={repairing}>
                      {repairing ? (
                        <><RefreshCw size={14} className="of-spin" /> {t('library.configModal.diagnostics.repairing')}</>
                      ) : (
                        <><Wrench size={14} /> {t('library.configModal.diagnostics.repair')}</>
                      )}
                    </button>
                  </div>
                  <div className="diagnostic-repair-list">
                    {repairActions.map((action: any) => (
                      <div key={action.id}>
                        <span>{action.label}</span>
                        <code>{action.detail || '—'}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="diagnostic-repair-empty">
                  <Check size={14} />
                  <span>{t('library.configModal.diagnostics.noPendingRepair')}</span>
                </div>
              )}

              {repairResult ? (
                <div className="diagnostic-repair-result">
                  {repairResult.length === 0 ? (
                    <div><Check size={14} /><span>{t('library.configModal.diagnostics.noChangeNeeded')}</span></div>
                  ) : repairResult.map((result: any) => (
                    <div className={`diagnostic-repair-result--${result.status}`} key={`${result.id}-${result.status}`}>
                      {result.status === 'done' ? <Check size={14} /> : result.status === 'error' ? <AlertCircle size={14} /> : <Terminal size={14} />}
                      <span>{result.label}: {result.detail || result.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="diagnostic-check-list">
                {(diagnostics.checks || []).map((check: any) => (
                  <div className={`diagnostic-check diagnostic-check--${check.status}`} key={check.id}>
                    <div className="diagnostic-check-status">
                      {check.status === 'ok' ? <Check size={14} /> : check.status === 'error' ? <AlertCircle size={14} /> : <Terminal size={14} />}
                    </div>
                    <div className="diagnostic-check-body">
                      <strong>{check.label}</strong>
                      <span>{check.detail || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {diagnostics ? (
        <>
          <div className="config-section">
            <div className="config-section-header">
              <Monitor size={18} />
              <h4>{t('library.configModal.diagnostics.environment')}</h4>
            </div>
            <div className="config-section-content">
              <div className="diagnostic-grid">
                <div><span>Game ID</span><strong>{renderValue(diagnostics.game?.gameId)}</strong></div>
                <div><span>{t('library.configModal.general.installedVersion')}</span><strong>{renderValue(diagnostics.game?.installedVersion)}</strong></div>
                <div><span>Steam AppID</span><strong>{renderValue(diagnostics.steam?.configuredSteamAppId)}</strong></div>
                <div><span>Overlay AppID</span><strong>{renderValue(diagnostics.steam?.overlayAppId)}</strong></div>
                <div><span>OnlineFix.ini</span><strong>{diagnostics.onlineFix?.found ? t('library.configModal.onlineFix.found') : t('common.missing')}</strong></div>
                <div><span>Epic/EOS</span><strong>{diagnostics.overlayCompatibility?.store === 'epic' ? t('library.configModal.diagnostics.detected') : t('common.no')}</strong></div>
                <div><span>{t('library.configModal.diagnostics.session')}</span><strong>{renderValue(diagnostics.display?.sessionType || (diagnostics.display?.isWayland ? 'wayland' : 'x11'))}</strong></div>
                <div><span>EOS Overlay</span><strong>{diagnostics.epic?.overlayValid ? t('common.installed') : t('common.missing')}</strong></div>
                <div><span>Gamescope</span><strong>{renderValue(diagnostics.tools?.gamescope)}</strong></div>
                <div><span>GameMode</span><strong>{renderValue(diagnostics.tools?.gamemoderun)}</strong></div>
              </div>
            </div>
          </div>

          <div className="config-section">
            <div className="config-section-header">
              <FolderOpen size={18} />
              <h4>{t('library.configModal.diagnostics.paths')}</h4>
            </div>
            <div className="config-section-content">
              <div className="diagnostic-paths">
                <div><span>{t('library.configModal.diagnostics.installation')}</span><code>{renderValue(diagnostics.paths?.install?.path)}</code></div>
                <div><span>{t('library.configModal.diagnostics.executable')}</span><code>{renderValue(diagnostics.paths?.executable?.path)}</code></div>
                <div><span>{t('library.configModal.diagnostics.prefix')}</span><code>{renderValue(diagnostics.paths?.prefix?.path)}</code></div>
                <div><span>Proton</span><code>{renderValue(diagnostics.paths?.protonRunner?.path)}</code></div>
                <div><span>Steam root</span><code>{renderValue(diagnostics.steam?.selectedRoot)}</code></div>
              </div>
            </div>
          </div>
        </>
      ) : null}
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
  const { t } = useI18n()

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
      <div className="section-title">{t('library.configModal.lan.mode')}</div>
      <div className="lan-mode-cards">
        <button
          className={`lan-mode-card ${lanMode === 'steam' ? 'active' : ''}`}
          onClick={() => onLanModeChange('steam')}
        >
          <Globe size={24} />
          <div className="lan-mode-card-content">
            <strong>{t('library.configModal.lan.defaultMode')}</strong>
            <span>Steam/Epic/OnlineFix</span>
          </div>
        </button>
        <button
          className={`lan-mode-card ${lanMode === 'ofvpn' ? 'active' : ''}`}
          onClick={() => onLanModeChange('ofvpn')}
        >
          <Users size={24} />
          <div className="lan-mode-card-content">
            <strong>{t('library.configModal.lan.vpnMode')}</strong>
            <span>{t('library.configModal.lan.virtualLan')}</span>
          </div>
        </button>
      </div>

      {lanMode === 'steam' && (
        <div className="lan-info-box">
          <p>{t('library.configModal.lan.defaultDesc')}</p>
          <p style={{ marginTop: 8, color: '#9ca3af' }}>{t('library.configModal.lan.vpnDesc')}</p>
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
                <span>{t('library.configModal.lan.checking')}</span>
              ) : !vpnStatus?.installed ? (
                <span>{t('library.configModal.lan.wireguardNotInstalled')}</span>
              ) : vpnConnected ? (
                <span>{t('library.configModal.lan.connected')}</span>
              ) : (
                <span>{t('library.configModal.lan.ready')}</span>
              )}
            </div>
            {!vpnStatus?.installed && (
              <button className="btn small accent" onClick={onInstallVpn} disabled={vpnActionBusy}>
                {t('library.configModal.lan.install')}
              </button>
            )}
            {vpnStatus?.installed && !vpnConnected && vpnConfig && (
              <button className="btn small" onClick={onConnectVpn} disabled={vpnActionBusy}>
                {t('library.configModal.lan.connect')}
              </button>
            )}
            {vpnConnected && (
              <button className="btn small ghost" onClick={onDisconnectVpn} disabled={vpnActionBusy}>
                {t('library.configModal.lan.disconnect')}
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
                  <h4>{lanRoomName || t('library.vpn.roomFallback')}</h4>
                  <div className="vpn-room-code">
                    <code>{lanNetworkId}</code>
                    <button
                      className="copy-btn"
                      onClick={() => handleCopy(lanNetworkId, 'code')}
                      title={t('library.configModal.lan.copyCode')}
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
                  {t('library.configModal.lan.leave')}
                </button>
              </div>

              <div className="vpn-room-ips">
                <div className="vpn-ip-card">
                  <span className="vpn-ip-label">{t('library.configModal.lan.myIp')}</span>
                  <div className="vpn-ip-value">
                    <code>{vpnLocalIp || '—'}</code>
                    {vpnLocalIp && (
                      <button className="copy-btn" onClick={() => handleCopy(vpnLocalIp, 'local')} title={t('library.logs.copy')}>
                        {copiedField === 'local' ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="vpn-ip-card">
                  <span className="vpn-ip-label">{t('library.configModal.lan.hostIp')}</span>
                  <div className="vpn-ip-value">
                    <code>{vpnHostIp || '—'}</code>
                    {vpnHostIp && (
                      <button className="copy-btn" onClick={() => handleCopy(vpnHostIp, 'host')} title={t('library.logs.copy')}>
                        {copiedField === 'host' ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Peers list */}
              <div className="vpn-peers-section">
                <div className="vpn-peers-header">
                  <span>{t('library.configModal.lan.playersInRoom', { count: vpnPeers.length })}</span>
                </div>
                <div className="vpn-peers-list">
                  {vpnPeers.length === 0 ? (
                    <div className="vpn-peers-empty">{t('library.configModal.lan.loadingPlayers')}</div>
                  ) : (
                    vpnPeers.map((peer) => (
                      <div key={peer.id || peer.ip} className={`vpn-peer-item ${peer.online === false ? 'offline' : ''}`}>
                        <div className="vpn-peer-icon">
                          {peer.role === 'host' ? <Crown size={14} /> : <User size={14} />}
                        </div>
                        <div className="vpn-peer-info">
                          <span className="vpn-peer-name">{peer.name || t('library.configModal.lan.player')}</span>
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
                <span>{t('library.configModal.lan.autoconnect')}</span>
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
                    <strong>{t('library.configModal.lan.createRoom')}</strong>
                    <span>{t('library.configModal.lan.createRoomDesc')}</span>
                  </button>

                  <button
                    className="vpn-action-card"
                    onClick={() => setShowRoomBrowser(true)}
                    disabled={lanRoomBusy || vpnActionBusy || !vpnStatus?.installed}
                  >
                    <Globe size={24} />
                    <strong>{t('library.configModal.lan.browseRooms')}</strong>
                    <span>{t('library.configModal.lan.browseRoomsDesc')}</span>
                  </button>
                </div>
              )}

              {/* Create Room Form */}
              {showCreateForm && (
                <div className="vpn-create-form">
                  <div className="vpn-form-header">
                    <h4>{t('library.configModal.lan.createNewRoom')}</h4>
                    <button className="btn ghost small" onClick={() => setShowCreateForm(false)}>{t('common.cancel')}</button>
                  </div>

                  <div className="vpn-form-field">
                    <label>{t('library.configModal.lan.roomName')}</label>
                    <input
                      value={createRoomName}
                      onChange={(e) => setCreateRoomName(e.target.value)}
                      placeholder={t('library.configModal.lan.roomNamePlaceholder', { title: titleValue || t('library.configModal.lan.gameFallback') })}
                      maxLength={64}
                    />
                  </div>

                  <div className="vpn-form-field">
                    <label>{t('library.configModal.lan.password')}</label>
                    <input
                      type="password"
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder={t('library.configModal.lan.passwordPlaceholder')}
                      maxLength={32}
                    />
                  </div>

                  <div className="vpn-form-row">
                    <div className="vpn-form-field" style={{ flex: 1 }}>
                      <label>{t('library.configModal.lan.maxPlayers')}</label>
                      <select
                        value={createMaxPlayers}
                        onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
                      >
                        {[2, 4, 6, 8, 12, 16, 24, 32].map(n => (
                          <option key={n} value={n}>{t('library.configModal.lan.players', { count: n })}</option>
                        ))}
                      </select>
                    </div>

                    <label className="toggle vpn-public-toggle">
                      <input
                        type="checkbox"
                        checked={createIsPublic}
                        onChange={(e) => setCreateIsPublic(e.target.checked)}
                      />
                      <span>{t('library.configModal.lan.publicRoom')}</span>
                    </label>
                  </div>

                  <div className="vpn-form-info">
                    {createIsPublic ? (
                      <><Unlock size={14} /> {t('library.configModal.lan.publicHint')}</>
                    ) : (
                      <><Lock size={14} /> {t('library.configModal.lan.privateHint')}</>
                    )}
                  </div>

                  <button
                    className="btn accent full-width"
                    onClick={handleCreateRoom}
                    disabled={lanRoomBusy || vpnActionBusy}
                  >
                    {lanRoomBusy ? <><RefreshCw size={14} className="of-spin" /> {t('library.configModal.lan.creating')}</> : t('library.configModal.lan.createRoom')}
                  </button>
                </div>
              )}

              {/* Room Browser */}
              {showRoomBrowser && (
                <div className="vpn-room-browser">
                  <div className="vpn-form-header">
                    <h4>{t('library.configModal.lan.publicRooms')}</h4>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn ghost small" onClick={onRefreshRooms} disabled={vpnLoading}>
                        <RefreshCw size={14} className={vpnLoading ? 'of-spin' : ''} />
                      </button>
                      <button className="btn ghost small" onClick={() => setShowRoomBrowser(false)}>{t('login.close')}</button>
                    </div>
                  </div>

                  <div className="vpn-rooms-list">
                    {vpnRooms.length === 0 ? (
                      <div className="vpn-rooms-empty">
                        <Users size={32} />
                        <span>{t('library.configModal.lan.noPublicRooms')}</span>
                        <span className="vpn-rooms-empty-sub">{t('library.configModal.lan.noPublicRoomsHint')}</span>
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
                              onJoinRoom(undefined, room.code)
                            }
                          }}
                          disabled={lanRoomBusy || vpnActionBusy}
                        >
                          <div className="vpn-room-item-info">
                            <strong>{room.name}</strong>
                            <span className="vpn-room-item-host">{t('library.configModal.lan.byHost', { host: room.hostName || t('library.configModal.lan.anonymous') })}</span>
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
                    <span>{t('library.configModal.lan.joinWithCode')}</span>
                  </div>

                  <div className="vpn-join-form">
                    <input
                      value={lanRoomCode}
                      onChange={(e) => onLanRoomCodeChange(
                        e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 16)
                      )}
                      placeholder={t('library.configModal.lan.roomCodePlaceholder')}
                    />
                    {showJoinPassword && (
                      <input
                        type="password"
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        placeholder={t('library.configModal.lan.roomPassword')}
                      />
                    )}
                    <button
                      className="btn accent"
                      onClick={handleJoinRoom}
                      disabled={lanRoomBusy || vpnActionBusy || !lanRoomCode.trim() || !vpnStatus?.installed}
                    >
                      <LogIn size={14} />
                      {t('library.configModal.lan.join')}
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
