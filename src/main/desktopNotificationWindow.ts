import { BrowserWindow, screen } from 'electron'
import * as path from 'path'
import type { NotificationMessage } from './overlayIPC'
import { getSetting } from './db'

interface NotificationWindow {
  window: BrowserWindow
  timeout: NodeJS.Timeout
}

class DesktopNotificationManager {
  private activeNotifications: NotificationWindow[] = []
  private maxNotifications = 4
  private notificationHeight = 96
  private notificationWidth = 420
  private marginRight = 20
  private marginBottom = 24
  private spacing = 12

  showNotification(notification: NotificationMessage): BrowserWindow | null {
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
    const workArea = display.workArea

    const position = this.getPositionSetting()
    const stackOffset = (this.activeNotifications.length * (this.notificationHeight + this.spacing))
    const { anchor, offsetX, offsetY } = this.computeAnchorOffsets(position, stackOffset)

    const win = new BrowserWindow({
      width: workArea.width,
      height: workArea.height,
      x: workArea.x,
      y: workArea.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      hasShadow: false,
      type: 'toolbar',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      }
    })

    win.setAlwaysOnTop(true, 'floating')
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setSkipTaskbar(true)

    try {
      win.setBounds({
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height
      }, false)
    } catch {
      // ignore
    }

    win.once('ready-to-show', () => {
      try {
        win.setBounds({
          x: workArea.x,
          y: workArea.y,
          width: workArea.width,
          height: workArea.height
        }, false)
      } catch {
        // ignore
      }
    })

    const htmlPath = path.join(__dirname, '..', '..', 'resources', 'notification.html')
    const params = new URLSearchParams({
      type: notification.type,
      title: notification.title,
      description: notification.description || '',
      icon: notification.icon || '',
      duration: String(notification.duration_ms || 5000),
      mode: 'desktop',
      anchor,
      offsetX: String(offsetX),
      offsetY: String(offsetY),
      width: String(this.notificationWidth),
      height: String(this.notificationHeight)
    })

    win.loadFile(htmlPath, { query: Object.fromEntries(params) })
      .catch((err) => {
        console.error('[DesktopNotifications] Failed to load notification HTML:', err)
      })

    const duration = notification.duration_ms || 5000
    const closeTimeout = setTimeout(() => {
      this.closeNotification(win)
    }, duration + 500)

    this.activeNotifications.push({ window: win, timeout: closeTimeout })
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

    this.repositionNotifications()
  }

  private repositionNotifications() {
    const display = screen.getPrimaryDisplay()
    const workArea = display.workArea

    const position = this.getPositionSetting()

    this.activeNotifications.forEach((notification, index) => {
      if (!notification.window.isDestroyed()) {
        const stackOffset = index * (this.notificationHeight + this.spacing)
        const { anchor, offsetX, offsetY } = this.computeAnchorOffsets(position, stackOffset)
        try {
          notification.window.webContents.executeJavaScript(
            `window.__setAnchorOffset && window.__setAnchorOffset(${JSON.stringify(anchor)}, ${Number(offsetX)}, ${Number(offsetY)});`
          )
        } catch {
          // ignore
        }
        try {
          notification.window.setBounds({
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height
          }, false)
        } catch {
          // ignore
        }
      }
    })
  }

  private computeAnchorOffsets(position: string, stackOffset: number) {
    const isTop = position.startsWith('top')
    const isLeft = position.endsWith('left')
    const anchor = `${isTop ? 'top' : 'bottom'}-${isLeft ? 'left' : 'right'}` as const
    const offsetX = this.marginRight
    const offsetY = this.marginBottom + stackOffset
    return { anchor, offsetX, offsetY }
  }

  private getPositionSetting(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const raw = String(getSetting('notification_position') || 'bottom-right').trim().toLowerCase()
    if (raw === 'top-left' || raw === 'top-right' || raw === 'bottom-left' || raw === 'bottom-right') {
      return raw
    }
    return 'bottom-right'
  }

  closeAll() {
    this.activeNotifications.forEach(({ window, timeout }) => {
      clearTimeout(timeout)
      if (!window.isDestroyed()) window.close()
    })
    this.activeNotifications = []
  }
}

let desktopManager: DesktopNotificationManager | null = null

export function getDesktopNotificationManager(): DesktopNotificationManager {
  if (!desktopManager) desktopManager = new DesktopNotificationManager()
  return desktopManager
}

export function showDesktopOverlayNotification(notification: NotificationMessage): BrowserWindow | null {
  return getDesktopNotificationManager().showNotification(notification)
}

export function closeAllDesktopNotifications() {
  getDesktopNotificationManager().closeAll()
}
