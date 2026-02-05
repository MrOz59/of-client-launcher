/**
 * Shared types and context for IPC handlers
 */
import type { BrowserWindow } from 'electron'
import type { AchievementsManager } from '../achievements/manager'
import type { AchievementOverlay } from '../achievements/overlay'

// ============================================================================
// Payload Types
// ============================================================================

export type DownloadProgressPayload = {
  url?: string
  magnet?: string
  infoHash?: string
  progress: number
  speed?: number
  downloaded?: number
  total?: number
  eta?: number
  peers?: number
  seeds?: number
  stage?: 'download' | 'extract'
  extractProgress?: number
  destPath?: string
}

export type UpdateQueueStatusPayload = {
  running: boolean
  queued: number
  currentGameUrl?: string | null
  lastError?: string | null
  updatedAt: number
}

export type PrefixJobStatusPayload = {
  gameUrl: string
  status: 'starting' | 'progress' | 'done' | 'error'
  message?: string
  prefix?: string
}

export type GameLaunchStatusPayload = {
  gameUrl: string
  status: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  code?: number | null
  signal?: string | null
  message?: string
  startedAt?: number
  stderrTail?: string
  protonLogPath?: string
}

export type CloudSavesStatusPayload = {
  at: number
  gameUrl?: string
  gameKey?: string
  stage: 'restore' | 'backup'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  conflict?: boolean
}

export type RunningGameProc = {
  pid: number
  child: any
  protonLogPath?: string
  startedAt?: number
  overlaySessionId?: string
}

// ============================================================================
// IPC Context - Shared state accessible to all handlers
// ============================================================================

export interface IpcContext {
  // Main window reference
  getMainWindow: () => BrowserWindow | null

  // Running games state
  runningGames: Map<string, RunningGameProc>

  // Prefix jobs state
  inFlightPrefixJobs: Map<string, { startedAt: number }>

  // Update queue state
  updateQueue: string[]
  updateQueueRunning: boolean
  updateQueueCurrent: string | null
  updateQueueLastError: string | null
  setUpdateQueueRunning: (v: boolean) => void
  setUpdateQueueCurrent: (v: string | null) => void
  setUpdateQueueLastError: (v: string | null) => void

  // Achievement managers
  achievementsManager: AchievementsManager
  achievementOverlay: AchievementOverlay

  // Notification helpers
  sendDownloadProgress: (payload: DownloadProgressPayload) => void
  sendUpdateQueueStatus: () => void
  sendGameLaunchStatus: (payload: GameLaunchStatusPayload) => void
  sendPrefixJobStatus: (payload: PrefixJobStatusPayload) => void
  sendCloudSavesStatus: (payload: CloudSavesStatusPayload) => void

  // Utility functions
  fetchAndPersistBanner: (gameUrl: string, title: string) => Promise<void>
  prepareGamePrefixAfterInstall: (gameUrl: string, title: string, installDir: string) => Promise<void>
}

// ============================================================================
// Handler Registration Helper
// ============================================================================

export type IpcHandlerRegistrar = (context: IpcContext) => void
