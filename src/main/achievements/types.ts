export type GameAchievementSourceKind =
  | 'goldberg_json'
  | 'empress_json'
  | 'onlinefix_ini'
  | 'codex_ini'
  | 'rune_ini'
  | 'rld_ini'
  | 'rle_ini'
  | 'skidrow_ini'
  | 'userstats_ini'
  | '_3dm_ini'
  | 'smartsteamemu_ini'
  | 'steamemu_achiev_ini'
  | 'creamapi_cfg'
  | 'razor1911_txt'
  | 'exe_relative_ini'

export type GameAchievementSource = {
  kind: GameAchievementSourceKind
  label: string
  path: string
  isDirectory?: boolean
}

export type UnlockedAchievement = {
  id: string
  name?: string
  description?: string
  unlockedAt?: number
  sourcePath?: string
  sourceKind?: GameAchievementSourceKind
}

export type AchievementListItem = {
  id: string
  name?: string
  description?: string
  hidden?: boolean
  percent?: number
  iconPath?: string
  iconUrl?: string
  unlocked: boolean
  unlockedAt?: number
}

export type ParsedAchievement = {
  id: string
  name?: string
  description?: string
  unlocked: boolean
  unlockedAt?: number
}

export type GameMetaForAchievements = {
  gameUrl: string
  title?: string
  installPath?: string | null
  executablePath?: string | null
  steamAppId?: string | null
  // Auto-detected/resolved Steam AppID used only for discovery/schema.
  // Keep `steamAppId` as the explicit DB value so storage keys remain stable.
  schemaSteamAppId?: string | null
  protonPrefix?: string | null
}
