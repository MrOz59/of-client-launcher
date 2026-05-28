/// <reference lib="dom" />

import { ipcRenderer } from 'electron'

(() => {
  const baseButtonStyle = [
    'display: inline-flex',
    'align-items: center',
    'gap: 8px',
    'padding: 12px 16px',
    'margin: 6px 4px',
    'background: linear-gradient(135deg, #2563eb, #1d4ed8)',
    'color: white',
    'border: none',
    'border-radius: 10px',
    'font-weight: 700',
    'cursor: pointer',
    'box-shadow: 0 8px 20px rgba(37,99,235,0.35)',
    'transition: all 0.2s ease',
    'position: relative',
    'z-index: 10'
  ].join('; ')

  const unsupportedButtonKeywords = [
    'hosters',
    'drive',
    'фикс с сервера',
    'сервера',
    'скачать с сервера',
    'mega.nz',
    'yandex disk',
    'яндекс',
    'лаунчер с mega',
    'клиент с yandex',
    'from server',
    'fix from',
    'launcher from mega',
    'client from yandex',
    'download from online-fix',
    'from online-fix servers',
    'do servidor',
    'correção do servidor',
    'launcher do mega',
    'cliente do yandex',
    'baixe de servidores',
    'baixar de servidores',
    'servidores online-fix',
    'descargar de servidores',
    'servidores de online-fix',
    'online-fix hosters',
    'online-fix drive'
  ]

  const unsupportedUrlPatterns = [
    'hosters.online-fix',
    'mega.nz',
    'yandex.disk',
    'drive.google.com',
    'mediafire.com',
    '1fichier.com',
    'uploadhaven.com'
  ]

  function isGamePage() {
    const path = window.location.pathname || ''
    return path.includes('/games/') && path.endsWith('.html')
  }

  function isTorrentHref(href: string) {
    const value = String(href || '').toLowerCase()
    return value.includes('/torrents/') || value.endsWith('.torrent')
  }

  function isUnsupportedDownload(link: HTMLAnchorElement) {
    const text = String(link.textContent || '').toLowerCase()
    const href = String(link.getAttribute('href') || link.href || '').toLowerCase()
    return unsupportedButtonKeywords.some(keyword => text.includes(keyword.toLowerCase())) ||
      unsupportedUrlPatterns.some(pattern => href.includes(pattern.toLowerCase()))
  }

  function setButtonState(button: HTMLButtonElement, state: 'ready' | 'starting' | 'active') {
    button.setAttribute('data-state', state)
    button.setAttribute('data-variant', 'download')
    button.disabled = state !== 'ready'
    if (state === 'ready') {
      button.textContent = 'Baixar via Torrent'
      button.style.cssText = baseButtonStyle
    } else if (state === 'starting') {
      button.textContent = 'Iniciando download... Aguarde'
      button.style.cssText = baseButtonStyle + '; opacity: 0.85; filter: saturate(0.9); cursor: not-allowed'
    } else {
      button.textContent = 'Download em andamento...'
      button.style.cssText = baseButtonStyle + '; opacity: 0.75; filter: saturate(0.85); cursor: not-allowed'
    }
  }

  function createButton(href: string, sourceLabel: string) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'of-launcher-torrent-button'
    button.setAttribute('data-torrent-href', href)
    button.title = href
    button.textContent = sourceLabel || 'Baixar via Torrent'
    setButtonState(button, 'ready')
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const currentState = button.getAttribute('data-state')
      if (currentState === 'starting' || currentState === 'active') return
      setButtonState(button, 'starting')
      console.log('[Torrent Interceptor] Custom torrent button clicked')
      ipcRenderer.sendToHost('torrent-download-request', href)
      console.log('[TORRENT_DOWNLOAD_REQUEST]', href)
      window.setTimeout(() => {
        if (button.getAttribute('data-state') === 'starting') setButtonState(button, 'active')
      }, 1200)
    }, true)
    return button
  }

  function processDownloads() {
    if (!isGamePage()) return
    const article = document.querySelector('#dle-content > div > article') || document.querySelector('article')
    if (!article) return

    article.querySelectorAll('a').forEach(anchor => {
      const link = anchor as HTMLAnchorElement
      const href = String(link.href || link.getAttribute('href') || '').trim()
      if (!href) return

      if (isUnsupportedDownload(link)) {
        link.remove()
        return
      }

      if (!isTorrentHref(href)) return
      const alreadyProcessed = Array.from(article.querySelectorAll('.of-launcher-torrent-button'))
        .some(button => button.getAttribute('data-torrent-href') === href)
      if (alreadyProcessed) {
        link.remove()
        return
      }

      const parent = link.parentElement || article
      const button = createButton(href, String(link.textContent || '').trim())
      parent.insertBefore(button, link)
      link.remove()
    })
  }

  document.addEventListener('click', event => {
    let target = event.target as HTMLElement | null
    while (target && target !== document.documentElement) {
      if (target.tagName === 'A') {
        const link = target as HTMLAnchorElement
        const href = String(link.href || link.getAttribute('href') || '').trim()
        if (isTorrentHref(href)) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          ipcRenderer.sendToHost('torrent-download-request', href)
          console.log('[TORRENT_DOWNLOAD_REQUEST]', href)
          return
        }
      }
      target = target.parentElement
    }
  }, true)

  let scheduled = false
  function scheduleProcess() {
    if (scheduled) return
    scheduled = true
    const run = () => {
      scheduled = false
      try {
        processDownloads()
      } catch (err) {
        console.warn('[OF Store Preload] Failed to process download buttons', err)
      }
    }
    try {
      window.requestAnimationFrame(run)
    } catch {
      window.setTimeout(run, 0)
    }
  }

  function startObserver() {
    scheduleProcess()
    const root = document.documentElement || document
    new MutationObserver(scheduleProcess).observe(root, { childList: true, subtree: true })
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      scheduleProcess()
      if (attempts >= 40) window.clearInterval(timer)
    }, 100)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleProcess)
  }
  startObserver()
})()
