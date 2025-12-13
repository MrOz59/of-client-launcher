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

contextBridge.exposeInMainWorld('electronAPI', {
  openAuthWindow: () => ipcRenderer.invoke('open-auth-window'),
  checkGameVersion: (url: string) => ipcRenderer.invoke('check-game-version', url),
  getCookieHeader: (url: string) => ipcRenderer.invoke('get-cookie-header', url),
  exportCookies: (url?: string) => ipcRenderer.invoke('export-cookies', url),
  onCookiesSaved: (cb: (cookies: Electron.Cookie[]) => void) =>
    ipcRenderer.on('cookies-saved', (_event: IpcRendererEvent, cookies) => cb(cookies)),
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
  setGameImageUrl: (gameUrl: string, imageUrl: string | null) => ipcRenderer.invoke('set-game-image-url', gameUrl, imageUrl),
  pickGameBannerFile: (gameUrl: string) => ipcRenderer.invoke('pick-game-banner-file', gameUrl),
  fetchGameUpdateInfo: (gameUrl: string) => ipcRenderer.invoke('fetch-game-update-info', gameUrl),
  getUserProfile: () => ipcRenderer.invoke('get-user-profile'),
  checkAllUpdates: () => ipcRenderer.invoke('check-all-updates'),
  openPath: (target: string) => ipcRenderer.invoke('open-path', target),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  extractDownload: (downloadId: number | string, path?: string) => ipcRenderer.invoke('extract-download', downloadId, path),
  protonEnsureRuntime: (customPath?: string) => ipcRenderer.invoke('proton-ensure-runtime', customPath),
  protonListRuntimes: () => ipcRenderer.invoke('proton-list-runtimes'),
  protonSetRoot: (rootPath: string) => ipcRenderer.invoke('proton-set-root', rootPath),
  protonDefaultPrefix: (forceRecreate?: boolean) => ipcRenderer.invoke('proton-default-prefix', forceRecreate),
  protonPreparePrefix: (slug: string) => ipcRenderer.invoke('proton-prepare-prefix', slug),
  protonBuildLaunch: (exePath: string, args: string[], slug: string, runtimePath?: string, prefixPath?: string) => ipcRenderer.invoke('proton-build-launch', exePath, args, slug, runtimePath, prefixPath),
  protonCreateGamePrefix: (gameUrl: string, title?: string, commonRedistPath?: string) => ipcRenderer.invoke('proton-create-game-prefix', gameUrl, title, commonRedistPath),
  setGameProtonPrefix: (gameUrl: string, prefixPath: string | null) => ipcRenderer.invoke('set-game-proton-prefix', gameUrl, prefixPath),
  setGameSteamAppId: (gameUrl: string, steamAppId: string | null) => ipcRenderer.invoke('set-game-steam-appid', gameUrl, steamAppId),
  getGames: () => ipcRenderer.invoke('get-games'),
  launchGame: (gameUrl: string) => ipcRenderer.invoke('launch-game', gameUrl),
  stopGame: (gameUrl: string, force?: boolean) => ipcRenderer.invoke('stop-game', gameUrl, force),
  deleteGame: (gameUrl: string) => ipcRenderer.invoke('delete-game', gameUrl),
  openGameFolder: (path: string) => ipcRenderer.invoke('open-game-folder', path),
  configureGameExe: (gameUrl: string) => ipcRenderer.invoke('configure-game-exe', gameUrl),
  setGameVersion: (gameUrl: string, version: string) => ipcRenderer.invoke('set-game-version', gameUrl, version),
  setGameTitle: (gameUrl: string, title: string) => ipcRenderer.invoke('set-game-title', gameUrl, title),
  setGameProtonOptions: (gameUrl: string, runtime: string, options: any) => ipcRenderer.invoke('set-game-proton-options', gameUrl, runtime, options),
  setGameLanSettings: (gameUrl: string, payload: { mode?: string | null; networkId?: string | null; autoconnect?: boolean }) => ipcRenderer.invoke('set-game-lan-settings', gameUrl, payload),
  zerotierStatus: () => ipcRenderer.invoke('zerotier-status'),
  zerotierListNetworks: () => ipcRenderer.invoke('zerotier-list-networks'),
  zerotierListPeers: () => ipcRenderer.invoke('zerotier-list-peers'),
  zerotierJoin: (networkId: string) => ipcRenderer.invoke('zerotier-join', networkId),
  zerotierLeave: (networkId: string) => ipcRenderer.invoke('zerotier-leave', networkId),
  zerotierInstallHelp: () => ipcRenderer.invoke('zerotier-install-help'),
  zerotierInstallArch: () => ipcRenderer.invoke('zerotier-install-arch'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
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
  onGameLaunchStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'running' | 'exited' | 'error'; pid?: number; code?: number | null; signal?: string | null; message?: string; stderrTail?: string; protonLogPath?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('game-launch-status', handler)
    return () => ipcRenderer.removeListener('game-launch-status', handler)
  },
  onPrefixJobStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'progress' | 'done' | 'error'; message?: string; prefix?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('prefix-job-status', handler)
    return () => ipcRenderer.removeListener('prefix-job-status', handler)
  }
})
