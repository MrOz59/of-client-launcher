/**
 * Advanced ad blocking using EasyList-style filters
 * Based on uBlock Origin / AdBlock Plus filter syntax
 */

// Comprehensive list of ad/tracker domains to block
export const blockedDomains = [
  // Major ad networks
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'adservice.google.com',

  // Facebook tracking
  'connect.facebook.net',
  'facebook.com/tr',
  'facebook.net',

  // Common ad networks
  'advertising.com',
  'adnxs.com',
  'adsrvr.org',
  'adform.net',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'sharethrough.com',
  'media.net',
  'contextweb.com',
  'amazon-adsystem.com',

  // Analytics
  'hotjar.com',
  'mouseflow.com',
  'crazyegg.com',
  'luckyorange.com',
  'quantserve.com',
  'scorecardresearch.com',

  // Russian ad networks
  'yandex.ru/ads',
  'yandex.ru/banner',
  'begun.ru',
  'adfox.ru',
  'adfox.yandex.ru',
  'adnow.com',
  'adriver.ru',
  'medialand.ru',
  'clickunder.ru',
  'rotaban.ru',
  'recreativ.ru',
  'advmaker.ru',
  'marketgid.com',

  // Popunders and redirects
  'popcash.net',
  'popads.net',
  'propellerads.com',
  'push-notification.com',
  'clickadu.com',
  'adcash.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.com',
  'ero-advertising.com',

  // Tracking pixels
  'pixel.facebook.com',
  'analytics.twitter.com',
  'b.scorecardresearch.com',
  't.co/i/adsct',
]

// URL patterns to block
export const blockedPatterns = [
  '/ads.js',
  '/ad.js',
  '/ads/',
  '/adv/',
  '/banner',
  '/banners/',
  '/popup',
  '/popunder',
  '/advertisement',
  '/tracking.js',
  '/analytics.js',
  '/gtag/',
  '/ga.js',
  '/fbevents.js',
  '_ads.',
  '/prebid',
  '/adsbygoogle',
  '/monetization',
  '/sponsored',
  '/beacon',
  '/pixel.',
  '/click.track',
  '.doubleclick.',
  'pagead2.googlesyndication',
]

const blockedDomainSet = new Set(blockedDomains.map((d) => d.toLowerCase()))
const blockedPatternsLower = blockedPatterns.map((p) => p.toLowerCase())
const overlaySelectors = [
  'div[id*="popup"]',
  'div[id*="popunder"]',
  'div[class*="modal-backdrop"]',
  'div[class*="modal"]',
  'div[class*="overlay"]',
  'div[class*="pop"]',
  'div[class*="dialog"]',
  'body > div[style*="position: fixed"][style*="z-index"]',
]

// Element hiding rules (CSS selectors)
export const cssHidingRules = [
  // Generic ad containers
  '[class*="advertisement"]',
  '[class*="ad-container"]',
  '[class*="ad-wrapper"]',
  '[class*="ad-banner"]',
  '[class*="ad-slot"]',
  '[class*="adsense"]',
  '[id*="advertisement"]',
  '[id*="ad-container"]',
  '[id*="ad-banner"]',
  '[id*="google_ads"]',

  // Specific ad services
  '.adsbygoogle',
  'ins.adsbygoogle',
  '[data-ad-client]',
  '[data-ad-slot]',

  // Iframes with ad URLs
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="/ads"]',
  'iframe[src*="adnxs"]',

  // Popups and overlays
  '[class*="popup-ad"]',
  '[class*="pop-up"]',
  '[class*="modal-ad"]',
  '[class*="overlay-ad"]',
  '[id*="popup"]',

  // Russian ad networks
  '[class*="yandex-ad"]',
  '[class*="begun"]',
  '[class*="adfox"]',
  'div[id*="yandex_ad"]',

  // Social media tracking
  '[class*="fb-like"]',
  '[class*="twitter-share"]',
  '.fb_iframe_widget',

  // Common overlay patterns
  'div[style*="position: fixed"][style*="z-index: 999"]',
  'div[style*="position: fixed"][style*="z-index: 9999"]',
  ...overlaySelectors,
]

/**
 * Check if URL should be blocked
 */
export function shouldBlockRequest(url: string): boolean {
  const urlLower = url.toLowerCase()

  // Check blocked domains
  for (const domain of blockedDomainSet) {
    if (urlLower.includes(domain)) return true
  }

  // Check blocked patterns
  for (const pattern of blockedPatternsLower) {
    if (urlLower.includes(pattern)) return true
  }

  return false
}

/**
 * Generate comprehensive CSS to hide ads
 */
export function generateAdBlockCSS(): string {
  const selectors = cssHidingRules.join(',\n  ')

  return `
  /* uBlock Origin style ad blocking */
  ${selectors} {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    height: 0 !important;
    width: 0 !important;
    position: absolute !important;
    left: -9999px !important;
  }

  /* Prevent body scroll lock */
  body {
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
  `
}

/**
 * Advanced JavaScript ad blocker
 */
export function generateAdBlockScript(): string {
  return `
  (function() {
    'use strict';
    console.log('[AdBlock Pro] Initializing advanced ad blocking...');

    // Comprehensive ad removal
    function removeAds() {
      const selectors = ${JSON.stringify(cssHidingRules)};
      let count = 0;

      selectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(el => {
            el.remove();
            count++;
          });
        } catch(e) {}
      });

      // Remove elements with ad-related attributes
      document.querySelectorAll('[data-ad-client], [data-ad-slot], [data-google-query-id]').forEach(el => {
        el.remove();
        count++;
      });

      if (count > 0) {
        console.log('[AdBlock Pro] Removed ' + count + ' ad elements');
      }
    }

    // Block ad scripts and iframes at appendChild level
    const originalAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
      if (child.nodeType === 1) { // Element node
        const tagName = child.tagName;
        const src = child.src || child.getAttribute('src') || '';
        const href = child.href || child.getAttribute('href') || '';

        const blockedDomains = ${JSON.stringify(blockedDomains)};
        const blockedPatterns = ${JSON.stringify(blockedPatterns)};

        // Check if it's an ad script or iframe
        if (tagName === 'SCRIPT' || tagName === 'IFRAME') {
          const url = src || href;

          // Check against blocked domains
          for (const domain of blockedDomains) {
            if (url.toLowerCase().includes(domain)) {
              console.log('[AdBlock Pro] Blocked ' + tagName + ': ' + url);
              return child;
            }
          }

          // Check against blocked patterns
          for (const pattern of blockedPatterns) {
            if (url.toLowerCase().includes(pattern)) {
              console.log('[AdBlock Pro] Blocked ' + tagName + ': ' + url);
              return child;
            }
          }
        }
      }

      return originalAppendChild.call(this, child);
    };

    // Also override insertBefore
    const originalInsertBefore = Element.prototype.insertBefore;
    Element.prototype.insertBefore = function(newNode, referenceNode) {
      if (newNode.nodeType === 1) {
        const tagName = newNode.tagName;
        const src = newNode.src || newNode.getAttribute('src') || '';

        if (tagName === 'SCRIPT' || tagName === 'IFRAME') {
          const blockedDomains = ${JSON.stringify(blockedDomains)};
          for (const domain of blockedDomains) {
            if (src.toLowerCase().includes(domain)) {
              console.log('[AdBlock Pro] Blocked insertBefore: ' + src);
              return newNode;
            }
          }
        }
      }
      return originalInsertBefore.call(this, newNode, referenceNode);
    };

    // Block window.open popups
    const originalOpen = window.open;
    window.open = function(...args) {
      console.log('[AdBlock Pro] Blocked popup window');
      return null;
    };

    // Block overlay click hijacks / popunders
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest('a');
      if (!link) return;
      const href = (link.getAttribute('href') || '').toLowerCase();
      const blockedDomains = ${JSON.stringify(blockedDomains)};
      const blockedPatterns = ${JSON.stringify(blockedPatterns)};
      for (const domain of blockedDomains) {
        if (href.includes(domain)) {
          e.preventDefault();
          e.stopPropagation();
          console.log('[AdBlock Pro] Blocked overlay/popunder link:', href);
          return;
        }
      }
      for (const pattern of blockedPatterns) {
        if (href.includes(pattern)) {
          e.preventDefault();
          e.stopPropagation();
          console.log('[AdBlock Pro] Blocked overlay/popunder link:', href);
          return;
        }
      }
    }, true);

    // Prevent redirects on click
    document.addEventListener('click', function(e) {
      let target = e.target;
      while (target && target !== document) {
        if (target.tagName === 'A') {
          const href = target.href || '';
          const blockedDomains = ${JSON.stringify(blockedDomains)};

          for (const domain of blockedDomains) {
            if (href.includes(domain)) {
              e.preventDefault();
              e.stopPropagation();
              console.log('[AdBlock Pro] Blocked redirect to: ' + href);
              return false;
            }
          }
        }
        target = target.parentElement;
      }
    }, true);

    // Remove ads immediately and continuously
    removeAds();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', removeAds);
    }

    // Watch for new ads with aggressive observer
    const observer = new MutationObserver((mutations) => {
      removeAds();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'id']
    });

    // Periodic cleanup every 2 seconds
    setInterval(removeAds, 2000);

    // Prevent body overflow lock
    const bodyObserver = new MutationObserver(() => {
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = 'auto';
      }
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = 'auto';
      }
    });

    if (document.body) {
      bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['style']
      });
    }

    console.log('[AdBlock Pro] Advanced protection active!');
  })();
  `
}
