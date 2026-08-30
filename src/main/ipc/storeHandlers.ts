/**
 * IPC for the native store.
 *
 * The classic store tab keeps browsing the site inside a webview; these
 * handlers back the new tab, which reads the same pages through the store
 * session and renders them natively.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { captureStoreFixture, clearStoreCache, getStoreGame, getStoreListing } from '../store/catalog'
import { getStoreGameMetadata } from '../store/metadata'
import type { IpcContext, IpcHandlerRegistrar } from './types'

export const registerStoreHandlers: IpcHandlerRegistrar = (_ctx: IpcContext) => {
  ipcMain.handle(
    'store-listing',
    async (_event: IpcMainInvokeEvent, payload?: { page?: number; query?: string; force?: boolean }) => {
      try {
        const listing = await getStoreListing({
          page: payload?.page,
          query: payload?.query,
          force: payload?.force === true
        })
        return { success: true, listing }
      } catch (err: any) {
        console.error('[Store] Listing failed:', err?.message || err)
        return { success: false, error: err?.message || String(err), errorCode: 'store-listing-failed' }
      }
    }
  )

  ipcMain.handle('store-game', async (_event: IpcMainInvokeEvent, payload: { url: string; force?: boolean }) => {
    try {
      const game = await getStoreGame(String(payload?.url || ''), { force: payload?.force === true })
      return { success: true, game }
    } catch (err: any) {
      console.error('[Store] Game page failed:', err?.message || err)
      return { success: false, error: err?.message || String(err), errorCode: 'store-game-failed' }
    }
  })

  // Saves a real page for the parser tests; see scripts/test-store-parser.js.
  ipcMain.handle(
    'store-capture-fixture',
    async (_event: IpcMainInvokeEvent, payload: { url: string; name?: string }) => {
      try {
        const result = await captureStoreFixture(String(payload?.url || ''), payload?.name)
        return { success: true, ...result }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err), errorCode: 'store-capture-failed' }
      }
    }
  )

  // Artwork, description and screenshots for the game page: the site provides
  // none of that, so it comes from Steam.
  ipcMain.handle(
    'store-game-metadata',
    async (_event: IpcMainInvokeEvent, payload: { url: string; title: string; steamAppId?: string }) => {
      try {
        const metadata = await getStoreGameMetadata({
          gameUrl: String(payload?.url || ''),
          title: String(payload?.title || ''),
          steamAppId: payload?.steamAppId
        })
        return { success: true, metadata }
      } catch (err: any) {
        console.warn('[Store] Metadata failed:', err?.message || err)
        return { success: false, error: err?.message || String(err), errorCode: 'store-metadata-failed' }
      }
    }
  )

  ipcMain.handle('store-clear-cache', async () => {
    clearStoreCache()
    return { success: true }
  })
}
