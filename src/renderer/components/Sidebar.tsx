import React from 'react'
import { Store, Library, Download, Settings, User, ChevronLeft, ChevronRight } from 'lucide-react'

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
          title={isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          aria-label={isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        <div
          className={`nav-item ${activeTab === 'store' ? 'active' : ''}`}
          onClick={() => onTabChange('store')}
          title="Loja"
        >
          <Store />
          <span>Loja</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => onTabChange('library')}
          title="Biblioteca"
        >
          <Library />
          <span>Biblioteca</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'downloads' ? 'active' : ''} ${hasDownloadActivity ? 'downloading' : ''}`}
          onClick={() => onTabChange('downloads')}
          title="Downloads"
        >
          <Download />
          <span>Downloads</span>
        </div>

        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
          title="Configurações"
        >
          <Settings />
          <span>Configurações</span>
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
          title={isLoggedIn ? (profileName || 'Ver perfil') : 'Abrir loja'}
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
              {isLoggedIn ? (profileName || 'Conectado') : 'Desconectado'}
            </div>
            <div className="user-status-action">
              {isLoggedIn ? 'Ver perfil' : 'Abrir loja'}
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
            title="Sair"
          >
            Sair
          </button>
        ) : null}
      </div>
    </div>
  )
}
