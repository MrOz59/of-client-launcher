/**
 * Process utility functions
 */

/**
 * Check if a process with the given PID is still alive
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // EPERM means "exists but not permitted" – treat as alive
    return err?.code === 'EPERM'
  }
}

/**
 * Attempt to kill a process and its children (best effort)
 * On POSIX, kills the whole process group (Proton spawns children)
 */
export function killProcessTreeBestEffort(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    try { process.kill(-pid, signal) } catch {}
  }
  try { process.kill(pid, signal) } catch {}
}

/**
 * Wait for a specified number of milliseconds
 */
export function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
