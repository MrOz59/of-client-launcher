import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { NotificationMessage } from './overlayIPC'

interface ToastPayload {
  type?: NotificationMessage['type']
  title: string
  message?: string
  game?: string
  icon?: string
  duration?: number
}

const activeToasts = new Set<ChildProcess>()

function getBinaryName(): string | null {
  if (process.platform === 'linux') return 'void-toast-linux-x86_64'
  if (process.platform === 'win32') return 'void-toast-windows-x86_64.exe'
  return null
}

function candidatePaths(): string[] {
  const fromEnv = String(process.env.VOIDLAUNCHER_VOID_TOAST_BIN || '').trim()
  const binaryName = getBinaryName()
  if (!binaryName) return fromEnv ? [fromEnv] : []

  const candidates = [
    fromEnv,
    path.join(process.resourcesPath || '', 'void-toast', binaryName),
    path.join(app.getAppPath(), 'notification-overlay', 'dist', binaryName),
    path.join(process.cwd(), 'notification-overlay', 'dist', binaryName),
  ]

  return candidates.filter(Boolean)
}

function resolveToastBinary(): string | null {
  for (const candidate of candidatePaths()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Try next candidate.
    }
  }
  return null
}

function normalizeIcon(icon?: string): string | undefined {
  const value = String(icon || '').trim()
  if (!value) return undefined

  if (
    value.startsWith('data:image/') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return value
  }

  if (value.length > 128 && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) {
    return `data:image/png;base64,${value.replace(/\s+/g, '')}`
  }

  return value
}

function sourceFor(notification: NotificationMessage): string {
  const explicit = String(notification.game || notification.source || '').trim()
  if (explicit) return explicit

  switch (notification.type) {
    case 'achievement_unlocked':
      return 'Conquista desbloqueada'
    case 'download_complete':
    case 'download_error':
    case 'friend_online':
    case 'info':
    default:
      return 'VoidLauncher'
  }
}

function toToastPayload(notification: NotificationMessage): ToastPayload {
  return {
    type: notification.type,
    title: notification.title || 'VoidLauncher',
    message: notification.description,
    game: sourceFor(notification),
    icon: normalizeIcon(notification.icon),
    duration: notification.duration_ms || 5000,
  }
}

export function showStandaloneToast(notification: NotificationMessage): boolean {
  const binary = resolveToastBinary()
  if (!binary) {
    console.warn('[StandaloneToast] Binary not found; falling back to Electron notification')
    return false
  }

  let child: ChildProcess
  try {
    child = spawn(binary, ['--stdin'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        VOID_TOAST_X: process.env.VOID_TOAST_X || '',
        VOID_TOAST_Y: process.env.VOID_TOAST_Y || '',
      },
    })
  } catch (err) {
    console.error('[StandaloneToast] Failed to start toast binary:', err)
    return false
  }

  activeToasts.add(child)

  child.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').trim()
    if (text) console.log('[StandaloneToast]', text)
  })

  child.on('error', (err) => {
    console.error('[StandaloneToast] Toast process error:', err)
  })

  child.on('close', (code) => {
    activeToasts.delete(child)
    if (code && code !== 0) {
      console.warn('[StandaloneToast] Toast process exited with code:', code)
    }
  })

  try {
    if (!child.stdin) throw new Error('toast process stdin is unavailable')
    child.stdin.end(`${JSON.stringify(toToastPayload(notification))}\n`)
  } catch (err) {
    console.error('[StandaloneToast] Failed to send toast payload:', err)
    try { child.kill() } catch {}
    activeToasts.delete(child)
    return false
  }

  return true
}

export function closeAllStandaloneToasts() {
  for (const child of Array.from(activeToasts)) {
    try { child.kill() } catch {}
    activeToasts.delete(child)
  }
}

app.on('before-quit', () => {
  closeAllStandaloneToasts()
})
