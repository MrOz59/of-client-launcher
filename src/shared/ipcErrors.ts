/**
 * Error codes crossing the IPC boundary.
 *
 * The main process has no access to the renderer's translations, so it used to
 * return already-written sentences — some in Portuguese, some in English, mixed
 * within the same file. Whatever language the user picked, part of the UI spoke
 * the other one.
 *
 * Handlers now return a stable `errorCode` next to the original `error` string.
 * The renderer translates the code when it knows it (`errors.<code>` in the
 * translation files) and falls back to the raw string otherwise, so a handler
 * that has not been converted yet behaves exactly as before.
 */

export type IpcFailure = {
  error?: string
  errorCode?: string
}

/** Shape returned by a failing IPC handler. */
export function ipcFail(errorCode: string, error: string): { success: false; error: string; errorCode: string } {
  return { success: false, error, errorCode }
}

/**
 * Message to show the user. `t` is the renderer's translate function, which
 * returns the key itself when there is no entry for it.
 */
export function ipcErrorText(
  t: (key: string, params?: Record<string, string | number>) => string,
  result: IpcFailure | null | undefined,
  fallback?: string
): string {
  const code = String(result?.errorCode || '').trim()
  if (code) {
    const key = `errors.${code}`
    const translated = t(key)
    if (translated && translated !== key) return translated
  }

  const raw = String(result?.error || '').trim()
  return raw || fallback || ''
}
