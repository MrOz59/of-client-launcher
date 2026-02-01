/**
 * IPC Handlers Index - Exports all handler registration functions
 */
export * from './types'
export { registerDriveHandlers } from './driveHandlers'
export { registerDownloadHandlers } from './downloadHandlers'
export { registerGameHandlers } from './gameHandlers'
export { registerSettingsHandlers } from './settingsHandlers'
export { registerVpnHandlers } from './vpnHandlers'
export { registerProtonHandlers, getCachedProtonRuntimes } from './protonHandlers'
export { registerAchievementsHandlers, detectSteamAppIdFromInstall } from './achievementsHandlers'
export { registerAuthHandlers } from './authHandlers'
export { registerTorrentHandlers } from './torrentHandlers'
export { registerLaunchHandlers } from './launchHandlers'

import type { IpcContext } from './types'
import { registerDriveHandlers } from './driveHandlers'
import { registerDownloadHandlers } from './downloadHandlers'
import { registerGameHandlers } from './gameHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerVpnHandlers } from './vpnHandlers'
import { registerProtonHandlers } from './protonHandlers'
import { registerAchievementsHandlers } from './achievementsHandlers'
import { registerAuthHandlers } from './authHandlers'
import { registerTorrentHandlers } from './torrentHandlers'
import { registerLaunchHandlers } from './launchHandlers'

/**
 * Register all IPC handlers
 * @param context - The IPC context containing shared state and helpers
 */
export function registerAllIpcHandlers(context: IpcContext): void {
  registerDriveHandlers(context)
  registerDownloadHandlers(context)
  registerGameHandlers(context)
  registerSettingsHandlers(context)
  registerVpnHandlers(context)
  registerProtonHandlers(context)
  registerAchievementsHandlers(context)
  registerAuthHandlers(context)
  registerTorrentHandlers(context)
  registerLaunchHandlers(context)
}
