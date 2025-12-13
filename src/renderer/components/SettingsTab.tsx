import React, { useState, useEffect } from 'react'
import { Folder } from 'lucide-react'

interface Settings {
  downloadPath: string
  autoExtract: boolean
  autoUpdate: boolean
  parallelDownloads: number
  useProton: boolean
  protonPath: string
}

export default function SettingsTab() {
  const [settings, setSettings] = useState<Settings>({
    downloadPath: '/home/user/Games',
    autoExtract: true,
    autoUpdate: false,
    parallelDownloads: 3,
    useProton: false,
    protonPath: ''
  })
  const [runtimes, setRuntimes] = useState<Array<{ name: string; path: string; runner: string; source: string }>>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [defaultPrefixBusy, setDefaultPrefixBusy] = useState(false)
  const [defaultPrefixPath, setDefaultPrefixPath] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
    refreshRuntimes()
  }, [])

  const loadSettings = async () => {
    try {
      const res = await window.electronAPI.getSettings()
      if (res.success && res.settings) {
        setSettings(res.settings)
      }
    } finally {
      setLoading(false)
    }
  }

  const refreshRuntimes = async () => {
    try {
      const res = await window.electronAPI.protonListRuntimes()
      if (res.success) {
        setRuntimes(res.runtimes || [])
      }
    } catch (err) {
      console.warn('Failed to list proton runtimes', err)
    }
  }

  const selectDownloadPath = async () => {
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      setSettings(prev => ({ ...prev, downloadPath: res.path || prev.downloadPath }))
    }
  }

  const selectProtonPath = async () => {
    const res = await window.electronAPI.selectDirectory()
    if (res.success && res.path) {
      setSettings(prev => ({ ...prev, protonPath: res.path || prev.protonPath, useProton: true }))
      const update = await window.electronAPI.protonSetRoot(res.path)
      if (update.success) setRuntimes(update.runtimes || [])
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res = await window.electronAPI.saveSettings(settings)
      if (!res.success) {
        alert(res.error || 'Falha ao salvar configurações')
      } else {
        if (settings.protonPath) {
          const update = await window.electronAPI.protonSetRoot(settings.protonPath)
          if (update.success) setRuntimes(update.runtimes || [])
        }
        alert('Configurações salvas')
      }
    } finally {
      setSaving(false)
    }
  }

  const recreateDefaultPrefix = async () => {
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
              value={settings.parallelDownloads}
              onChange={(e) => setSettings({ ...settings, parallelDownloads: parseInt(e.target.value) })}
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
      </div>

      <div className="settings-section">
        <h3>Compatibilidade (Linux)</h3>

        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">Usar Proton/Wine</div>
            <div className="settings-label-description">
              Executar jogos Windows usando camada de compatibilidade
            </div>
          </div>
          <div className="settings-control">
            <input
              type="checkbox"
              checked={settings.useProton}
              onChange={(e) => setSettings({ ...settings, useProton: e.target.checked })}
            />
          </div>
        </div>

        {settings.useProton && (
          <div className="settings-item">
            <div className="settings-label">
              <div className="settings-label-title">Caminho do Proton/Wine</div>
              <div className="settings-label-description">
                Executável do Proton ou Wine a ser usado
              </div>
            </div>
            <div className="settings-control" style={{ display: 'flex', gap: '8px' }}>
              <select
                value={settings.protonPath}
                onChange={(e) => setSettings({ ...settings, protonPath: e.target.value })}
                style={{ minWidth: '260px', padding: '8px', background: '#2a2a2a', color: '#fff', border: '1px solid #333', borderRadius: '6px' }}
              >
                <option value="">Auto (Proton Experimental)</option>
                {runtimes.map(rt => (
                  <option key={rt.runner} value={rt.path}>{rt.name} • {rt.path}</option>
                ))}
              </select>
              <button onClick={refreshRuntimes}>Recarregar</button>
              <button onClick={selectProtonPath}>Adicionar pasta</button>
            </div>
          </div>
        )}

        {settings.useProton && (
          <div className="settings-item">
            <div className="settings-label">
              <div className="settings-label-title">Prefixo Proton default (teste)</div>
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
        )}
      </div>

      <div className="settings-section">
        <h3>Sobre</h3>
        <div className="settings-item">
          <div className="settings-label">
            <div className="settings-label-title">OnlineFix Launcher</div>
            <div className="settings-label-description">
              Versão 0.1.0 • Protótipo em desenvolvimento
            </div>
          </div>
        </div>
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
