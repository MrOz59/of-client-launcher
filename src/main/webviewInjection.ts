// This file contains the code that will be injected into the online-fix.me webview
// to enhance the UI with information about installed games

export interface GameStatus {
  url: string
  installed: boolean
  version?: string
  latestVersion?: string
  hasUpdate?: boolean
}

/**
 * CSS to be injected into the online-fix.me website
 */
export const injectedCSS = `
  /* Overlay badge for installed games */
  .of-launcher-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    z-index: 100;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .of-launcher-badge.installed {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
  }

  .of-launcher-badge.update-available {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #000;
  }

  /* Quick action buttons */
  .of-launcher-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }

  .of-launcher-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .of-launcher-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .of-launcher-btn.play {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
  }

  .of-launcher-btn.download {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
  }

  .of-launcher-btn.update {
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: #000;
  }

  /* Highlight game cards */
  .of-game-card {
    position: relative;
    border: 2px solid transparent;
    transition: border-color 0.3s;
  }

  .of-game-card.installed {
    border-color: #10b981;
  }

  .of-game-card.update-available {
    border-color: #fbbf24;
  }
`

/**
 * JavaScript to be injected into the online-fix.me website
 * This will run in the webview context and communicate with the launcher
 */
export const injectedScript = `
(function() {
  console.log('[OF-Launcher] Script injected successfully');

  // Store game status data
  let gamesStatus = new Map();

  // Function to extract game URL from page elements
  function extractGameUrl(element) {
    const link = element.querySelector('a[href*="online-fix.me/games"]');
    if (link) {
      return link.href;
    }

    // Check if element itself is a link
    if (element.tagName === 'A' && element.href.includes('online-fix.me/games')) {
      return element.href;
    }

    return null;
  }

  // Function to find game cards on the page
  function findGameCards() {
    const cards = [];

    // Try different selectors based on site structure
    const selectors = [
      '.short-story',
      '.story',
      'article',
      '[class*="game"]',
      '[class*="item"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const url = extractGameUrl(el);
        if (url) {
          cards.push({ element: el, url });
        }
      });

      if (cards.length > 0) break;
    }

    return cards;
  }

  // Function to add badge to game card
  function addBadgeToCard(card, status) {
    // Remove existing badge if any
    const existingBadge = card.element.querySelector('.of-launcher-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    // Make sure the card has position relative
    if (getComputedStyle(card.element).position === 'static') {
      card.element.style.position = 'relative';
    }

    // Add game card class
    card.element.classList.add('of-game-card');

    if (status.hasUpdate) {
      card.element.classList.add('update-available');
      card.element.classList.remove('installed');
    } else if (status.installed) {
      card.element.classList.add('installed');
      card.element.classList.remove('update-available');
    }

    // Create badge
    const badge = document.createElement('div');
    badge.className = 'of-launcher-badge';

    if (status.hasUpdate) {
      badge.classList.add('update-available');
      badge.textContent = \`↑ Atualização \${status.latestVersion}\`;
    } else {
      badge.classList.add('installed');
      badge.textContent = \`✓ Instalado v\${status.version}\`;
    }

    card.element.appendChild(badge);
  }

  // Function to add action buttons
  function addActionButtons(card, status) {
    // Find appropriate place to add buttons
    let container = card.element.querySelector('.story-content, .short-story-content, .content');
    if (!container) {
      container = card.element;
    }

    // Remove existing buttons
    const existingButtons = container.querySelector('.of-launcher-actions');
    if (existingButtons) {
      existingButtons.remove();
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'of-launcher-actions';

    if (status.installed) {
      // Play button
      const playBtn = document.createElement('button');
      playBtn.className = 'of-launcher-btn play';
      playBtn.textContent = '▶ Jogar';
      playBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.postMessage({
          type: 'OF_LAUNCHER_PLAY_GAME',
          url: card.url
        }, '*');
      };
      actionsDiv.appendChild(playBtn);

      if (status.hasUpdate) {
        // Update button
        const updateBtn = document.createElement('button');
        updateBtn.className = 'of-launcher-btn update';
        updateBtn.textContent = \`↑ Atualizar para \${status.latestVersion}\`;
        updateBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.postMessage({
            type: 'OF_LAUNCHER_UPDATE_GAME',
            url: card.url
          }, '*');
        };
        actionsDiv.appendChild(updateBtn);
      }
    } else {
      // Download button
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'of-launcher-btn download';
      downloadBtn.textContent = '⬇ Baixar com Launcher';
      downloadBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.postMessage({
          type: 'OF_LAUNCHER_DOWNLOAD_GAME',
          url: card.url
        }, '*');
      };
      actionsDiv.appendChild(downloadBtn);
    }

    container.appendChild(actionsDiv);
  }

  // Function to update all game cards
  function updateGameCards() {
    const cards = findGameCards();
    console.log(\`[OF-Launcher] Found \${cards.length} game cards\`);

    cards.forEach(card => {
      const status = gamesStatus.get(card.url);
      if (status) {
        addBadgeToCard(card, status);
        addActionButtons(card, status);
      }
    });
  }

  // Listen for messages from the Electron app
  window.addEventListener('message', (event) => {
    if (event.data.type === 'OF_LAUNCHER_UPDATE_GAMES') {
      console.log('[OF-Launcher] Received game status update', event.data.games);

      // Update games status map
      gamesStatus.clear();
      if (Array.isArray(event.data.games)) {
        event.data.games.forEach(game => {
          gamesStatus.set(game.url, game);
        });
      }

      // Update the page
      updateGameCards();
    }
  });

  // Initial update
  updateGameCards();

  // Watch for DOM changes (new content loaded)
  const observer = new MutationObserver(() => {
    updateGameCards();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Notify that script is ready
  window.postMessage({ type: 'OF_LAUNCHER_READY' }, '*');
})();
`
