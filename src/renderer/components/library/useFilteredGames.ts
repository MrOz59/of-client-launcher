import { useMemo } from 'react'
import type { Game, UpdateQueueState, UpdatingGameState } from './types'

export interface UseFilteredGamesOptions {
  games: Game[]
  search: string
  category: 'all' | 'favorites' | 'installed' | 'updating'
  sort: 'recent' | 'name' | 'size'
  updatingGames: Record<string, UpdatingGameState>
  updateQueue: UpdateQueueState
}

export function useFilteredGames({
  games,
  search,
  category,
  sort,
  updatingGames,
  updateQueue
}: UseFilteredGamesOptions) {
  return useMemo(() => {
    const norm = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')

    const parseSizeToBytes = (raw: any): number => {
      const s = String(raw || '').trim()
      if (!s) return 0
      if (/^\d+$/.test(s)) return Number(s) || 0
      const m = s.replace(',', '.').match(/([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)/i)
      if (!m) return 0
      const n = Number(m[1])
      if (!Number.isFinite(n)) return 0
      const unit = String(m[2]).toLowerCase()
      const isI = unit.endsWith('ib')
      const base = isI ? 1024 : 1000
      const pow = unit.startsWith('t') ? 4 : unit.startsWith('g') ? 3 : unit.startsWith('m') ? 2 : unit.startsWith('k') ? 1 : 0
      return Math.round(n * Math.pow(base, pow))
    }

    const safeDateMs = (v: any) => {
      if (v == null) return 0
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return 0
        // Support timestamps in ms (13 digits) or seconds (10 digits)
        return v > 1e12 ? v : Math.round(v * 1000)
      }
      const s = String(v).trim()
      if (!s) return 0
      if (/^\d+$/.test(s)) {
        const n = Number(s)
        if (!Number.isFinite(n)) return 0
        return n > 1e12 ? n : Math.round(n * 1000)
      }
      const t = Date.parse(s)
      return Number.isFinite(t) ? t : 0
    }

    const isUpdating = (gameUrl: string) => {
      if (!gameUrl) return false
      if ((updatingGames as any)?.[gameUrl]) return true
      if (updateQueue?.running && updateQueue?.currentGameUrl === gameUrl) return true
      return false
    }

    const qRaw = String(search || '').trim()
    let list = (games || []).slice()

    if (qRaw) {
      const q = norm(qRaw)
      list = list.filter((g) => norm(String(g?.title || '')).includes(q))
    }

    if (category !== 'all') {
      list = list.filter((g) => {
        const url = String(g?.url || '')
        const installed = !!(g as any)?.install_path || !!(g as any)?.installed_version
        const fav = !!(g as any)?.is_favorite
        if (category === 'favorites') return fav
        if (category === 'installed') return installed
        if (category === 'updating') return isUpdating(url)
        return true
      })
    }

    list.sort((a, b) => {
      if (sort === 'name') {
        return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
      }
      if (sort === 'size') {
        const av = parseSizeToBytes((a as any)?.file_size)
        const bv = parseSizeToBytes((b as any)?.file_size)
        if (bv !== av) return bv - av
        return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
      }
      const am = safeDateMs((a as any)?.last_played)
      const bm = safeDateMs((b as any)?.last_played)
      if (bm !== am) return bm - am
      return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR', { sensitivity: 'base' })
    })

    return list
  }, [games, search, category, sort, updatingGames, updateQueue])
}

export function hasUpdate(game: Game): boolean {
  if (!game.latest_version || !game.installed_version) return false
  const v1 = String(game.installed_version).trim().toLowerCase()
  const v2 = String(game.latest_version).trim().toLowerCase()
  if (v1 === v2) return false

  // Parse Build DDMMYYYY format to comparable number
  const parseBuildDate = (v: string): number | null => {
    const match = v.match(/build[.\s]*(\d{2})(\d{2})(\d{4})/i)
    if (match) {
      // DDMMYYYY -> YYYYMMDD for proper comparison
      return parseInt(match[3] + match[2] + match[1], 10)
    }
    const match2 = v.match(/build[.\s]*(\d{8})/i)
    if (match2) {
      const d = match2[1]
      return parseInt(d.slice(4, 8) + d.slice(2, 4) + d.slice(0, 2), 10)
    }
    return null
  }

  const build1 = parseBuildDate(v1)
  const build2 = parseBuildDate(v2)

  // If both are Build dates, compare them
  if (build1 !== null && build2 !== null) {
    return build2 > build1
  }

  // For semantic versions or other formats, different = update available
  return true
}
