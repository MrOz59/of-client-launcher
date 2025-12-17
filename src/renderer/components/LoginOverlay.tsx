import React from 'react'

const STORE_PARTITION = 'persist:online-fix'

// Minimal adblock for the login webview (same idea as StoreTab)
const cssRules = [
  '[class*="advertisement"]', '[class*="ad-container"]', '[class*="ad-banner"]',
  '[class*="ad-wrapper"]', '[class*="ad-slot"]', '[class*="adsense"]',
  '[id*="advertisement"]', '[id*="ad-container"]', '[id*="ad-banner"]',
  '[id*="google_ads"]', '[data-ad-client]', '[data-ad-slot]',
  'iframe[src*="doubleclick"]', 'iframe[src*="/ads"]', 'iframe[src*="googlesyndication"]',
  '.adsbygoogle', 'ins.adsbygoogle',
  '[class*="popup"]', '[class*="pop-up"]', '[class*="modal-ad"]', '[class*="overlay-ad"]',
  '[class*="yandex-ad"]', '[class*="begun"]', '[class*="adfox"]',
  'div[id*="yandex_ad"]'
]

const adBlockCSS = `
  ${cssRules.join(',\n  ')} {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    height: 0 !important;
    width: 0 !important;
    position: absolute !important;
    left: -9999px !important;
  }

  body, html {
    overflow: auto !important;
  }

  html[style*="overflow: hidden"] {
    overflow: auto !important;
  }
`

const loginInstructionsScript = `
(function() {
  try {
    if (document.getElementById('of-login-instructions')) return;

    const wrap = document.createElement('div');
    wrap.id = 'of-login-instructions';
    wrap.style.cssText = [
      'position: fixed',
      'left: 16px',
      'right: 16px',
      'bottom: 16px',
      'z-index: 2147483647',
      'display: flex',
      'align-items: flex-start',
      'justify-content: space-between',
      'gap: 12px',
      'padding: 14px 14px',
      'border-radius: 12px',
      'background: rgba(15, 15, 15, 0.92)',
      'border: 1px solid rgba(255, 255, 255, 0.18)',
      'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45)',
      'color: #fff',
      'font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Helvetica Neue, Arial, sans-serif'
    ].join(';');

    const text = document.createElement('div');
    text.style.cssText = 'font-size: 13px; line-height: 1.35; font-weight: 600;';
    text.innerHTML = [
      '<div style="font-size: 13px; font-weight: 800; margin-bottom: 4px;">Login no Online-Fix</div>',
      '<div style="opacity: 0.85; font-weight: 600;">Faça login normalmente. O launcher vai identificar automaticamente e salvar seus cookies para você baixar os jogos depois.</div>'
    ].join('');

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Entendi';
    close.style.cssText = [
      'flex: none',
      'cursor: pointer',
      'border-radius: 10px',
      'padding: 10px 12px',
      'border: 1px solid rgba(255, 255, 255, 0.18)',
      'background: rgba(255, 255, 255, 0.08)',
      'color: #fff',
      'font-weight: 800'
    ].join(';');
    close.addEventListener('click', function() {
      try { wrap.remove(); } catch(e) {}
    });

    wrap.appendChild(text);
    wrap.appendChild(close);

    document.documentElement.appendChild(wrap);
  } catch (e) {
    // ignore
  }
})();
`

type Props = {
  open: boolean
  onClose: () => void
  onLoggedIn: () => void
}

export default function LoginOverlay({ open, onClose, onLoggedIn }: Props) {
  const webviewRef = React.useRef<Electron.WebviewTag | null>(null)
  const [checking, setChecking] = React.useState(false)
  const injectedRef = React.useRef(false)

  const checkLoggedIn = React.useCallback(async () => {
    if (!open) return
    if (checking) return
    setChecking(true)
    try {
      const res = await window.electronAPI.getUserProfile()
      if (res?.success) {
        onLoggedIn()
      }
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }, [open, checking, onLoggedIn])

  React.useEffect(() => {
    if (!open) return

    const wv = webviewRef.current
    if (!wv) return

    const injectOnce = async () => {
      if (injectedRef.current) return
      injectedRef.current = true
      try {
        await (wv as any).insertCSS?.(adBlockCSS)
      } catch {
        // ignore
      }
      try {
        await (wv as any).executeJavaScript?.(loginInstructionsScript, true)
      } catch {
        // ignore
      }
    }

    const onLoaded = () => {
      void injectOnce()
      void checkLoggedIn()
    }

    // Try a few common webview lifecycle events
    wv.addEventListener('dom-ready', onLoaded)
    wv.addEventListener('did-finish-load', onLoaded)
    wv.addEventListener('did-navigate', onLoaded as any)
    wv.addEventListener('did-navigate-in-page', onLoaded as any)
    wv.addEventListener('did-stop-loading', onLoaded)

    // Poll while open in case the site is SPA-ish
    const interval = setInterval(() => {
      void checkLoggedIn()
    }, 1500)

    return () => {
      clearInterval(interval)
      try { wv.removeEventListener('dom-ready', onLoaded) } catch {}
      try { wv.removeEventListener('did-finish-load', onLoaded) } catch {}
      try { wv.removeEventListener('did-navigate', onLoaded as any) } catch {}
      try { wv.removeEventListener('did-navigate-in-page', onLoaded as any) } catch {}
      try { wv.removeEventListener('did-stop-loading', onLoaded) } catch {}
    }
  }, [open, checkLoggedIn])

  React.useEffect(() => {
    if (!open) injectedRef.current = false
  }, [open])

  if (!open) return null

  return (
    <div className="login-overlay" role="dialog" aria-modal="true">
      <div className="login-overlay__scrim" onClick={onClose} />
      <div className="login-overlay__panel">
        <div className="login-overlay__header">
          <div className="login-overlay__title">Login</div>
          <button className="login-overlay__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="login-overlay__body">
          <webview
            ref={(el) => {
              // React types don't fully understand <webview/>
              webviewRef.current = el as any
            }}
            src="https://online-fix.me/"
            partition={STORE_PARTITION}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        <div className="login-overlay__footer">
          <div className="login-overlay__hint">Faça login e a janela fechará automaticamente.</div>
        </div>
      </div>
    </div>
  )
}
