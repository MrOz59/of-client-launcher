/**
 * Game Notification Window - Steam-style notifications using Electron windows
 * 
 * This system creates transparent Electron windows that overlay games when running
 * inside Gamescope. The windows use 'screen-saver' level to appear above fullscreen games.
 * 
 * Requirements:
 * - Gamescope with -e flag (overlay support)
 * - OR running in windowed mode
 */

import { BrowserWindow, screen, app } from 'electron'
import * as path from 'path'
import type { NotificationMessage } from './overlayIPC'

interface NotificationWindow {
  window: BrowserWindow
  timeout: NodeJS.Timeout
}

class GameNotificationManager {
  private activeNotifications: NotificationWindow[] = []
  private maxNotifications = 3
  private notificationHeight = 90
  private notificationWidth = 380
  private marginRight = 20
  private marginTop = 20
  private spacing = 10
  private isGamescopeMode = false

  constructor() {
    // Check if we're running inside Gamescope
    this.isGamescopeMode = this.detectGamescope()
    console.log('[GameNotifications] Gamescope mode:', this.isGamescopeMode)
  }

  private detectGamescope(): boolean {
    // Gamescope sets GAMESCOPE_WAYLAND_DISPLAY or we're running under its nested X
    return !!(
      process.env.GAMESCOPE_WAYLAND_DISPLAY ||
      process.env.GAMESCOPE ||
      process.env.SteamDeck
    )
  }

  /**
   * Show a notification overlay on top of the game
   */
  showNotification(notification: NotificationMessage): BrowserWindow | null {
    // Remove oldest notification if at max
    if (this.activeNotifications.length >= this.maxNotifications) {
      const oldest = this.activeNotifications.shift()
      if (oldest) {
        clearTimeout(oldest.timeout)
        if (!oldest.window.isDestroyed()) {
          oldest.window.close()
        }
      }
    }

    const display = screen.getPrimaryDisplay()
    const { width: screenWidth } = display.workAreaSize

    // Calculate Y position based on existing notifications
    const yOffset = this.marginTop + 
      (this.activeNotifications.length * (this.notificationHeight + this.spacing))

    const win = new BrowserWindow({
      width: this.notificationWidth,
      height: this.notificationHeight,
      x: screenWidth - this.notificationWidth - this.marginRight,
      y: yOffset,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,        // Don't steal focus from game
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      hasShadow: false,
      type: 'toolbar',         // Utility window type for Linux
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      }
    })

    // Force window to stay on top of fullscreen apps
    win.setAlwaysOnTop(true, 'screen-saver')
    
    // Allow mouse clicks to pass through to the game
    win.setIgnoreMouseEvents(true)

    // Prevent the window from showing in alt-tab
    win.setSkipTaskbar(true)

    // Load notification HTML with data
    const htmlPath = path.join(__dirname, '..', '..', 'resources', 'notification.html')
    
    // Pass notification data via query string
    const params = new URLSearchParams({
      type: notification.type,
      title: notification.title,
      description: notification.description || '',
      icon: notification.icon || '',
      duration: String(notification.duration_ms || 5000),
    })

    win.loadFile(htmlPath, { query: Object.fromEntries(params) })
      .catch((err) => {
        console.error('[GameNotifications] Failed to load notification HTML:', err)
        // Fallback: load inline HTML
        win.loadURL(`data:text/html,${encodeURIComponent(this.generateFallbackHTML(notification))}`)
      })

    // Auto-close after duration
    const duration = notification.duration_ms || 5000
    const closeTimeout = setTimeout(() => {
      this.closeNotification(win)
    }, duration + 500) // Extra time for fade-out animation

    this.activeNotifications.push({ window: win, timeout: closeTimeout })

    console.log('[GameNotifications] Showing notification:', notification.title)
    return win
  }

  private closeNotification(win: BrowserWindow) {
    const index = this.activeNotifications.findIndex(n => n.window === win)
    if (index !== -1) {
      const notification = this.activeNotifications[index]
      clearTimeout(notification.timeout)
      this.activeNotifications.splice(index, 1)
    }

    if (!win.isDestroyed()) {
      win.close()
    }

    // Reposition remaining notifications
    this.repositionNotifications()
  }

  private repositionNotifications() {
    const display = screen.getPrimaryDisplay()
    const { width: screenWidth } = display.workAreaSize

    this.activeNotifications.forEach((notification, index) => {
      if (!notification.window.isDestroyed()) {
        const y = this.marginTop + (index * (this.notificationHeight + this.spacing))
        notification.window.setPosition(
          screenWidth - this.notificationWidth - this.marginRight,
          y
        )
      }
    })
  }

  private generateFallbackHTML(notification: NotificationMessage): string {
    const iconEmoji = this.getIconEmoji(notification.type)
    const bgColor = this.getBackgroundColor(notification.type)
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      overflow: hidden;
    }
    .notification {
      background: rgba(23, 26, 33, 0.95);
      border-left: 4px solid ${bgColor};
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      animation: slideIn 0.3s ease-out, fadeOut 0.3s ease-in ${(notification.duration_ms || 5000) - 300}ms forwards;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .icon {
      font-size: 28px;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${bgColor}33;
      border-radius: 50%;
    }
    .content { flex: 1; overflow: hidden; }
    .title {
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .description {
      color: #8b929a;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  </style>
</head>
<body>
  <div class="notification">
    <div class="icon">${iconEmoji}</div>
    <div class="content">
      <div class="title">${this.escapeHtml(notification.title)}</div>
      <div class="description">${this.escapeHtml(notification.description || '')}</div>
    </div>
  </div>
</body>
</html>`
  }

  private getIconEmoji(type: string): string {
    switch (type) {
      case 'achievement_unlocked': return '🏆'
      case 'download_complete': return '✅'
      case 'download_error': return '❌'
      case 'friend_online': return '👤'
      default: return 'ℹ️'
    }
  }

  private getBackgroundColor(type: string): string {
    switch (type) {
      case 'achievement_unlocked': return '#c7a628' // Gold
      case 'download_complete': return '#5ba32b'   // Green
      case 'download_error': return '#c94a4a'      // Red
      case 'friend_online': return '#4b88c7'       // Blue
      default: return '#66c0f4'                     // Steam blue
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * Close all active notifications
   */
  closeAll() {
    for (const notification of this.activeNotifications) {
      clearTimeout(notification.timeout)
      if (!notification.window.isDestroyed()) {
        notification.window.close()
      }
    }
    this.activeNotifications = []
  }

  /**
   * Check if running in Gamescope mode
   */
  isRunningInGamescope(): boolean {
    return this.isGamescopeMode
  }
}

// Singleton instance
let notificationManager: GameNotificationManager | null = null

export function getGameNotificationManager(): GameNotificationManager {
  if (!notificationManager) {
    notificationManager = new GameNotificationManager()
  }
  return notificationManager
}

export function showGameNotification(notification: NotificationMessage): BrowserWindow | null {
  return getGameNotificationManager().showNotification(notification)
}

export function closeAllGameNotifications() {
  getGameNotificationManager().closeAll()
}

export function isGamescopeAvailable(): boolean {
  return getGameNotificationManager().isRunningInGamescope()
}
