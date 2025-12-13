/**
 * Ad blocking and tracker blocking for webviews
 */

// Common ad and tracker domains to block
export const blockedDomains = [
  // Ad networks
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'advertising.com',
  'adnxs.com',
  'adsrvr.org',
  'adform.net',
  'criteo.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'sharethrough.com',

  // Analytics and tracking
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.com/tr',
  'connect.facebook.net',
  'hotjar.com',
  'mouseflow.com',
  'crazyegg.com',
  'luckyorange.com',

  // Known ad servers
  'ads.yahoo.com',
  'adserver',
  'adservice',
  'adverserve',

  // Specific to common Russian ad networks
  'yandex.ru/ads',
  'begun.ru',
  'adfox.ru',
  'adnow.com',
  'adriver.ru',
  'medialand.ru'
]

// URL patterns to block
export const blockedPatterns = [
  '/ads/',
  '/ad.js',
  '/ads.js',
  '/banner',
  '/popup',
  '/adv/',
  '/advertisement',
  '/tracking',
  '/analytics',
  '/pixel',
  '/beacon'
]

/**
 * Check if a URL should be blocked
 */
export function shouldBlockUrl(url: string): boolean {
  const urlLower = url.toLowerCase()

  // Check blocked domains
  for (const domain of blockedDomains) {
    if (urlLower.includes(domain.toLowerCase())) {
      return true
    }
  }

  // Check blocked patterns
  for (const pattern of blockedPatterns) {
    if (urlLower.includes(pattern)) {
      return true
    }
  }

  return false
}

/**
 * CSS rules to hide common ad elements
 */
export const adBlockCSS = `
  /* Hide common ad containers */
  [class*="advertisement"],
  [class*="ad-container"],
  [class*="ad-banner"],
  [class*="ad-slot"],
  [id*="advertisement"],
  [id*="ad-container"],
  [id*="ad-banner"],
  [id*="google_ads"],
  iframe[src*="doubleclick"],
  iframe[src*="googlesyndication"],
  iframe[src*="ads"],
  .adsbygoogle,
  ins.adsbygoogle,

  /* Hide popups and overlays */
  [class*="popup"],
  [class*="modal"][class*="ad"],
  [class*="overlay"][class*="ad"],

  /* Russian ad networks */
  [class*="yandex_ad"],
  [class*="begun"],
  [class*="adfox"],

  /* Generic hiding */
  div[style*="position: fixed"][style*="z-index: 9"],
  div[style*="position: fixed"][style*="z-index: 99"],
  div[style*="position: fixed"][style*="z-index: 999"],
  div[style*="position: fixed"][style*="z-index: 9999"] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* Prevent body scroll lock from ads */
  body {
    overflow: auto !important;
  }
`

/**
 * JavaScript to remove ads dynamically
 */
export const adBlockScript = `
(function() {
  console.log('[AdBlock] Initializing...');

  // Remove ads on load
  function removeAds() {
    const selectors = [
      '[class*="advertisement"]',
      '[class*="ad-container"]',
      '[class*="ad-banner"]',
      '[id*="advertisement"]',
      '[id*="ad-container"]',
      'iframe[src*="ads"]',
      'iframe[src*="doubleclick"]',
      'iframe[src*="googlesyndication"]',
      '.adsbygoogle',
      'ins.adsbygoogle'
    ];

    let removedCount = 0;
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.remove();
        removedCount++;
      });
    });

    if (removedCount > 0) {
      console.log('[AdBlock] Removed ' + removedCount + ' ad elements');
    }
  }

  // Block ad scripts
  const originalAppendChild = Element.prototype.appendChild;
  Element.prototype.appendChild = function(child) {
    if (child.tagName === 'SCRIPT' || child.tagName === 'IFRAME') {
      const src = child.src || child.getAttribute('src') || '';
      const blockedDomains = [
        'doubleclick',
        'googlesyndication',
        'googleadservices',
        'ads',
        'adnxs',
        'advertising',
        'google-analytics',
        'googletagmanager',
        'yandex.ru/ads',
        'begun.ru',
        'adfox.ru'
      ];

      for (const domain of blockedDomains) {
        if (src.includes(domain)) {
          console.log('[AdBlock] Blocked script/iframe: ' + src);
          return child;
        }
      }
    }
    return originalAppendChild.call(this, child);
  };

  // Remove ads immediately
  removeAds();

  // Remove ads after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeAds);
  }

  // Watch for new ads being added
  const observer = new MutationObserver((mutations) => {
    removeAds();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Prevent popup windows
  const originalOpen = window.open;
  window.open = function(...args) {
    console.log('[AdBlock] Blocked popup window');
    return null;
  };

  console.log('[AdBlock] Protection active');
})();
`
