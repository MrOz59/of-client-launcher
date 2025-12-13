import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import StoreTab from './components/StoreTab'
import LibraryTab from './components/LibraryTab'
import DownloadsTab from './components/DownloadsTab'
import SettingsTab from './components/SettingsTab'
import './App.css'

type Tab = 'store' | 'library' | 'downloads' | 'settings'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('store')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [hasDownloadActivity, setHasDownloadActivity] = useState(false)
  const [storeTargetUrl, setStoreTargetUrl] = useState<string | null>(null)

  useEffect(() => {
    // Check if user has cookies (is logged in)
    checkLoginStatus()

    // Listen for cookie updates
    window.electronAPI.onCookiesSaved((cookies) => {
      if (cookies && cookies.length > 0) {
        setIsLoggedIn(true)
      }
    })
  }, [])

  const checkLoginStatus = async () => {
    try {
      const cookies = await window.electronAPI.exportCookies('https://online-fix.me')
      setIsLoggedIn(cookies && cookies.length > 0)
    } catch (error) {
      console.error('Failed to check login status:', error)
    }
  }

  const handleLoginClick = async () => {
    if (!isLoggedIn) {
      await window.electronAPI.openAuthWindow()
      // After login window closes, check status again
      setTimeout(checkLoginStatus, 1000)
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
        return <StoreTab isLoggedIn={isLoggedIn} targetUrl={storeTargetUrl} onTargetConsumed={() => setStoreTargetUrl(null)} />
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
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isLoggedIn={isLoggedIn}
        onLoginClick={handleLoginClick}
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
