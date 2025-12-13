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
}
type ActiveDownloadsResult = { success: boolean; downloads: ActiveDownload[]; error?: string }
type CompletedDownloadsResult = { success: boolean; downloads: ActiveDownload[]; error?: string }

export {}

declare global {
  interface Window {
    electronAPI: {
      openAuthWindow: () => Promise<boolean>
      checkGameVersion: (url: string) => Promise<VersionResult>
      onCookiesSaved: (cb: (cookies: Cookie[]) => void) => void
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
      openPath: (target: string) => Promise<DownloadResult>
      getSettings: () => Promise<{ success: boolean; settings?: any; error?: string }>
      saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>
      selectDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>
      extractDownload: (downloadId: number | string, path?: string) => Promise<DownloadResult & { destPath?: string }>
      protonEnsureRuntime: (customPath?: string) => Promise<{ success: boolean; runtime?: string; runner?: string; error?: string }>
      protonListRuntimes: () => Promise<{ success: boolean; runtimes?: Array<{ name: string; path: string; runner: string; source: string }>; error?: string }>
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
      setGameProtonOptions: (gameUrl: string, runtime: string, options: any) => Promise<{ success: boolean; error?: string }>
      getOnlineFixIni: (gameUrl: string) => Promise<{ success: boolean; path?: string; content?: string; exists?: boolean; error?: string }>
      saveOnlineFixIni: (gameUrl: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>
      fetchGameImage: (gameUrl: string, title: string) => Promise<{ success: boolean; imageUrl?: string; error?: string }>
      setGameImageUrl: (gameUrl: string, imageUrl: string | null) => Promise<{ success: boolean; imageUrl?: string | null; error?: string }>
      pickGameBannerFile: (gameUrl: string) => Promise<{ success: boolean; imageUrl?: string; path?: string; canceled?: boolean; error?: string }>
      fetchGameUpdateInfo: (gameUrl: string) => Promise<{ success: boolean; latest?: string | null; torrentUrl?: string | null; error?: string }>
      getUserProfile: () => Promise<{ success: boolean; name?: string | null; avatar?: string | null; avatarData?: string | null; profileUrl?: string | null; error?: string }>
      checkAllUpdates: () => Promise<{ success: boolean; results?: any[]; error?: string }>
      getCookieHeader: (url: string) => Promise<string>
      exportCookies: (url?: string) => Promise<any>
      deleteDownload: (downloadId: number) => Promise<{ success: boolean; error?: string }>
      onGameVersionUpdate: (cb: (data: { url: string; latest?: string }) => void) => (() => void)
      onDownloadDeleted: (cb: () => void) => (() => void)
      onGameLaunchStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'running' | 'exited' | 'error'; pid?: number; code?: number | null; signal?: string | null; message?: string; stderrTail?: string; protonLogPath?: string }) => void) => (() => void)
      onPrefixJobStatus: (cb: (data: { gameUrl: string; status: 'starting' | 'progress' | 'done' | 'error'; message?: string; prefix?: string }) => void) => (() => void)
    }
  }
}
