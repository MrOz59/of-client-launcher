/**
 * Advanced Notification Overlay System
 * 
 * Features:
 * - Multiple simultaneous notifications (stacked)
 * - Fully customizable appearance (colors, gradients, icons)
 * - Configurable position, duration, animations
 * - Built-in notification types with presets
 * - Progress notifications with live updates
 * - Action buttons support
 * - Grouped notifications
 * - Priority levels with visual indicators
 * - Easy to create new notification types
 */

import { BrowserWindow, screen } from 'electron';
import { getSetting } from './db';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type NotificationType =
  | 'achievement'
  | 'download-complete'
  | 'download-error'
  | 'download-progress'
  | 'update-available'
  | 'game-ready'
  | 'cloud-sync'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'custom';

export type NotificationPosition =
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right';

export type NotificationAnimation =
  | 'slide'
  | 'fade'
  | 'scale'
  | 'bounce';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationAction {
  id: string;
  label: string;
  primary?: boolean;
  destructive?: boolean;
}

export interface NotificationStyle {
  // Background
  background?: string;
  borderColor?: string;
  borderRadius?: number;
  
  // Icon
  icon?: string; // Emoji or text
  iconBackground?: string;
  iconColor?: string;
  iconBorderRadius?: number;
  
  // Text
  titleColor?: string;
  messageColor?: string;
  
  // Progress
  progressBackground?: string;
  progressColor?: string;
  
  // Glow effect for priority
  glowColor?: string;
}

export interface NotificationPayload {
  // Required
  type: NotificationType;
  title: string;
  
  // Optional content
  message?: string;
  
  // Custom styling (overrides type preset)
  style?: NotificationStyle;
  
  // Behavior
  duration?: number; // ms, 0 = persistent
  dismissible?: boolean; // Show X button
  
  // Progress (for download-progress type)
  progress?: number; // 0-100
  
  // Actions
  actions?: NotificationAction[];
  
  // Metadata
  id?: string; // For updates
  group?: string; // Group related notifications
  priority?: NotificationPriority;
  
  // Image (game cover, etc)
  imageUrl?: string;
  
  // Sound
  sound?: boolean;
}

export interface NotificationConfig {
  position: NotificationPosition;
  maxVisible: number;
  defaultDuration: number;
  animation: NotificationAnimation;
  animationDuration: number;
  spacing: number;
  width: number;
  notificationHeight: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: NotificationConfig = {
  position: 'top-center',
  maxVisible: 5,
  defaultDuration: 5000,
  animation: 'slide',
  animationDuration: 300,
  spacing: 12,
  width: 380,
  notificationHeight: 85
};

// ============================================================================
// TYPE PRESETS - Easy to add new notification types
// ============================================================================

const TYPE_PRESETS: Record<NotificationType, NotificationStyle> = {
  achievement: {
    icon: '🏆',
    iconBackground: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
    borderColor: 'rgba(251, 191, 36, 0.4)',
    glowColor: 'rgba(251, 191, 36, 0.15)'
  },
  'download-complete': {
    icon: '✓',
    iconBackground: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    glowColor: 'rgba(16, 185, 129, 0.15)'
  },
  'download-error': {
    icon: '✕',
    iconBackground: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
    glowColor: 'rgba(239, 68, 68, 0.15)'
  },
  'download-progress': {
    icon: '⬇',
    iconBackground: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    borderColor: 'rgba(59, 130, 246, 0.4)',
    progressColor: 'linear-gradient(90deg, #3b82f6, #8b5cf6)'
  },
  'update-available': {
    icon: '🔄',
    iconBackground: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    borderColor: 'rgba(59, 130, 246, 0.4)'
  },
  'game-ready': {
    icon: '🎮',
    iconBackground: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
    glowColor: 'rgba(139, 92, 246, 0.15)'
  },
  'cloud-sync': {
    icon: '☁',
    iconBackground: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    borderColor: 'rgba(6, 182, 212, 0.4)'
  },
  info: {
    icon: 'ℹ',
    iconBackground: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
    borderColor: 'rgba(107, 114, 128, 0.3)'
  },
  success: {
    icon: '✓',
    iconBackground: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    borderColor: 'rgba(16, 185, 129, 0.4)'
  },
  warning: {
    icon: '⚠',
    iconBackground: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    borderColor: 'rgba(245, 158, 11, 0.4)'
  },
  error: {
    icon: '✕',
    iconBackground: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    borderColor: 'rgba(239, 68, 68, 0.4)'
  },
  custom: {
    icon: '📢',
    iconBackground: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
    borderColor: 'rgba(255, 255, 255, 0.1)'
  }
};

// Default durations per type
const TYPE_DURATIONS: Record<NotificationType, number> = {
  achievement: 6000,
  'download-complete': 5000,
  'download-error': 7000,
  'download-progress': 0, // Persistent
  'update-available': 5000,
  'game-ready': 4000,
  'cloud-sync': 4000,
  info: 4000,
  success: 4000,
  warning: 5000,
  error: 6000,
  custom: 5000
};

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface ActiveNotification {
  id: string;
  payload: NotificationPayload;
  timeout?: NodeJS.Timeout;
  createdAt: number;
}

// ============================================================================
// HTML & STYLES GENERATOR
// ============================================================================

function generateStyles(config: NotificationConfig): string {
  return `
    :root {
      --animation-duration: ${config.animationDuration}ms;
      --spacing: ${config.spacing}px;
      --width: ${config.width}px;
      --notification-height: ${config.notificationHeight}px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      background: transparent;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, sans-serif;
      -webkit-font-smoothing: antialiased;
      width: 100%;
      height: 100%;
    }

    #container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--spacing);
      gap: var(--spacing);
    }

    /* Base notification styles */
    .notification {
      width: var(--width);
      min-height: var(--notification-height);
      background: linear-gradient(135deg, rgba(28, 28, 32, 0.98) 0%, rgba(18, 18, 22, 0.98) 100%);
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      gap: 14px;
      align-items: flex-start;
      box-shadow: 
        0 0 0 1px rgba(0, 0, 0, 0.3),
        0 8px 32px rgba(0, 0, 0, 0.5),
        0 2px 8px rgba(0, 0, 0, 0.25);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      position: relative;
      overflow: hidden;
      pointer-events: auto;
    }

    /* Glow effect for special notifications */
    .notification.has-glow {
      box-shadow: 
        0 0 0 1px rgba(0, 0, 0, 0.3),
        0 0 30px var(--glow-color, transparent),
        0 8px 32px rgba(0, 0, 0, 0.5);
    }

    /* Priority styles */
    .notification.priority-critical {
      box-shadow: 
        0 0 0 1px rgba(239, 68, 68, 0.3),
        0 0 40px rgba(239, 68, 68, 0.25),
        0 8px 32px rgba(0, 0, 0, 0.5);
      animation: pulse 2s ease-in-out infinite;
    }

    .notification.priority-high {
      box-shadow: 
        0 0 0 1px rgba(245, 158, 11, 0.2),
        0 0 20px rgba(245, 158, 11, 0.15),
        0 8px 32px rgba(0, 0, 0, 0.5);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }

    /* Animations */
    .notification.entering { animation: slideIn var(--animation-duration) cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
    .notification.exiting { animation: slideOut var(--animation-duration) cubic-bezier(0.4, 0, 0.2, 1) forwards; }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-30px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes slideOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(-20px) scale(0.95); }
    }

    /* Icon container */
    .notification-icon {
      width: 50px;
      height: 50px;
      border-radius: var(--icon-radius, 12px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
      background: var(--icon-bg, linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05)));
      color: var(--icon-color, #fff);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    /* Game image (alternative to icon) */
    .notification-image {
      width: 50px;
      height: 50px;
      border-radius: 10px;
      object-fit: cover;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    /* Content area */
    .notification-content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .notification-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .notification-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--title-color, rgba(255, 255, 255, 0.95));
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notification-message {
      font-size: 12.5px;
      color: var(--message-color, rgba(255, 255, 255, 0.7));
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    /* Close button */
    .notification-close {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .notification-close:hover {
      background: rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.9);
    }

    /* Progress bar */
    .notification-progress-container {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 0 0 14px 14px;
      overflow: hidden;
    }

    .notification-progress-bar {
      height: 100%;
      background: var(--progress-color, linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.6)));
      transition: width 0.2s ease;
      border-radius: 0 3px 3px 0;
    }

    .notification-progress-timer {
      height: 100%;
      background: rgba(255, 255, 255, 0.25);
      animation: shrink var(--duration) linear forwards;
    }

    @keyframes shrink {
      from { width: 100%; }
      to { width: 0%; }
    }

    /* Action buttons */
    .notification-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .notification-action {
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.85);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .notification-action:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .notification-action.primary {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9));
      border-color: rgba(59, 130, 246, 0.5);
    }

    .notification-action.primary:hover {
      background: linear-gradient(135deg, rgba(59, 130, 246, 1), rgba(37, 99, 235, 1));
    }

    .notification-action.destructive {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(239, 68, 68);
    }

    .notification-action.destructive:hover {
      background: rgba(239, 68, 68, 0.25);
    }
  `;
}

function generateHTML(config: NotificationConfig): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https: http:;">
  <style>${generateStyles(config)}</style>
</head>
<body>
  <div id="container"></div>
  <script>
    const container = document.getElementById('container');
    const notifications = new Map();
    const ANIMATION_DURATION = ${config.animationDuration};

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function createNotificationElement(data) {
      const { id, title, message, style, duration, progress, actions, dismissible, priority, imageUrl } = data;
      
      const el = document.createElement('div');
      el.className = 'notification entering';
      el.dataset.id = id;
      
      // Add priority class
      if (priority && priority !== 'normal') {
        el.classList.add('priority-' + priority);
      }
      
      // Apply custom styles via CSS variables
      if (style) {
        if (style.borderColor) el.style.setProperty('--border-color', style.borderColor);
        if (style.iconBackground) el.style.setProperty('--icon-bg', style.iconBackground);
        if (style.iconColor) el.style.setProperty('--icon-color', style.iconColor);
        if (style.iconBorderRadius) el.style.setProperty('--icon-radius', style.iconBorderRadius + 'px');
        if (style.titleColor) el.style.setProperty('--title-color', style.titleColor);
        if (style.messageColor) el.style.setProperty('--message-color', style.messageColor);
        if (style.progressColor) el.style.setProperty('--progress-color', style.progressColor);
        if (style.glowColor) {
          el.classList.add('has-glow');
          el.style.setProperty('--glow-color', style.glowColor);
        }
      }
      
      if (duration > 0) {
        el.style.setProperty('--duration', duration + 'ms');
      }
      
      let html = '';
      
      // Icon or image
      if (imageUrl) {
        html += '<img class="notification-image" src="' + escapeHtml(imageUrl) + '" alt="" onerror="this.style.display=\\'none\\'" />';
      } else {
        const icon = style?.icon || '📢';
        html += '<div class="notification-icon">' + icon + '</div>';
      }
      
      // Content
      html += '<div class="notification-content">';
      html += '<div class="notification-header">';
      html += '<div class="notification-title">' + escapeHtml(title) + '</div>';
      if (dismissible !== false) {
        html += '<button class="notification-close" onclick="dismissNotification(\\'' + id + '\\')">✕</button>';
      }
      html += '</div>';
      
      if (message) {
        html += '<div class="notification-message">' + escapeHtml(message) + '</div>';
      }
      
      // Actions
      if (actions && actions.length > 0) {
        html += '<div class="notification-actions">';
        actions.forEach(function(action) {
          let cls = 'notification-action';
          if (action.primary) cls += ' primary';
          if (action.destructive) cls += ' destructive';
          html += '<button class="' + cls + '" onclick="handleAction(\\'' + id + '\\', \\'' + action.id + '\\')">' + escapeHtml(action.label) + '</button>';
        });
        html += '</div>';
      }
      
      html += '</div>'; // end content
      
      // Progress bar
      if (typeof progress === 'number') {
        html += '<div class="notification-progress-container"><div class="notification-progress-bar" style="width:' + progress + '%"></div></div>';
      } else if (duration > 0) {
        html += '<div class="notification-progress-container"><div class="notification-progress-timer"></div></div>';
      }
      
      el.innerHTML = html;
      
      // Remove entering class after animation
      setTimeout(function() { el.classList.remove('entering'); }, ANIMATION_DURATION);
      
      return el;
    }

    function addNotification(data) {
      const el = createNotificationElement(data);
      container.insertBefore(el, container.firstChild);
      notifications.set(data.id, { el: el, data: data });
    }

    function updateNotification(data) {
      const existing = notifications.get(data.id);
      if (!existing) {
        addNotification(data);
        return;
      }
      
      // Update text content
      const titleEl = existing.el.querySelector('.notification-title');
      const messageEl = existing.el.querySelector('.notification-message');
      const progressBar = existing.el.querySelector('.notification-progress-bar');
      
      if (titleEl && data.title) titleEl.textContent = data.title;
      if (messageEl && data.message !== undefined) messageEl.textContent = data.message;
      if (progressBar && typeof data.progress === 'number') {
        progressBar.style.width = data.progress + '%';
      }
      
      existing.data = Object.assign({}, existing.data, data);
    }

    function removeNotification(id) {
      const existing = notifications.get(id);
      if (!existing) return;
      
      existing.el.classList.add('exiting');
      setTimeout(function() {
        if (existing.el.parentNode) {
          existing.el.remove();
        }
        notifications.delete(id);
      }, ANIMATION_DURATION);
    }

    function dismissNotification(id) {
      if (window.notificationBridge) {
        window.notificationBridge.onDismiss(id);
      }
    }

    function handleAction(notificationId, actionId) {
      if (window.notificationBridge) {
        window.notificationBridge.onAction(notificationId, actionId);
      }
    }

    // Bridge object for main process communication
    window.notificationBridge = {
      add: addNotification,
      update: updateNotification,
      remove: removeNotification,
      onDismiss: function(id) { console.log(JSON.stringify({ type: 'dismiss', id: id })); },
      onAction: function(nid, aid) { console.log(JSON.stringify({ type: 'action', notificationId: nid, actionId: aid })); }
    };
  </script>
</body>
</html>`;
}

// ============================================================================
// NOTIFICATION MANAGER CLASS
// ============================================================================

// Detect if running on Wayland
const isWayland = process.platform === 'linux' && (
  process.env.XDG_SESSION_TYPE === 'wayland' ||
  process.env.WAYLAND_DISPLAY !== undefined
);

class NotificationOverlayManager {
  private window: BrowserWindow | null = null;
  private notifications: Map<string, ActiveNotification> = new Map();
  private config: NotificationConfig = { ...DEFAULT_CONFIG };
  private idCounter = 0;
  private actionCallbacks: Map<string, (actionId: string) => void> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Configure the notification system
   */
  configure(options: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...options };
    // Recreate window if it exists to apply new config
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      this.window = null;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Window Management
  // -------------------------------------------------------------------------

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    const display = screen.getPrimaryDisplay();
    const { workArea } = display;

    const windowHeight =
      (this.config.notificationHeight + this.config.spacing) * this.config.maxVisible +
      this.config.spacing * 2;
    const windowWidth = this.config.width + this.config.spacing * 2;

    // Calculate position based on config
    let x: number, y: number;

    switch (this.config.position) {
      case 'top-left':
        x = workArea.x + 20;
        y = workArea.y + 20;
        break;
      case 'top-right':
        x = workArea.x + workArea.width - windowWidth - 20;
        y = workArea.y + 20;
        break;
      case 'top-center':
        x = workArea.x + Math.floor((workArea.width - windowWidth) / 2);
        y = workArea.y + 20;
        break;
      case 'bottom-left':
        x = workArea.x + 20;
        y = workArea.y + workArea.height - windowHeight - 20;
        break;
      case 'bottom-right':
        x = workArea.x + workArea.width - windowWidth - 20;
        y = workArea.y + workArea.height - windowHeight - 20;
        break;
      case 'bottom-center':
        x = workArea.x + Math.floor((workArea.width - windowWidth) / 2);
        y = workArea.y + workArea.height - windowHeight - 20;
        break;
      default:
        x = workArea.x + Math.floor((workArea.width - windowWidth) / 2);
        y = workArea.y + 20;
    }

    // Determine window type based on platform
    // 'notification' type is specifically for notification windows
    // 'dock' is a fallback for Linux that stays above other windows
    let windowType: string | undefined;
    if (process.platform === 'linux') {
      // Try 'notification' first, then 'dock' as fallback
      windowType = 'notification';
    }

    this.window = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      type: windowType as any,
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false
      }
    });

    // Click-through support - enable mouse events only on notification elements
    try {
      this.window.setIgnoreMouseEvents(true, { forward: true } as any);
    } catch {
      try {
        this.window.setIgnoreMouseEvents(true);
      } catch {}
    }

    // Maximum always-on-top level - try multiple approaches
    // Level priority: screen-saver > pop-up-menu > floating > normal
    const topLevels = ['screen-saver', 'pop-up-menu', 'floating', 'dock', 'status'] as const;
    let setTopSuccess = false;
    
    for (const level of topLevels) {
      if (setTopSuccess) break;
      try {
        (this.window as any).setAlwaysOnTop(true, level);
        setTopSuccess = true;
      } catch {}
    }
    
    if (!setTopSuccess) {
      try {
        this.window.setAlwaysOnTop(true);
      } catch {}
    }

    // Visible on all workspaces (Linux/macOS)
    try {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}

    // On Linux, try to set window hints for staying on top
    if (process.platform === 'linux') {
      try {
        // Skip pager and taskbar
        (this.window as any).setSkipTaskbar?.(true);
      } catch {}
    }

    const html = generateHTML(this.config);
    this.window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    this.window.on('closed', () => {
      this.window = null;
      this.stopRefreshInterval();
    });

    // Handle messages from the notification window
    this.window.webContents.on('console-message', (_e, _level, message) => {
      try {
        if (message.startsWith('{')) {
          const data = JSON.parse(message);
          if (data.type === 'dismiss') {
            this.dismiss(data.id);
          } else if (data.type === 'action') {
            const callback = this.actionCallbacks.get(data.notificationId);
            if (callback) {
              callback(data.actionId);
              // Auto-dismiss after action
              this.dismiss(data.notificationId);
            }
          }
        }
      } catch {}
    });

    this.window.hide();
    return this.window;
  }

  /**
   * Start interval to keep window on top (needed for Wayland/some compositors)
   */
  private startRefreshInterval(): void {
    if (this.refreshInterval) return;
    
    // On Wayland, we need to periodically re-assert the window is on top
    if (isWayland) {
      this.refreshInterval = setInterval(() => {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible() && this.notifications.size > 0) {
          this.bringToTop();
        }
      }, 500); // Every 500ms
    }
  }

  /**
   * Stop the refresh interval
   */
  private stopRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Show a notification
   * @returns The notification ID
   */
  show(payload: NotificationPayload, onAction?: (actionId: string) => void): string {
    // Check if notifications are enabled
    try {
      const enabled = getSetting('notifications_enabled');
      if (enabled === 'false') return '';
    } catch {}

    const win = this.ensureWindow();

    // Generate ID if not provided
    const id = payload.id || `notif_${++this.idCounter}_${Date.now()}`;

    // Merge with type preset
    const preset = TYPE_PRESETS[payload.type] || TYPE_PRESETS.custom;
    const duration = payload.duration ?? TYPE_DURATIONS[payload.type] ?? this.config.defaultDuration;

    const mergedStyle: NotificationStyle = {
      ...preset,
      ...payload.style
    };

    // Check if updating existing notification
    const existing = this.notifications.get(id);
    if (existing) {
      if (existing.timeout) clearTimeout(existing.timeout);
      existing.payload = payload;

      win.webContents
        .executeJavaScript(
          `window.notificationBridge.update(${JSON.stringify({
            id,
            title: payload.title,
            message: payload.message,
            style: mergedStyle,
            duration,
            progress: payload.progress,
            actions: payload.actions,
            dismissible: payload.dismissible,
            priority: payload.priority,
            imageUrl: payload.imageUrl
          })})`
        )
        .catch(() => {});

      // Reset timeout if duration > 0
      if (duration > 0) {
        existing.timeout = setTimeout(() => this.dismiss(id), duration);
      }

      return id;
    }

    // Enforce max visible
    if (this.notifications.size >= this.config.maxVisible) {
      const oldest = Array.from(this.notifications.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      )[0];
      if (oldest) this.dismiss(oldest[0]);
    }

    // Create new notification
    const notification: ActiveNotification = {
      id,
      payload,
      createdAt: Date.now()
    };

    // Set timeout for auto-dismiss
    if (duration > 0) {
      notification.timeout = setTimeout(() => this.dismiss(id), duration);
    }

    // Store action callback
    if (onAction) {
      this.actionCallbacks.set(id, onAction);
    }

    this.notifications.set(id, notification);

    // Send to window
    win.webContents
      .executeJavaScript(
        `window.notificationBridge.add(${JSON.stringify({
          id,
          title: payload.title,
          message: payload.message,
          style: mergedStyle,
          duration,
          progress: payload.progress,
          actions: payload.actions,
          dismissible: payload.dismissible,
          priority: payload.priority,
          imageUrl: payload.imageUrl
        })})`
      )
      .catch(() => {});

    // Show window and ensure it's on top
    if (!win.isVisible()) {
      try {
        win.showInactive();
      } catch {
        win.show();
      }
    }
    
    // Re-apply always-on-top to ensure window stays above other apps
    this.bringToTop();
    
    // Start refresh interval to keep on top (for Wayland)
    this.startRefreshInterval();

    return id;
  }

  /**
   * Bring the notification window to the top of all other windows
   */
  private bringToTop(): void {
    if (!this.window || this.window.isDestroyed()) return;

    // Re-apply always-on-top with highest level
    const topLevels = ['screen-saver', 'pop-up-menu', 'floating'] as const;
    
    for (const level of topLevels) {
      try {
        (this.window as any).setAlwaysOnTop(true, level);
        break;
      } catch {}
    }

    // On some systems, we need to toggle the always-on-top to force it
    try {
      this.window.setAlwaysOnTop(false);
      this.window.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      try {
        this.window.setAlwaysOnTop(true);
      } catch {}
    }

    // Ensure visible on all workspaces
    try {
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}

    // Move to front without focusing
    try {
      this.window.moveTop();
    } catch {}
  }

  /**
   * Update an existing notification
   */
  update(id: string, updates: Partial<NotificationPayload>): void {
    const existing = this.notifications.get(id);
    if (!existing) return;

    existing.payload = { ...existing.payload, ...updates };

    this.window?.webContents
      .executeJavaScript(
        `window.notificationBridge.update(${JSON.stringify({
          id,
          ...updates
        })})`
      )
      .catch(() => {});
  }

  /**
   * Dismiss a notification
   */
  dismiss(id: string): void {
    const notification = this.notifications.get(id);
    if (!notification) return;

    if (notification.timeout) {
      clearTimeout(notification.timeout);
    }

    this.notifications.delete(id);
    this.actionCallbacks.delete(id);

    this.window?.webContents
      .executeJavaScript(`window.notificationBridge.remove('${id}')`)
      .catch(() => {});

    // Hide window if no notifications
    if (this.notifications.size === 0 && this.window && !this.window.isDestroyed()) {
      this.stopRefreshInterval();
      setTimeout(() => {
        if (this.notifications.size === 0 && this.window && !this.window.isDestroyed()) {
          this.window.hide();
        }
      }, this.config.animationDuration + 50);
    }
  }

  /**
   * Dismiss all notifications
   */
  dismissAll(): void {
    for (const id of this.notifications.keys()) {
      this.dismiss(id);
    }
  }

  /**
   * Dismiss notifications by group
   */
  dismissGroup(group: string): void {
    for (const [id, notif] of this.notifications.entries()) {
      if (notif.payload.group === group) {
        this.dismiss(id);
      }
    }
  }

  /**
   * Get active notification count
   */
  getCount(): number {
    return this.notifications.size;
  }

  /**
   * Destroy the notification system
   */
  destroy(): void {
    this.stopRefreshInterval();
    
    for (const notif of this.notifications.values()) {
      if (notif.timeout) clearTimeout(notif.timeout);
    }
    this.notifications.clear();
    this.actionCallbacks.clear();

    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      this.window = null;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const notificationManager = new NotificationOverlayManager();

// Keep old name for backwards compatibility
export const notificationOverlay = notificationManager;

// ============================================================================
// GENERIC API FUNCTIONS
// ============================================================================

/**
 * Show a notification with full customization
 */
export function showNotification(
  payload: NotificationPayload,
  onAction?: (actionId: string) => void
): string {
  return notificationManager.show(payload, onAction);
}

/**
 * Show notification overlay (alias for backwards compatibility)
 */
export function showNotificationOverlay(payload: NotificationPayload): void {
  notificationManager.show(payload);
}

/**
 * Update an existing notification
 */
export function updateNotification(id: string, updates: Partial<NotificationPayload>): void {
  notificationManager.update(id, updates);
}

/**
 * Dismiss a notification by ID
 */
export function dismissNotification(id: string): void {
  notificationManager.dismiss(id);
}

/**
 * Dismiss all notifications
 */
export function dismissAllNotifications(): void {
  notificationManager.dismissAll();
}

/**
 * Configure the notification system
 */
export function configureNotifications(options: Partial<NotificationConfig>): void {
  notificationManager.configure(options);
}

// ============================================================================
// PRESET NOTIFICATION FUNCTIONS
// ============================================================================

export function notifyAchievementUnlocked(title: string, description?: string): string {
  return notificationManager.show({
    type: 'achievement',
    title,
    message: description,
    priority: 'high'
  });
}

export function notifyDownloadComplete(gameTitle: string): string {
  return notificationManager.show({
    type: 'download-complete',
    title: gameTitle,
    message: 'Pronto para jogar!'
  });
}

export function notifyDownloadError(gameTitle: string, error?: string): string {
  return notificationManager.show({
    type: 'download-error',
    title: gameTitle,
    message: error || 'Falha no download',
    priority: 'high'
  });
}

export function notifyDownloadProgress(
  gameTitle: string,
  progress: number,
  id?: string
): string {
  return notificationManager.show({
    type: 'download-progress',
    title: gameTitle,
    message: `Baixando... ${Math.round(progress)}%`,
    progress,
    id: id || `download_${gameTitle.replace(/\s+/g, '_')}`,
    dismissible: false
  });
}

export function notifyUpdateAvailable(gameTitle: string, version?: string): string {
  return notificationManager.show({
    type: 'update-available',
    title: gameTitle,
    message: version ? `Nova versão: ${version}` : 'Nova versão disponível'
  });
}

export function notifyGameReady(gameTitle: string): string {
  return notificationManager.show({
    type: 'game-ready',
    title: gameTitle,
    message: 'Extração concluída'
  });
}

export function notifyCloudSync(gameTitle: string, action: 'backup' | 'restore'): string {
  return notificationManager.show({
    type: 'cloud-sync',
    title: gameTitle,
    message:
      action === 'backup'
        ? 'Saves sincronizados com a nuvem'
        : 'Saves restaurados da nuvem'
  });
}

export function notifyInfo(title: string, message?: string): string {
  return notificationManager.show({
    type: 'info',
    title,
    message
  });
}

export function notifySuccess(title: string, message?: string): string {
  return notificationManager.show({
    type: 'success',
    title,
    message
  });
}

export function notifyWarning(title: string, message?: string): string {
  return notificationManager.show({
    type: 'warning',
    title,
    message
  });
}

export function notifyError(title: string, message?: string): string {
  return notificationManager.show({
    type: 'error',
    title,
    message,
    priority: 'high'
  });
}

// ============================================================================
// ADVANCED NOTIFICATION BUILDERS
// ============================================================================

/**
 * Show a notification with action buttons
 */
export function notifyWithActions(
  type: NotificationType,
  title: string,
  message: string,
  actions: NotificationAction[],
  onAction: (actionId: string) => void
): string {
  return notificationManager.show(
    {
      type,
      title,
      message,
      actions,
      duration: 0 // Persistent until action
    },
    onAction
  );
}

/**
 * Create a progress notification that can be updated
 */
export function createProgressNotification(
  title: string,
  initialMessage?: string
): {
  id: string;
  update: (progress: number, message?: string) => void;
  complete: (message?: string) => void;
  error: (message?: string) => void;
  dismiss: () => void;
} {
  const id = notificationManager.show({
    type: 'download-progress',
    title,
    message: initialMessage || 'Iniciando...',
    progress: 0,
    dismissible: false
  });

  return {
    id,
    update: (progress: number, message?: string) => {
      notificationManager.update(id, {
        progress,
        message: message || `${Math.round(progress)}%`
      });
    },
    complete: (message?: string) => {
      notificationManager.dismiss(id);
      notificationManager.show({
        type: 'success',
        title,
        message: message || 'Concluído!'
      });
    },
    error: (message?: string) => {
      notificationManager.dismiss(id);
      notificationManager.show({
        type: 'error',
        title,
        message: message || 'Erro!'
      });
    },
    dismiss: () => notificationManager.dismiss(id)
  };
}

/**
 * Create a custom notification type preset
 */
export function createNotificationPreset(
  baseType: NotificationType,
  customStyle: NotificationStyle,
  defaultDuration?: number
): (title: string, message?: string) => string {
  return (title: string, message?: string) => {
    return notificationManager.show({
      type: baseType,
      title,
      message,
      style: customStyle,
      duration: defaultDuration
    });
  };
}

/**
 * Show a confirmation notification with Yes/No actions
 */
export function notifyConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
): string {
  return notificationManager.show(
    {
      type: 'info',
      title,
      message,
      actions: [
        { id: 'confirm', label: 'Sim', primary: true },
        { id: 'cancel', label: 'Não' }
      ],
      duration: 0,
      dismissible: false
    },
    (actionId) => {
      if (actionId === 'confirm') {
        onConfirm();
      } else if (onCancel) {
        onCancel();
      }
    }
  );
}
