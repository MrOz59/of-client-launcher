import { BrowserWindow } from 'electron'

export type TaskKind = 'download' | 'extract' | 'prefix' | 'redist' | 'cloud-save'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export type LauncherTask = {
  id: string
  kind: TaskKind
  title: string
  status: TaskStatus
  progress?: number
  message?: string
  gameUrl?: string
  gameKey?: string
  targetPath?: string
  impact?: 'network' | 'disk' | 'compat' | 'cloud' | 'background'
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

const tasks = new Map<string, LauncherTask>()
const RECENT_TTL_MS = 30 * 60 * 1000

function clampProgress(value: any): number | undefined {
  if (value === undefined || value === null) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, n))
}

function isFinal(status: TaskStatus) {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

function pruneTasks() {
  const now = Date.now()
  for (const [id, task] of tasks.entries()) {
    if (task.finishedAt && now - task.finishedAt > RECENT_TTL_MS) {
      tasks.delete(id)
    }
  }
}

function broadcast() {
  pruneTasks()
  const payload = getTaskQueueStatus()
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('task-status', payload) } catch {}
  }
}

export function upsertTask(input: {
  id: string
  kind: TaskKind
  title?: string
  status: TaskStatus
  progress?: number
  message?: string
  gameUrl?: string
  gameKey?: string
  targetPath?: string
  impact?: LauncherTask['impact']
}) {
  if (!input.id) return null
  const now = Date.now()
  const prev = tasks.get(input.id)
  const next: LauncherTask = {
    id: input.id,
    kind: input.kind,
    title: input.title || prev?.title || defaultTitle(input.kind),
    status: input.status,
    progress: clampProgress(input.progress) ?? prev?.progress,
    message: input.message ?? prev?.message,
    gameUrl: input.gameUrl ?? prev?.gameUrl,
    gameKey: input.gameKey ?? prev?.gameKey,
    targetPath: input.targetPath ?? prev?.targetPath,
    impact: input.impact ?? prev?.impact ?? defaultImpact(input.kind),
    startedAt: prev?.startedAt || now,
    updatedAt: now,
    finishedAt: isFinal(input.status) ? now : undefined
  }
  tasks.set(input.id, next)
  broadcast()
  return next
}

export function getTaskQueueStatus() {
  pruneTasks()
  const all = Array.from(tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  const active = all.filter(t => !isFinal(t.status))
  const recent = all.filter(t => isFinal(t.status)).slice(0, 20)
  return {
    activeCount: active.length,
    recentCount: recent.length,
    active,
    recent,
    updatedAt: Date.now()
  }
}

export function taskId(kind: TaskKind, key: string) {
  return `${kind}:${String(key || 'unknown')}`
}

function defaultTitle(kind: TaskKind) {
  switch (kind) {
    case 'download': return 'Download'
    case 'extract': return 'Extração'
    case 'prefix': return 'Prefixo Proton'
    case 'redist': return 'Redists'
    case 'cloud-save': return 'Saves na nuvem'
    default: return 'Tarefa'
  }
}

function defaultImpact(kind: TaskKind): LauncherTask['impact'] {
  switch (kind) {
    case 'download': return 'network'
    case 'extract': return 'disk'
    case 'prefix': return 'compat'
    case 'redist': return 'compat'
    case 'cloud-save': return 'cloud'
    default: return 'background'
  }
}
