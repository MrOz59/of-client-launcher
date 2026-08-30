import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import StoreTab from './components/StoreTab'
import LibraryTab from './components/LibraryTab'
import DownloadsTab from './components/DownloadsTab'
import SettingsTab from './components/SettingsTab'
import ToolsTab from './components/ToolsTab'
import LoginOverlay from './components/LoginOverlay'
import { useI18n } from './i18n'
import { useToast } from './components/ToastHost'
import { Download, ExternalLink, X } from 'lucide-react'
import './App.css'

type Tab = 'store' | 'library' | 'downloads' | 'tools' | 'settings'
type LauncherUpdateStatus = {
  currentVersion: string
  latestVersion?: string
  latestTag?: string
  releaseUrl?: string
  canAutoUpdate?: boolean
  updatePackage?: 'appimage' | 'manual'
  updateAvailable: boolean
}

export default function App() {
  const { t } = useI18n()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<Tab>('store')
  const [settingsDirty, setSettingsDirty] = useState(false)
  // Listeners registered once would otherwise capture a stale dirty flag.
  const canLeaveSettingsRef = useRef<(tab: Tab) => boolean>(() => true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [hasDownloadActivity, setHasDownloadActivity] = useState(false)
  const [storeTargetUrl, setStoreTargetUrl] = useState<string | null>(null)
  const [loginOverlayOpen, setLoginOverlayOpen] = useState(false)
  const [storeWebviewResetKey, setStoreWebviewResetKey] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [launcherUpdate, setLauncherUpdate] = useState<LauncherUpdateStatus | null>(null)
  const [launcherUpdateInstalling, setLauncherUpdateInstalling] = useState(false)
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem('voidlauncher.dismissedUpdateVersion')
    } catch {
      return null
    }
  })

  useEffect(() => {
    // Check if user has cookies (is logged in)
    checkLoginStatus()

    try {
      const raw = localStorage.getItem('of_sidebar_collapsed')
      if (raw != null) setSidebarCollapsed(raw === '1')
    } catch {
      // ignore
    }

    // Listen for cookie updates
    const off = window.electronAPI.onCookiesSaved((cookies) => {
      if (cookies && cookies.length > 0) {
        setIsLoggedIn(true)
      }
      // Keep renderer state in sync with persisted cookies
      checkLoginStatus()
    })

    const offCleared = window.electronAPI.onCookiesCleared(() => {
      setIsLoggedIn(false)
      setLoginOverlayOpen(false)
      setStoreTargetUrl(null)
      setStoreWebviewResetKey((k) => k + 1)
    })

    // Listen for navigation events from tray menu
    const offNavigateTab = window.electronAPI.onNavigateToTab?.((tab: string) => {
      if (tab === 'store' || tab === 'library' || tab === 'downloads' || tab === 'tools' || tab === 'settings') {
        if (!canLeaveSettingsRef.current(tab as Tab)) return
        setActiveTab(tab as Tab)
      }
    })

    const offNavigateGame = window.electronAPI.onNavigateToGame?.((gameUrl: string) => {
      setActiveTab('library')
      // Could also scroll to the game or show it somehow
    })

    return () => {
      try { off?.() } catch {}
      try { offCleared?.() } catch {}
      try { offNavigateTab?.() } catch {}
      try { offNavigateGame?.() } catch {}
    }
  }, [])

  useEffect(() => {
    let disposed = false

    async function checkLauncherUpdate() {
      try {
        const res = await window.electronAPI.getLauncherUpdateStatus(false)
        if (!disposed && res?.success && res.status) {
          setLauncherUpdate(res.status)
        }
      } catch (err) {
        console.warn('Failed to check launcher update:', err)
      }
    }

    checkLauncherUpdate()
    return () => {
      disposed = true
    }
  }, [])

  const checkLoginStatus = async () => {
    try {
      const cookies = await window.electronAPI.exportCookies('https://online-fix.me')
      setIsLoggedIn(cookies && cookies.length > 0)
    } catch (error) {
      console.error('Failed to check login status:', error)
    }
  }

  const handleLoginClick = () => {
    // Open a temporary embedded login webview; closes automatically when logged in.
    setLoginOverlayOpen(true)
  }

  const handleLogoutClick = async () => {
    try {
      await window.electronAPI.clearCookies()
    } finally {
      // Even if IPC fails, reset local UI so it doesn't look stuck.
      setIsLoggedIn(false)
      setLoginOverlayOpen(false)
      setStoreTargetUrl(null)
      try { sessionStorage.removeItem('of_store_url') } catch {}
      setStoreWebviewResetKey((k) => k + 1)
    }
  }

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('of_sidebar_collapsed', next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  const getTabTitle = (tab: Tab) => {
    switch (tab) {
      case 'store':
        return t('app.tabs.store')
      case 'library':
        return t('app.tabs.library')
      case 'downloads':
        return t('app.tabs.downloads')
      case 'tools':
        return t('app.tabs.tools')
      case 'settings':
        return t('app.tabs.settings')
      default:
        return ''
    }
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'store':
        return (
          <StoreTab
            key={`store-${storeWebviewResetKey}`}
            isLoggedIn={isLoggedIn}
            targetUrl={storeTargetUrl}
            onTargetConsumed={() => setStoreTargetUrl(null)}
          />
        )
      case 'library':
        return <LibraryTab />
      case 'tools':
        return <ToolsTab />
      case 'settings':
        return <SettingsTab onDirtyChange={setSettingsDirty} />
      default:
        return null
    }
  }

  const updateVersion = launcherUpdate?.latestVersion || launcherUpdate?.latestTag || ''
  const showUpdateBanner = Boolean(launcherUpdate?.updateAvailable && updateVersion && dismissedUpdateVersion !== updateVersion)
  const dismissUpdateBanner = () => {
    if (!updateVersion) return
    setDismissedUpdateVersion(updateVersion)
    try {
      localStorage.setItem('voidlauncher.dismissedUpdateVersion', updateVersion)
    } catch {
      // ignore
    }
  }
  const installLauncherUpdate = async () => {
    if (!launcherUpdate?.canAutoUpdate) {
      if (launcherUpdate?.releaseUrl) await window.electronAPI.openExternal(launcherUpdate.releaseUrl)
      return
    }

    setLauncherUpdateInstalling(true)
    try {
      const res = await window.electronAPI.installLauncherAppImageUpdate()
      if (!res?.success) {
        window.alert(res?.error || t('app.updateBanner.installFailed'))
        setLauncherUpdateInstalling(false)
      }
    } catch (err: any) {
      window.alert(err?.message || String(err))
      setLauncherUpdateInstalling(false)
    }
  }

  useEffect(() => {
    const off = window.electronAPI.onDownloadWarning?.((data) => {
      if (data?.code !== 'low-disk-space') return
      toast.error(t('downloads.warning.lowDiskSpace', {
        free: String(data.freeGb ?? '?'),
        threshold: String(data.thresholdGb ?? '?')
      }))
    })
    return () => { off?.() }
  }, [t, toast])

  // Leaving Settings with pending edits used to drop them without a word.
  const canLeaveSettings = useCallback((tab: Tab) => {
    if (activeTab !== 'settings' || tab === 'settings' || !settingsDirty) return true
    if (!window.confirm(t('settings.unsaved.confirmLeave'))) return false
    setSettingsDirty(false)
    return true
  }, [activeTab, settingsDirty, t])

  useEffect(() => {
    canLeaveSettingsRef.current = canLeaveSettings
  }, [canLeaveSettings])

  const handleTabChange = (tab: Tab) => {
    if (!canLeaveSettings(tab)) return
    setActiveTab(tab)
  }

  return (
    <div className="app-container">
      <LoginOverlay
        open={loginOverlayOpen && !isLoggedIn}
        onClose={() => setLoginOverlayOpen(false)}
        onLoggedIn={() => {
          setLoginOverlayOpen(false)
          setIsLoggedIn(true)
          setActiveTab('store')
          setStoreWebviewResetKey((k) => k + 1)
        }}
      />
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isLoggedIn={isLoggedIn}
        onLoginClick={handleLoginClick}
        onLogoutClick={handleLogoutClick}
        hasDownloadActivity={hasDownloadActivity}
        onProfileNavigate={(url) => { setStoreTargetUrl(url); handleTabChange('store') }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      <div className="main-content">
        <div className="content-header">
          <h2>{getTabTitle(activeTab)}</h2>
        </div>
        {showUpdateBanner && (
          <div className="launcher-update-banner">
            <div className="launcher-update-banner__main">
              <Download size={17} />
              <div>
                <strong>{t('app.updateBanner.title', { version: updateVersion.replace(/^v/i, '') })}</strong>
                <span>{t('app.updateBanner.description', { current: launcherUpdate?.currentVersion || '' })}</span>
              </div>
            </div>
            <div className="launcher-update-banner__actions">
              <button
                className="settings-btn primary sm"
                disabled={launcherUpdateInstalling || (!launcherUpdate?.canAutoUpdate && !launcherUpdate?.releaseUrl)}
                onClick={installLauncherUpdate}
              >
                {launcherUpdate?.canAutoUpdate ? <Download size={13} className={launcherUpdateInstalling ? 'of-spin' : ''} /> : <ExternalLink size={13} />}
                {launcherUpdate?.canAutoUpdate
                  ? launcherUpdateInstalling ? t('app.updateBanner.installing') : t('app.updateBanner.install')
                  : t('app.updateBanner.open')}
              </button>
              <button className="settings-btn-icon" onClick={dismissUpdateBanner} title={t('app.updateBanner.dismiss')} aria-label={t('app.updateBanner.dismiss')}>
                <X size={15} />
              </button>
            </div>
          </div>
        )}
        <div className="content-body">
          {activeTab !== 'downloads' && renderTabContent()}
          <div style={{ display: activeTab === 'downloads' ? 'block' : 'none', height: '100%' }}>
            <DownloadsTab onActivityChange={setHasDownloadActivity} />
          </div>
        </div>
      </div>
    </div>
  )
}
