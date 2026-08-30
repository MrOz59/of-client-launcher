/**
 * Electron fallback toasts.
 *
 * These are only used when the void-toast binary is unavailable (or when the
 * game runs under Gamescope, where a nested X server needs the overlay to come
 * from Electron itself). Two nearly identical managers used to live in separate
 * files; the window plumbing is shared here and only the layout differs:
 *
 *   game    - a small window parked in the top-right corner, moved as the stack
 *             changes, stacked above fullscreen games.
 *   desktop - one work-area sized transparent window per toast; the page anchors
 *             the card itself, so restacking is a message to the page.
 */

import { BrowserWindow, screen, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { NotificationMessage } from './overlayIPC'

type ToastLayout = 'game' | 'desktop'

type ToastPreset = {
  layout: ToastLayout
  maxNotifications: number
  width: number
  height: number
  marginRight: number
  marginVertical: number
  spacing: number
  alwaysOnTopLevel: 'screen-saver' | 'floating'
  forwardMouse: boolean
}

const GAME_PRESET: ToastPreset = {
  layout: 'game',
  maxNotifications: 3,
  width: 380,
  height: 90,
  marginRight: 20,
  marginVertical: 20,
  spacing: 10,
  alwaysOnTopLevel: 'screen-saver',
  forwardMouse: false
}

const DESKTOP_PRESET: ToastPreset = {
  layout: 'desktop',
  maxNotifications: 4,
  width: 420,
  height: 96,
  marginRight: 20,
  marginVertical: 24,
  spacing: 12,
  alwaysOnTopLevel: 'floating',
  forwardMouse: true
}

type ActiveToast = {
  window: BrowserWindow
  timeout: NodeJS.Timeout
}

let cachedHtmlPath: string | null | undefined

/**
 * The page ships as an extra resource in packaged builds and sits in the repo
 * during development, so try both before giving up.
 */
function resolveNotificationHtml(): string | null {
  if (cachedHtmlPath !== undefined) return cachedHtmlPath

  const candidates = [
    path.join(process.resourcesPath || '', 'notification.html'),
    path.join(app.getAppPath(), 'resources', 'notification.html'),
    path.join(__dirname, '..', '..', 'resources', 'notification.html'),
    path.join(process.cwd(), 'resources', 'notification.html')
  ]

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        cachedHtmlPath = candidate
        return cachedHtmlPath
      }
    } catch {
      // Try the next candidate.
    }
  }

  console.warn('[Toasts] notification.html not found; using the inline fallback')
  cachedHtmlPath = null
  return null
}

function accentFor(type: string): string {
  switch (type) {
    case 'achievement_unlocked': return '#c7a628'
    case 'download_complete': return '#5ba32b'
    case 'download_error': return '#c94a4a'
    case 'friend_online': return '#4b88c7'
    default: return '#66c0f4'
  }
}

function iconFor(type: string): string {
  switch (type) {
    case 'achievement_unlocked': return '🏆'
    case 'download_complete': return '✅'
    case 'download_error': return '❌'
    case 'friend_online': return '👤'
    default: return 'ℹ️'
  }
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Last resort when the packaged page is missing: same shape, no animations. */
function fallbackHtml(notification: NotificationMessage): string {
  const accent = accentFor(notification.type)
  return `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:transparent;overflow:hidden}
    .toast{background:rgba(23,26,33,.95);border-left:4px solid ${accent};border-radius:8px;padding:16px;
      display:flex;align-items:center;gap:14px}
    .icon{font-size:28px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;
      background:${accent}33;border-radius:50%}
    .content{flex:1;overflow:hidden}
    .title{color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .description{color:#8b929a;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style>
  <div class="toast">
    <div class="icon">${iconFor(notification.type)}</div>
    <div class="content">
      <div class="title">${escapeHtml(notification.title)}</div>
      <div class="description">${escapeHtml(notification.description || '')}</div>
    </div>
  </div>`
}

class ToastWindowManager {
  private active: ActiveToast[] = []

  constructor(private preset: ToastPreset) {}

  show(notification: NotificationMessage): BrowserWindow | null {
    if (this.active.length >= this.preset.maxNotifications) {
      const oldest = this.active.shift()
      if (oldest) {
        clearTimeout(oldest.timeout)
        if (!oldest.window.isDestroyed()) oldest.window.close()
      }
    }

    const workArea = screen.getPrimaryDisplay().workArea
    const stackOffset = this.active.length * (this.preset.height + this.preset.spacing)
    const bounds = this.boundsFor(workArea, stackOffset)

    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false,        // Never take focus away from the game
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      hasShadow: false,
      show: false,             // Never map the window focused
      type: 'notification',    // Stacks above fullscreen games without activating
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    win.setAlwaysOnTop(true, this.preset.alwaysOnTopLevel)
    win.setIgnoreMouseEvents(true, this.preset.forwardMouse ? { forward: true } : undefined)
    win.setSkipTaskbar(true)

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      // showInactive() keeps the focus where it is; show() would steal it.
      win.showInactive()
    })

    this.load(win, notification, stackOffset)

    const duration = notification.duration_ms || 5000
    const timeout = setTimeout(() => this.close(win), duration + 500)
    this.active.push({ window: win, timeout })

    console.log(`[Toasts] Showing ${this.preset.layout} notification:`, notification.title)
    return win
  }

  private boundsFor(workArea: Electron.Rectangle, stackOffset: number) {
    if (this.preset.layout === 'desktop') {
      return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }
    }

    return {
      x: workArea.x + workArea.width - this.preset.width - this.preset.marginRight,
      y: workArea.y + this.preset.marginVertical + stackOffset,
      width: this.preset.width,
      height: this.preset.height
    }
  }

  private load(win: BrowserWindow, notification: NotificationMessage, stackOffset: number) {
    const htmlPath = resolveNotificationHtml()
    if (!htmlPath) {
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml(notification))}`)
        .catch((err) => console.error('[Toasts] Failed to load inline fallback:', err))
      return
    }

    const query: Record<string, string> = {
      type: notification.type,
      title: notification.title,
      description: notification.description || '',
      icon: notification.icon || '',
      duration: String(notification.duration_ms || 5000)
    }

    if (this.preset.layout === 'desktop') {
      Object.assign(query, {
        mode: 'desktop',
        anchor: 'bottom-right',
        offsetX: String(this.preset.marginRight),
        offsetY: String(this.preset.marginVertical + stackOffset),
        width: String(this.preset.width),
        height: String(this.preset.height)
      })
    }

    win.loadFile(htmlPath, { query }).catch((err) => {
      console.error('[Toasts] Failed to load notification page:', err)
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml(notification))}`)
        .catch(() => {})
    })
  }

  private close(win: BrowserWindow) {
    const index = this.active.findIndex((entry) => entry.window === win)
    if (index !== -1) {
      clearTimeout(this.active[index].timeout)
      this.active.splice(index, 1)
    }

    if (!win.isDestroyed()) win.close()
    this.restack()
  }

  private restack() {
    const workArea = screen.getPrimaryDisplay().workArea

    this.active.forEach((entry, index) => {
      if (entry.window.isDestroyed()) return
      const stackOffset = index * (this.preset.height + this.preset.spacing)

      if (this.preset.layout === 'desktop') {
        const offsetY = this.preset.marginVertical + stackOffset
        try {
          entry.window.webContents.executeJavaScript(
            `window.__setAnchorOffset && window.__setAnchorOffset("bottom-right", ${this.preset.marginRight}, ${offsetY});`
          )
        } catch {
          // The page may not be ready; the next toast will restack it.
        }
      }

      try {
        entry.window.setBounds(this.boundsFor(workArea, stackOffset), false)
      } catch (err) {
        console.warn('[Toasts] Failed to restack notification:', err)
      }
    })
  }

  closeAll() {
    for (const { window, timeout } of this.active) {
      clearTimeout(timeout)
      if (!window.isDestroyed()) window.close()
    }
    this.active = []
  }
}

let gameManager: ToastWindowManager | null = null
let desktopManager: ToastWindowManager | null = null

/** Gamescope nests its own X server, so the overlay has to come from Electron. */
export function isGamescopeAvailable(): boolean {
  return !!(process.env.GAMESCOPE_WAYLAND_DISPLAY || process.env.GAMESCOPE || process.env.SteamDeck)
}

export function showGameNotification(notification: NotificationMessage): BrowserWindow | null {
  if (!gameManager) gameManager = new ToastWindowManager(GAME_PRESET)
  return gameManager.show(notification)
}

export function closeAllGameNotifications() {
  gameManager?.closeAll()
}

export function showDesktopOverlayNotification(notification: NotificationMessage): BrowserWindow | null {
  if (!desktopManager) desktopManager = new ToastWindowManager(DESKTOP_PRESET)
  return desktopManager.show(notification)
}

export function closeAllDesktopNotifications() {
  desktopManager?.closeAll()
}
