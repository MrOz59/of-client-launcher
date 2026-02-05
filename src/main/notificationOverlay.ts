/**
 * Notification Overlay System (Simplified)
 * 
 * Provides notification functions for game-related events.
 * Uses the new Electron window-based overlay (gameNotificationWindow)
 * for in-game notifications when running inside Gamescope.
 */

import { showDesktopNotification, NOTIFICATIONS_ENABLED } from './desktopNotifications'
import type { NotificationMessage } from './overlayIPC'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function showNotification(
  type: NotificationMessage['type'],
  title: string,
  description?: string,
  duration_ms: number = 5000
): string {
  const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  if (!NOTIFICATIONS_ENABLED) return id
  
  const notification: NotificationMessage = {
    type,
    title,
    description,
    duration_ms
  }

  showDesktopNotification(notification)
  return id
}

// ============================================================================
// PRESET NOTIFICATION FUNCTIONS
// ============================================================================

export function notifyAchievementUnlocked(title: string, description?: string): string {
  return showNotification('achievement_unlocked', title, description, 6000)
}

export function notifyDownloadComplete(gameTitle: string): string {
  return showNotification('download_complete', 'Download Completo', `${gameTitle} - Pronto para jogar!`, 5000)
}

export function notifyDownloadError(gameTitle: string, error?: string): string {
  return showNotification('download_error', 'Erro no Download', error || `Falha ao baixar ${gameTitle}`, 7000)
}

export function notifyUpdateAvailable(gameTitle: string, version?: string): string {
  return showNotification('info', `Atualização Disponível: ${gameTitle}`, version ? `Nova versão: ${version}` : 'Nova versão disponível', 5000)
}

export function notifyGameReady(gameTitle: string): string {
  return showNotification('info', gameTitle, 'Extração concluída', 4000)
}

export function notifyCloudSync(gameTitle: string, action: 'backup' | 'restore'): string {
  const message = action === 'backup'
    ? 'Saves sincronizados com a nuvem'
    : 'Saves restaurados da nuvem'
  return showNotification('info', gameTitle, message, 4000)
}

export function notifyInfo(title: string, message?: string): string {
  return showNotification('info', title, message, 4000)
}

export function notifySuccess(title: string, message?: string): string {
  return showNotification('info', title, message, 4000)
}

export function notifyWarning(title: string, message?: string): string {
  return showNotification('info', title, message, 5000)
}

export function notifyError(title: string, message?: string): string {
  return showNotification('download_error', title, message, 6000)
}

// ============================================================================
// COMPAT: Keep the manager interface for backward compatibility
// ============================================================================

class NotificationManagerCompat {
  show(_payload: any): string {
    return `notif_${Date.now()}`
  }
  
  update(_id: string, _updates: any): void {
    // No-op for compat
  }
  
  dismiss(_id: string): void {
    // No-op for compat
  }
  
  dismissAll(): void {
    // No-op for compat
  }
}

export const notificationManager = new NotificationManagerCompat()

// ============================================================================
// ENVIRONMENT CHECK
// ============================================================================

export function isRunningOnWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === 'wayland' ||
         !!process.env.WAYLAND_DISPLAY
}
