import { BrowserWindow, screen } from 'electron'

export type AchievementOverlayPayload = {
  title: string
  description?: string
  unlockedAt?: number
}

const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Achievement Overlay</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  .toast {
    width: 340px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif;
    background: rgba(20, 20, 20, 0.86);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .icon {
    width: 44px; height: 44px;
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06));
    border: 1px solid rgba(255,255,255,0.10);
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .icon span { font-size: 18px; color: rgba(255,255,255,0.85); }
  .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .kicker { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,0.65); }
  .title { font-size: 14px; font-weight: 800; color: rgba(255,255,255,0.95); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: 12px; color: rgba(255,255,255,0.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wrap { padding: 0; margin: 0; }
  .root { padding: 0; margin: 0; display: flex; justify-content: flex-end; }
  .hidden { opacity: 0; transform: translateY(8px); }
  .visible { opacity: 1; transform: translateY(0); }
  .anim { transition: opacity 220ms ease, transform 220ms ease; }
</style>
</head>
<body>
  <div class="root">
    <div id="toast" class="toast anim hidden" aria-live="polite">
      <div class="icon"><span>★</span></div>
      <div class="meta">
        <div class="kicker">Conquista desbloqueada</div>
        <div id="t" class="title">—</div>
        <div id="d" class="desc"> </div>
      </div>
    </div>
  </div>
<script>
  const toast = document.getElementById('toast');
  const t = document.getElementById('t');
  const d = document.getElementById('d');

  function show(payload) {
    t.textContent = payload.title || 'Conquista';
    d.textContent = payload.description || '';
    toast.classList.remove('hidden');
    toast.classList.add('visible');
  }

  function hide() {
    toast.classList.add('hidden');
    toast.classList.remove('visible');
  }

  window.__overlay = { show, hide };
</script>
</body>
</html>`

export class AchievementOverlay {
  private win: BrowserWindow | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win

    const display = screen.getPrimaryDisplay()
    const width = 360
    const height = 90

    this.win = new BrowserWindow({
      width,
      height,
      x: display.workArea.x + display.workArea.width - width - 16,
      y: display.workArea.y + 16,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false
      }
    })

    // Best-effort click-through
    try {
      this.win.setIgnoreMouseEvents(true, { forward: true } as any)
    } catch {
      try {
        this.win.setIgnoreMouseEvents(true)
      } catch {}
    }

    try {
      // Stronger always-on-top level where supported
      ;(this.win as any).setAlwaysOnTop(true, 'screen-saver')
    } catch {
      this.win.setAlwaysOnTop(true)
    }

    this.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(OVERLAY_HTML))
    this.win.on('closed', () => {
      this.win = null
      if (this.hideTimer) clearTimeout(this.hideTimer)
      this.hideTimer = null
    })

    this.win.hide()
    return this.win
  }

  async show(payload: AchievementOverlayPayload) {
    const win = this.ensure()

    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    try {
      win.showInactive()
    } catch {
      win.show()
    }

    try {
      await win.webContents.executeJavaScript(`window.__overlay && window.__overlay.show(${JSON.stringify(payload)})`)
    } catch {
      // ignore
    }

    this.hideTimer = setTimeout(async () => {
      try {
        await win.webContents.executeJavaScript(`window.__overlay && window.__overlay.hide()`)
      } catch {}
      try {
        win.hide()
      } catch {}
      this.hideTimer = null
    }, 5200)
  }
}
