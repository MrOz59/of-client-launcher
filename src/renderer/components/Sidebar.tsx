import React from 'react'
import { Store, Library, Download, Settings, User, ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n'

type Tab = 'store' | 'library' | 'downloads' | 'settings'

interface SidebarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  isLoggedIn: boolean
  onLoginClick: () => void
  onLogoutClick?: () => void
  hasDownloadActivity?: boolean
  onProfileNavigate?: (url: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({ activeTab, onTabChange, isLoggedIn, onLoginClick, onLogoutClick, hasDownloadActivity, onProfileNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useI18n()
  const [profileName, setProfileName] = React.useState<string | null>(null)
  const [profileAvatar, setProfileAvatar] = React.useState<string | null>(null)
  const [profileUrl, setProfileUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    const fetchProfile = async () => {
      if (!isLoggedIn) {
        setProfileName(null)
        setProfileAvatar(null)
        return
      }
      try {
        const res = await window.electronAPI.getUserProfile()
        if (res.success) {
          setProfileName(res.name || null)
          const absoluteAvatar = res.avatar && res.avatar.startsWith('http')
            ? res.avatar
            : res.avatar
              ? 'https://online-fix.me' + (res.avatar.startsWith('/') ? res.avatar : '/' + res.avatar)
              : null
          setProfileAvatar(res.avatarData || absoluteAvatar)
          setProfileUrl(res.profileUrl || null)
        }
      } catch {
        // ignore
      }
    }

    fetchProfile()
  }, [isLoggedIn])
  const isCollapsed = !!collapsed
  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <h1>VoidLauncher</h1>
        <button
          className="sidebar-collapse"
          onClick={() => onToggleCollapse?.()}
          title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        <div
          className={`nav-item ${activeTab === 'store' ? 'active' : ''}`}
          onClick={() => onTabChange('store')}
          title={t('app.tabs.store')}
        >
          <Store />
          <span>{t('app.tabs.store')}</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => onTabChange('library')}
          title={t('app.tabs.library')}
        >
          <Library />
          <span>{t('app.tabs.library')}</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'downloads' ? 'active' : ''} ${hasDownloadActivity ? 'downloading' : ''}`}
          onClick={() => onTabChange('downloads')}
          title={t('app.tabs.downloads')}
        >
          <Download />
          <span>{t('app.tabs.downloads')}</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
          title={t('app.tabs.settings')}
        >
          <Settings />
          <span>{t('app.tabs.settings')}</span>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div
          className="user-info"
          onClick={() => {
            if (isLoggedIn && profileUrl) {
              if (onProfileNavigate) onProfileNavigate(profileUrl)
            } else {
              onLoginClick()
            }
          }}
          style={{ cursor: 'pointer' }}
          title={isLoggedIn ? (profileName || t('sidebar.viewProfile')) : t('sidebar.openStore')}
        >
          <div className="user-avatar">
            {profileAvatar ? (
              <img src={profileAvatar} alt={profileName || 'Avatar'} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <User size={16} />
            )}
          </div>
          <div className="user-status">
            <div className="user-status-name">
              {isLoggedIn ? (profileName || t('sidebar.connected')) : t('sidebar.disconnected')}
            </div>
            <div className="user-status-action">
              {isLoggedIn ? t('sidebar.viewProfile') : t('sidebar.openStore')}
            </div>
          </div>
        </div>

        {isLoggedIn && onLogoutClick ? (
          <button
            className="user-logout"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onLogoutClick()
            }}
            title={t('sidebar.logout')}
          >
            {t('sidebar.logout')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
