/**
 * IPC handlers for the unified launcher task feed.
 */
import { ipcMain } from 'electron'
import { getTaskQueueStatus } from '../taskManager'
import type { IpcHandlerRegistrar } from './types'

export const registerTaskHandlers: IpcHandlerRegistrar = () => {
  ipcMain.handle('get-task-queue-status', async () => {
    try {
      return { success: true, status: getTaskQueueStatus() }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao carregar tarefas' }
    }
  })
}
