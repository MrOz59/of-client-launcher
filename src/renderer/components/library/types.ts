// Types for Library components and hooks

export interface Game {
  id: number
  title: string
  url: string
  installed_version: string | null
  latest_version: string | null
  install_path?: string
  image_url?: string
  executable_path?: string | null
  proton_runtime?: string | null
  proton_options?: string | null
  download_url?: string | null
  torrent_magnet?: string | null
  proton_prefix?: string | null
  steam_app_id?: string | null
  lan_mode?: string | null
  lan_network_id?: string | null
  lan_autoconnect?: number | null

  // DB metadata
  last_played?: string | null
  file_size?: string | null
  is_favorite?: number | boolean | null
}

export type LanMode = 'steam' | 'ofvpn'

export type GameConfigTab = 'geral' | 'onlinefix' | 'proton' | 'lan'

export interface ProtonOptions {
  esync: boolean
  fsync: boolean
  dxvk: boolean
  mesa_glthread: boolean
  locale: string
  gamemode: boolean
  mangohud: boolean
  logging: boolean
  launchArgs: string
  useGamescope: boolean // Run game inside Gamescope for in-game notifications
}

export interface ProtonRuntime {
  name: string
  path: string
  runner: string
  source: string
}

export interface LaunchState {
  status: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  code?: number | null
  message?: string
  stderrTail?: string
  protonLogPath?: string
  updatedAt: number
}

export interface PrefixJobState {
  status: 'starting' | 'progress' | 'done' | 'error'
  message?: string
  prefix?: string
  updatedAt: number
}

export interface SaveSyncJobState {
  status: 'syncing' | 'done' | 'error'
  message?: string
  updatedAt: number
}

export interface AchievementProgress {
  complete: boolean
  total: number
  unlocked: number
  updatedAt: number
}

export interface CloudSavesBannerState {
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  gameUrl?: string
  at: number
  conflict?: boolean
}

export interface ConfigSaveState {
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  message?: string
  updatedAt: number
}

export interface UpdateQueueState {
  running: boolean
  queued: number
  currentGameUrl?: string | null
  lastError?: string | null
  updatedAt: number
}

export interface UpdatingGameState {
  status: 'starting' | 'downloading'
  id?: string
}

export interface IniField {
  key: string
  value: string
}

export interface VpnStatusState {
  controller?: string | null
  installed: boolean
  installError?: string | null
}

export interface VpnPeer {
  id?: string
  ip?: string
  name?: string
  role?: string
  online?: boolean
}

export interface VpnRoom {
  code: string
  name: string
  gameName?: string
  hostName?: string
  hasPassword: boolean
  playerCount: number
  onlineCount: number
  maxPlayers: number
  createdAt: number
  lastActivity: number
}

// Alias for public room listing
export type PublicRoom = VpnRoom

export interface SavedConfigState {
  title: string
  version: string
  protonRuntime: string
  protonOptionsJson: string
  protonPrefix: string
  steamAppId: string | null
  lanMode: LanMode
  lanNetworkId: string
  lanAutoconnect: boolean
}
