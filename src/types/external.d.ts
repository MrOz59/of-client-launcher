declare module 'electron-is-dev' {
  const isDev: boolean
  export = isDev
}

declare module 'webtorrent' {
  export interface Torrent {
    downloaded: number
    length: number
    on(event: 'download', cb: () => void): void
    on(event: 'done', cb: () => void): void
    on(event: 'error', cb: (err: Error) => void): void
  }

  export interface AddTorrentOptions {
    path?: string
    [key: string]: unknown
  }

  export default class WebTorrent {
    add(input: string, opts: AddTorrentOptions, cb: (torrent: Torrent) => void): void
    on(event: 'error', cb: (err: Error) => void): void
    destroy(): void
  }
}

declare module 'node-7z' {
  import { EventEmitter } from 'events'

  interface ExtractOptions {
    p?: string
    [key: string]: unknown
  }

  export function Extract(source: string, destination: string, options?: ExtractOptions): EventEmitter
}
