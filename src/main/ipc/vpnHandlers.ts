/**
 * IPC Handlers for VPN/LAN functionality
 */
import { ipcMain, app } from 'electron'
import { getSetting } from '../db'
import {
  vpnControllerCreateRoom,
  vpnControllerJoinRoom,
  vpnControllerListPeers,
  vpnControllerListRooms,
  vpnControllerHeartbeat,
  vpnControllerLeaveRoom,
  vpnControllerStatus
} from '../vpnControllerClient'
import {
  vpnCheckInstalled,
  vpnConnectFromConfig,
  vpnDisconnect,
  vpnInstallBestEffort
} from '../ofVpnManager'
import type { IpcContext, IpcHandlerRegistrar } from './types'

const DEFAULT_LAN_CONTROLLER_URL = 'https://vpn.mroz.dev.br'

export const registerVpnHandlers: IpcHandlerRegistrar = (ctx: IpcContext) => {
  ipcMain.handle('vpn-status', async () => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const ctrl = await vpnControllerStatus({ controllerUrl })
      const installed = await vpnCheckInstalled()
      return { success: true, controller: ctrl.success ? ctrl.data : null, installed: installed.installed, installError: installed.error }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao consultar VPN' }
    }
  })

  ipcMain.handle('vpn-install', async () => {
    try {
      const res = await vpnInstallBestEffort()
      if (!res.success) {
        if (process.platform === 'win32') {
          return {
            success: false,
            error: res.error || 'Windows: instale WireGuard e tente novamente',
            url: 'https://www.wireguard.com/install/'
          }
        }
        return { success: false, error: res.error || 'Falha ao instalar' }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao instalar' }
    }
  })

  ipcMain.handle('vpn-room-create', async (_event, payload?: {
    name?: string
    roomName?: string
    gameName?: string
    password?: string
    public?: boolean
    maxPlayers?: number
  }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const res = await vpnControllerCreateRoom({
        controllerUrl,
        name: String(payload?.name || '').trim(),
        roomName: String(payload?.roomName || '').trim(),
        gameName: String(payload?.gameName || '').trim(),
        password: String(payload?.password || '').trim(),
        public: payload?.public ?? false,
        maxPlayers: payload?.maxPlayers || 8
      })
      if (!res.success) return { success: false, error: res.error || 'Falha ao criar sala' }
      return { success: true, code: res.code, config: res.config, vpnIp: res.vpnIp, peerId: res.peerId, roomName: res.roomName }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao criar sala' }
    }
  })

  ipcMain.handle('vpn-room-join', async (_event, payload: { code: string; name?: string; password?: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const code = String(payload?.code || '').trim()
      const name = String(payload?.name || '').trim()
      const password = String(payload?.password || '').trim()
      if (!code) return { success: false, error: 'Código ausente' }
      const res = await vpnControllerJoinRoom({ controllerUrl, code, name, password })
      if (!res.success) return { success: false, error: res.error || 'Falha ao entrar na sala', needsPassword: (res as any).needsPassword }
      return { success: true, config: res.config, vpnIp: res.vpnIp, hostIp: res.hostIp, peerId: res.peerId, roomName: res.roomName }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao entrar na sala' }
    }
  })

  ipcMain.handle('vpn-room-peers', async (_event, payload: { code: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const code = String(payload?.code || '').trim()
      if (!code) return { success: false, error: 'Código ausente' }
      const res = await vpnControllerListPeers({ controllerUrl, code })
      if (!res.success) return { success: false, error: res.error || 'Falha ao listar peers' }
      return { success: true, peers: res.peers || [] }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao listar peers' }
    }
  })

  // List public rooms (Hamachi-like browser)
  ipcMain.handle('vpn-room-list', async (_event, payload?: { gameName?: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const gameName = String(payload?.gameName || '').trim()
      const res = await vpnControllerListRooms({ controllerUrl, gameName: gameName || undefined })
      if (!res.success) return { success: false, error: res.error || 'Falha ao listar salas' }
      return { success: true, rooms: res.rooms || [] }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao listar salas' }
    }
  })

  // Heartbeat to maintain online status
  ipcMain.handle('vpn-heartbeat', async (_event, payload: { peerId: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const peerId = String(payload?.peerId || '').trim()
      if (!peerId) return { success: false, error: 'peerId ausente' }
      const res = await vpnControllerHeartbeat({ controllerUrl, peerId })
      if (!res.success) return { success: false, error: res.error || 'Heartbeat falhou' }
      return { success: true, peers: res.peers || [] }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Heartbeat falhou' }
    }
  })

  // Leave room cleanly
  ipcMain.handle('vpn-room-leave', async (_event, payload: { peerId: string }) => {
    try {
      const controllerUrl = String(getSetting('lan_controller_url') || DEFAULT_LAN_CONTROLLER_URL).trim()
      const peerId = String(payload?.peerId || '').trim()
      if (!peerId) return { success: false, error: 'peerId ausente' }
      const res = await vpnControllerLeaveRoom({ controllerUrl, peerId })
      if (!res.success) return { success: false, error: res.error || 'Falha ao sair da sala' }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao sair da sala' }
    }
  })

  ipcMain.handle('vpn-connect', async (_event, payload: { config: string }) => {
    try {
      const cfg = String(payload?.config || '').trim()
      if (!cfg) return { success: false, error: 'Config ausente' }
      const userDataDir = app.getPath('userData')
      const res = await vpnConnectFromConfig({ configText: cfg, userDataDir })
      if (!res.success) {
        return {
          success: false,
          error: res.error || 'Falha ao conectar',
          needsInstall: !!(res as any).needsInstall,
          needsAdmin: !!(res as any).needsAdmin
        }
      }
      return { success: true, tunnelName: res.tunnelName, configPath: res.configPath }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao conectar' }
    }
  })

  ipcMain.handle('vpn-disconnect', async () => {
    try {
      const userDataDir = app.getPath('userData')
      const res = await vpnDisconnect({ userDataDir })
      if (!res.success) return { success: false, error: res.error || 'Falha ao desconectar', needsAdmin: !!(res as any).needsAdmin }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao desconectar' }
    }
  })
}
