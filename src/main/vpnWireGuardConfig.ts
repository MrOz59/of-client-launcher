import { isIP } from 'node:net'

// wg-quick supports shell hooks executed as administrator. Room configs only
// need addresses and one WireGuard peer; refuse executable/unknown directives.
export function validateWireGuardConfig(text: string): void {
  if (!text || text.length > 16_384) throw new Error('Configuração WireGuard inválida')
  let section = ''
  let interfaces = 0
  let peerCount = 0
  const seen = new Set<string>()
  const key = (value: string) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32
  const cidr = (value: string) => {
    const [ip, prefix, extra] = value.split('/')
    return !extra && isIP(ip) !== 0 && /^\d+$/.test(prefix || '') && Number(prefix) > 0 && Number(prefix) <= (isIP(ip) === 4 ? 32 : 128)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    if (line === '[Interface]') { section = 'interface'; interfaces++; continue }
    if (line === '[Peer]') { section = 'peer'; peerCount++; continue }
    const match = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/)
    if (!match || !section) throw new Error('Diretiva WireGuard inválida')
    const [, field, rawValue] = match
    const value = rawValue.trim()
    const id = `${section}.${field}`
    if (seen.has(id)) throw new Error('Diretiva WireGuard duplicada')
    seen.add(id)
    let valid = false
    if (id === 'interface.PrivateKey' || id === 'peer.PublicKey') valid = key(value)
    if (id === 'interface.Address' || id === 'peer.AllowedIPs') valid = value.split(',').every(part => cidr(part.trim()))
    if (id === 'interface.DNS') valid = value.split(',').every(part => isIP(part.trim()) !== 0)
    if (id === 'peer.PersistentKeepalive') valid = /^\d+$/.test(value) && Number(value) <= 65535
    if (id === 'peer.Endpoint') {
      try {
        const endpoint = new URL(`udp://${value}`)
        valid = !!endpoint.hostname && Number(endpoint.port) > 0 && Number(endpoint.port) <= 65535 &&
          !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && !endpoint.pathname
      } catch { /* Invalid endpoint */ }
    }
    if (!valid) throw new Error(`Diretiva WireGuard não permitida: ${field}`)
  }
  if (interfaces !== 1 || peerCount !== 1 || !['interface.PrivateKey', 'interface.Address', 'peer.PublicKey', 'peer.AllowedIPs', 'peer.Endpoint'].every(field => seen.has(field))) {
    throw new Error('Configuração WireGuard incompleta')
  }
}
