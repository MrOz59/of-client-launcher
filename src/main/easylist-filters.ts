/**
 * Lightweight popup/popunder blocker
 * 
 * This blocker is designed to be fair to the website:
 * - Blocks popups, popunders, and redirect ads
 * - Allows static banner ads to remain on the page
 * - Only blocks network requests for known popup/redirect services
 */

// Domains known for popups, popunders, and aggressive redirects ONLY
// We're NOT blocking regular ad networks that show static banners
export const popupDomains = [
  // Popunder/popup networks
  'popcash.net',
  'popads.net',
  'propellerads.com',
  'clickadu.com',
  'adcash.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.com',
  'clickunder.ru',
  'rotaban.ru',
  'popunder.net',
  'popunderjs.com',
  'popjs.com',
  'popmyads.com',
  'poponclick.com',

  // Push notification spam
  'push-notification.com',
  'pushprofit.net',
  'pushengage.com',
  'pushcrew.com',

  // Redirect services
  'adf.ly',
  'bc.vc',
  'sh.st',
  'linkbucks.com',
  'shorte.st',
]

// Patterns that indicate popup/redirect scripts
export const popupPatterns = [
  '/popunder',
  '/popup',
  '/pop.js',
  '/popundr',
  'popunder.js',
  'popup.js',
  '/clickunder',
  '/clickundr',
  '/redirect.js',
  '/redir.',
  'popads.js',
  'popcash.js',
]

const popupDomainSet = new Set(popupDomains.map((d) => d.toLowerCase()))
const popupPatternsLower = popupPatterns.map((p) => p.toLowerCase())

// Keep these exports for compatibility but they're now empty/minimal
export const blockedDomains = popupDomains
export const blockedPatterns = popupPatterns
export const cssHidingRules: string[] = []

/**
 * Check if URL should be blocked (only for popup/redirect related)
 * Returns true only for known popup/redirect networks
 */
export function shouldBlockRequest(url: string): boolean {
  const urlLower = url.toLowerCase()

  // Check popup domains
  for (const domain of popupDomainSet) {
    if (urlLower.includes(domain)) return true
  }

  // Check popup patterns
  for (const pattern of popupPatternsLower) {
    if (urlLower.includes(pattern)) return true
  }

  return false
}

/**
 * Generate minimal CSS - only prevent scroll lock, not hide ads
 */
export function generateAdBlockCSS(): string {
  return `
  /* Only prevent scroll lock from popup overlays, not hide banner ads */
  
  body.popup-open,
  body.modal-open {
    overflow: auto !important;
  }
  `
}

/**
 * Lightweight JavaScript - only blocks popups and window.open
 * Does NOT remove banner ads from the page
 */
export function generateAdBlockScript(): string {
  return `
  (function() {
    'use strict';
    console.log('[PopupBlocker] Initializing lightweight popup blocker...');

    const popupDomains = ${JSON.stringify(popupDomains)};
    const popupPatterns = ${JSON.stringify(popupPatterns)};

    function isPopupUrl(url) {
      if (!url) return false;
      const urlLower = url.toLowerCase();
      for (const domain of popupDomains) {
        if (urlLower.includes(domain)) return true;
      }
      for (const pattern of popupPatterns) {
        if (urlLower.includes(pattern)) return true;
      }
      return false;
    }

    // Block window.open for popups only
    const originalOpen = window.open;
    window.open = function(url, ...args) {
      if (url) {
        const urlLower = url.toLowerCase();
        // Always allow torrent-related URLs
        if (urlLower.includes('.torrent') || 
            urlLower.includes('/torrents/') ||
            urlLower.includes('online-fix.me')) {
          console.log('[PopupBlocker] Allowing torrent-related popup:', url);
          return originalOpen.call(window, url, ...args);
        }
        // Block known popup domains
        if (isPopupUrl(url)) {
          console.log('[PopupBlocker] Blocked popup window:', url);
          return null;
        }
      }
      // Allow other popups (like login windows, etc)
      return originalOpen.call(window, url, ...args);
    };

    // Block only popup/redirect scripts, not ad banner scripts
    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
      if (child.nodeType === 1 && child.tagName === 'SCRIPT') {
        const src = child.src || child.getAttribute('src') || '';
        if (isPopupUrl(src)) {
          console.log('[PopupBlocker] Blocked popup script:', src);
          return child;
        }
      }
      return originalAppendChild.call(this, child);
    };

    // Block click hijacking for popunders only
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;
      
      const link = target.closest ? target.closest('a') : null;
      if (link) {
        const href = link.href || link.getAttribute('href') || '';
        if (isPopupUrl(href)) {
          e.preventDefault();
          e.stopPropagation();
          console.log('[PopupBlocker] Blocked popunder link:', href);
          return false;
        }
      }
    }, true);

    console.log('[PopupBlocker] Lightweight protection active - banner ads allowed');
  })();
  `
}

