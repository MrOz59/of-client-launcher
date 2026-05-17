import { Notification as ElectronNotification } from 'electron'
import type { NotificationMessage } from './overlayIPC'
import { showGameNotification, isGamescopeAvailable, closeAllGameNotifications } from './gameNotificationWindow'
import { showDesktopOverlayNotification, closeAllDesktopNotifications } from './desktopNotificationWindow'
import { showStandaloneToast, closeAllStandaloneToasts } from './standaloneToast'
import { getSetting } from './db'

export const NOTIFICATIONS_ENABLED = true

let notificationsEnabled = NOTIFICATIONS_ENABLED
let useGameOverlay = true // Use in-game overlay when available
let currentGamePid: number | null = null

export function setNotificationsEnabled(enabled: boolean) {
  notificationsEnabled = NOTIFICATIONS_ENABLED ? enabled : false
  if (!enabled) {
    closeAllGameNotifications()
    closeAllDesktopNotifications()
    closeAllStandaloneToasts()
  }
}

export function setUseGameOverlay(enabled: boolean) {
  useGameOverlay = enabled
}

export function setCurrentGamePid(pid: number | null) {
  currentGamePid = pid
  if (!pid) {
    // Game closed, clean up any remaining notifications
    closeAllGameNotifications()
  }
}

export function showDesktopNotification(notification: NotificationMessage) {
  const persistedEnabled = getSetting('notifications_enabled') !== 'false'
  if (!NOTIFICATIONS_ENABLED || !notificationsEnabled || !persistedEnabled) {
    console.log('[Notifications] Notifications disabled')
    return
  }

  // If a game is running and we're in a Gamescope session, use in-game overlay
  if (currentGamePid && useGameOverlay && isGamescopeAvailable()) {
    console.log('[Notifications] Using game overlay for notification:', notification.title)
    showGameNotification(notification)
    return
  }

  // Otherwise use custom desktop overlay notifications
  try {
    if (showStandaloneToast(notification)) {
      console.log('[Notifications] Standalone toast notification shown:', notification.title)
      return
    }
  } catch (err) {
    console.error('[Notifications] Failed to show standalone toast notification:', err)
  }

  try {
    const win = showDesktopOverlayNotification(notification)
    if (win) {
      console.log('[Notifications] Desktop overlay notification shown:', notification.title)
      return
    }
  } catch (err) {
    console.error('[Notifications] Failed to show desktop overlay notification:', err)
  }

  // Fallback to system notifications
  try {
    const n = new ElectronNotification({
      title: notification.title,
      body: notification.description || '',
      icon: notification.icon,
      urgency: 'normal',
      timeoutType: 'default',
    })

    n.show()
    console.log('[Notifications] Desktop notification shown:', notification.title)
  } catch (err) {
    console.error('[Notifications] Failed to show desktop notification:', err)
  }
}

export function notifyAchievementUnlocked(
  title: string,
  description?: string,
  icon?: string,
  game?: string
): NotificationMessage {
  const notification: NotificationMessage = {
    type: 'achievement_unlocked',
    title,
    description,
    icon,
    game,
    duration_ms: 5000,
  }

  if (NOTIFICATIONS_ENABLED) showDesktopNotification(notification)
  return notification
}

export function notifyDownloadComplete(
  gameName: string,
  icon?: string
): NotificationMessage {
  const notification: NotificationMessage = {
    type: 'download_complete',
    title: 'Pronto para jogar',
    description: `${gameName} foi baixado com sucesso!`,
    game: gameName,
    icon,
    duration_ms: 4000,
  }

  if (NOTIFICATIONS_ENABLED) showDesktopNotification(notification)
  return notification
}

export function notifyDownloadError(
  gameName: string,
  error: string
): NotificationMessage {
  const notification: NotificationMessage = {
    type: 'download_error',
    title: 'Erro no Download',
    description: `${gameName}: ${error}`,
    game: gameName,
    duration_ms: 6000,
  }

  if (NOTIFICATIONS_ENABLED) showDesktopNotification(notification)
  return notification
}

export function notifyInfo(title: string, description?: string): NotificationMessage {
  const notification: NotificationMessage = {
    type: 'info',
    title,
    description,
    source: 'VoidLauncher',
    duration_ms: 4000,
  }

  if (NOTIFICATIONS_ENABLED) showDesktopNotification(notification)
  return notification
}
