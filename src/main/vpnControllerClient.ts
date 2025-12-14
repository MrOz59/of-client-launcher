type VpnRoomCreateResponse = { ok: boolean; code?: string; config?: string; vpnIp?: string; error?: string }
type VpnRoomJoinResponse = { ok: boolean; config?: string; vpnIp?: string; hostIp?: string | null; error?: string }
type VpnPeersResponse = { ok: boolean; peers?: Array<{ id: string; name?: string; ip?: string; role?: string }>; error?: string }
type VpnStatusResponse = { ok: boolean; enabled?: boolean; ready?: boolean; publicKey?: string; error?: string }

function joinUrl(base: string, path: string): string {
  const trimmed = String(base || '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    const joined = new URL(path.replace(/^\//, ''), u)
    return joined.toString()
  } catch {
    try {
      const u = new URL(`http://${trimmed}`)
      const joined = new URL(path.replace(/^\//, ''), u)
      return joined.toString()
    } catch {
      return ''
    }
  }
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ ok: boolean; status?: number; data?: T; error?: string }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ac.signal })
    const data = (await r.json().catch(() => null)) as T | null
    if (!r.ok) return { ok: false, status: r.status, error: (data as any)?.error || `HTTP ${r.status}` }
    if (!data) return { ok: false, status: r.status, error: `HTTP ${r.status}` }
    return { ok: true, status: r.status, data }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { ok: false, error: 'Timeout' }
    return { ok: false, error: err?.message || 'Falha de rede' }
  } finally {
    clearTimeout(t)
  }
}

export async function vpnControllerStatus(params: { controllerUrl: string; timeoutMs?: number }) {
  const endpoint = joinUrl(params.controllerUrl, '/api/vpn/status')
  if (!endpoint) return { success: false, error: 'VPN Controller URL inválida' }
  const out = await fetchJson<VpnStatusResponse>(endpoint, { method: 'GET' }, Number(params.timeoutMs || 4000))
  if (!out.ok || !out.data?.ok) return { success: false, error: out.error || out.data?.error || 'Falha ao consultar status' }
  return { success: true, data: out.data }
}

export async function vpnControllerCreateRoom(params: { controllerUrl: string; name?: string; timeoutMs?: number }) {
  const endpoint = joinUrl(params.controllerUrl, '/api/vpn/rooms/create')
  if (!endpoint) return { success: false, error: 'VPN Controller URL inválida' }
  const out = await fetchJson<VpnRoomCreateResponse>(
    endpoint,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: params.name || '' }) },
    Number(params.timeoutMs || 12000)
  )
  if (!out.ok || !out.data?.ok) return { success: false, error: out.error || out.data?.error || 'Falha ao criar sala' }
  return { success: true, code: out.data.code, config: out.data.config, vpnIp: out.data.vpnIp }
}

export async function vpnControllerJoinRoom(params: { controllerUrl: string; code: string; name?: string; timeoutMs?: number }) {
  const endpoint = joinUrl(params.controllerUrl, '/api/vpn/rooms/join')
  if (!endpoint) return { success: false, error: 'VPN Controller URL inválida' }
  const code = String(params.code || '').trim().toUpperCase()
  if (!code) return { success: false, error: 'Código ausente' }
  const out = await fetchJson<VpnRoomJoinResponse>(
    endpoint,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: params.name || '' }) },
    Number(params.timeoutMs || 12000)
  )
  if (!out.ok || !out.data?.ok) return { success: false, error: out.error || out.data?.error || 'Falha ao entrar na sala' }
  return { success: true, config: out.data.config, vpnIp: out.data.vpnIp, hostIp: out.data.hostIp ?? null }
}

export async function vpnControllerListPeers(params: { controllerUrl: string; code: string; timeoutMs?: number }) {
  const code = String(params.code || '').trim().toUpperCase()
  if (!code) return { success: false, error: 'Código ausente' }
  const endpoint = joinUrl(params.controllerUrl, `/api/vpn/rooms/peers?code=${encodeURIComponent(code)}`)
  if (!endpoint) return { success: false, error: 'VPN Controller URL inválida' }
  const out = await fetchJson<VpnPeersResponse>(endpoint, { method: 'GET' }, Number(params.timeoutMs || 5000))
  if (!out.ok || !out.data?.ok) return { success: false, error: out.error || out.data?.error || 'Falha ao listar peers' }
  return { success: true, peers: out.data.peers || [] }
}

