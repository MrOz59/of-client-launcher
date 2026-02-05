import { app } from 'electron'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'

export interface NotificationMessage {
  type: 'achievement_unlocked' | 'download_complete' | 'download_error' | 'friend_online' | 'info'
  title: string
  description?: string
  icon?: string // base64 encoded image
  duration_ms?: number
}

class OverlayIPC {
  private socket: net.Socket | null = null
  private socketPath: string = ''
  private connected: boolean = false
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(private gamePid?: number) {
    if (gamePid) {
      this.socketPath = `/tmp/voidlauncher-overlay-${gamePid}.sock`
    }
  }

  async connect(): Promise<boolean> {
    if (!this.socketPath || this.connected) {
      return this.connected
    }

    return new Promise((resolve) => {
      try {
        // Check if socket exists
        if (!fs.existsSync(this.socketPath)) {
          console.log('[OverlayIPC] Socket not found:', this.socketPath)
          resolve(false)
          return
        }

        this.socket = net.createConnection(this.socketPath, () => {
          console.log('[OverlayIPC] Connected to overlay socket')
          this.connected = true
          resolve(true)
        })

        this.socket.on('error', (err) => {
          console.error('[OverlayIPC] Socket error:', err)
          this.connected = false
          resolve(false)
        })

        this.socket.on('close', () => {
          console.log('[OverlayIPC] Socket closed')
          this.connected = false
          this.tryReconnect()
        })

        // Timeout after 2 seconds
        setTimeout(() => {
          if (!this.connected) {
            this.socket?.destroy()
            resolve(false)
          }
        }, 2000)
      } catch (err) {
        console.error('[OverlayIPC] Connection error:', err)
        resolve(false)
      }
    })
  }

  private tryReconnect() {
    if (this.reconnectTimer) {
      return
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      console.log('[OverlayIPC] Attempting reconnect...')
      this.connect()
    }, 5000)
  }

  async sendNotification(notification: NotificationMessage): Promise<boolean> {
    if (!this.connected) {
      const connected = await this.connect()
      if (!connected) {
        return false
      }
    }

    try {
      const message = JSON.stringify(notification) + '\n'
      this.socket?.write(message)
      console.log('[OverlayIPC] Sent notification:', notification.type)
      return true
    } catch (err) {
      console.error('[OverlayIPC] Send error:', err)
      this.connected = false
      return false
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.socket?.destroy()
    this.socket = null
    this.connected = false
  }
}

// Global registry of overlay connections per game PID
const overlayConnections = new Map<number, OverlayIPC>()

export function getOverlayIPC(gamePid: number): OverlayIPC {
  if (!overlayConnections.has(gamePid)) {
    overlayConnections.set(gamePid, new OverlayIPC(gamePid))
  }
  return overlayConnections.get(gamePid)!
}

export function removeOverlayIPC(gamePid: number) {
  const ipc = overlayConnections.get(gamePid)
  if (ipc) {
    ipc.disconnect()
    overlayConnections.delete(gamePid)
  }
}

export function disconnectAllOverlays() {
  overlayConnections.forEach((ipc) => ipc.disconnect())
  overlayConnections.clear()
}

// Cleanup on app quit
app.on('before-quit', () => {
  disconnectAllOverlays()
})
