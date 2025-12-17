import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import StoreTab from './components/StoreTab'
import LibraryTab from './components/LibraryTab'
import DownloadsTab from './components/DownloadsTab'
import SettingsTab from './components/SettingsTab'
import LoginOverlay from './components/LoginOverlay'
import './App.css'

type Tab = 'store' | 'library' | 'downloads' | 'settings'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('store')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [hasDownloadActivity, setHasDownloadActivity] = useState(false)
  const [storeTargetUrl, setStoreTargetUrl] = useState<string | null>(null)
  const [loginOverlayOpen, setLoginOverlayOpen] = useState(false)
  const [storeWebviewResetKey, setStoreWebviewResetKey] = useState(0)

  useEffect(() => {
    // Check if user has cookies (is logged in)
    checkLoginStatus()

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

    return () => {
      try { off?.() } catch {}
      try { offCleared?.() } catch {}
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

  const getTabTitle = (tab: Tab) => {
    switch (tab) {
      case 'store':
        return 'Loja'
      case 'library':
        return 'Biblioteca'
      case 'downloads':
        return 'Downloads'
      case 'settings':
        return 'Configurações'
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
      case 'settings':
        return <SettingsTab />
      default:
        return null
    }
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
        onTabChange={setActiveTab}
        isLoggedIn={isLoggedIn}
        onLoginClick={handleLoginClick}
        onLogoutClick={handleLogoutClick}
        hasDownloadActivity={hasDownloadActivity}
        onProfileNavigate={(url) => { setStoreTargetUrl(url); setActiveTab('store') }}
      />

      <div className="main-content">
        <div className="content-header">
          <h2>{getTabTitle(activeTab)}</h2>
        </div>
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
