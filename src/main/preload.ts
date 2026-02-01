import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

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
}

type GameLaunchStatusPayload = {
  gameUrl: string
  status: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  code?: number | null
  signal?: string | null
  message?: string
  stderrTail?: string
  protonLogPath?: string
}

type PrefixJobStatusPayload = {
  gameUrl: string
  status: 'starting' | 'progress' | 'done' | 'error'
  message?: string
  prefix?: string
}

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

contextBridge.exposeInMainWorld('electronAPI', {
  openAuthWindow: () => ipcRenderer.invoke('open-auth-window'),
  checkGameVersion: (url: string) => ipcRenderer.invoke('check-game-version', url),
  getCookieHeader: (url: string) => ipcRenderer.invoke('get-cookie-header', url),
  exportCookies: (url?: string) => ipcRenderer.invoke('export-cookies', url),
  clearCookies: () => ipcRenderer.invoke('clear-cookies'),

  onCookiesSaved: (cb: (cookies: Electron.Cookie[]) => void) => {
    const handler = (_event: IpcRendererEvent, cookies: Electron.Cookie[]) => cb(cookies)
    ipcRenderer.on('cookies-saved', handler)
    return () => ipcRenderer.removeListener('cookies-saved', handler)
  },

  onCookiesCleared: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('cookies-cleared', handler)
    return () => ipcRenderer.removeListener('cookies-cleared', handler)
  },

  downloadHttp: (url: string, dest: string) => ipcRenderer.invoke('download-http', url, dest),
  downloadTorrent: (magnet: string, dest: string) => ipcRenderer.invoke('download-torrent', magnet, dest),
  startTorrentDownload: (url: string, referer?: string) => ipcRenderer.invoke('start-torrent-download', url, referer),
  pauseDownload: (torrentId: string) => ipcRenderer.invoke('pause-download', torrentId),
  resumeDownload: (torrentId: string) => ipcRenderer.invoke('resume-download', torrentId),
  cancelDownload: (torrentId: string) => ipcRenderer.invoke('cancel-download', torrentId),
  getActiveDownloads: () => ipcRenderer.invoke('get-active-downloads'),
  getCompletedDownloads: () => ipcRenderer.invoke('get-completed-downloads'),
  deleteDownload: (downloadId: number) => ipcRenderer.invoke('delete-download', downloadId),

  getOnlineFixIni: (gameUrl: string) => ipcRenderer.invoke('get-onlinefix-ini', gameUrl),
  saveOnlineFixIni: (gameUrl: string, content: string) => ipcRenderer.invoke('save-onlinefix-ini', gameUrl, content),

  fetchGameImage: (gameUrl: string, title: string) => ipcRenderer.invoke('fetch-game-image', gameUrl, title),
  setGameImageUrl: (gameUrl: string, imageUrl: string | null) =>
    ipcRenderer.invoke('set-game-image-url', gameUrl, imageUrl),
  pickGameBannerFile: (gameUrl: string) => ipcRenderer.invoke('pick-game-banner-file', gameUrl),

  fetchGameUpdateInfo: (gameUrl: string) => ipcRenderer.invoke('fetch-game-update-info', gameUrl),
  getUserProfile: () => ipcRenderer.invoke('get-user-profile'),
  checkAllUpdates: () => ipcRenderer.invoke('check-all-updates'),

  scanInstalledGames: () => ipcRenderer.invoke('scan-installed-games'),

  queueGameUpdates: (gameUrls: string[]) => ipcRenderer.invoke('queue-game-updates', gameUrls),
  clearUpdateQueue: () => ipcRenderer.invoke('clear-update-queue'),
  getUpdateQueueStatus: () => ipcRenderer.invoke('get-update-queue-status'),

  openPath: (target: string) => ipcRenderer.invoke('open-path', target),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),

  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractDownload: (downloadId: number | string, path?: string) => ipcRenderer.invoke('extract-download', downloadId, path),

  protonEnsureRuntime: (customPath?: string) => ipcRenderer.invoke('proton-ensure-runtime', customPath),
  protonListRuntimes: (force?: boolean) => ipcRenderer.invoke('proton-list-runtimes', force),
  protonSetRoot: (rootPath: string) => ipcRenderer.invoke('proton-set-root', rootPath),
  protonDefaultPrefix: (forceRecreate?: boolean) => ipcRenderer.invoke('proton-default-prefix', forceRecreate),
  protonPreparePrefix: (slug: string) => ipcRenderer.invoke('proton-prepare-prefix', slug),
  protonBuildLaunch: (
    exePath: string,
    args: string[],
    slug: string,
    runtimePath?: string,
    prefixPath?: string
  ) => ipcRenderer.invoke('proton-build-launch', exePath, args, slug, runtimePath, prefixPath),
  protonCreateGamePrefix: (gameUrl: string, title?: string, commonRedistPath?: string) =>
    ipcRenderer.invoke('proton-create-game-prefix', gameUrl, title, commonRedistPath),

  setGameProtonPrefix: (gameUrl: string, prefixPath: string | null) =>
    ipcRenderer.invoke('set-game-proton-prefix', gameUrl, prefixPath),
  setGameSteamAppId: (gameUrl: string, steamAppId: string | null) =>
    ipcRenderer.invoke('set-game-steam-appid', gameUrl, steamAppId),

  getGames: () => ipcRenderer.invoke('get-games'),
  launchGame: (gameUrl: string) => ipcRenderer.invoke('launch-game', gameUrl),
  stopGame: (gameUrl: string, force?: boolean) => ipcRenderer.invoke('stop-game', gameUrl, force),
  deleteGame: (gameUrl: string) => ipcRenderer.invoke('delete-game', gameUrl),
  openGameFolder: (path: string) => ipcRenderer.invoke('open-game-folder', path),
  configureGameExe: (gameUrl: string) => ipcRenderer.invoke('configure-game-exe', gameUrl),

  setGameVersion: (gameUrl: string, version: string) => ipcRenderer.invoke('set-game-version', gameUrl, version),
  setGameTitle: (gameUrl: string, title: string) => ipcRenderer.invoke('set-game-title', gameUrl, title),
  setGameFavorite: (gameUrl: string, isFavorite: boolean) => ipcRenderer.invoke('set-game-favorite', gameUrl, isFavorite),
  toggleGameFavorite: (gameUrl: string) => ipcRenderer.invoke('toggle-game-favorite', gameUrl),
  setGameProtonOptions: (gameUrl: string, runtime: string, options: any) =>
    ipcRenderer.invoke('set-game-proton-options', gameUrl, runtime, options),

  setGameLanSettings: (gameUrl: string, payload: { mode?: string | null; networkId?: string | null; autoconnect?: boolean }) =>
    ipcRenderer.invoke('set-game-lan-settings', gameUrl, payload),

  vpnStatus: () => ipcRenderer.invoke('vpn-status'),
  vpnInstall: () => ipcRenderer.invoke('vpn-install'),
  vpnRoomCreate: (payload?: {
    name?: string
    roomName?: string
    gameName?: string
    password?: string
    public?: boolean
    maxPlayers?: number
  }) => ipcRenderer.invoke('vpn-room-create', payload),
  vpnRoomJoin: (code: string, payload?: { name?: string; password?: string }) =>
    ipcRenderer.invoke('vpn-room-join', { code, name: payload?.name, password: payload?.password }),
  vpnRoomPeers: (code: string) => ipcRenderer.invoke('vpn-room-peers', { code }),
  vpnRoomList: (payload?: { gameName?: string }) => ipcRenderer.invoke('vpn-room-list', payload),
  vpnHeartbeat: (peerId: string) => ipcRenderer.invoke('vpn-heartbeat', { peerId }),
  vpnRoomLeave: (peerId: string) => ipcRenderer.invoke('vpn-room-leave', { peerId }),
  vpnConnect: (config: string) => ipcRenderer.invoke('vpn-connect', { config }),
  vpnDisconnect: () => ipcRenderer.invoke('vpn-disconnect'),

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Achievements
  getGameAchievements: (gameUrl: string) => ipcRenderer.invoke('achievements-get', gameUrl),
  importAchievementSchema: (gameUrl: string) => ipcRenderer.invoke('achievements-import-schema', gameUrl),
  saveAchievementSchema: (gameUrl: string, rawJson: string) => ipcRenderer.invoke('achievements-save-schema', gameUrl, rawJson),
  clearAchievementSchema: (gameUrl: string) => ipcRenderer.invoke('achievements-clear-schema', gameUrl),
  forceRefreshAchievementSchema: (gameUrl: string) => ipcRenderer.invoke('achievements-force-refresh', gameUrl),
  onAchievementUnlocked: (cb: (data: any) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('achievement-unlocked', handler)
    return () => ipcRenderer.removeListener('achievement-unlocked', handler)
  },

  onDownloadProgress: (cb: (data: DownloadProgressPayload) => void) => {
    const handler = (_event: IpcRendererEvent, data: DownloadProgressPayload) => cb(data)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },

  onDownloadComplete: (cb: (data: { magnet?: string; infoHash?: string; destPath?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { magnet?: string; infoHash?: string; destPath?: string }) => cb(data)
    ipcRenderer.on('download-complete', handler)
    return () => ipcRenderer.removeListener('download-complete', handler)
  },

  onDownloadDeleted: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('download-deleted', handler)
    return () => ipcRenderer.removeListener('download-deleted', handler)
  },

  onGameVersionUpdate: (cb: (data: { url: string; latest?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { url: string; latest?: string }) => cb(data)
    ipcRenderer.on('game-version-update', handler)
    return () => ipcRenderer.removeListener('game-version-update', handler)
  },

  onUpdateQueueStatus: (cb: (data: any) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('update-queue-status', handler)
    return () => ipcRenderer.removeListener('update-queue-status', handler)
  },

  onGameLaunchStatus: (cb: (data: GameLaunchStatusPayload) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data as GameLaunchStatusPayload)
    ipcRenderer.on('game-launch-status', handler)
    return () => ipcRenderer.removeListener('game-launch-status', handler)
  },

  onCloudSavesStatus: (cb: (data: CloudSavesStatusPayload) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data as CloudSavesStatusPayload)
    ipcRenderer.on('cloud-saves-status', handler)
    return () => ipcRenderer.removeListener('cloud-saves-status', handler)
  },

  cloudSavesOpenBackups: (gameUrl: string) => ipcRenderer.invoke('cloud-saves-open-backups', { gameUrl }),
  cloudSavesGetHistory: (gameUrl: string, limit?: number) =>
    ipcRenderer.invoke('cloud-saves-get-history', { gameUrl, limit }),
  
  onPrefixJobStatus: (cb: (data: PrefixJobStatusPayload) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data as PrefixJobStatusPayload)
    ipcRenderer.on('prefix-job-status', handler)
    return () => ipcRenderer.removeListener('prefix-job-status', handler)
  },

  // ==========================
  // Drive APIs
  // ==========================
  driveAuth: () => ipcRenderer.invoke('drive-auth'),
  driveStatus: () => ipcRenderer.invoke('drive-status'),
  driveDisconnect: () => ipcRenderer.invoke('drive-disconnect'),
  
  // ✅ FIX: Adicionada a função syncGameSaves para compatibilidade com o LibraryTab
  syncGameSaves: (gameUrl: string) => ipcRenderer.invoke('drive-sync-game-saves', gameUrl),

  driveListSaves: () => ipcRenderer.invoke('drive-list-saves') as Promise<{ success: boolean; files?: DriveListItem[]; error?: string }>,
  driveListSavesForGame: (realAppId: string) =>
    ipcRenderer.invoke('drive-list-saves-for-game', realAppId) as Promise<{ success: boolean; files?: DriveListItem[]; error?: string }>,
  driveUploadSave: (localPath: string, remoteName?: string) => ipcRenderer.invoke('drive-upload-save', localPath, remoteName),
  driveDownloadSave: (fileId: string, destPath: string) => ipcRenderer.invoke('drive-download-save', fileId, destPath)
})
