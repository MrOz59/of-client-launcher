import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useI18n } from '../i18n'

/**
 * In-app feedback.
 *
 * Every tab used to keep its own local `error` state, so anything that failed
 * outside the tab the user was looking at — a download, a cloud save — only
 * reached the console. This is the one place that reports what happened.
 *
 * Not to be confused with the desktop toasts in the main process: those are
 * separate always-on-top windows meant to be seen while a game is in front.
 */

export type ToastKind = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  kind: ToastKind
  message: string
  detail?: string
}

export type ToastApi = {
  success: (message: string, detail?: string) => void
  error: (message: string, detail?: string) => void
  info: (message: string, detail?: string) => void
}

const MAX_VISIBLE = 4
const DURATION_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  // Errors carry something to act on, so they stay long enough to be read.
  error: 9000
}

const ToastContext = createContext<ToastApi | null>(null)

/** Never throws: a component outside the provider just gets a no-op. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  return useMemo<ToastApi>(() => api ?? {
    success: () => {},
    error: () => {},
    info: () => {}
  }, [api])
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, message: string, detail?: string) => {
    const text = String(message || '').trim()
    if (!text) return

    const id = nextId.current++
    setItems((current) => [...current, { id, kind, message: text, detail }].slice(-MAX_VISIBLE))

    timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS[kind]))
  }, [dismiss])

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({
    success: (message, detail) => push('success', message, detail),
    error: (message, detail) => push('error', message, detail),
    info: (message, detail) => push('info', message, detail)
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { t } = useI18n()
  const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? AlertCircle : Info

  return (
    <div className={`app-toast app-toast--${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="app-toast__icon" aria-hidden="true" />
      <div className="app-toast__body">
        <span className="app-toast__message">{item.message}</span>
        {item.detail && <span className="app-toast__detail">{item.detail}</span>}
      </div>
      <button className="app-toast__close" onClick={onDismiss} aria-label={t('app.toast.dismiss')}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
