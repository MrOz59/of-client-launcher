declare module 'electron-is-dev' {
  const isDev: boolean
  export = isDev
}


declare module 'node-7z' {
  import { EventEmitter } from 'events'

  interface ExtractOptions {
    p?: string
    [key: string]: unknown
  }

  export function Extract(source: string, destination: string, options?: ExtractOptions): EventEmitter
}
// External type shims live here.
