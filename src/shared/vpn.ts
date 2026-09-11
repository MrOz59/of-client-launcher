export type VpnTransport = 'wireguard' | 'easytier'

export interface VpnPeerState {
  id: string
  name?: string
  ip?: string
  role?: string
  online?: boolean
  connection?: 'direct' | 'relay' | 'connecting' | 'local'
  latencyMs?: number
}

export interface VpnSessionState {
  code: string
  peerId: string
  roomName: string
  vpnIp: string
  hostIp: string
  connected: boolean
  transport: VpnTransport
  peers: VpnPeerState[]
  error?: string
}
