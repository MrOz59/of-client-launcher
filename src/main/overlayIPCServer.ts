import * as net from 'net'
import * as fs from 'fs'

export interface NotificationMessage {
  type: 'achievement_unlocked' | 'download_complete' | 'download_error' | 'friend_online' | 'info'
  title: string
  description?: string
  icon?: string
  duration_ms?: number
}

export class OverlayIPCServer {
  private server: net.Server | null = null
  private socketPath: string
  private clients: Set<net.Socket> = new Set()

  constructor(private sessionId: string) {
    this.socketPath = `/tmp/voidlauncher-overlay-${sessionId}.sock`
  }

  async start(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        // Remove existing socket file if it exists
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath)
        }

        this.server = net.createServer((socket) => {
          console.log('[OverlayIPCServer] Client connected')
          this.clients.add(socket)

          socket.on('close', () => {
            console.log('[OverlayIPCServer] Client disconnected')
            this.clients.delete(socket)
          })

          socket.on('error', (err) => {
            console.error('[OverlayIPCServer] Socket error:', err)
            this.clients.delete(socket)
          })
        })

        this.server.on('error', (err) => {
          console.error('[OverlayIPCServer] Server error:', err)
          reject(err)
        })

        this.server.listen(this.socketPath, () => {
          console.log(`[OverlayIPCServer] Listening on ${this.socketPath}`)
          
          // Set socket permissions so game process can connect
          try {
            fs.chmodSync(this.socketPath, 0o666)
          } catch (err) {
            console.warn('[OverlayIPCServer] Failed to chmod socket:', err)
          }
          
          resolve(true)
        })
      } catch (err) {
        console.error('[OverlayIPCServer] Start error:', err)
        reject(err)
      }
    })
  }

  sendNotification(notification: NotificationMessage): boolean {
    if (this.clients.size === 0) {
      console.log('[OverlayIPCServer] No clients connected')
      return false
    }

    const message = JSON.stringify(notification) + '\n'
    let sent = false

    this.clients.forEach((client) => {
      try {
        client.write(message)
        sent = true
      } catch (err) {
        console.error('[OverlayIPCServer] Write error:', err)
        this.clients.delete(client)
      }
    })

    if (sent) {
      console.log(`[OverlayIPCServer] Notification sent to ${this.clients.size} client(s):`, notification.type)
    }

    return sent
  }

  stop() {
    console.log('[OverlayIPCServer] Stopping server')

    // Close all client connections
    this.clients.forEach((client) => {
      client.destroy()
    })
    this.clients.clear()

    // Close server
    if (this.server) {
      this.server.close()
      this.server = null
    }

    // Remove socket file
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath)
      } catch (err) {
        console.warn('[OverlayIPCServer] Failed to remove socket:', err)
      }
    }
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  getClientCount(): number {
    return this.clients.size
  }
  
  getSessionId(): string {
    return this.sessionId
  }
}

// Global registry of servers per session ID
const overlayServers = new Map<string, OverlayIPCServer>()

export function createOverlayServer(sessionId: string): OverlayIPCServer {
  if (overlayServers.has(sessionId)) {
    return overlayServers.get(sessionId)!
  }

  const server = new OverlayIPCServer(sessionId)
  overlayServers.set(sessionId, server)
  return server
}

export function getOverlayServer(sessionId: string): OverlayIPCServer | undefined {
  return overlayServers.get(sessionId)
}

export function removeOverlayServer(sessionId: string) {
  const server = overlayServers.get(sessionId)
  if (server) {
    server.stop()
    overlayServers.delete(sessionId)
  }
}

export function getAllOverlayServers(): Map<string, OverlayIPCServer> {
  return overlayServers
}

export function stopAllServers() {
  overlayServers.forEach((server) => server.stop())
  overlayServers.clear()
}
