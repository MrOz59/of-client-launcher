import { isIP } from 'node:net'

export interface VpnMeshConfig {
  version: 1
  transport: 'easytier'
  networkName: string
  networkSecret: string
  ipv4: string
  hostname: string
  peers: string[]
}

export function parseMeshConfig(text: string): VpnMeshConfig {
  if (text.length > 16_384) throw new Error('Configuração P2P muito grande')
  const value = JSON.parse(text)
  if (value?.version !== 1 || value.transport !== 'easytier' ||
      typeof value.networkName !== 'string' || typeof value.networkSecret !== 'string' || typeof value.hostname !== 'string' ||
      !/^of-room-[a-f0-9]{32}$/.test(value.networkName) ||
      !/^[a-f0-9]{64}$/.test(value.networkSecret) ||
      !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(value.hostname)) throw new Error('Configuração P2P inválida')
  const [ip, prefix] = String(value.ipv4).split('/')
  if (isIP(ip) !== 4 || !ip.startsWith('10.77.0.') || prefix !== '24' ||
      Number(ip.split('.')[3]) < 2 || Number(ip.split('.')[3]) > 254) throw new Error('Endereço P2P inválido')
  if (!Array.isArray(value.peers) || !value.peers.length || value.peers.length > 16) throw new Error('Pontos de encontro P2P inválidos')
  for (const peer of value.peers) {
    if (typeof peer !== 'string' || peer.length > 256) throw new Error('Endpoint P2P inválido')
    const url = new URL(peer)
    if (!['tcp:', 'udp:'].includes(url.protocol) || !url.hostname || Number(url.port) < 1 || Number(url.port) > 65535 ||
        url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error('Endpoint P2P inválido')
  }
  // Select fields explicitly. Never accept raw engine flags, routes or TOML from the controller.
  return { version: 1, transport: 'easytier', networkName: value.networkName, networkSecret: value.networkSecret,
    // EasyTier truncates hostnames to 32 characters. A compact UUID retains all
    // identity bits and lets readiness checks compare the actual runtime name.
    ipv4: value.ipv4, hostname: value.hostname.replace(/-/g, ''), peers: value.peers }
}

export function buildMeshToml(config: VpnMeshConfig): string {
  const quote = (text: string) => JSON.stringify(text)
  return [
    'instance_name = "ofvpn"',
    `hostname = ${quote(config.hostname)}`,
    `ipv4 = ${quote(config.ipv4)}`,
    'dhcp = false',
    'listeners = ["udp://0.0.0.0:0", "tcp://0.0.0.0:0"]',
    // Restrict routes to the gaming subnet, ignoring routes advertised by peers.
    'routes = ["10.77.0.0/24"]',
    'exit_nodes = []',
    '[network_identity]',
    `network_name = ${quote(config.networkName)}`,
    `network_secret = ${quote(config.networkSecret)}`,
    ...config.peers.flatMap(peer => ['[[peer]]', `uri = ${quote(peer)}`]),
    '[flags]',
    'dev_name = "ofmesh"',
    'enable_encryption = true',
    'enable_exit_node = false',
    'disable_p2p = false',
    'latency_first = true',
    'mtu = 1360',
    'compression = "none"',
    // Only this room, and only for its own members: a player never carries
    // traffic for networks they are not in, but must be able to carry it for
    // the room they joined. With no network whitelisted at all, EasyTier keeps
    // the route it already has — the rendezvous, which drops game traffic — and
    // a player who joins later cannot bridge a pair that has no direct path
    // (measured in scripts/test-vpn-mesh-fallback.py: broken for 90s, against
    // an immediate recovery once the room is whitelisted).
    `relay_network_whitelist = ${quote(config.networkName)}`,
    'relay_all_peer_rpc = false',
    'accept_dns = false',
    'enable_kcp_proxy = false',
    'enable_quic_proxy = false',
    ''
  ].join('\n')
}

/** A member of the room, as opposed to the rendezvous, which has no address. */
const ROOM_ADDRESS = /^10\.77\.0\.\d{1,3}(?:\/\d{1,2})?$/

/**
 * Who is reachable, and through whom.
 *
 * The peer list alone is not enough to say a player is reachable. The
 * rendezvous relays discovery for the room but refuses to carry its traffic,
 * and EasyTier still offers it as a path: a pair with no direct route ends up
 * with `relay(2)` towards a node that drops every packet. Reported as "via
 * relay" that reads as connected while the game finds nobody.
 *
 * So a relayed route only counts when the next hop is another member of the
 * room — a player, who does carry it. Anything else is still looking for a
 * path. `latency_first` is on, so the hop that matters is the one EasyTier
 * picks under that policy.
 */
export function parseMeshPeers(text: string, routeText?: string): Array<{ ip: string; connection: 'direct' | 'relay' | 'local' | 'connecting'; latencyMs?: number }> {
  const rows = JSON.parse(text)
  if (!Array.isArray(rows)) throw new Error('Resposta P2P inválida')
  const hops = parseMeshRoutes(routeText)
  return rows.flatMap(row => {
    if (isIP(row?.ipv4) !== 4) return []
    const cost = String(row.cost)
    const local = cost === 'Local'
    const direct = cost === 'p2p' || cost === '1'
    const relayed = hops === null || hops.get(row.ipv4) === 'player'
    const connection = local ? 'local' as const : direct ? 'direct' as const : relayed ? 'relay' as const : 'connecting' as const
    const latency = Number(row.lat_ms)
    // While a path is still being looked for, what the engine reports is its
    // own per-hop penalty, not a measurement: showing it reads as a slow but
    // working link.
    const measured = connection !== 'local' && connection !== 'connecting' && Number.isFinite(latency) && latency >= 0
    return [{ ip: row.ipv4, connection, ...(measured ? { latencyMs: latency } : {}) }]
  })
}

/**
 * The next hop per destination, as either another player or the rendezvous.
 * Returns null when the table could not be read, so a failed lookup leaves the
 * previous, coarser reading rather than reporting everyone as unreachable.
 */
function parseMeshRoutes(routeText?: string): Map<string, 'player' | 'rendezvous'> | null {
  if (!routeText) return null
  try {
    const rows = JSON.parse(routeText)
    if (!Array.isArray(rows)) return null
    const hops = new Map<string, 'player' | 'rendezvous'>()
    for (const row of rows) {
      const ip = String(row?.ipv4 || '').split('/')[0]
      if (isIP(ip) !== 4) continue
      const hop = String(row.next_hop_ipv4_lat_first || row.next_hop_ipv4 || '').trim()
      hops.set(ip, hop === 'DIRECT' || ROOM_ADDRESS.test(hop) ? 'player' : 'rendezvous')
    }
    return hops
  } catch {
    return null
  }
}
