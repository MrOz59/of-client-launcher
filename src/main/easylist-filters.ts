import { isAllowedWebviewHost, LOGIN_HOSTS, LOGIN_SUFFIXES, STORE_DOMAINS } from '../shared/allowedHosts'

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

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Which rule a URL trips, or null. Exposed so the block can be logged with the
 * reason — a silent false positive is very hard to track down.
 */
export function matchedPopupRule(url: string): string | null {
  const urlLower = String(url || '').toLowerCase()

  for (const domain of popupDomainSet) {
    if (urlLower.includes(domain)) return `domain:${domain}`
  }
  for (const pattern of popupPatternsLower) {
    if (urlLower.includes(pattern)) return `pattern:${pattern}`
  }

  return null
}

// Keep these exports for compatibility but they're now empty/minimal
export const blockedDomains = popupDomains
export const blockedPatterns = popupPatterns
export const cssHidingRules: string[] = []

/**
 * Check if URL should be blocked (only for popup/redirect related)
 * Returns true only for known popup/redirect networks
 */
export function shouldBlockRequest(url: string, _details?: { resourceType?: string; initiator?: string | null }): boolean {
  // The patterns are substring matches, so a first-party file called popup.js —
  // jQuery UI dialogs, the site's own profile popup — used to trip them. A
  // popunder network is third-party by definition, so the hosts the launcher
  // deliberately browses are never candidates.
  const host = hostOf(url)
  if (!host || isAllowedWebviewHost(host)) return false

  return matchedPopupRule(url) !== null
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
    const storeDomains = ${JSON.stringify(STORE_DOMAINS)};
    const loginHosts = ${JSON.stringify(LOGIN_HOSTS)};
    const loginSuffixes = ${JSON.stringify(LOGIN_SUFFIXES)};

    // Relative URLs resolve against the page, so the site's own links land here
    // as first party.
    function isAllowedHost(url) {
      try {
        const host = new URL(url, window.location.href).hostname.toLowerCase();
        if (storeDomains.some((d) => host === d || host.endsWith('.' + d))) return true;
        if (loginHosts.indexOf(host) !== -1) return true;
        return loginSuffixes.some((suffix) => host.endsWith(suffix));
      } catch (err) {
        return false;
      }
    }

    function isPopupUrl(url) {
      if (!url) return false;
      // The patterns are substring matches: without this, the site's own
      // popup.js / jquery-ui popup paths and profile links get treated as
      // popunders and the profile dialog stops working.
      if (isAllowedHost(url)) return false;
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
        // Always allow the store itself and torrent links
        if (urlLower.includes('.torrent') ||
            urlLower.includes('/torrents/') ||
            isAllowedHost(url)) {
          console.log('[PopupBlocker] Allowing first-party/torrent popup:', url);
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
