import { useState, useRef, useCallback, useEffect } from 'react'
import type { VpnStatusState, VpnPeer, LanMode, PublicRoom } from './types'
import { useI18n } from '../../i18n'

type CreateRoomOptions = {
  roomName?: string
  password?: string
  isPublic?: boolean
  maxPlayers?: number
}

export function useVpn(configOpen: boolean, configTab: string, lanMode: LanMode, lanNetworkId: string) {
  const { t } = useI18n()
  const [vpnLoading, setVpnLoading] = useState(false)
  const [vpnHasLoaded, setVpnHasLoaded] = useState(false)
  const vpnHasLoadedRef = useRef(false)
  const [vpnError, setVpnError] = useState<string | null>(null)
  const [vpnStatus, setVpnStatus] = useState<VpnStatusState | null>(null)
  const [vpnPeers, setVpnPeers] = useState<VpnPeer[]>([])
  const [vpnActionBusy, setVpnActionBusy] = useState(false)
  const [vpnConfig, setVpnConfig] = useState<string>('')
  const [vpnLocalIp, setVpnLocalIp] = useState<string>('')
  const [vpnHostIp, setVpnHostIp] = useState<string>('')
  const [vpnConnected, setVpnConnected] = useState<boolean>(false)
  const [vpnPeerId, setVpnPeerId] = useState<string>('')

  // Room state
  const [lanRoomCode, setLanRoomCode] = useState<string>('')
  const [lanRoomBusy, setLanRoomBusy] = useState<boolean>(false)
  const [lanRoomLastCode, setLanRoomLastCode] = useState<string>('')
  
  // New room creation options
  const [createRoomName, setCreateRoomName] = useState<string>('')
  const [createRoomPassword, setCreateRoomPassword] = useState<string>('')
  const [createRoomPublic, setCreateRoomPublic] = useState<boolean>(true)
  
  // Current room info
  const [currentRoomName, setCurrentRoomName] = useState<string>('')
  const [currentRoomIsHost, setCurrentRoomIsHost] = useState<boolean>(false)
  const [currentRoomMaxPlayers, setCurrentRoomMaxPlayers] = useState<number>(8)
  
  // Public rooms
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([])
  const [publicRoomsLoading, setPublicRoomsLoading] = useState<boolean>(false)

  const resetState = useCallback(() => {
    setLanRoomCode('')
    setLanRoomLastCode('')
    vpnHasLoadedRef.current = false
    setVpnLoading(false)
    setVpnHasLoaded(false)
    setVpnError(null)
    setVpnStatus(null)
    setVpnPeers([])
    setVpnActionBusy(false)
    setVpnConfig('')
    setVpnLocalIp('')
    setVpnHostIp('')
    setVpnConnected(false)
    setVpnPeerId('')
    setCreateRoomName('')
    setCreateRoomPassword('')
    setCreateRoomPublic(true)
    setCurrentRoomName('')
    setCurrentRoomIsHost(false)
    setCurrentRoomMaxPlayers(8)
    setPublicRooms([])
  }, [])

  const createRoom = useCallback(async (gameName: string, onNetworkUpdate: (code: string) => void, options?: CreateRoomOptions) => {
    setLanRoomBusy(true)
    setVpnActionBusy(true)
    try {
      const roomName = String(options?.roomName || createRoomName || '').trim() || `${gameName || t('library.vpn.roomFallback')}`
      const maxPlayers = Math.min(Math.max(Number(options?.maxPlayers || 8), 2), 32)
      const res = await window.electronAPI.vpnRoomCreate?.({ 
        name: `OF ${gameName || ''}`.trim(),
        roomName,
        gameName: gameName || 'Unknown',
        password: String(options?.password || createRoomPassword || '').trim() || undefined,
        public: options?.isPublic ?? createRoomPublic,
        maxPlayers
      })
      if (!res?.success) throw new Error(res?.error || t('library.vpn.createFailed'))
      const code = String(res.code || '').trim()
      const cfg = String(res.config || '').trim()
      const peerId = String(res.peerId || '').trim()
      if (!code || !cfg) throw new Error(t('library.vpn.invalidResponse'))
      setLanRoomLastCode(code)
      setLanRoomCode(code)
      onNetworkUpdate(code)
      setVpnConfig(cfg)
      setVpnLocalIp(String(res.vpnIp || '').trim())
      setVpnHostIp(String(res.vpnIp || '').trim())
      setVpnPeerId(peerId)
      setCurrentRoomName(roomName)
      setCurrentRoomIsHost(true)
      setCurrentRoomMaxPlayers(maxPlayers)

      const conn = await window.electronAPI.vpnConnect?.(cfg)
      if (!conn?.success) {
        if (peerId) window.electronAPI.vpnRoomLeave?.(peerId).catch(() => {})
        setLanRoomLastCode('')
        setLanRoomCode('')
        onNetworkUpdate('')
        setVpnConfig('')
        setVpnLocalIp('')
        setVpnHostIp('')
        setVpnPeerId('')
        setCurrentRoomName('')
        setCurrentRoomIsHost(false)
        if (conn?.needsInstall) throw new Error(t('library.vpn.wireguardMissing'))
        if (conn?.needsAdmin) throw new Error(t('library.vpn.adminConnect'))
        throw new Error(conn?.error || t('library.vpn.connectFailed'))
      }
      setVpnConnected(true)
    } catch (err: any) {
      const msg = err?.message || t('library.vpn.createFailed')
      setVpnError(msg)
      alert(msg)
    } finally {
      setLanRoomBusy(false)
      setVpnActionBusy(false)
    }
  }, [createRoomName, createRoomPassword, createRoomPublic, t])

  const joinRoom = useCallback(async (code: string, gameName: string, onNetworkUpdate: (code: string) => void, password?: string) => {
    const cleanCode = code.trim().toUpperCase()
    setLanRoomBusy(true)
    setVpnActionBusy(true)
    try {
      const res = await window.electronAPI.vpnRoomJoin?.(cleanCode, { 
        name: `OF ${gameName || ''}`.trim(),
        password 
      })
      if (!res?.success) throw new Error(res?.error || t('library.vpn.joinFailed'))
      const cfg = String(res.config || '').trim()
      const peerId = String(res.peerId || '').trim()
      if (!cfg) throw new Error(t('library.vpn.invalidResponse'))
      setLanRoomLastCode(cleanCode)
      onNetworkUpdate(cleanCode)
      setVpnConfig(cfg)
      setVpnLocalIp(String(res.vpnIp || '').trim())
      setVpnHostIp(String(res.hostIp || '').trim())
      setVpnPeerId(peerId)
      setCurrentRoomName(String(res.roomName || cleanCode))
      setCurrentRoomIsHost(false)
      setCurrentRoomMaxPlayers((res as any).maxPlayers || 8)

      const conn = await window.electronAPI.vpnConnect?.(cfg)
      if (!conn?.success) {
        if (peerId) window.electronAPI.vpnRoomLeave?.(peerId).catch(() => {})
        setLanRoomLastCode('')
        onNetworkUpdate('')
        setVpnConfig('')
        setVpnLocalIp('')
        setVpnHostIp('')
        setVpnPeerId('')
        setCurrentRoomName('')
        setCurrentRoomIsHost(false)
        if (conn?.needsInstall) throw new Error(t('library.vpn.wireguardMissing'))
        if (conn?.needsAdmin) throw new Error(t('library.vpn.adminConnect'))
        throw new Error(conn?.error || t('library.vpn.connectFailed'))
      }
      setVpnConnected(true)
    } catch (err: any) {
      const msg = err?.message || t('library.vpn.joinFailed')
      setVpnError(msg)
      alert(msg)
    } finally {
      setLanRoomBusy(false)
      setVpnActionBusy(false)
    }
  }, [t])

  const installVpn = useCallback(async () => {
    if (!confirm(t('library.vpn.installConfirm'))) return
    setVpnActionBusy(true)
    try {
      const res = await window.electronAPI.vpnInstall?.()
      if (!res?.success) {
        const url = (res as any)?.url
        if (url) {
          const open = confirm(t('library.vpn.installOpenPageConfirm', { error: res?.error || t('library.vpn.installFailed') }))
          if (open) await window.electronAPI.openExternal?.(String(url))
        }
        throw new Error(res?.error || t('library.vpn.installFailed'))
      }
      alert(t('library.vpn.installed'))
    } catch (err: any) {
      alert(err?.message || t('library.vpn.installFailed'))
    } finally {
      setVpnActionBusy(false)
    }
  }, [t])

  const connect = useCallback(async () => {
    setVpnActionBusy(true)
    try {
      const res = await window.electronAPI.vpnConnect?.(vpnConfig)
      if (!res?.success) {
        if (res?.needsInstall) throw new Error(t('library.vpn.wireguardMissing'))
        if (res?.needsAdmin) throw new Error(t('library.vpn.adminConnect'))
        throw new Error(res?.error || t('library.vpn.connectFailed'))
      }
      setVpnConnected(true)
    } catch (err: any) {
      alert(err?.message || t('library.vpn.connectFailed'))
    } finally {
      setVpnActionBusy(false)
    }
  }, [vpnConfig, t])

  const disconnect = useCallback(async () => {
    setVpnActionBusy(true)
    try {
      const res = await window.electronAPI.vpnDisconnect?.()
      if (!res?.success) {
        if (res?.needsAdmin) throw new Error(t('library.vpn.adminDisconnect'))
        throw new Error(res?.error || t('library.vpn.disconnectFailed'))
      }
      setVpnConnected(false)
    } catch (err: any) {
      alert(err?.message || t('library.vpn.disconnectFailed'))
    } finally {
      setVpnActionBusy(false)
    }
  }, [t])

  const leaveRoom = useCallback(async (onNetworkUpdate: (code: string) => void) => {
    setLanRoomBusy(true)
    setVpnActionBusy(true)
    try {
      // First disconnect VPN
      await window.electronAPI.vpnDisconnect?.()
      
      // Then leave the room on server using peerId
      if (vpnPeerId) {
        await window.electronAPI.vpnRoomLeave?.(vpnPeerId)
      }
      
      // Reset room state
      setLanRoomCode('')
      setLanRoomLastCode('')
      onNetworkUpdate('')
      setVpnConfig('')
      setVpnLocalIp('')
      setVpnHostIp('')
      setVpnPeerId('')
      setVpnConnected(false)
      setVpnPeers([])
      setCurrentRoomName('')
      setCurrentRoomIsHost(false)
    } catch (err: any) {
      alert(err?.message || t('library.vpn.leaveFailed'))
    } finally {
      setLanRoomBusy(false)
      setVpnActionBusy(false)
    }
  }, [vpnPeerId, t])

  const loadPublicRooms = useCallback(async (gameName?: string) => {
    setPublicRoomsLoading(true)
    try {
      const res = await window.electronAPI.vpnRoomList?.({ gameName })
      if (res?.success && Array.isArray(res.rooms)) {
        setPublicRooms(res.rooms)
      }
    } catch (err: any) {
      console.error('Failed to load public rooms:', err)
    } finally {
      setPublicRoomsLoading(false)
    }
  }, [])

  const refreshPeers = useCallback(async () => {
    const code = lanRoomLastCode || lanRoomCode
    if (!code) return
    
    try {
      const peersRes = await window.electronAPI.vpnRoomPeers?.(code)
      if (peersRes?.success && Array.isArray(peersRes.peers)) {
        setVpnPeers(peersRes.peers)
      }
    } catch (err: any) {
      console.error('Failed to refresh peers:', err)
    }
  }, [lanRoomLastCode, lanRoomCode])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      alert(t('library.vpn.copyFailed'))
    }
  }, [t])

  // Refresh VPN status when LAN tab is open
  useEffect(() => {
    if (!configOpen) return
    if (configTab !== 'lan') return
    if (lanMode !== 'ofvpn') return

    let cancelled = false
    let timer: any = null
    let lastStatusJson = ''
    let lastPeersJson = ''

    const refresh = async () => {
      if (cancelled) return
      if (!vpnHasLoadedRef.current) setVpnLoading(true)
      try {
        const st = await window.electronAPI.vpnStatus?.()
        if (cancelled) return
        if (!st?.success) { setVpnError(st?.error || t('library.vpn.statusFailed')); return }

        setVpnError(null)
        const nextStatus = { controller: st.controller || null, installed: !!st.installed, installError: st.installError || null }
        const statusJson = JSON.stringify(nextStatus)
        if (statusJson !== lastStatusJson) { lastStatusJson = statusJson; setVpnStatus(nextStatus) }

        const code = String(lanNetworkId || '').trim()
        if (code) {
          const peersRes = vpnConnected && vpnPeerId
            ? await window.electronAPI.vpnHeartbeat?.(vpnPeerId)
            : await window.electronAPI.vpnRoomPeers?.(code)
          if (cancelled) return
          if (peersRes?.success) {
            const nextPeers = Array.isArray(peersRes.peers) ? peersRes.peers : []
            const peersJson = JSON.stringify(nextPeers)
            if (peersJson !== lastPeersJson) { lastPeersJson = peersJson; setVpnPeers(nextPeers) }
          } else if (vpnConnected && vpnPeerId) {
            setVpnError(peersRes?.error || t('library.vpn.heartbeatMissing'))
          }
        }
      } catch (err: any) {
        if (cancelled) return
        setVpnError(err?.message || t('library.vpn.statusFailed'))
      } finally {
        if (!cancelled) {
          setVpnLoading(false)
          if (!vpnHasLoadedRef.current) { vpnHasLoadedRef.current = true; setVpnHasLoaded(true) }
        }
      }
    }

    void refresh()
    timer = setInterval(refresh, 4000)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [configOpen, configTab, lanMode, lanNetworkId, vpnConnected, vpnPeerId, t])

  return {
    // State
    vpnLoading,
    vpnHasLoaded,
    vpnError,
    vpnStatus,
    vpnPeers,
    vpnActionBusy,
    vpnConfig,
    vpnLocalIp,
    vpnHostIp,
    vpnConnected,
    vpnPeerId,
    lanRoomCode,
    lanRoomBusy,
    lanRoomLastCode,
    
    // New room creation options
    createRoomName,
    createRoomPassword,
    createRoomPublic,
    
    // Current room info
    currentRoomName,
    currentRoomIsHost,
    currentRoomMaxPlayers,
    
    // Public rooms
    publicRooms,
    publicRoomsLoading,

    // Setters for external updates
    setLanRoomCode,
    setVpnActionBusy,
    setCreateRoomName,
    setCreateRoomPassword,
    setCreateRoomPublic,

    // Actions
    resetState,
    createRoom,
    joinRoom,
    installVpn,
    connect,
    disconnect,
    leaveRoom,
    loadPublicRooms,
    refreshPeers,
    copyToClipboard
  }
}
