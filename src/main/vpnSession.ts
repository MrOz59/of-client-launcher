import type { VpnSessionState, VpnTransport } from '../shared/vpn'
import * as controller from './vpnControllerClient'
import { vpnCheckInstalled, vpnConnectFromConfig, vpnDisconnect, vpnInstallBestEffort } from './ofVpnManager'
import { meshCheckInstalled, meshConnect, meshDisconnect, meshPeers, meshStopImmediately } from './vpnMeshManager'
import { parseMeshConfig } from './vpnMeshConfig'

type RoomSession = VpnSessionState & { controllerUrl: string; config: string; sessionToken?: string }

let activeSession: VpnSession | undefined
export function setActiveVpnSession(session: VpnSession) { activeSession = session }
export function getActiveVpnSession() { return activeSession }

// The tunnel belongs to the application, not a React modal or a particular tab.
export class VpnSession {
  private room: RoomSession | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private controllerCache: { url: string; until: number; result: ReturnType<typeof controller.vpnControllerStatus> } | null = null
  private generation = 0

  constructor(private readonly userDataDir: () => string, private readonly controllerUrl: () => string) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action)
    this.queue = result.catch(() => {})
    return result
  }

  snapshot(): VpnSessionState | null {
    if (!this.room) return null
    const { controllerUrl, config, sessionToken, ...snapshot } = this.room
    return snapshot
  }

  private async tick(room: RoomSession, generation = this.generation) {
    if (this.room !== room || !room.connected || generation !== this.generation) return
    try {
      const [presence, routes] = await Promise.all([
        controller.vpnControllerHeartbeat(room),
        room.transport === 'easytier' ? meshPeers().catch(() => null) : Promise.resolve(null)
      ])
      if (this.room !== room || !room.connected || generation !== this.generation) return
      if (presence.success && presence.peers) room.peers = presence.peers
      room.error = presence.success ? undefined : presence.error
      // A controller outage does not tear down an established P2P game.
      if (room.transport === 'easytier') {
        room.peers = room.peers.map(peer => {
          const route = routes?.find(route => route.ip === peer.ip)
          return { ...peer, connection: route?.connection || 'connecting', latencyMs: route?.latencyMs }
        })
        if (!routes) room.error = 'Não foi possível consultar a conexão P2P local'
      }
    } catch {
      if (this.room === room && generation === this.generation) room.error = 'Falha ao atualizar a sessão VPN'
    } finally {
      if (this.room === room && room.connected && generation === this.generation) {
        this.timer = setTimeout(() => { void this.tick(room, generation) }, 15_000)
        this.timer.unref?.()
      }
    }
  }

  async status() {
    const url = this.controllerUrl()
    if (!this.controllerCache || this.controllerCache.url !== url || this.controllerCache.until < Date.now()) {
      this.controllerCache = { url, until: Date.now() + 30_000, result: controller.vpnControllerStatus({ controllerUrl: url }) }
    }
    const ctrl = await this.controllerCache.result
    const transport: VpnTransport = this.room?.transport || ctrl.data?.transport || 'wireguard'
    const installed = transport === 'easytier' ? meshCheckInstalled() : await vpnCheckInstalled()
    return { success: true, controller: ctrl.success ? ctrl.data : null, installed: installed.installed,
      installError: installed.error, transport, session: this.snapshot(), error: ctrl.error || ctrl.data?.error }
  }

  async install() {
    this.controllerCache = null
    const ctrl = await controller.vpnControllerStatus({ controllerUrl: this.controllerUrl() })
    if ((this.room?.transport || ctrl.data?.transport) === 'easytier') {
      const installed = meshCheckInstalled()
      return { success: installed.installed, error: installed.error }
    }
    const result = await vpnInstallBestEffort()
    return { ...result, ...(!result.success && process.platform === 'win32' ? { url: 'https://www.wireguard.com/install/' } : {}) }
  }

  create(payload: Omit<Parameters<typeof controller.vpnControllerCreateRoom>[0], 'controllerUrl'>) {
    return this.exclusive(async () => {
      if (this.room) return { success: false, error: 'Saia da sala atual antes de criar outra' }
      const controllerUrl = this.controllerUrl()
      const result = await controller.vpnControllerCreateRoom({ ...payload, controllerUrl })
      if (result.success) this.remember(result, result.code || '', controllerUrl, true)
      const { sessionToken, ...publicResult } = result
      return publicResult
    })
  }

  join(payload: Omit<Parameters<typeof controller.vpnControllerJoinRoom>[0], 'controllerUrl'>) {
    return this.exclusive(async () => {
      if (this.room) return { success: false, error: 'Saia da sala atual antes de entrar em outra' }
      const controllerUrl = this.controllerUrl()
      const result = await controller.vpnControllerJoinRoom({ ...payload, controllerUrl })
      if (result.success) this.remember(result, payload.code, controllerUrl, false)
      const { sessionToken, ...publicResult } = result
      return publicResult
    })
  }

  private remember(result: { config?: string; peerId?: string; sessionToken?: string; roomName?: string; vpnIp?: string; hostIp?: string | null }, code: string, controllerUrl: string, host: boolean) {
    if (!result.config || !result.peerId) throw new Error('Resposta VPN incompleta')
    const transport = result.config.trim().startsWith('{') ? 'easytier' : 'wireguard'
    if (transport === 'easytier') parseMeshConfig(result.config)
    this.room = { controllerUrl, code: code.trim().toUpperCase(), peerId: result.peerId, sessionToken: result.sessionToken,
      roomName: result.roomName || code, config: result.config, vpnIp: result.vpnIp || '',
      hostIp: host ? result.vpnIp || '' : result.hostIp || '', transport, connected: false, peers: [] }
  }

  connect(config: string) {
    return this.exclusive(async () => {
      const room = this.room
      // Only execute the config admitted through the room API in this process.
      if (!room || (config && config !== room.config)) return { success: false, error: 'Entre na sala novamente para conectar' }
      if (room.connected) return { success: true }
      const result = room.transport === 'easytier'
        ? await meshConnect(room.config, this.userDataDir())
        : await vpnConnectFromConfig({ configText: room.config, userDataDir: this.userDataDir() })
      if (result.success) {
        this.generation++
        room.connected = true
        void this.tick(room)
      }
      return result
    })
  }

  private async disconnectRoom() {
    const room = this.room
    if (!room || !room.connected) return { success: true }
    const result = room.transport === 'easytier' ? await meshDisconnect() : await vpnDisconnect({ userDataDir: this.userDataDir() })
    if (result.success) {
      this.generation++
      room.connected = false
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
    }
    return result
  }

  disconnect() { return this.exclusive(() => this.disconnectRoom()) }

  async autoconnect(code: string) {
    code = code.trim().toUpperCase()
    if (!code) return { success: false, error: 'VPN: sala não configurada' }
    if (this.room && this.room.code !== code) return { success: false, error: 'VPN: outra sala está ativa. Saia dela nas configurações.' }
    if (!this.room) {
      const joined = await this.join({ code })
      if (!joined.success) return joined
    }
    return this.connect('')
  }

  leave(peerId: string) {
    return this.exclusive(async () => {
      const room = this.room
      if (!room) return { success: true }
      if (room.peerId !== peerId) return { success: false, error: 'Sessão VPN inválida' }
      const disconnected = await this.disconnectRoom()
      if (!disconnected.success) return disconnected
      const result = await controller.vpnControllerLeaveRoom(room)
      if (result.success) this.room = null
      return result
    })
  }

  stopOnQuit() {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    // Removing the lease is synchronous; the supervisor also watches the launcher PID.
    meshStopImmediately()
  }
}
