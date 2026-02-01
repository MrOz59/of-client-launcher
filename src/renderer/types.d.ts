/// <reference types="vite/client" />

import type { Cookie } from 'electron'

type DownloadResult = { success: boolean; error?: string }
type VersionResult =
  | { success: true; version: string; torrentUrl?: string | null }
  | { success: false; error: string }
type DownloadProgressPayload = {
  url?: string
  magnet?: string
  progress: number
  speed?: number
  eta?: number
  downloaded?: number
  total?: number
  infoHash?: string
  destPath?: string
  stage?: 'download' | 'extract'
  extractProgress?: number
}
type ActiveDownload = {
  id: number
  game_url?: string
  title?: string
  type: 'http' | 'torrent'
  download_url: string
  dest_path?: string
  progress?: number
  status?: string
  info_hash?: string
  speed?: string
  eta?: string
  size?: string
  downloaded?: string
  seeds?: number
  peers?: number
  error_message?: string
}
type ActiveDownloadsResult = { success: boolean; downloads: ActiveDownload[]; error?: string }
type CompletedDownloadsResult = { success: boolean; downloads: ActiveDownload[]; error?: string }

type DriveListItem = {
  id: string
  name: string
  mimeType?: string
  size?: number
  modifiedTime?: string
  createdTime?: string
}

type CloudSavesStatusPayload = {
  at: number
  gameUrl?: string
  gameKey?: string
  stage: 'restore' | 'backup'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  conflict?: boolean
}

type DownloadQueueItem = {
  id: string
  gameUrl: string
  title: string
  priority: number
  addedAt: number
}

type DownloadQueueStatus = {
  maxParallel: number
  activeCount: number
  queuedCount: number
  active: DownloadQueueItem[]
  queued: DownloadQueueItem[]
  updatedAt: number
}

export {}

declare global {
  interface Window {
    electronAPI: {
      openAuthWindow: () => Promise<boolean>
      checkGameVersion: (url: string) => Promise<VersionResult>
      onCookiesSaved: (cb: (cookies: Cookie[]) => void) => (() => void)
      onCookiesCleared: (cb: () => void) => (() => void)
      clearCookies: () => Promise<{ success: boolean; error?: string }>
      downloadHttp: (url: string, dest: string) => Promise<DownloadResult>
      downloadTorrent: (magnet: string, dest: string) => Promise<DownloadResult>
      startTorrentDownload: (url: string, referer?: string) => Promise<DownloadResult>
      getActiveDownloads: () => Promise<ActiveDownloadsResult>
      getCompletedDownloads: () => Promise<CompletedDownloadsResult>
      pauseDownload: (torrentId: string) => Promise<DownloadResult>
      resumeDownload: (torrentId: string) => Promise<DownloadResult>
      cancelDownload: (torrentId: string) => Promise<DownloadResult>
      onDownloadProgress: (cb: (data: DownloadProgressPayload) => void) => (() => void)
      onDownloadComplete: (cb: (data: { magnet?: string; infoHash?: string; destPath?: string }) => void) => (() => void)
      
      // Download Queue APIs
      getDownloadQueueStatus: () => Promise<{ success: boolean; status?: DownloadQueueStatus; error?: string }>
      prioritizeDownload: (queueId: string) => Promise<{ success: boolean; error?: string }>
      removeFromDownloadQueue: (queueId: string) => Promise<{ success: boolean; error?: string }>
      swapActiveDownload: (queueId: string) => Promise<{ success: boolean; error?: string }>
      onDownloadQueueStatus: (cb: (data: DownloadQueueStatus) => void) => (() => void)

      openPath: (target: string) => Promise<DownloadResult>
      getSettings: () => Promise<{ success: boolean; settings?: any; platform?: string; isLinux?: boolean; error?: string }>
      saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>
      selectDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>
      extractDownload: (downloadId: number | string, path?: string) => Promise<DownloadResult & { destPath?: string }>
      protonEnsureRuntime: (customPath?: string) => Promise<{ success: boolean; runtime?: string; runner?: string; error?: string }>
      protonListRuntimes: (force?: boolean) => Promise<{ success: boolean; runtimes?: Array<{ name: string; path: string; runner: string; source: string }>; error?: string }>
      protonSetRoot: (rootPath: string) => Promise<{ success: boolean; runtimes?: Array<{ name: string; path: string; runner: string; source: string }>; error?: string }>
      protonDefaultPrefix: (forceRecreate?: boolean) => Promise<{ success: boolean; prefix?: string; error?: string }>
      protonPreparePrefix: (slug: string) => Promise<{ success: boolean; prefix?: string; error?: string }>
      protonBuildLaunch: (exePath: string, args: string[], slug: string, runtimePath?: string, prefixPath?: string) => Promise<{ success: boolean; launch?: any; error?: string }>
      protonCreateGamePrefix: (gameUrl: string, title?: string, commonRedistPath?: string) => Promise<{ success: boolean; prefix?: string; error?: string }>
      setGameProtonPrefix: (gameUrl: string, prefixPath: string | null) => Promise<{ success: boolean; error?: string }>
      setGameSteamAppId: (gameUrl: string, steamAppId: string | null) => Promise<{ success: boolean; error?: string }>
      getGames: () => Promise<{ success: boolean; games: any[]; error?: string }>
      launchGame: (gameUrl: string) => Promise<{ success: boolean; error?: string }>
      stopGame: (gameUrl: string, force?: boolean) => Promise<{ success: boolean; error?: string }>
      deleteGame: (gameUrl: string) => Promise<{ success: boolean; error?: string }>
      openGameFolder: (path: string) => Promise<{ success: boolean; error?: string }>
      configureGameExe: (gameUrl: string) => Promise<{ success: boolean; exePath?: string; error?: string }>
      setGameVersion: (gameUrl: string, version: string) => Promise<{ success: boolean; error?: string }>
      setGameTitle: (gameUrl: string, title: string) => Promise<{ success: boolean; error?: string }>
      setGameFavorite: (gameUrl: string, isFavorite: boolean) => Promise<{ success: boolean; isFavorite?: boolean; error?: string }>
      toggleGameFavorite: (gameUrl: string) => Promise<{ success: boolean; isFavorite?: boolean; error?: string }>
      setGameProtonOptions: (gameUrl: string, runtime: string, options: any) => Promise<{ success: boolean; error?: string }>
      setGameLanSettings: (gameUrl: string, payload: { mode?: string | null; networkId?: string | null; autoconnect?: boolean }) => Promise<{ success: boolean; error?: string }>
      vpnStatus: () => Promise<{ success: boolean; controller?: any; installed?: boolean; installError?: string; error?: string }>
      vpnInstall: () => Promise<{ success: boolean; error?: string; url?: string }>
      vpnRoomCreate: (payload?: {
        name?: string
        roomName?: string
        gameName?: string
        password?: string
        public?: boolean
        maxPlayers?: number
      }) => Promise<{ success: boolean; code?: string; config?: string; vpnIp?: string; peerId?: string; roomName?: string; error?: string }>
      vpnRoomJoin: (code: string, payload?: { name?: string; password?: string }) => Promise<{ success: boolean; config?: string; vpnIp?: string; hostIp?: string; peerId?: string; roomName?: string; needsPassword?: boolean; error?: string }>
      vpnRoomPeers: (code: string) => Promise<{ success: boolean; peers?: Array<{ id: string; name?: string; ip?: string; role?: string; online?: boolean }>; error?: string }>
      vpnRoomList: (payload?: { gameName?: string }) => Promise<{ success: boolean; rooms?: Array<{
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
      }>; error?: string }>
      vpnHeartbeat: (peerId: string) => Promise<{ success: boolean; peers?: Array<{ id: string; name?: string; ip?: string; role?: string; online?: boolean }>; error?: string }>
      vpnRoomLeave: (peerId: string) => Promise<{ success: boolean; error?: string }>
      vpnConnect: (config: string) => Promise<{ success: boolean; tunnelName?: string; configPath?: string; needsInstall?: boolean; needsAdmin?: boolean; error?: string }>
      vpnDisconnect: () => Promise<{ success: boolean; needsAdmin?: boolean; error?: string }>

      // Achievements
      getGameAchievements: (gameUrl: string) => Promise<{ success: boolean; sources?: any[]; achievements?: any[]; error?: string }>
      importAchievementSchema: (gameUrl: string) => Promise<{ success: boolean; count?: number; error?: string }>
      saveAchievementSchema: (gameUrl: string, rawJson: string) => Promise<{ success: boolean; count?: number; error?: string }>
      clearAchievementSchema: (gameUrl: string) => Promise<{ success: boolean; error?: string }>
      forceRefreshAchievementSchema: (gameUrl: string) => Promise<{ success: boolean; error?: string }>
      onAchievementUnlocked: (cb: (data: { gameUrl: string; id: string; title: string; description?: string; unlockedAt?: number }) => void) => (() => void)

      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
      getOnlineFixIni: (gameUrl: string) => Promise<{ success: boolean; path?: string; content?: string; exists?: boolean; error?: string }>
      saveOnlineFixIni: (gameUrl: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>
      fetchGameImage: (gameUrl: string, title: string) => Promise<{ success: boolean; imageUrl?: string; error?: string }>
      setGameImageUrl: (gameUrl: string, imageUrl: string | null) => Promise<{ success: boolean; imageUrl?: string | null; error?: string }>
      pickGameBannerFile: (gameUrl: string) => Promise<{ success: boolean; imageUrl?: string; path?: string; canceled?: boolean; error?: string }>
      fetchGameUpdateInfo: (gameUrl: string) => Promise<{ success: boolean; latest?: string | null; torrentUrl?: string | null; error?: string }>
      getUserProfile: () => Promise<{ success: boolean; name?: string | null; avatar?: string | null; avatarData?: string | null; profileUrl?: string | null; error?: string }>
      checkAllUpdates: () => Promise<{ success: boolean; results?: any[]; error?: string }>
      scanInstalledGames: () => Promise<{ success: boolean; scanned?: number; added?: number; skipped?: number; error?: string }>

      queueGameUpdates: (gameUrls: string[]) => Promise<{ success: boolean; queuedAdded?: number; error?: string }>
      clearUpdateQueue: () => Promise<{ success: boolean; error?: string }>
      getUpdateQueueStatus: () => Promise<{ success: boolean; status?: { running: boolean; queued: number; currentGameUrl?: string | null; lastError?: string | null; updatedAt: number }; error?: string }>
      getCookieHeader: (url: string) => Promise<string>
      exportCookies: (url?: string) => Promise<any>
      deleteDownload: (downloadId: number) => Promise<{ success: boolean; error?: string }>
      onGameVersionUpdate: (cb: (data: { url: string; latest?: string }) => void) => (() => void)
      onUpdateQueueStatus: (cb: (data: { running: boolean; queued: number; currentGameUrl?: string | null; lastError?: string | null; updatedAt: number }) => void) => (() => void)
      onDownloadDeleted: (cb: () => void) => (() => void)
      onGameLaunchStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'running' | 'exited' | 'error'; pid?: number; code?: number | null; signal?: string | null; message?: string; stderrTail?: string; protonLogPath?: string }) => void) => (() => void)
      onPrefixJobStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'progress' | 'done' | 'error'; message?: string; prefix?: string }) => void) => (() => void)

      // Cloud Saves (Ludusavi + Drive)
      onCloudSavesStatus: (cb: (data: CloudSavesStatusPayload) => void) => (() => void)
      cloudSavesOpenBackups: (gameUrl: string) => Promise<{ success: boolean; error?: string }>
      cloudSavesGetHistory: (gameUrl: string, limit?: number) => Promise<{ success: boolean; entries?: any[]; error?: string }>

      // Navigation events from tray menu
      onNavigateToTab: (cb: (tab: string) => void) => (() => void)
      onNavigateToGame: (cb: (gameUrl: string) => void) => (() => void)

      // Test/Debug
      testNotification: (type: string) => Promise<{ success: boolean; error?: string }>

      // Drive
      driveAuth: () => Promise<{
        success: boolean
        message?: string
        error?: string
        ludusaviPrepared?: boolean
        ludusaviPath?: string
        ludusaviDownloaded?: boolean
        ludusaviError?: string
      }>
      driveGetCredentials: () => Promise<{ success: boolean; content?: string; message?: string }>
      driveOpenCredentials: () => Promise<{ success: boolean; message?: string }>
      driveSaveCredentials: (rawJson: string) => Promise<{ success: boolean; message?: string }>
      driveListSaves: () => Promise<{ success: boolean; files?: DriveListItem[]; message?: string; error?: string }>
      driveListSavesForGame: (realAppId: string) => Promise<{ success: boolean; files?: DriveListItem[]; error?: string }>
      driveUploadSave: (localPath: string, remoteName?: string) => Promise<{ success: boolean; message?: string; error?: string }>
      driveDownloadSave: (fileId: string, destPath: string) => Promise<{ success: boolean; message?: string; error?: string }>

      // Saves sync entrypoint (manual / after-exit)
      syncGameSaves: (gameUrl: string) => Promise<{ success: boolean; message?: string; error?: string }>
    }
  }
}
