type LanControllerAuthorizeResponse = { ok: boolean; error?: string }
type LanControllerRoomCreateResponse = { ok: boolean; code?: string; networkId?: string; authorized?: boolean; authError?: string | null; error?: string }
type LanControllerRoomJoinResponse = { ok: boolean; networkId?: string; authorized?: boolean; authError?: string | null; error?: string }
type LanControllerConfigResponse = {
  ok: boolean
  defaultNetworkId?: string | null
  zerotier?: { tokenConfigured?: boolean; authorizeRequiresApiKey?: boolean }
  error?: string
}

function joinUrl(base: string, path: string): string {
  const trimmed = String(base || '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    const joined = new URL(path.replace(/^\//, ''), u)
    return joined.toString()
  } catch {
    // Accept "host:port" style inputs.
    try {
      const u = new URL(`http://${trimmed}`)
      const joined = new URL(path.replace(/^\//, ''), u)
      return joined.toString()
    } catch {
      return ''
    }
  }
}

export async function authorizeZeroTierMemberViaController(params: {
  controllerUrl: string
  controllerApiKey?: string
  networkId: string
  memberId: string
  timeoutMs?: number
}): Promise<{ success: boolean; error?: string }> {
  const endpoint = joinUrl(params.controllerUrl, '/api/zerotier/authorize')
  if (!endpoint) return { success: false, error: 'LAN Controller URL inválida' }

  const controllerApiKey = String(params.controllerApiKey || '').trim()
  const networkId = String(params.networkId || '').trim()
  const memberId = String(params.memberId || '').trim()
  if (!networkId) return { success: false, error: 'Network ID ausente' }
  if (!memberId) return { success: false, error: 'Member ID ausente' }

  const timeoutMs = Number(params.timeoutMs || 8000)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(controllerApiKey ? { 'x-api-key': controllerApiKey } : {})
      },
      body: JSON.stringify({ networkId, memberId }),
      signal: ac.signal
    })
    const data = (await r.json().catch(() => null)) as LanControllerAuthorizeResponse | null
    if (!r.ok || !data?.ok) {
      return { success: false, error: data?.error || `LAN Controller retornou ${r.status}` }
    }
    return { success: true }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { success: false, error: 'Timeout ao contatar LAN Controller' }
    return { success: false, error: err?.message || 'Falha ao contatar LAN Controller' }
  } finally {
    clearTimeout(t)
  }
}

export async function lanControllerCreateRoom(params: {
  controllerUrl: string
  controllerApiKey?: string
  name?: string
  memberId?: string
  timeoutMs?: number
}): Promise<{ success: boolean; code?: string; networkId?: string; error?: string }> {
  const endpoint = joinUrl(params.controllerUrl, '/api/rooms/create')
  if (!endpoint) return { success: false, error: 'LAN Controller URL inválida' }

  const controllerApiKey = String(params.controllerApiKey || '').trim()
  const timeoutMs = Number(params.timeoutMs || 12000)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(controllerApiKey ? { 'x-api-key': controllerApiKey } : {})
      },
      body: JSON.stringify({ name: params.name || '', memberId: params.memberId || '' }),
      signal: ac.signal
    })
    const data = (await r.json().catch(() => null)) as LanControllerRoomCreateResponse | null
    if (!r.ok || !data?.ok) {
      return { success: false, error: data?.error || `LAN Controller retornou ${r.status}` }
    }
    return { success: true, code: data.code, networkId: data.networkId }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { success: false, error: 'Timeout ao contatar LAN Controller' }
    return { success: false, error: err?.message || 'Falha ao contatar LAN Controller' }
  } finally {
    clearTimeout(t)
  }
}

export async function lanControllerJoinRoom(params: {
  controllerUrl: string
  controllerApiKey?: string
  code: string
  memberId?: string
  timeoutMs?: number
}): Promise<{ success: boolean; networkId?: string; authorized?: boolean; error?: string }> {
  const endpoint = joinUrl(params.controllerUrl, '/api/rooms/join')
  if (!endpoint) return { success: false, error: 'LAN Controller URL inválida' }

  const code = String(params.code || '').trim().toUpperCase()
  if (!code) return { success: false, error: 'Código da sala ausente' }

  const timeoutMs = Number(params.timeoutMs || 12000)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    // join endpoint doesn't require api-key, but allow passing if configured.
    const controllerApiKey = String(params.controllerApiKey || '').trim()
    if (controllerApiKey) headers['x-api-key'] = controllerApiKey

    const r = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, memberId: params.memberId || '' }),
      signal: ac.signal
    })
    const data = (await r.json().catch(() => null)) as LanControllerRoomJoinResponse | null
    if (!r.ok || !data?.ok) {
      return { success: false, error: data?.error || `LAN Controller retornou ${r.status}` }
    }
    return { success: true, networkId: data.networkId, authorized: !!data.authorized }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { success: false, error: 'Timeout ao contatar LAN Controller' }
    return { success: false, error: err?.message || 'Falha ao contatar LAN Controller' }
  } finally {
    clearTimeout(t)
  }
}

export async function lanControllerGetConfig(params: {
  controllerUrl: string
  timeoutMs?: number
}): Promise<{ success: boolean; defaultNetworkId?: string; error?: string }> {
  const endpoint = joinUrl(params.controllerUrl, '/api/config')
  if (!endpoint) return { success: false, error: 'LAN Controller URL inválida' }

  const timeoutMs = Number(params.timeoutMs || 3000)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(endpoint, { method: 'GET', signal: ac.signal })
    const data = (await r.json().catch(() => null)) as LanControllerConfigResponse | null
    if (!r.ok || !data?.ok) return { success: false, error: data?.error || `LAN Controller retornou ${r.status}` }
    const id = String(data?.defaultNetworkId || '').trim()
    if (!id) return { success: false, error: 'LAN Controller não informou defaultNetworkId' }
    return { success: true, defaultNetworkId: id }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { success: false, error: 'Timeout ao contatar LAN Controller' }
    return { success: false, error: err?.message || 'Falha ao contatar LAN Controller' }
  } finally {
    clearTimeout(t)
  }
}
