import { globalShortcut } from 'electron'
import { getOverlayServer } from './overlayIPCServer'
import { notifyInfo, NOTIFICATIONS_ENABLED } from './desktopNotifications'
import type { NotificationMessage } from './overlayIPCServer'

let registered = false

export function registerNotificationHotkeys(getRunningGames: () => Map<string, any>) {
  if (!NOTIFICATIONS_ENABLED) {
    console.log('[Hotkeys] Notification system disabled; skipping hotkey registration')
    return
  }
  if (registered) {
    console.log('[Hotkeys] Already registered')
    return
  }

  try {
    // Ctrl+Shift+F9 - Test in-game notification
    const success = globalShortcut.register('CommandOrControl+Shift+F9', () => {
      console.log('[Hotkeys] Test notification triggered (Ctrl+Shift+F9)')
      
      const runningGames = getRunningGames()
      
      if (runningGames.size === 0) {
        console.log('[Hotkeys] No games running, showing desktop notification only')
        notifyInfo('Teste de Notificação', 'Nenhum jogo em execução. Inicie um jogo para testar o overlay in-game.')
        return
      }

      // Send test notification to all running games
      let sentCount = 0
      runningGames.forEach((gameInfo, gameUrl) => {
        const sessionId = gameInfo.overlaySessionId
        if (!sessionId) {
          console.log(`[Hotkeys] No overlay session for game: ${gameUrl}`)
          return
        }

        const testNotification: NotificationMessage = {
          type: 'achievement_unlocked',
          title: '🎮 Teste de Overlay',
          description: 'Se você está vendo isso, o overlay in-game está funcionando!',
          duration_ms: 6000
        }

        const server = getOverlayServer(sessionId)
        if (server && server.isRunning()) {
          const success = server.sendNotification(testNotification)
          if (success) {
            console.log(`[Hotkeys] Test notification sent to session: ${sessionId}`)
            sentCount++
          } else {
            console.log(`[Hotkeys] Failed to send notification to session: ${sessionId}`)
          }
        } else {
          console.log(`[Hotkeys] No server running for session: ${sessionId}`)
        }
      })

      // Also show desktop notification
      notifyInfo(
        '🎮 Teste Enviado',
        sentCount > 0 
          ? `Notificação de teste enviada para ${sentCount} jogo(s) em execução`
          : 'Tentando conectar ao overlay...'
      )
    })

    if (success) {
      console.log('[Hotkeys] ✅ Notification hotkey registered: Ctrl+Shift+F9')
      registered = true
    } else {
      console.error('[Hotkeys] ❌ Failed to register hotkey')
    }
  } catch (err) {
    console.error('[Hotkeys] Error registering hotkeys:', err)
  }
}

export function unregisterNotificationHotkeys() {
  if (!NOTIFICATIONS_ENABLED) return
  if (!registered) return
  
  try {
    globalShortcut.unregister('CommandOrControl+Shift+F9')
    console.log('[Hotkeys] Hotkeys unregistered')
    registered = false
  } catch (err) {
    console.error('[Hotkeys] Error unregistering hotkeys:', err)
  }
}

export function unregisterAllHotkeys() {
  if (!NOTIFICATIONS_ENABLED) return
  try {
    globalShortcut.unregisterAll()
    console.log('[Hotkeys] All hotkeys unregistered')
    registered = false
  } catch (err) {
    console.error('[Hotkeys] Error unregistering all hotkeys:', err)
  }
}
