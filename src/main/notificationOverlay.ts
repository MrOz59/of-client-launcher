/**
 * Steam-style notification overlay system
 * Shows toast notifications on top of any application
 */
import { BrowserWindow, screen } from 'electron'
import { getSetting } from './db'

export type NotificationType = 
  | 'achievement'
  | 'download-complete'
  | 'download-error'
  | 'update-available'
  | 'game-ready'
  | 'cloud-sync'
  | 'info'

export interface NotificationPayload {
  type: NotificationType
  title: string
  message?: string
  icon?: string // emoji or icon name
  duration?: number // ms, default 5000
}

// Queue for notifications
const notificationQueue: NotificationPayload[] = []
let isShowingNotification = false

const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>VoidLauncher Notification</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  
  .toast {
    width: 340px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif;
    background: linear-gradient(135deg, rgba(24, 24, 28, 0.95), rgba(18, 18, 22, 0.95));
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 14px 16px;
    box-shadow: 
      0 0 0 1px rgba(0, 0, 0, 0.3),
      0 8px 32px rgba(0, 0, 0, 0.45),
      0 2px 8px rgba(0, 0, 0, 0.25);
    display: flex;
    gap: 14px;
    align-items: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  
  .icon {
    width: 48px; 
    height: 48px;
    border-radius: 12px;
    display: flex; 
    align-items: center; 
    justify-content: center;
    flex: 0 0 auto;
    font-size: 24px;
  }
  
  /* Icon backgrounds by type */
  .icon.achievement {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    box-shadow: 0 4px 12px rgba(251, 191, 36, 0.3);
  }
  .icon.download-complete {
    background: linear-gradient(135deg, #10b981, #059669);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
  .icon.download-error {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  }
  .icon.update-available {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }
  .icon.game-ready {
    background: linear-gradient(135deg, #8b5cf6, #7c3aed);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
  }
  .icon.cloud-sync {
    background: linear-gradient(135deg, #06b6d4, #0891b2);
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
  }
  .icon.info {
    background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  
  .meta { 
    display: flex; 
    flex-direction: column; 
    gap: 3px; 
    min-width: 0;
    flex: 1;
  }
  
  .kicker { 
    font-size: 10px; 
    font-weight: 700; 
    letter-spacing: .08em; 
    text-transform: uppercase; 
    color: rgba(255, 255, 255, 0.5);
  }
  
  .title { 
    font-size: 14px; 
    font-weight: 700; 
    color: rgba(255, 255, 255, 0.95); 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  
  .message { 
    font-size: 12px; 
    color: rgba(255, 255, 255, 0.7); 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  
  .progress-bar {
    position: absolute;
    bottom: 0;
    left: 16px;
    right: 16px;
    height: 2px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 1px;
    overflow: hidden;
  }
  
  .progress-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.4);
    width: 100%;
    transform-origin: left;
    animation: shrink var(--duration, 5s) linear forwards;
  }
  
  @keyframes shrink {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }
  
  .root { 
    padding: 8px; 
    margin: 0; 
    display: flex; 
    justify-content: flex-end;
  }
  
  .toast-container {
    position: relative;
  }
  
  .hidden { 
    opacity: 0; 
    transform: translateX(20px); 
  }
  .visible { 
    opacity: 1; 
    transform: translateX(0); 
  }
  .anim { 
    transition: opacity 280ms cubic-bezier(0.4, 0, 0.2, 1), 
                transform 280ms cubic-bezier(0.4, 0, 0.2, 1); 
  }
</style>
</head>
<body>
  <div class="root">
    <div id="toast" class="toast-container anim hidden">
      <div class="toast">
        <div id="icon" class="icon info">
          <span id="icon-emoji">ℹ️</span>
        </div>
        <div class="meta">
          <div id="kicker" class="kicker">VoidLauncher</div>
          <div id="title" class="title">—</div>
          <div id="message" class="message"></div>
        </div>
      </div>
      <div class="progress-bar">
        <div id="progress" class="progress-fill"></div>
      </div>
    </div>
  </div>
<script>
  const toast = document.getElementById('toast');
  const icon = document.getElementById('icon');
  const iconEmoji = document.getElementById('icon-emoji');
  const kicker = document.getElementById('kicker');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const progress = document.getElementById('progress');

  const typeConfig = {
    'achievement': { kicker: 'Conquista Desbloqueada', icon: '🏆' },
    'download-complete': { kicker: 'Download Concluído', icon: '✅' },
    'download-error': { kicker: 'Erro no Download', icon: '❌' },
    'update-available': { kicker: 'Atualização Disponível', icon: '🔄' },
    'game-ready': { kicker: 'Jogo Pronto', icon: '🎮' },
    'cloud-sync': { kicker: 'Saves Sincronizados', icon: '☁️' },
    'info': { kicker: 'VoidLauncher', icon: 'ℹ️' }
  };

  function show(payload) {
    const type = payload.type || 'info';
    const config = typeConfig[type] || typeConfig.info;
    const duration = payload.duration || 5000;
    
    // Update icon class
    icon.className = 'icon ' + type;
    iconEmoji.textContent = payload.icon || config.icon;
    
    // Update text
    kicker.textContent = config.kicker;
    title.textContent = payload.title || '';
    message.textContent = payload.message || '';
    message.style.display = payload.message ? 'block' : 'none';
    
    // Update progress animation duration
    progress.style.setProperty('--duration', duration + 'ms');
    progress.style.animation = 'none';
    progress.offsetHeight; // trigger reflow
    progress.style.animation = 'shrink ' + duration + 'ms linear forwards';
    
    // Show toast
    toast.classList.remove('hidden');
    toast.classList.add('visible');
  }

  function hide() {
    toast.classList.add('hidden');
    toast.classList.remove('visible');
  }

  window.__overlay = { show, hide };
</script>
</body>
</html>`

class NotificationOverlayManager {
  private win: BrowserWindow | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private currentNotification: NotificationPayload | null = null

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const display = screen.getPrimaryDisplay()
    const width = 380
    const height = 100

    this.win = new BrowserWindow({
      width,
      height,
      x: display.workArea.x + display.workArea.width - width - 20,
      y: display.workArea.y + 20,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false
      }
    })

    // Click-through so it doesn't interfere with user
    try {
      this.win.setIgnoreMouseEvents(true, { forward: true } as any)
    } catch {
      try {
        this.win.setIgnoreMouseEvents(true)
      } catch {}
    }

    // Maximum always-on-top level (appears over fullscreen games)
    try {
      ;(this.win as any).setAlwaysOnTop(true, 'screen-saver')
    } catch {
      this.win.setAlwaysOnTop(true)
    }

    this.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(OVERLAY_HTML))
    
    this.win.on('closed', () => {
      this.win = null
      if (this.hideTimer) {
        clearTimeout(this.hideTimer)
        this.hideTimer = null
      }
    })

    this.win.hide()
    return this.win
  }

  async show(payload: NotificationPayload): Promise<void> {
    // Check if notifications are enabled
    const enabled = getSetting('notifications_enabled') !== 'false'
    if (!enabled) return

    const win = this.ensure()
    const duration = payload.duration || 5000

    // Clear any pending hide
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    this.currentNotification = payload

    // Show window
    try {
      win.showInactive()
    } catch {
      win.show()
    }

    // Send data to renderer
    try {
      await win.webContents.executeJavaScript(
        `window.__overlay && window.__overlay.show(${JSON.stringify(payload)})`
      )
    } catch (e) {
      console.warn('[NotificationOverlay] Failed to show:', e)
    }

    // Schedule hide
    this.hideTimer = setTimeout(async () => {
      await this.hide()
      this.processQueue()
    }, duration + 300) // extra time for animation
  }

  private async hide(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return

    try {
      await this.win.webContents.executeJavaScript(
        `window.__overlay && window.__overlay.hide()`
      )
    } catch {}

    // Wait for animation
    await new Promise(r => setTimeout(r, 300))

    try {
      this.win.hide()
    } catch {}

    this.currentNotification = null
    this.hideTimer = null
  }

  private processQueue(): void {
    if (notificationQueue.length > 0 && !this.currentNotification) {
      const next = notificationQueue.shift()
      if (next) {
        isShowingNotification = true
        this.show(next).finally(() => {
          isShowingNotification = false
        })
      }
    }
  }

  destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.close()
    }
    this.win = null
  }
}

// Singleton instance
let overlayManager: NotificationOverlayManager | null = null

function getOverlayManager(): NotificationOverlayManager {
  if (!overlayManager) {
    overlayManager = new NotificationOverlayManager()
  }
  return overlayManager
}

/**
 * Show a notification overlay (Steam-style)
 */
export function showNotificationOverlay(payload: NotificationPayload): void {
  if (isShowingNotification) {
    // Queue it
    notificationQueue.push(payload)
    return
  }

  isShowingNotification = true
  getOverlayManager().show(payload).finally(() => {
    isShowingNotification = false
  })
}

// Convenience functions for specific notification types

export function notifyAchievementUnlocked(title: string, description?: string): void {
  showNotificationOverlay({
    type: 'achievement',
    title,
    message: description,
    duration: 6000
  })
}

export function notifyDownloadComplete(gameTitle: string): void {
  showNotificationOverlay({
    type: 'download-complete',
    title: gameTitle,
    message: 'Pronto para jogar!',
    duration: 5000
  })
}

export function notifyDownloadError(gameTitle: string, error?: string): void {
  showNotificationOverlay({
    type: 'download-error',
    title: gameTitle,
    message: error || 'Falha no download',
    duration: 6000
  })
}

export function notifyUpdateAvailable(gameTitle: string, version?: string): void {
  showNotificationOverlay({
    type: 'update-available',
    title: gameTitle,
    message: version ? `Nova versão: ${version}` : 'Nova versão disponível',
    duration: 5000
  })
}

export function notifyGameReady(gameTitle: string): void {
  showNotificationOverlay({
    type: 'game-ready',
    title: gameTitle,
    message: 'Extração concluída',
    duration: 4000
  })
}

export function notifyCloudSync(gameTitle: string, action: 'backup' | 'restore'): void {
  showNotificationOverlay({
    type: 'cloud-sync',
    title: gameTitle,
    message: action === 'backup' ? 'Saves sincronizados com a nuvem' : 'Saves restaurados da nuvem',
    duration: 4000
  })
}

export function notifyInfo(title: string, message?: string): void {
  showNotificationOverlay({
    type: 'info',
    title,
    message,
    duration: 4000
  })
}
