// Content script — stateless extraction layer
// Does NOT navigate. Reads the current page and returns structured data.
// Navigation is handled by the orchestrator (popup/tab JS) via chrome.tabs.update().

console.log('Pinterest Pin Downloader content script loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'extract') return false;

  const handler = {
    boards: () => extractBoards(),
    pins: () => extractPins(message.options),
  }[message.mode];

  if (!handler) {
    sendResponse({ success: false, error: `Unknown mode: ${message.mode}` });
    return false;
  }

  handler()
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true; // async
});

// ── Board extraction ──────────────────────────────────────

async function extractBoards() {
  // Wait for board elements to render
  await waitForSelector('[data-test-id="board-card"], [data-test-id="board"], a[href*="/board/"], [class*="BoardCard"], [class*="boardCard"]', 8000);

  const boards = [];
  const seen = new Set();

  // Strategy 1: board card elements
  const boardCards = document.querySelectorAll('[data-test-id="board-card"], [data-test-id="board"]');
  for (const card of boardCards) {
    const board = parseBoardCard(card);
    if (board && !seen.has(board.url)) {
      seen.add(board.url);
      boards.push(board);
    }
  }

  // Strategy 2: board links in profile grid
  if (boards.length === 0) {
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href');
      // Board URLs: /{username}/{board-name}/ (not /pins/, not /pin/, not /_saved/)
      if (!href || href.includes('/pin/') || href.includes('/pins/') || href.includes('/_saved/') || href.includes('/settings/')) continue;
      const boardMatch = href.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (!boardMatch) continue;
      const boardSlug = boardMatch[2];
      // Skip known non-board paths
      if (['pins', '_saved', '_created', 'followers', 'following', 'settings'].includes(boardSlug)) continue;

      const url = `/${boardMatch[1]}/${boardSlug}/`;
      if (seen.has(url)) continue;
      seen.add(url);

      const name = extractBoardNameFromCard(link) || decodeURIComponent(boardSlug).replace(/-/g, ' ');
      const coverImg = link.querySelector('img');
      const pinCountEl = link.closest('[data-test-id="board-card"], [data-test-id="board"]')
        || link.parentElement?.parentElement;
      const pinCount = extractPinCount(pinCountEl);

      boards.push({
        name,
        url,
        coverImage: coverImg?.src || null,
        pinCount,
      });
    }
  }

  // Strategy 3: parse from __PWS_DATA__ or initial state scripts
  if (boards.length === 0) {
    const scriptBoards = extractBoardsFromScripts();
    for (const b of scriptBoards) {
      if (!seen.has(b.url)) {
        seen.add(b.url);
        boards.push(b);
      }
    }
  }

  return { success: true, boards };
}

function parseBoardCard(card) {
  const link = card.querySelector('a[href]');
  if (!link) return null;

  const href = link.getAttribute('href');
  if (!href || href.includes('/pin/') || href.includes('/pins/')) return null;

  const name = card.querySelector('[data-test-id="board-name"], [class*="boardName"], h3, h4')?.textContent?.trim()
    || link.getAttribute('aria-label')?.trim()
    || decodeURIComponent(href.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ');

  const coverImg = card.querySelector('img');
  const pinCount = extractPinCount(card);

  return {
    name,
    url: href.endsWith('/') ? href : href + '/',
    coverImage: coverImg?.src || null,
    pinCount,
  };
}

function extractBoardNameFromCard(link) {
  // Look for explicit name elements near the link
  const parent = link.closest('[data-test-id="board-card"], [data-test-id="board"]') || link.parentElement;
  if (!parent) return null;
  const nameEl = parent.querySelector('[data-test-id="board-name"], h3, h4');
  return nameEl?.textContent?.trim() || null;
}

function extractPinCount(el) {
  if (!el) return null;
  const text = el.textContent || '';
  const match = text.match(/(\d+)\s*(?:pins?|Pins?)/i);
  return match ? parseInt(match[1], 10) : null;
}

function extractBoardsFromScripts() {
  const boards = [];
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text.includes('board') || text.length > 500000) continue;
    try {
      // Look for __PWS_DATA__ or resource_response patterns
      const jsonMatch = text.match(/__PWS_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const boardData = findBoardsInObject(data);
        boards.push(...boardData);
      }
    } catch {
      // ignore parse errors
    }
  }
  return boards;
}

function findBoardsInObject(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return [];
  const results = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && item.type === 'board' && item.id) {
        results.push({
          name: item.name || 'Untitled Board',
          url: item.url || `/${item.owner?.username || 'unknown'}/${item.slug || item.id}/`,
          coverImage: item.image_cover_url || item.images?.['170x']?.url || null,
          pinCount: item.pin_count ?? null,
        });
      }
      results.push(...findBoardsInObject(item, depth + 1));
    }
  } else {
    for (const val of Object.values(obj)) {
      results.push(...findBoardsInObject(val, depth + 1));
    }
  }
  return results;
}

// ── Pin extraction ────────────────────────────────────────

async function extractPins(options = {}) {
  const maxScrolls = options.maxScrolls ?? 50;

  // Wait for initial pins
  await waitForSelector(
    '[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper, [class*="Pin"][class*="wrapper"], div[data-grid-item="true"]',
    10000
  );

  // Scroll to load all pins
  const totalLoaded = await scrollAndLoadMore(maxScrolls);

  // Extract
  const pins = [];
  const seenIds = new Set();

  const selectors = [
    '[data-test-id="pin"]',
    '[data-test-id="pinWrapper"]',
    '.pinWrapper',
    '[class*="Pin"][class*="wrapper"]',
    'div[data-grid-item="true"]',
  ];

  let pinElements = [];
  for (const sel of selectors) {
    pinElements = document.querySelectorAll(sel);
    if (pinElements.length > 0) break;
  }

  for (const [index, el] of [...pinElements].entries()) {
    try {
      const pin = extractPinData(el, index);
      if (pin && pin.id && !seenIds.has(pin.id)) {
        seenIds.add(pin.id);
        pins.push(pin);
      }
    } catch (err) {
      console.warn('Pin extraction failed for element:', err);
    }
  }

  // Fallback: parse from page scripts
  if (pins.length === 0) {
    const scriptPins = extractPinsFromScripts();
    for (const p of scriptPins) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        pins.push(p);
      }
    }
  }

  return { success: true, pins, scrolledPins: totalLoaded };
}

function extractPinData(element, index) {
  const link = element.querySelector('a[href*="/pin/"]');
  const href = link ? link.getAttribute('href') : null;

  let pinId = null;
  if (href) {
    const match = href.match(/\/pin\/(\d+)/);
    pinId = match ? match[1] : null;
  }
  if (!pinId) return null; // Skip elements without a real pin ID

  const img = element.querySelector('img');
  const imageUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;

  const title =
    element.querySelector('[data-test-id="pinTitle"]')?.textContent?.trim() ||
    element.querySelector('h1, h2, h3')?.textContent?.trim() ||
    img?.getAttribute('alt')?.trim() ||
    '';

  return {
    id: pinId,
    title: title || 'Untitled Pin',
    description: title || '',
    image: upgradeImageUrl(imageUrl),
    thumbnail: imageUrl,
    url: `https://www.pinterest.com/pin/${pinId}/`,
  };
}

/** Upgrade Pinterest thumbnail URL to original resolution */
function upgradeImageUrl(url) {
  if (!url) return null;
  // Pinterest image URLs: /236x/... /474x/... /736x/... /originals/...
  return url.replace(/\/\d+x\//, '/originals/');
}

function extractPinsFromScripts() {
  const pins = [];
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text.includes('resource_response') || text.length > 1000000) continue;
    try {
      const jsonMatch = text.match(/\{[\s\S]*"resource_response"[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.resource_response?.data) {
          const pinData = data.resource_response.data;
          const items = Array.isArray(pinData) ? pinData : [pinData];
          for (const item of items) {
            if (item.id && item.type === 'pin') {
              pins.push(formatPinFromAPI(item));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return pins;
}

function formatPinFromAPI(apiPin) {
  return {
    id: String(apiPin.id),
    title: apiPin.title || apiPin.grid_title || 'Untitled Pin',
    description: apiPin.description || apiPin.title || '',
    image: apiPin.images?.orig?.url || apiPin.images?.['736x']?.url || null,
    thumbnail: apiPin.images?.['236x']?.url || apiPin.images?.['136x136']?.url || null,
    url: `https://www.pinterest.com/pin/${apiPin.id}/`,
  };
}

// ── Scroll + wait utilities ───────────────────────────────

async function scrollAndLoadMore(maxScrolls = 50) {
  let scrollCount = 0;
  let lastPinCount = 0;
  let sameCountIterations = 0;

  while (scrollCount < maxScrolls) {
    window.scrollTo(0, document.body.scrollHeight);
    await waitForNewContent(1500);

    const currentPinCount = document.querySelectorAll(
      '[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper'
    ).length;

    if (currentPinCount === lastPinCount) {
      sameCountIterations++;
      if (sameCountIterations >= 3) break;
    } else {
      sameCountIterations = 0;
    }

    lastPinCount = currentPinCount;
    scrollCount++;
  }

  window.scrollTo(0, 0);
  return lastPinCount;
}

function waitForNewContent(timeout) {
  return new Promise(resolve => {
    let timer;
    let observer;

    const complete = () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
      resolve();
    };

    timer = setTimeout(complete, timeout);

    observer = new MutationObserver(mutations => {
      const hasNew = mutations.some(m =>
        Array.from(m.addedNodes).some(node =>
          node.nodeType === 1 && (
            node.matches?.('[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper') ||
            node.querySelector?.('[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper')
          )
        )
      );
      if (hasNew) {
        clearTimeout(timer);
        timer = setTimeout(complete, 500);
      }
    });

    const container = document.querySelector('[data-test-id="user-pins-container"]')
      || document.querySelector('[role="main"]')
      || document.body;
    observer.observe(container, { childList: true, subtree: true });
  });
}

function waitForSelector(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (document.querySelector(selector)) {
        resolve();
      } else if (Date.now() - start > timeout) {
        // Resolve anyway — the page may just not have the expected elements
        resolve();
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}
