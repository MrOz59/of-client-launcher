import React, { useEffect, useRef } from 'react'

interface StoreTabProps {
  isLoggedIn: boolean
  targetUrl?: string | null
  onTargetConsumed?: () => void
}

interface InstalledGame {
  url: string
  title: string
  installed_version: string | null
  install_path: string | null
}

// Persist webview URL across tab switches
const STORE_URL_STORAGE_KEY = 'of_store_url'

function getPersistedUrl(): string | null {
  try {
    const v = sessionStorage.getItem(STORE_URL_STORAGE_KEY)
    return v && v.trim().length > 0 ? v : null
  } catch {
    return null
  }
}

function setPersistedUrl(url: string | null) {
  try {
    if (!url) sessionStorage.removeItem(STORE_URL_STORAGE_KEY)
    else sessionStorage.setItem(STORE_URL_STORAGE_KEY, url)
  } catch {
    // ignore
  }
}

// Comprehensive CSS rules for ad blocking
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

// Aggressive CSS blocking
const adBlockCSS = `
  ${cssRules.join(',\\n  ')} {
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

  /* Remove forced overlays */
  html[style*="overflow: hidden"] {
    overflow: auto !important;
  }

  /* Hide common ad sizes */
  div[style*="width: 728px"][style*="height: 90px"],
  div[style*="width: 300px"][style*="height: 250px"],
  div[style*="width: 160px"][style*="height: 600px"],
  div[style*="width: 320px"][style*="height: 50px"],
  div[style*="width: 970px"][style*="height: 90px"],
  div[style*="width: 300px"][style*="height: 600px"] {
    display: none !important;
  }

  .of-launcher-download-warning {
    padding: 12px 14px;
    margin-top: 10px;
    border-radius: 8px;
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.4);
    color: #fca5a5;
    font-weight: 600;
  }
`

// Advanced DOM cleanup script - function to generate with installed games data
function getAdBlockScript(installedGames: InstalledGame[]) {
  return `
(function() {
  'use strict';
  console.log('[AdBlock Pro] Client-side protection initializing...');

  const rules = ${JSON.stringify(cssRules)};

  // Installed games data from launcher
  const installedGames = ${JSON.stringify(installedGames)};
  console.log('[AdBlock Pro] Installed games:', installedGames.length);

  // Keywords to identify unsupported download buttons (Russian + translated versions)
  const unsupportedButtonKeywords = [
    // Russian original
    'hosters', 'drive', 'фикс с сервера', 'сервера',
    'mega.nz', 'yandex disk', 'яндекс', 'лаунчер с mega', 'клиент с yandex',
    // English translations
    'from server', 'fix from', 'launcher from mega', 'client from yandex',
    // Portuguese translations
    'do servidor', 'correção do servidor', 'launcher do mega', 'cliente do yandex',
    // Common patterns
    'online-fix hosters', 'online-fix drive'
  ];

  // Version comparison helper - supports semantic versions and Build dates
  function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    // Normalize versions for comparison
    const normalize = (v) => String(v).trim().toLowerCase();
    const n1 = normalize(v1);
    const n2 = normalize(v2);

    // If exactly equal, no update needed
    if (n1 === n2) return 0;

    // Handle Build DDMMYYYY format - convert to YYYYMMDD for comparison
    const parseBuildDate = (v) => {
      const match = v.match(/build[.\s]*(\d{2})(\d{2})(\d{4})/i);
      if (match) {
        // DDMMYYYY -> YYYYMMDD for proper numeric comparison
        return parseInt(match[3] + match[2] + match[1], 10);
      }
      // Also try MMDDYYYY format
      const match2 = v.match(/build[.\s]*(\d{8})/i);
      if (match2) {
        const d = match2[1];
        // Assume DDMMYYYY, convert to YYYYMMDD
        return parseInt(d.slice(4, 8) + d.slice(2, 4) + d.slice(0, 2), 10);
      }
      return null;
    };

    const build1 = parseBuildDate(n1);
    const build2 = parseBuildDate(n2);

    // If both are Build dates, compare them
    if (build1 !== null && build2 !== null) {
      if (build1 < build2) return -1;
      if (build1 > build2) return 1;
      return 0;
    }

    // Fallback: semantic version comparison
    const parts1 = n1.replace(/[^0-9.]/g, '').split('.').map(Number).filter(n => !isNaN(n));
    const parts2 = n2.replace(/[^0-9.]/g, '').split('.').map(Number).filter(n => !isNaN(n));

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    // If numeric comparison is equal but strings differ, consider it an update
    // This handles cases like "1.0.0a" vs "1.0.0b"
    return n1 < n2 ? -1 : (n1 > n2 ? 1 : 0);
  }

  // Extract game version from page
  function getPageVersion() {
    const article = document.querySelector('#dle-content > div > article');
    if (!article) return null;

    const text = article.textContent || '';

    // Version labels in different languages
    const versionLabels = [
      'Версия игры',      // Russian original
      'Game version',     // English translation
      'Versão do jogo',   // Portuguese translation
      'Versión del juego', // Spanish translation
      'Version du jeu',   // French translation
    ];

    // Try to find version by label first
    for (const label of versionLabels) {
      const labelPattern = new RegExp(
        label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') +
        '[:\\\\s]+' +
        '((?:Build[.\\\\s]*)?[vV]?[0-9][0-9a-zA-Z._-]*)',
        'i'
      );
      const match = text.match(labelPattern);
      if (match && match[1]) {
        console.log('[OF Store] Found page version via label:', match[1]);
        return match[1].trim();
      }
    }

    // Fallback patterns
    const patterns = [
      // Build format: Build 04122025, Build.04122025
      /\\b(Build[.\\s]*\\d{6,10})\\b/i,
      // Semantic versioning
      /\\bv?([0-9]+\\.[0-9]+(?:\\.[0-9]+){1,3})\\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        console.log('[OF Store] Found page version via pattern:', match[1]);
        return match[1];
      }
    }
    return null;
  }

  // Check if current page game is installed
  function getInstalledGameForCurrentPage() {
    const currentUrl = window.location.href;
    for (const game of installedGames) {
      if (game.url && currentUrl.includes(game.url.replace('https://online-fix.me', ''))) {
        return game;
      }
      // Also check by normalizing URLs
      const pageSlug = currentUrl.split('/').pop()?.replace('.html', '');
      const gameSlug = game.url?.split('/').pop()?.replace('.html', '');
      if (pageSlug && gameSlug && pageSlug === gameSlug) {
        return game;
      }
    }
    return null;
  }

  function removeAds() {
    try {
      let count = 0;
      const baseButtonStyle = 'display: inline-flex; align-items: center; gap: 8px; padding: 12px 16px; margin: 6px 4px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 20px rgba(37,99,235,0.35); transition: all 0.2s ease;';

      const setButtonState = (button, state, variant = 'download') => {
        const isBusy = state !== 'ready';
        button.setAttribute('data-state', state);
        button.setAttribute('data-variant', variant);
        button.disabled = isBusy;

        const label = variant === 'update' ? 'Atualizar via Torrent' : 'Baixar via Torrent';
        const startingLabel = variant === 'update' ? 'Iniciando atualização... Aguarde' : 'Iniciando download... Aguarde';
        const activeLabel = variant === 'update' ? 'Atualização em andamento...' : 'Download em andamento...';
        if (state === 'ready') {
          button.textContent = label;
          button.style.cssText = baseButtonStyle;
          if (variant === 'update') {
            button.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            button.style.boxShadow = '0 8px 20px rgba(234,179,8,0.35)';
          }
        } else if (state === 'starting') {
          button.textContent = startingLabel;
          button.style.cssText = baseButtonStyle + 'opacity: 0.85; filter: saturate(0.9); cursor: not-allowed;';
        } else {
          button.textContent = activeLabel;
          button.style.cssText = baseButtonStyle + 'opacity: 0.75; filter: saturate(0.85); cursor: not-allowed;';
        }
      };

      // Remove by CSS selectors
      rules.forEach(r => {
        try {
          document.querySelectorAll(r).forEach(el => {
            el.remove();
            count++;
          });
        } catch(e) {}
      });

      // AGGRESSIVE: Remove ALL iframes with ad-related content
      document.querySelectorAll('iframe').forEach(iframe => {
        const src = (iframe.src || '').toLowerCase();
        const id = (iframe.id || '').toLowerCase();
        const cls = (iframe.className || '').toLowerCase();
        // Whitelist Google Translate widgets/frames
        const isTranslate = src.includes('translate.google') || id.includes('goog') || cls.includes('goog')
        if (isTranslate) return
        if (src.includes('ad') || src.includes('banner') || src.includes('popup') ||
            src.includes('doubleclick') || src.includes('googlesyndication') ||
            src === '' || src === 'about:blank') {
          console.log('[AdBlock Pro] Removing iframe:', src.substring(0, 50));
          iframe.remove();
          count++;
        }
      });

      // Remove high z-index fixed overlays (popups/modals)
      document.querySelectorAll('div[style*="position: fixed"], div[style*="position:fixed"]').forEach(div => {
        const zIndex = parseInt(window.getComputedStyle(div).zIndex || '0');
        const id = (div.id || '').toLowerCase()
        const cls = (div.className || '').toLowerCase()
        const isTranslate = id.includes('goog') || cls.includes('goog')
        if (isTranslate) return
        if (zIndex > 9000 && !div.classList.contains('of-launcher-badge')) {
          console.log('[AdBlock Pro] Removing fixed overlay, z-index:', zIndex);
          div.remove();
          count++;
        }
      });

      // Remove elements with ad-related attributes
      document.querySelectorAll('[data-ad-client], [data-ad-slot], [data-google-query-id]').forEach(el => {
        el.remove();
        count++;
      });

      if (count > 0) {
        console.log('[AdBlock Pro] Removed ' + count + ' ad elements');
      }

      // Only apply game page modifications on game detail pages
      const currentPath = window.location.pathname;
      const isGamePage = currentPath.includes('/games/') && currentPath.endsWith('.html');
      console.log('[AdBlock Pro] Current path:', currentPath, 'isGamePage:', isGamePage);
      if (isGamePage) {
        console.log('[AdBlock Pro] Game page detected, checking for unsupported download buttons...');

        // Check if game is installed
        const installedGame = getInstalledGameForCurrentPage();
        const pageVersion = getPageVersion();
        console.log('[AdBlock Pro] Installed game:', installedGame, 'Page version:', pageVersion);

        // Find the download section in the article
        const article = document.querySelector('#dle-content > div > article');
        if (article) {
          // Find all download links
          const allLinks = article.querySelectorAll('a');
          const torrentLinks = [];
          let removedCount = 0;
          let downloadContainer = null;

          // First pass: find download container and remove unsupported buttons
          allLinks.forEach(link => {
            const text = (link.textContent || '').toLowerCase();
            const href = (link.getAttribute('href') || '').toLowerCase();
            const isUnsupported = unsupportedButtonKeywords.some(keyword => text.includes(keyword.toLowerCase()));
            const isTorrentLink = href.includes('/torrents/') || href.includes('.torrent');

            if (isTorrentLink) {
              torrentLinks.push(link);
            }

            // Track download container
            if ((isUnsupported || isTorrentLink) && !downloadContainer) {
              downloadContainer = link.closest('div');
            }

            if (isUnsupported) {
              console.log('[AdBlock Pro] Removing unsupported button:', link.textContent.trim());
              link.remove();
              removedCount++;
            }
          });

          console.log('[AdBlock Pro] Removed', removedCount, 'unsupported download buttons');

          // Attempt to grab torrent links even if the DOM structure shifts (nth-child can vary)
          const torrentButtonSelectors = [
            '#dle-content > div > article > div.full-story-content > div:nth-child(3) > div:nth-child(21) > div > a:nth-child(13)'
          ];
          torrentButtonSelectors.forEach(selector => {
            const fallbackLink = article.querySelector(selector);
            if (fallbackLink && !torrentLinks.includes(fallbackLink)) {
              torrentLinks.push(fallbackLink);
            }
          });

          // Replace torrent links with our own button so we can reliably detect clicks
          const processedTorrentHrefs = new Set();
          article.querySelectorAll('.of-launcher-torrent-button').forEach(btn => {
            const href = btn.getAttribute('data-torrent-href');
            if (href) processedTorrentHrefs.add(href);
          });

          torrentLinks.forEach(link => {
            const href = (link.href || link.getAttribute('href') || '').trim();
            if (!href) return;

            // Skip if we've already created a custom button for this link
            if (processedTorrentHrefs.has(href)) {
              link.remove();
              return;
            }

            const parent = link.parentElement || downloadContainer || article;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'of-launcher-torrent-button';
            button.setAttribute('data-torrent-href', href);
            const initialLabel = (link.textContent || '').trim() || 'Baixar via Torrent';
            button.textContent = initialLabel;
            button.title = href;
            button.style.cssText = baseButtonStyle;
            button.setAttribute('data-state', 'ready');
            button.setAttribute('data-variant', 'download');

            button.addEventListener('click', ev => {
              ev.preventDefault();
              ev.stopPropagation();
              const currentState = button.getAttribute('data-state');
              if (currentState === 'starting' || currentState === 'active') return false;
              setButtonState(button, 'starting', button.getAttribute('data-variant') || 'download');
              console.log('[Torrent Interceptor] Custom torrent button clicked');
              console.log('[TORRENT_DOWNLOAD_REQUEST]', href);
              // Keep the button blocked; after a short delay, move to active state to signal ongoing download
              setTimeout(() => {
                const state = button.getAttribute('data-state');
                if (state === 'starting') {
                  setButtonState(button, 'active', button.getAttribute('data-variant') || 'download');
                }
              }, 1200);
              return false;
            });

            // Preserve state across re-runs of removeAds
            const rememberedState = button.getAttribute('data-state');
            if (!rememberedState || rememberedState === 'ready') {
              setButtonState(button, 'ready', 'download');
            }

            if (parent) {
              parent.insertBefore(button, link);
            } else {
              article.appendChild(button);
            }

            // Keep the download container reference close to the torrent buttons
            if (!downloadContainer && parent && parent.closest) {
              downloadContainer = parent.closest('div');
            }

            console.log('[AdBlock Pro] Replaced torrent link with custom button:', href);
            link.remove();
            processedTorrentHrefs.add(href);
          });

          // If we already built custom buttons, keep track of their container for later UI updates
          if (!downloadContainer) {
            const existingCustomButton = article.querySelector('.of-launcher-torrent-button');
            if (existingCustomButton) {
              downloadContainer = (existingCustomButton.closest && existingCustomButton.closest('div')) || existingCustomButton.parentElement;
            }
          }

          // Find the version container div - try multiple selectors as nth-child can vary
          function findVersionContainer() {
            // Try to find the div containing the version info
            const selectors = [
              '#dle-content > div > article > div.full-story-content > div:nth-child(3) > div:nth-child(21) > div',
              '#dle-content > div > article > div.full-story-content > div:nth-child(3) > div:nth-child(20) > div',
              '#dle-content > div > article > div.full-story-content > div:nth-child(3) > div:nth-child(22) > div'
            ];

            for (const selector of selectors) {
              const el = document.querySelector(selector);
              if (el) {
                const text = el.textContent || '';
                // Check if this div contains version text
                if (/Версия|Version|Versão/i.test(text)) {
                  console.log('[AdBlock Pro] Found version container with selector:', selector);
                  return el;
                }
              }
            }

            // Fallback: search for b tag containing version
            const bTags = article.querySelectorAll('b');
            for (const b of bTags) {
              const text = b.textContent || '';
              if (/Версия|Version|Versão/i.test(text)) {
                const parentDiv = b.closest('div');
                if (parentDiv) {
                  console.log('[AdBlock Pro] Found version container via b tag');
                  return parentDiv;
                }
              }
            }

            return null;
          }

          // Remove existing status badges
          const existingBadge = article.querySelector('.of-launcher-status-badge');
          if (existingBadge) existingBadge.remove();
          const existingWarn = article.querySelector('.of-launcher-download-warning');
          if (existingWarn) existingWarn.remove();

          const versionContainer = findVersionContainer();
          console.log('[AdBlock Pro] Version container found:', !!versionContainer);

          if (installedGame && installedGame.installed_version) {
            // Game is installed - check if update is available
            const needsUpdate = pageVersion && compareVersions(installedGame.installed_version, pageVersion) < 0;
            console.log('[AdBlock Pro] Game installed, version:', installedGame.installed_version, 'needsUpdate:', needsUpdate);

            if (needsUpdate) {
              // Update available - show update badge in version container
              const updateBadge = document.createElement('div');
              updateBadge.className = 'of-launcher-status-badge';
              updateBadge.style.cssText = 'display: block; margin-top: 8px; padding: 6px 12px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border-radius: 6px; font-size: 13px; font-weight: 500; text-align: center;';
              updateBadge.innerHTML = '⬆️ Atualização disponível! (Instalado: ' + installedGame.installed_version + ')';

              if (versionContainer) {
                versionContainer.appendChild(updateBadge);
              } else if (downloadContainer) {
                downloadContainer.insertBefore(updateBadge, downloadContainer.firstChild);
              }

              // Mark custom torrent buttons as update buttons (unless already busy)
              article.querySelectorAll('.of-launcher-torrent-button').forEach(btn => {
                const state = btn.getAttribute('data-state') || 'ready';
                const isBusy = state === 'starting' || state === 'active';
                setButtonState(btn, isBusy ? state : 'ready', 'update');
              });
            } else {
              // Game is up to date - hide download buttons and show installed badge
              if (downloadContainer) {
                const torrentLinks = downloadContainer.querySelectorAll('a[href*="torrent"], a[href*="/torrents/"], .of-launcher-torrent-button');
                torrentLinks.forEach(el => {
                  el.style.display = 'none';
                });
              }

              const installedBadge = document.createElement('div');
              installedBadge.className = 'of-launcher-status-badge';
              installedBadge.style.cssText = 'display: block; margin-top: 8px; padding: 6px 12px; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: 6px; font-size: 13px; font-weight: 500; text-align: center;';
              installedBadge.innerHTML = '✅ Jogo já instalado!';

              if (versionContainer) {
                versionContainer.appendChild(installedBadge);
              } else if (downloadContainer) {
                downloadContainer.insertBefore(installedBadge, downloadContainer.firstChild);
              }
            }
          } else if (downloadContainer) {
            // Game not installed - check remaining download links
            const remainingLinks = downloadContainer.querySelectorAll('a[target="_blank"]:not([style*="display: none"]), a[href*="torrent"]:not([style*="display: none"]), .of-launcher-torrent-button:not([style*="display: none"])');
            console.log('[AdBlock Pro] Remaining download links:', remainingLinks.length);

            if (remainingLinks.length === 0) {
              const warn = document.createElement('div');
              warn.className = 'of-launcher-download-warning of-launcher-badge';
              warn.style.cssText = 'display: block; padding: 12px 16px; margin: 10px 0; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 8px; text-align: center; font-weight: 500;';
              warn.textContent = 'Ainda não é possível baixar este jogo pelo launcher.';
              downloadContainer.appendChild(warn);
            }
          }
        }
      }
    } catch (e) {
      console.error('[AdBlock Pro] removeAds error', e);
    }
  }

  // Block ad scripts at appendChild level (fail-safe)
  try {
    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
      if (child && child.nodeType === 1 && (child.tagName === 'SCRIPT' || child.tagName === 'IFRAME')) {
        const src = (child.src || '').toLowerCase();
        const idVal = child && (child.id || (child.getAttribute && child.getAttribute('id')));
        const clsVal = child && (child.className || (child.getAttribute && child.getAttribute('class')));
        const id = (idVal && typeof idVal.toLowerCase === 'function') ? idVal.toLowerCase() : '';
        const cls = (clsVal && typeof clsVal.toLowerCase === 'function') ? clsVal.toLowerCase() : '';
        const isTranslate = src.includes('translate.google') || id.includes('goog') || cls.includes('goog');
        if (!isTranslate && (src.includes('ad') || src.includes('doubleclick') || src.includes('googlesyndication'))) {
          console.log('[AdBlock Pro] Blocked appendChild:', src);
          return child;
        }
      }
      return originalAppendChild.call(this, child);
    };
  } catch (err) {
    console.warn('[AdBlock Pro] appendChild hook failed', err);
  }

  // CRITICAL: Intercept clicks on torrent download links
  document.addEventListener('click', function(e) {
    let target = e.target;
    console.log('[Click Monitor] Click detected on:', target);

    // Traverse up to find the actual link
    while (target && target !== document) {
      if (target.tagName === 'A') {
        const href = target.href || target.getAttribute('href') || '';
        console.log('[Click Monitor] Link clicked:', href);

        // Check if it's a torrent link
        if (href.includes('/torrents/') || href.endsWith('.torrent')) {
          console.log('[Torrent Interceptor] 🎯 TORRENT LINK CLICKED!');
          console.log('[Torrent Interceptor] Preventing navigation and starting download...');

          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          // Notify via console for the webview to catch
          console.log('[TORRENT_DOWNLOAD_REQUEST]', href);

          return false;
        }
        break;
      }
      target = target.parentElement;
    }
  }, true); // Use capture phase

  // Debounce helper to prevent infinite loops
  let removeAdsTimeout = null;
  let isProcessing = false;
  function debouncedRemoveAds() {
    if (isProcessing) return;
    if (removeAdsTimeout) clearTimeout(removeAdsTimeout);
    removeAdsTimeout = setTimeout(() => {
      isProcessing = true;
      removeAds();
      isProcessing = false;
    }, 100);
  }

  // Clean up immediately (once)
  removeAds();

  // Clean up on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => removeAds());
  }

  // Observer for new ads - use debounced version
  const observer = new MutationObserver(debouncedRemoveAds);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Periodic cleanup fallback (very low frequency to avoid CPU churn)
  setInterval(() => {
    try {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
    } catch {}
    removeAds();
  }, 20000);

  // Prevent body overflow lock from ads
  const bodyObserver = new MutationObserver(() => {
    if (document.body && document.body.style.overflow === 'hidden') {
      document.body.style.overflow = 'auto';
    }
    if (document.documentElement && document.documentElement.style.overflow === 'hidden') {
      document.documentElement.style.overflow = 'auto';
    }
  });

  if (document.body) {
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style']
    });
  }

  // Auto-set Google Translate language to user locale (guarded)
  try {
    (function() {
      const navLang = (navigator.language || (navigator.languages && navigator.languages[0]) || 'en').toLowerCase();
      let target = 'en';
      if (navLang.indexOf('pt') === 0) target = 'pt';
      else if (navLang.indexOf('es') === 0) target = 'es';
      else if (navLang.indexOf('ru') === 0) target = 'ru';
      else if (navLang.indexOf('fr') === 0) target = 'fr';
      else if (navLang.indexOf('de') === 0) target = 'de';

      const apply = () => {
        const select = document.querySelector('select.goog-te-combo');
        if (!select || typeof select.value === 'undefined') return false;
        const current = select.value;
        if (current !== target) {
          select.value = target;
          try {
            select.dispatchEvent(new Event('change'));
          } catch {}
        }
        try { document.cookie = 'googtrans=/auto/' + target + ';path=/'; } catch {}
        return true;
      };

      if (!apply()) {
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          if (apply() || attempts > 20) clearInterval(timer);
        }, 500);
      }
    })();
  } catch (err) {
    console.warn('[AdBlock Pro] autoSetTranslate failed', err);
  }

  console.log('[AdBlock Pro] Client-side protection active!');
})();
`
}

// Launcher features
const launcherCSS = `
  .of-launcher-badge {
    position: absolute; top: 10px; right: 10px;
    padding: 6px 12px; border-radius: 6px;
    font-size: 12px; font-weight: 600; z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .of-launcher-badge.installed {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
  }
  .of-launcher-badge.update-available {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #000;
  }
`

const launcherScript = `
(function() {
  console.log('[OF-Launcher] Active');
  let games = new Map();
  let scheduled = false;
  function findCards() {
    const cards = [];
    ['.short-story', '.story', 'article'].some(s => {
      document.querySelectorAll(s).forEach(el => {
        const link = el.querySelector('a[href*="/games/"]');
        if (link) cards.push({ el, url: link.href });
      });
      return cards.length > 0;
    });
    return cards;
  }
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      try { update(); } catch {}
    };
    try {
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(run);
    } catch {}
    setTimeout(run, 50);
  }
  function update() {
    findCards().forEach(c => {
      const st = games.get(c.url);
      if (!st) return;
      let badge = c.el.querySelector('.of-launcher-badge');
      if (!badge) {
        if (getComputedStyle(c.el).position === 'static') c.el.style.position = 'relative';
        badge = document.createElement('div');
        badge.className = 'of-launcher-badge';
        c.el.appendChild(badge);
      }
      badge.className = 'of-launcher-badge ' + (st.hasUpdate ? 'update-available' : 'installed');
      badge.textContent = st.hasUpdate ? '↑ ' + st.latestVersion : '✓ v' + st.version;
    });
  }
  window.addEventListener('message', e => {
    if (e.data.type === 'OF_LAUNCHER_UPDATE_GAMES') {
      games.clear();
      (e.data.games || []).forEach(g => games.set(g.url, g));
      scheduleUpdate();
    }
  });
  new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true });
  scheduleUpdate();
})();
`

export default function StoreTab({ isLoggedIn, targetUrl, onTargetConsumed }: StoreTabProps) {
  const webviewRef = useRef<HTMLDivElement>(null)
  const webviewInstance = useRef<any>(null)
  const targetUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!webviewRef.current) return

    const container = webviewRef.current

    // Check if webview already exists
    if (webviewInstance.current && webviewInstance.current.parentNode) {
      console.log('[StoreTab] Webview already exists, skipping creation')
      return
    }

    const wv = document.createElement('webview') as any
    // Use persisted URL or default
    wv.src = getPersistedUrl() || 'https://online-fix.me'
    wv.style.width = '100%'
    wv.style.height = '100%'
    wv.setAttribute('partition', 'persist:online-fix')

    webviewInstance.current = wv

    let isReady = false
    let destroyed = false
    const ensureUsable = () => wv.isConnected && !destroyed

    // Block popunders/popups at the <webview> level
    wv.addEventListener('new-window', (e: any) => {
      console.log('[StoreTab] Blocked popunder/new-window:', e?.url)
      e.preventDefault()
    })
    wv.addEventListener('did-create-window', (e: any) => {
      console.log('[StoreTab] Destroyed created window (popunder)')
      if (e && e.window) e.window.destroy?.()
    })
    wv.addEventListener('permissionrequest', (e: any) => {
      console.log('[StoreTab] Denied permission:', e.permission)
      e.preventDefault()
    })

    // Save URL when navigating (for persistence across tab switches)
    wv.addEventListener('did-navigate', (e: any) => {
      if (e.url && !e.url.startsWith('about:')) {
        setPersistedUrl(e.url)
        console.log('[StoreTab] Persisted URL:', e.url)
      }
    })
    wv.addEventListener('did-navigate-in-page', (e: any) => {
      if (e.url && !e.url.startsWith('about:')) {
        setPersistedUrl(e.url)
      }
    })

    // Handle external target URL navigation
    const navigateToTarget = (url?: string | null) => {
      const dest = url || targetUrlRef.current || targetUrl
      if (!dest || !ensureUsable()) return
      targetUrlRef.current = null
      setPersistedUrl(dest)
      try {
        wv.loadURL(dest)
      } catch (err) {
        console.warn('[StoreTab] Failed to load target URL', dest, err)
      }
      if (onTargetConsumed) onTargetConsumed()
    }

    // Listen for console messages from webview
    wv.addEventListener('console-message', (e: any) => {
      const msg = String(e?.message || '')
      if ((import.meta as any)?.env?.DEV) {
        // Web pages can spam console; only show in dev.
        console.log('[Webview Console]', msg)
      }

      // Check if it's a torrent download request
      if (msg.includes('[TORRENT_DOWNLOAD_REQUEST]') && ensureUsable()) {
        const urlMatch = msg.match(/\[TORRENT_DOWNLOAD_REQUEST\]\s+(.+)/)
        if (urlMatch && urlMatch[1]) {
          const torrentUrl = urlMatch[1].trim()
          console.log('[StoreTab] Captured torrent download request from console:', torrentUrl)

          window.electronAPI.startTorrentDownload(torrentUrl, wv.getURL())
            .then((result: any) => {
              console.log('[StoreTab] Download started:', result)
            })
            .catch((err: any) => {
              console.error('[StoreTab] Failed to start download:', err)
            })
        }
      }
    })

    wv.addEventListener('dom-ready', async () => {
      if (!ensureUsable()) return
      isReady = true
      console.log('[StoreTab] Webview DOM ready, injecting scripts...')

      // Load installed games for this page
      let currentInstalledGames: InstalledGame[] = []
      try {
        const result = await window.electronAPI.getGames()
        const gamesList = result?.games || []
        currentInstalledGames = gamesList.filter((g: any) => g.install_path).map((g: any) => ({
          url: g.url,
          title: g.title,
          installed_version: g.installed_version,
          install_path: g.install_path
        }))
        console.log('[StoreTab] Loaded installed games:', currentInstalledGames.length)
      } catch (err) {
        console.warn('[StoreTab] Failed to load games:', err)
      }

      // Inject adblock first (highest priority)
      wv.insertCSS(adBlockCSS)
        .then(() => {
          console.log('[StoreTab] AdBlock CSS injected')
        })
        .catch((err: unknown) => console.warn('[StoreTab] Failed to inject AdBlock CSS', err))

      // Generate script with installed games data
      const adBlockScript = getAdBlockScript(currentInstalledGames)
      wv.executeJavaScript(adBlockScript)
        .then(() => {
          console.log('[StoreTab] AdBlock script injected with', currentInstalledGames.length, 'installed games')
        })
        .catch((err: unknown) => console.warn('[StoreTab] Failed to inject AdBlock script', err))

      // Then launcher features
      wv.insertCSS(launcherCSS).catch(() => {})
      wv.executeJavaScript(launcherScript).catch(() => {})

      // Update game status
      setTimeout(() => {
        if (ensureUsable() && isReady) {
          wv.executeJavaScript(`window.postMessage({ type: 'OF_LAUNCHER_UPDATE_GAMES', games: [] }, '*');`).catch(() => {})
        }
      }, 1000)

      // If a target URL was provided, navigate to it after DOM ready
      if (targetUrl) {
        navigateToTarget(targetUrl)
      }
    })

    const handleTorrentNav = (url: string) => {
      if (!ensureUsable() || !isReady) return false
      console.log('[StoreTab] Navigation detected:', url)
      const lower = (url || '').toLowerCase()
      if (lower.includes('/torrents/') || lower.endsWith('.torrent')) {
        console.log('[StoreTab] ✅ Torrent link detected! Starting download...')
        console.log('[StoreTab] Torrent URL:', url)
        console.log('[StoreTab] Referer:', wv.getURL())

        window.electronAPI.startTorrentDownload(url, wv.getURL())
          .then((result: any) => {
            console.log('[StoreTab] Download started successfully:', result)
          })
          .catch((err: any) => {
            console.error('[StoreTab] Failed to start download:', err)
          })

        return true
      }
      return false
    }

    wv.addEventListener('will-navigate', (e: any) => {
      if ((import.meta as any)?.env?.DEV) console.log('[StoreTab] will-navigate event:', e.url)
      if (handleTorrentNav(e.url)) {
        if ((import.meta as any)?.env?.DEV) console.log('[StoreTab] Preventing navigation to torrent link')
        e.preventDefault()
      }
    })

    wv.addEventListener('new-window', (e: any) => {
      if ((import.meta as any)?.env?.DEV) console.log('[StoreTab] new-window event:', e.url)
      if (handleTorrentNav(e.url)) {
        if ((import.meta as any)?.env?.DEV) console.log('[StoreTab] Preventing new window for torrent link')
        e.preventDefault()
      }
    })

    container.appendChild(wv)

    return () => {
      destroyed = true
      // Save current URL before unmounting
      if (wv && ensureUsable()) {
        try {
          setPersistedUrl(wv.getURL())
        } catch (e) {
          // Ignore errors when getting URL
        }
      }
      if (container && wv.parentNode) {
        container.removeChild(wv)
      }
      webviewInstance.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // React to targetUrl prop changes (navigate existing webview)
  useEffect(() => {
    if (targetUrl && webviewInstance.current) {
      try {
        webviewInstance.current.loadURL(targetUrl)
        targetUrlRef.current = null
        setPersistedUrl(targetUrl)
        if (onTargetConsumed) onTargetConsumed()
      } catch (err) {
        console.warn('[StoreTab] Failed to navigate existing webview to target', targetUrl, err)
      }
    } else if (targetUrl) {
      targetUrlRef.current = targetUrl
    }
  }, [targetUrl, onTargetConsumed])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="webview-container" ref={webviewRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
