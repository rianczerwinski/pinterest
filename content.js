// Content script — stateless extraction layer
// Does NOT navigate. Reads the current page and returns structured data.
// Navigation is handled by the orchestrator (popup/tab JS) via chrome.tabs.update().

console.log('Pinterest Pin Downloader content script loaded');

// Pinterest system paths that look like board slugs but aren't
const SKIP_SLUGS = new Set([
  'pins', '_saved', '_created', '_drafts', 'followers', 'following',
  'settings', 'topics', 'ideas', 'tried'
]);

// ── Floating progress overlay ────────────────────────────

let overlayEl = null;
let overlayState = { cancelled: false, skipBoard: false, awaitConfirm: false, confirmResolve: null };

// Auto-restore overlay on page load if a session is active
chrome.storage.local.get('_overlaySession', (result) => {
  if (result._overlaySession?.active) {
    createOverlay();
    updateOverlayStatus(
      result._overlaySession.text || 'Loading...',
      result._overlaySession.current || 0,
      result._overlaySession.total || 0
    );
  }
});

/** Persist overlay state so it survives page navigations */
function persistOverlaySession(text, current, total) {
  chrome.storage.local.set({ _overlaySession: { active: true, text, current, total } });
}

function clearOverlaySession() {
  chrome.storage.local.set({ _overlaySession: { active: false } });
}

function createOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'pin-dl-overlay';
  overlayEl.innerHTML = `
    <style>
      #pin-dl-overlay {
        position: fixed; bottom: 24px; right: 24px; z-index: 999999;
        background: #1a1a2e; color: #eee; border-radius: 12px;
        padding: 16px 20px; min-width: 320px; max-width: 400px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        transition: opacity 0.3s;
      }
      #pin-dl-overlay .pdl-title {
        font-weight: 700; font-size: 14px; margin-bottom: 8px;
        display: flex; align-items: center; gap: 8px;
      }
      #pin-dl-overlay .pdl-title .pdl-dot {
        width: 8px; height: 8px; border-radius: 50%; background: #4caf50;
        animation: pdl-pulse 1.2s infinite;
      }
      @keyframes pdl-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      #pin-dl-overlay .pdl-warn {
        color: #ffb74d; font-size: 11px; margin-bottom: 6px;
      }
      #pin-dl-overlay .pdl-status {
        margin-bottom: 8px; line-height: 1.4;
      }
      #pin-dl-overlay .pdl-progress-bar {
        height: 6px; background: #333; border-radius: 3px; overflow: hidden;
        margin-bottom: 10px;
      }
      #pin-dl-overlay .pdl-progress-fill {
        height: 100%; background: linear-gradient(90deg, #e60023, #ff6b6b);
        border-radius: 3px; transition: width 0.3s;
      }
      #pin-dl-overlay .pdl-buttons {
        display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      }
      #pin-dl-overlay .pdl-btn {
        padding: 5px 12px; border: none; border-radius: 6px;
        font-size: 12px; font-weight: 600; cursor: pointer;
        transition: background 0.15s;
      }
      #pin-dl-overlay .pdl-btn-cancel { background: #e60023; color: white; }
      #pin-dl-overlay .pdl-btn-cancel:hover { background: #cc001f; }
      #pin-dl-overlay .pdl-btn-skip { background: #555; color: white; }
      #pin-dl-overlay .pdl-btn-skip:hover { background: #666; }
      #pin-dl-overlay .pdl-btn-confirm { background: #4caf50; color: white; }
      #pin-dl-overlay .pdl-btn-confirm:hover { background: #43a047; }
      #pin-dl-overlay .pdl-toggle {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; color: #aaa; margin-top: 8px;
      }
      #pin-dl-overlay .pdl-toggle input { accent-color: #e60023; }
      #pin-dl-overlay .pdl-verification {
        font-size: 11px; color: #aaa; margin-top: 4px;
      }
      #pin-dl-overlay .pdl-verification .pdl-match { color: #4caf50; }
      #pin-dl-overlay .pdl-verification .pdl-mismatch { color: #ffb74d; }
    </style>
    <div class="pdl-title"><span class="pdl-dot"></span> Pin Downloader Active</div>
    <div class="pdl-warn">⚠ Don't touch this tab — loading in progress</div>
    <div class="pdl-status" id="pdl-status">Initializing...</div>
    <div class="pdl-progress-bar"><div class="pdl-progress-fill" id="pdl-progress" style="width:0%"></div></div>
    <div class="pdl-verification" id="pdl-verification"></div>
    <div class="pdl-buttons">
      <button class="pdl-btn pdl-btn-cancel" id="pdl-cancel">Cancel</button>
      <button class="pdl-btn pdl-btn-skip" id="pdl-skip">Skip Board</button>
      <button class="pdl-btn pdl-btn-confirm" id="pdl-confirm" style="display:none">Continue →</button>
    </div>
    <div class="pdl-toggle">
      <label><input type="checkbox" id="pdl-await-toggle"> Confirm after each board</label>
    </div>
  `;
  document.body.appendChild(overlayEl);

  document.getElementById('pdl-cancel').addEventListener('click', () => {
    overlayState.cancelled = true;
    chrome.runtime.sendMessage({ action: 'overlay-cancel' });
    updateOverlayStatus('Cancelling...', 0, 0);
  });
  document.getElementById('pdl-skip').addEventListener('click', () => {
    overlayState.skipBoard = true;
    chrome.runtime.sendMessage({ action: 'overlay-skip' });
  });
  document.getElementById('pdl-confirm').addEventListener('click', () => {
    if (overlayState.confirmResolve) {
      overlayState.confirmResolve();
      overlayState.confirmResolve = null;
      document.getElementById('pdl-confirm').style.display = 'none';
    }
    chrome.runtime.sendMessage({ action: 'overlay-confirm' });
  });
  document.getElementById('pdl-await-toggle').addEventListener('change', (e) => {
    overlayState.awaitConfirm = e.target.checked;
    chrome.runtime.sendMessage({ action: 'overlay-toggle-confirm', value: e.target.checked });
  });
}

function updateOverlayStatus(text, current, total) {
  if (!overlayEl) createOverlay();
  const statusEl = document.getElementById('pdl-status');
  const progressEl = document.getElementById('pdl-progress');
  if (statusEl) statusEl.textContent = text;
  if (progressEl && total > 0) {
    progressEl.style.width = `${Math.round((current / total) * 100)}%`;
  }
}

function updateOverlayVerification(scraped, expected) {
  if (!overlayEl) return;
  const el = document.getElementById('pdl-verification');
  if (!el) return;
  if (expected == null) {
    el.textContent = `Scraped: ${scraped} pins`;
  } else if (scraped >= expected * 0.95) {
    el.innerHTML = `Scraped: ${scraped} / ${expected} pins <span class="pdl-match">✓</span>`;
  } else {
    el.innerHTML = `Scraped: ${scraped} / ${expected} pins <span class="pdl-mismatch">⚠ incomplete</span>`;
  }
}

function showOverlayConfirmButton() {
  if (!overlayEl) return;
  document.getElementById('pdl-confirm').style.display = '';
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  overlayState = { cancelled: false, skipBoard: false, awaitConfirm: false, confirmResolve: null };
}

// ── Message handler ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Overlay control messages from popup
  if (message.action === 'overlay-show') {
    createOverlay();
    updateOverlayStatus(message.text || 'Starting...', message.current || 0, message.total || 0);
    persistOverlaySession(message.text || 'Starting...', message.current || 0, message.total || 0);
    sendResponse({ success: true });
    return false;
  }
  if (message.action === 'overlay-update') {
    updateOverlayStatus(message.text, message.current || 0, message.total || 0);
    if (message.scraped != null) updateOverlayVerification(message.scraped, message.expected);
    persistOverlaySession(message.text, message.current || 0, message.total || 0);
    sendResponse({ success: true });
    return false;
  }
  if (message.action === 'overlay-await-confirm') {
    showOverlayConfirmButton();
    updateOverlayStatus(message.text || 'Board complete — review and continue', message.current || 0, message.total || 0);
    persistOverlaySession(message.text || 'Board complete', message.current || 0, message.total || 0);
    sendResponse({ success: true });
    return false;
  }
  if (message.action === 'overlay-hide') {
    removeOverlay();
    clearOverlaySession();
    sendResponse({ success: true });
    return false;
  }

  if (message.action !== 'extract') return false;

  const handler = {
    boards: () => extractBoards(),
    pins: () => extractPins(message.options),
    pinCount: () => Promise.resolve({ success: true, pinCount: extractBoardPagePinCount() }),
    diagnose: () => diagnosePage(),
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
  // Pinterest profile pages are fully client-rendered — boards appear only after
  // React hydrates and fetches data via XHR. We need to wait for actual board
  // links to appear in the DOM, not data-test-id attributes (which don't exist
  // on board cards in the current Pinterest UI).

  // Extract username from current URL to identify board links
  const pathMatch = window.location.pathname.match(/^\/([^/]+)\/?$/);
  const username = pathMatch ? pathMatch[1] : null;

  // Wait for board links to render — these are <a> tags with href="/{username}/{slug}/"
  // Also wait for cover images which use elementtiming="cover-image"
  await waitForBoardContent(username, 15000);

  // Scroll down to load all boards — Pinterest lazy-loads them on the profile page
  await scrollToLoadAllBoards(username);

  const boards = [];
  const seen = new Set();
  // Strategy 1: find board links by URL pattern /{username}/{slug}/
  const links = document.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    // Skip non-board paths
    if (href.includes('/pin/') || href.includes('/pins/') || href.includes('/_saved/')
        || href.includes('/settings/') || href.includes('/today')
        || href.startsWith('http')) continue;

    const boardMatch = href.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!boardMatch) continue;

    const [, linkUser, boardSlug] = boardMatch;
    // Must match the profile username (or the username we navigated to)
    if (username && linkUser !== username) continue;
    if (SKIP_SLUGS.has(boardSlug)) continue;

    const url = `/${linkUser}/${boardSlug}/`;
    if (seen.has(url)) continue;
    seen.add(url);

    // Walk up to find the board card container
    const cardContainer = link.closest('[role="listitem"]') || link.parentElement?.parentElement?.parentElement;

    const name = extractBoardNameFromCard(link, cardContainer)
      || decodeURIComponent(boardSlug).replace(/-/g, ' ');
    const coverImg = link.querySelector('img[elementtiming="cover-image"]')
      || link.querySelector('img')
      || cardContainer?.querySelector('img');
    const pinCount = extractPinCount(cardContainer);

    boards.push({
      name,
      url,
      coverImage: coverImg?.src || null,
      pinCount,
    });
  }

  // Strategy 2: parse from __PWS_DATA__ or initial state scripts
  if (boards.length === 0) {
    const scriptBoards = extractBoardsFromScripts();
    for (const b of scriptBoards) {
      if (!seen.has(b.url)) {
        seen.add(b.url);
        boards.push(b);
      }
    }
  }

  console.log(`[Pinterest Pin DL] extractBoards: found ${boards.length} boards:`,
    boards.map(b => `${b.name} (${b.url}, ${b.pinCount ?? '?'} pins)`));

  return { success: true, boards };
}

function extractBoardNameFromCard(link, container) {
  // Look for text elements near the link that could be the board name
  const parent = container || link.parentElement;
  if (!parent) return null;

  // Try common heading elements
  const nameEl = parent.querySelector('h3, h4, h2')
    || parent.querySelector('[data-test-id="board-name"]');
  if (nameEl) return nameEl.textContent?.trim() || null;

  // Look for text nodes in sibling elements (Pinterest often puts the name
  // in a separate div from the cover image link)
  const textEls = parent.querySelectorAll('div');
  for (const el of textEls) {
    const text = el.textContent?.trim();
    // Board names: non-empty, not just a number, not too long
    if (text && text.length > 1 && text.length < 100
        && !text.match(/^\d+$/) && !text.includes('Pin')
        && el.children.length === 0) {
      return text;
    }
  }

  return link.getAttribute('aria-label')?.trim() || null;
}

function extractPinCount(el) {
  if (!el) return null;
  const text = el.textContent || '';

  // Try "3,642 Pins" or "3.642 Pins" (locale-dependent thousands separator)
  const commaMatch = text.match(/([\d,\.]+)\s*(?:pins?|Pins?)/i);
  if (commaMatch) {
    // Strip commas/dots used as thousands separators (not decimal — pin counts are integers)
    const raw = commaMatch[1].replace(/[,\.]/g, '');
    const n = parseInt(raw, 10);
    if (!isNaN(n)) return n;
  }

  // Try "1.2k Pins" or "12K pins"
  const kMatch = text.match(/([\d.]+)\s*k\s*(?:pins?|Pins?)/i);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }

  return null;
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

/** Extract the pin count shown on a board page header (more accurate than profile card) */
function extractBoardPagePinCount() {
  // Pinterest board pages show "N Pins" in the header area
  const candidates = document.querySelectorAll('div, span, h2, h3');
  for (const el of candidates) {
    // Only check leaf-ish elements to avoid matching the whole page
    if (el.children.length > 3) continue;
    const text = el.textContent?.trim() || '';
    // Match "3,642 Pins" or "1.2k Pins" — but NOT "3,642 Pins · 2w" (the whole header)
    if (text.length > 50) continue;
    const m = text.match(/^([\d,\.]+)\s*(?:pins?)/i) || text.match(/^([\d.]+)\s*k\s*(?:pins?)/i);
    if (m) {
      if (text.toLowerCase().includes('k')) {
        return Math.round(parseFloat(m[1]) * 1000);
      }
      return parseInt(m[1].replace(/[,\.]/g, ''), 10);
    }
  }
  return null;
}

// ── Pin extraction ────────────────────────────────────────

async function extractPins(options = {}) {
  const maxScrolls = options.maxScrolls ?? 300;

  // Wait for initial pins
  await waitForSelector(PIN_SELECTORS, 10000);

  // Collect pins incrementally while scrolling — Pinterest virtualizes its grid,
  // so pins scrolled past get removed from the DOM. We must harvest each batch
  // before scrolling further.
  const seenIds = new Set();
  const pins = [];

  function harvestCurrentPins() {
    const pinElements = document.querySelectorAll(PIN_SELECTORS);
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
  }

  // Harvest initial batch
  harvestCurrentPins();

  // Scroll and harvest incrementally
  await scrollAndLoadMore(maxScrolls, harvestCurrentPins);

  // Final harvest after scroll completes
  harvestCurrentPins();

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

  // Sample the board page's own pin count for verification
  const boardPinCount = extractBoardPagePinCount();

  console.log(`[Pinterest Pin DL] extractPins: ${pins.length} unique pins collected (${seenIds.size} seen)`);
  return { success: true, pins, scrolledPins: pins.length, boardPinCount };
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

// ── Diagnostic mode ───────────────────────────────────────

async function diagnosePage() {
  await new Promise(r => setTimeout(r, 2000)); // let page render

  const url = window.location.href;
  const title = document.title;

  // Sample links
  const allLinks = [...document.querySelectorAll('a[href]')];
  const linkSamples = allLinks.slice(0, 100).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent?.trim().substring(0, 60),
    hasImg: !!a.querySelector('img'),
  }));

  // Board-like selectors
  const selectors = {
    'data-test-id=board-card': document.querySelectorAll('[data-test-id="board-card"]').length,
    'data-test-id=board': document.querySelectorAll('[data-test-id="board"]').length,
    'data-test-id=pin': document.querySelectorAll('[data-test-id="pin"]').length,
    'data-test-id=pinWrapper': document.querySelectorAll('[data-test-id="pinWrapper"]').length,
    'class*=Board': document.querySelectorAll('[class*="Board"]').length,
    'class*=board': document.querySelectorAll('[class*="board"]').length,
    'role=list': document.querySelectorAll('[role="list"]').length,
    'role=listitem': document.querySelectorAll('[role="listitem"]').length,
    'role=main': document.querySelectorAll('[role="main"]').length,
    'div[data-grid-item]': document.querySelectorAll('div[data-grid-item]').length,
  };

  // Data attributes in use
  const dataTestIds = new Set();
  document.querySelectorAll('[data-test-id]').forEach(el => {
    dataTestIds.add(el.getAttribute('data-test-id'));
  });

  // Script data
  const scripts = [...document.querySelectorAll('script')];
  const hasResourceResponse = scripts.some(s => s.textContent.includes('resource_response'));
  const hasPWSData = scripts.some(s => s.textContent.includes('__PWS_DATA__'));

  // Board-pattern links (/{user}/{slug}/)
  const boardPatternLinks = allLinks
    .map(a => a.getAttribute('href'))
    .filter(h => h && /^\/[^/]+\/[^/]+\/?$/.test(h) && !h.includes('/pin/'))
    .slice(0, 30);

  return {
    success: true,
    diagnostic: {
      url,
      title,
      totalLinks: allLinks.length,
      selectorCounts: selectors,
      dataTestIds: [...dataTestIds].sort(),
      boardPatternLinks,
      hasResourceResponse,
      hasPWSData,
      linkSamples: linkSamples.filter(l => l.href && !l.href.startsWith('http') && !l.href.startsWith('#')).slice(0, 40),
    },
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

/** Selector set that matches pin containers across Pinterest DOM versions */
const PIN_SELECTORS = [
  'div[data-grid-item="true"]',
  '[data-test-id="pin"]',
  '[data-test-id="pinWrapper"]',
  '.pinWrapper',
].join(', ');

function countPinElements() {
  return document.querySelectorAll(PIN_SELECTORS).length;
}

async function scrollAndLoadMore(maxScrolls = 300, onNewContent = null) {
  let scrollCount = 0;
  let lastPinCount = 0;
  let sameCountIterations = 0;

  while (scrollCount < maxScrolls) {
    // Check for cancel/skip from overlay — makes buttons responsive mid-scroll
    if (overlayState.cancelled || overlayState.skipBoard) break;

    window.scrollTo(0, document.body.scrollHeight);
    await waitForNewContent(2000);

    // Harvest pins before they get virtualized away
    if (onNewContent) onNewContent();

    const currentPinCount = countPinElements();

    if (currentPinCount === lastPinCount) {
      sameCountIterations++;
      // Pinterest lazy-loads in batches — be patient before giving up
      if (sameCountIterations >= 5) break;
    } else {
      sameCountIterations = 0;
    }

    lastPinCount = currentPinCount;
    scrollCount++;

    // Update overlay with scroll progress every 5 scrolls
    if (scrollCount % 5 === 0 && overlayEl) {
      updateOverlayStatus(`Scrolling... ${currentPinCount} pins loaded`, 0, 0);
    }

    // Log to console every 10 scrolls
    if (scrollCount % 10 === 0) {
      console.log(`[Pinterest Pin DL] Scroll ${scrollCount}: ${currentPinCount} pins loaded`);
    }
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
            node.matches?.(PIN_SELECTORS) ||
            node.querySelector?.(PIN_SELECTORS) ||
            // Also detect any added elements containing pin links
            node.querySelector?.('a[href*="/pin/"]')
          )
        )
      );
      if (hasNew) {
        clearTimeout(timer);
        // Give Pinterest a moment to finish rendering the batch
        timer = setTimeout(complete, 600);
      }
    });

    const container = document.querySelector('[role="main"]')
      || document.body;
    observer.observe(container, { childList: true, subtree: true });
  });
}

/** Scroll the profile page to load all boards (Pinterest lazy-loads them) */
async function scrollToLoadAllBoards(username) {
  function countBoardLinks() {
    let count = 0;
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const m = href.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (!m) continue;
      if (username && m[1] !== username) continue;
      if (SKIP_SLUGS.has(m[2])) continue;
      count++;
    }
    return count;
  }

  let lastCount = countBoardLinks();
  let stableIterations = 0;
  const maxScrolls = 30; // boards are fewer than pins — 30 scrolls is plenty

  for (let i = 0; i < maxScrolls; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1200));

    const current = countBoardLinks();
    if (current === lastCount) {
      stableIterations++;
      if (stableIterations >= 3) break;
    } else {
      stableIterations = 0;
      console.log(`[Pinterest Pin DL] Board scroll ${i + 1}: ${current} board links found`);
    }
    lastCount = current;
  }

  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 500));
  console.log(`[Pinterest Pin DL] Board loading complete: ${lastCount} board links found`);
}

/** Wait for board content to appear in the client-rendered DOM */
function waitForBoardContent(username, timeout = 15000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      // Look for links matching /{username}/{slug}/ pattern
      const links = document.querySelectorAll('a[href]');
      let boardLinkCount = 0;
      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;
        const m = href.match(/^\/([^/]+)\/([^/]+)\/?$/);
        if (!m) continue;
        if (username && m[1] !== username) continue;
        const slug = m[2];
        if (SKIP_SLUGS.has(slug)) continue;
        boardLinkCount++;
      }

      if (boardLinkCount > 0) {
        // Found board links — wait a bit more for images to load
        setTimeout(resolve, 1000);
      } else if (Date.now() - start > timeout) {
        resolve(); // timeout — proceed with whatever we have
      } else {
        setTimeout(check, 500);
      }
    };
    check();
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
