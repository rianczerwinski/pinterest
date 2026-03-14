// ── Archive state ─────────────────────────────────────────
// v2 archive: pins keyed by ID, boards under profiles, download tracking.

const ARCHIVE_VERSION = 2;

let archive = emptyArchive();
let currentProfile = '';
let boardSelections = {}; // boardName → boolean
let newPinIds = new Set(); // populated after diff
let selectedPinterestTab = null;

let downloadSettings = {
  minDelay: 2000,
  maxDelay: 5000,
  batchSize: 5,
  batchDelay: 10000,
  maxRetries: 3,
  exponentialBackoff: true,
  folderPrefix: 'pinterest',
};

let downloadState = {
  isDownloading: false,
  currentBatch: 0,
  totalBatches: 0,
  completed: 0,
  failed: 0,
  total: 0,
};

function emptyArchive() {
  return { version: ARCHIVE_VERSION, profiles: {}, pins: {}, downloads: null };
}

// ── Initialization ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadState().then(() => {
    // Start fresh — no pins selected on load
    for (const pin of Object.values(archive.pins)) pin.selected = false;
    initEventListeners();
    initPinListDelegation();
    refreshTabStatus();
    renderAll();
  });
});

function initEventListeners() {
  // Profile
  el('loadProfileBtn').addEventListener('click', loadProfile);
  el('refreshTabsBtn').addEventListener('click', refreshTabStatus);
  el('openPinterestBtn').addEventListener('click', openPinterest);

  // Boards
  el('selectAllBoardsBtn').addEventListener('click', () => setBoardSelections(true));
  el('selectIncompleteBoardsBtn').addEventListener('click', selectIncompleteBoards);
  el('deselectAllBoardsBtn').addEventListener('click', () => setBoardSelections(false));
  el('loadSelectedBoardsBtn').addEventListener('click', loadSelectedBoards);
  el('scrapeCountsBtn').addEventListener('click', scrapeAccurateCounts);

  // Diff
  el('selectNewPinsBtn').addEventListener('click', selectNewPins);
  el('dismissDiffBtn').addEventListener('click', () => { el('diffSection').style.display = 'none'; });

  // Pins
  el('selectAllPinsBtn').addEventListener('click', () => setAllPinSelections(true));
  el('deselectAllPinsBtn').addEventListener('click', () => setAllPinSelections(false));
  el('resetDownloadsBtn').addEventListener('click', resetDownloads);
  el('exportMetadataBtn').addEventListener('click', exportMetadataOnly);
  el('downloadSelectedBtn').addEventListener('click', downloadSelected);
  el('searchInput').addEventListener('input', debounce(renderPins, 300));
  el('filterSelect').addEventListener('change', renderPins);

  // Resume
  el('resumeBtn').addEventListener('click', resumeDownload);
  el('clearResumeBtn').addEventListener('click', clearResume);

  // Diagnose
  el('diagnoseBtn')?.addEventListener('click', runDiagnose);

  // Export/Import
  el('exportBtn').addEventListener('click', exportArchive);
  el('importBtn').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', importArchive);

  // Settings
  for (const id of ['minDelay', 'maxDelay', 'batchSize', 'batchDelay', 'maxRetries', 'exponentialBackoff']) {
    el(id).addEventListener('change', updateSettings);
  }
}

// ── Tab management ────────────────────────────────────────
// The extension creates and owns a dedicated Pinterest tab. It doesn't hijack
// existing tabs — it opens a new one and tracks it by ID.

async function refreshTabStatus() {
  const dot = el('tabStatusDot');
  const text = el('tabStatusText');
  const openBtn = el('openPinterestBtn');

  // Check if our tracked tab still exists
  if (selectedPinterestTab) {
    try {
      const tab = await chrome.tabs.get(selectedPinterestTab.id);
      if (tab?.url?.includes('pinterest.com')) {
        dot.className = 'status-dot green';
        text.textContent = `Connected: Tab ${tab.id} — ${tab.title?.substring(0, 30) || tab.url}`;
        openBtn.style.display = 'none';
        return;
      }
    } catch { /* tab was closed */ }
    selectedPinterestTab = null;
  }

  dot.className = 'status-dot red';
  text.textContent = 'No connected tab';
  openBtn.style.display = '';
}

/** Open a new Pinterest tab and mark it as the connected tab */
function openPinterest() {
  chrome.tabs.create({ url: 'https://www.pinterest.com', active: false }, (tab) => {
    selectedPinterestTab = tab;
    setTimeout(refreshTabStatus, 2000);
  });
}

async function getTab() {
  // Verify our tracked tab is still alive
  if (selectedPinterestTab) {
    try {
      const tab = await chrome.tabs.get(selectedPinterestTab.id);
      if (tab?.url?.includes('pinterest.com')) return tab;
    } catch { /* tab closed */ }
  }
  // No valid tab — open one
  return new Promise((resolve) => {
    chrome.tabs.create({ url: 'https://www.pinterest.com', active: false }, (tab) => {
      selectedPinterestTab = tab;
      refreshTabStatus();
      // Wait for it to load
      const listener = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => resolve(tab), 1500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// ── Navigation + extraction ───────────────────────────────

async function navigateAndExtract(tabId, url, mode, options = {}) {
  // Activate the Pinterest tab — background tabs get throttled and Pinterest
  // won't render board content in inactive tabs (requestIdleCallback, IntersectionObserver)
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTabLoad(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'extract', mode, options }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('No response from content script'));
      } else {
        resolve(response);
      }
    });
  });
}

/** Send extraction message to a tab WITHOUT navigating — the page is already loaded */
function extractFromTab(tabId, mode, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'extract', mode, options }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response) {
        reject(new Error('No response from content script'));
      } else {
        resolve(response);
      }
    });
  });
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for Pinterest's client-side rendering
        setTimeout(resolve, 3000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Profile + board loading ───────────────────────────────

async function loadProfile() {
  const username = el('usernameInput').value.trim();
  if (!username) { showStatus('Enter a username', 'error'); return; }

  currentProfile = username;
  showStatus('Loading boards... Make sure the Pinterest tab is on the profile page.', 'info');
  el('loadProfileBtn').disabled = true;

  try {
    const tab = await getTab();

    // Check if the Pinterest tab is already on the right profile page
    const profileUrl = `https://www.pinterest.com/${username}/`;
    const tabUrl = tab.url || '';
    const onProfile = tabUrl.includes(`pinterest.com/${username}`);

    let result;
    if (onProfile) {
      // Already on the profile — extract directly from the live DOM (boards are rendered)
      result = await extractFromTab(tab.id, 'boards');
    } else {
      // Navigate to the profile, activate the tab so Pinterest renders content
      result = await navigateAndExtract(tab.id, profileUrl, 'boards');
    }

    if (!result.success || !result.boards?.length) {
      showStatus('No boards found. The profile may be private or empty.', 'warning');
      el('loadProfileBtn').disabled = false;
      return;
    }

    // Store board metadata in archive
    if (!archive.profiles[username]) {
      archive.profiles[username] = { lastFetched: null, boards: {} };
    }

    const profile = archive.profiles[username];
    for (const board of result.boards) {
      const existing = profile.boards[board.name];
      profile.boards[board.name] = {
        url: board.url,
        coverImage: board.coverImage,
        pinCount: board.pinCount,
        lastFetched: existing?.lastFetched || null,
        pins: existing?.pins || [],
      };
    }
    profile.lastFetched = new Date().toISOString();

    // Initialize board selections
    boardSelections = {};
    for (const b of result.boards) boardSelections[b.name] = true;

    saveState();
    renderBoards();
    showStatus(`Found ${result.boards.length} boards`, 'success');
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }

  el('loadProfileBtn').disabled = false;
}

// Overlay control state — set by messages relayed from content script via background
let overlayControls = { cancelled: false, skipBoard: false, awaitConfirm: false, pendingConfirm: null };

// Listen for overlay control messages relayed by background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'overlay-cancel') overlayControls.cancelled = true;
  if (message.action === 'overlay-skip') overlayControls.skipBoard = true;
  if (message.action === 'overlay-confirm' && overlayControls.pendingConfirm) {
    overlayControls.pendingConfirm();
    overlayControls.pendingConfirm = null;
  }
  if (message.action === 'overlay-toggle-confirm') overlayControls.awaitConfirm = message.value;
});

/** Send an overlay message to the Pinterest tab's content script */
function sendOverlay(tabId, action, data = {}) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action, ...data }, () => {
      if (chrome.runtime.lastError) { /* tab may not have content script */ }
      resolve();
    });
  });
}

/** Wait for the user to click "Continue" on the overlay */
function waitForOverlayConfirm() {
  return new Promise(resolve => { overlayControls.pendingConfirm = resolve; });
}

async function loadSelectedBoards() {
  const username = currentProfile;
  if (!username || !archive.profiles[username]) return;

  const profile = archive.profiles[username];
  const selectedBoards = Object.entries(boardSelections)
    .filter(([, selected]) => selected)
    .map(([name]) => name);

  if (selectedBoards.length === 0) { showStatus('No boards selected', 'error'); return; }

  el('loadSelectedBoardsBtn').disabled = true;
  showStatus(`Loading pins from ${selectedBoards.length} boards...`, 'info');

  // Reset overlay controls
  overlayControls = { cancelled: false, skipBoard: false, awaitConfirm: false, pendingConfirm: null };

  const previousPinIds = new Set(Object.keys(archive.pins).filter(id => archive.pins[id].profile === username));
  let totalNew = 0;
  let totalUpdated = 0;
  let totalPins = 0;
  const verificationResults = []; // { boardName, scraped, expected, match }

  try {
    const tab = await getTab();

    // Show overlay on Pinterest tab
    await sendOverlay(tab.id, 'overlay-show', {
      text: `Loading ${selectedBoards.length} boards...`,
      current: 0, total: selectedBoards.length,
    });

    for (let i = 0; i < selectedBoards.length; i++) {
      if (overlayControls.cancelled) {
        showStatus('Cancelled by user', 'warning');
        break;
      }
      if (overlayControls.skipBoard) {
        overlayControls.skipBoard = false; // reset for next board
      }

      const boardName = selectedBoards[i];
      const boardMeta = profile.boards[boardName];
      if (!boardMeta?.url) continue;

      try {
      const statusText = `Board ${i + 1}/${selectedBoards.length}: ${boardName}`;
      showStatus(`Loading ${statusText}...`, 'info');
      await sendOverlay(tab.id, 'overlay-update', {
        text: `Loading ${statusText}...`,
        current: i, total: selectedBoards.length,
      });

      const result = await navigateAndExtract(
        tab.id,
        `https://www.pinterest.com${boardMeta.url}`,
        document.getElementById('manualScrapeToggle')?.checked ? 'pinsPassive' : 'pins'
      );

      if (overlayControls.skipBoard) {
        overlayControls.skipBoard = false;
        continue;
      }

      if (!result.success || !result.pins?.length) {
        verificationResults.push({ boardName, scraped: 0, expected: boardMeta.pinCount, match: false });
        continue;
      }

      // Verification: compare scraped count vs expected
      const expected = result.boardPinCount ?? boardMeta.pinCount;
      const scraped = result.pins.length;
      const unavailable = result.unavailable || 0;
      const match = expected == null || (scraped + unavailable) >= expected * 0.95;
      verificationResults.push({ boardName, scraped, expected, match, unavailable });

      // Update overlay with verification data
      await sendOverlay(tab.id, 'overlay-update', {
        text: `${statusText} — ${scraped} pins scraped`,
        current: i + 1, total: selectedBoards.length,
        scraped, expected,
      });

      // If board-level pin count was from the page, update the stored metadata
      if (result.boardPinCount != null) {
        boardMeta.pinCount = result.boardPinCount;
        boardMeta.pinCountVerified = true;
      }

      const boardPinIds = [];
      for (const pin of result.pins) {
        boardPinIds.push(pin.id);
        totalPins++;

        const existing = archive.pins[pin.id];
        if (existing) {
          existing.lastSeen = new Date().toISOString();
          existing.title = pin.title || existing.title;
          existing.image = pin.image || existing.image;
          existing.thumbnail = pin.thumbnail || existing.thumbnail;
          existing.altText = pin.altText || existing.altText || '';
          existing.carouselImages = pin.carouselImages || existing.carouselImages || null;
          totalUpdated++;
        } else {
          archive.pins[pin.id] = {
            ...pin,
            board: boardName,
            profile: username,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            downloaded: false,
            downloadPath: null,
            downloadedAt: null,
            downloadError: null,
            downloadAttempts: 0,
            terminalFailure: false,
            selected: false,
          };
          totalNew++;
        }
      }

      boardMeta.pins = boardPinIds;
      boardMeta.lastFetched = new Date().toISOString();
      // Track per-board completeness across harvests
      boardMeta.harvestHistory = (boardMeta.harvestHistory || []).slice(-9); // cap at 10
      boardMeta.harvestHistory.push({
        timestamp: new Date().toISOString(),
        captured: scraped,
        unavailable: result.unavailable || 0,
        expected,
        newPins: boardPinIds.filter(id => !previousPinIds.has(id)).length,
      });
      boardMeta.capturedTotal = boardMeta.pins.length;
      boardMeta.completionPct = expected ? boardMeta.capturedTotal / expected : null;
      saveState();

      // If await-confirm is on, pause for user to review
      if (overlayControls.awaitConfirm && i < selectedBoards.length - 1) {
        await sendOverlay(tab.id, 'overlay-await-confirm', {
          text: `${boardName}: ${scraped} pins scraped${expected ? ` / ${expected} expected` : ''}. Continue?`,
          current: i + 1, total: selectedBoards.length,
        });
        await waitForOverlayConfirm();
      }
      } catch (err) {
        console.error(`[Pinterest Pin DL] Board harvest failed for ${boardName}:`, err);
        verificationResults.push({ boardName, scraped: 0, expected: boardMeta?.pinCount, match: false, error: err.message });
        showStatus(`Board "${boardName}" failed: ${err.message}. Continuing...`, 'warning');
        continue;
      }
    }

    // Hide overlay
    await sendOverlay(tab.id, 'overlay-hide').catch(() => {});

    saveState();

    // Compute diff
    newPinIds = new Set();
    for (const id of Object.keys(archive.pins)) {
      if (archive.pins[id].profile === username && !previousPinIds.has(id)) {
        newPinIds.add(id);
      }
    }

    if (newPinIds.size > 0) {
      showDiff(newPinIds.size, totalPins);
    }

    // Store verification results on profile for persistent display
    profile.lastHarvest = {
      timestamp: new Date().toISOString(),
      boards: verificationResults,
      totalPins,
      totalNew,
      totalUpdated,
    };
    saveState();

    // Render persistent verification and status bar summary
    renderHarvestVerification();
    const mismatches = verificationResults.filter(v => !v.match);
    const countSummary = `${totalPins} pins (${totalNew} new, ${totalUpdated} updated)`;
    if (mismatches.length > 0) {
      showStatus(`Loaded ${countSummary}. ${mismatches.length} board(s) incomplete — see details below.`, 'warning');
    } else {
      showStatus(`Loaded ${countSummary} from ${selectedBoards.length} boards`, 'success');
    }

    renderPins();
    renderBoards(); // refresh pin counts
  } catch (err) {
    // Hide overlay on error
    try { await sendOverlay((await getTab()).id, 'overlay-hide'); } catch { /* ok */ }
    showStatus(`Error: ${err.message}`, 'error');
  }

  el('loadSelectedBoardsBtn').disabled = false;
}

/** Scrape accurate pin counts by visiting each board page briefly */
async function scrapeAccurateCounts() {
  const username = currentProfile;
  if (!username || !archive.profiles[username]) return;

  const profile = archive.profiles[username];
  const boardNames = Object.entries(boardSelections)
    .filter(([, selected]) => selected)
    .map(([name]) => name)
    .filter(name => profile.boards[name]);
  if (boardNames.length === 0) { showStatus('No boards selected', 'error'); return; }

  el('scrapeCountsBtn').disabled = true;
  showStatus(`Scraping pin counts for ${boardNames.length} selected boards...`, 'info');

  try {
    const tab = await getTab();

    await sendOverlay(tab.id, 'overlay-show', {
      text: `Scraping pin counts (0/${boardNames.length})...`,
      current: 0, total: boardNames.length,
    });

    let updated = 0;
    for (let i = 0; i < boardNames.length; i++) {
      const boardName = boardNames[i];
      const boardMeta = profile.boards[boardName];
      if (!boardMeta?.url) continue;

      await sendOverlay(tab.id, 'overlay-update', {
        text: `Counting: ${boardName} (${i + 1}/${boardNames.length})`,
        current: i, total: boardNames.length,
      });

      // Navigate to board page, extract just the pin count
      const result = await navigateAndExtract(
        tab.id,
        `https://www.pinterest.com${boardMeta.url}`,
        'pinCount'
      );

      if (result.success && result.pinCount != null) {
        boardMeta.pinCount = result.pinCount;
        boardMeta.pinCountVerified = true;
        updated++;
      }
    }

    await sendOverlay(tab.id, 'overlay-hide').catch(() => {});

    // Close the dedicated tab — scrape counts is a background operation
    try { chrome.tabs.remove(tab.id); } catch { /* ok */ }
    selectedPinterestTab = null;
    refreshTabStatus();

    saveState();
    renderBoards();
    showStatus(`Updated pin counts for ${updated}/${boardNames.length} boards`, 'success');
  } catch (err) {
    try { await sendOverlay((await getTab()).id, 'overlay-hide'); } catch { /* ok */ }
    showStatus(`Error: ${err.message}`, 'error');
  }

  el('scrapeCountsBtn').disabled = false;
}

// ── Diff ──────────────────────────────────────────────────

function showDiff(newCount, totalCount) {
  el('diffSection').style.display = '';
  el('diffSummary').textContent = `${newCount} new pins found (of ${totalCount} total)`;
}

function selectNewPins() {
  for (const id of newPinIds) {
    if (archive.pins[id]) archive.pins[id].selected = true;
  }
  saveState();
  renderPins();
  el('diffSection').style.display = 'none';
}

// ── Download ──────────────────────────────────────────────

async function downloadSelected() {
  const pins = getVisiblePins().filter(p => p.selected && !p.downloaded);
  if (pins.length === 0) { showStatus('No undownloaded selected pins', 'error'); return; }
  await runDownload(pins);
}

async function resumeDownload() {
  if (!archive.downloads) return;
  const pins = Object.values(archive.pins)
    .filter(p => p.profile === currentProfile && p.selected && !p.downloaded);
  if (pins.length === 0) { showStatus('Nothing to resume', 'info'); clearResume(); return; }
  await runDownload(pins);
}

function clearResume() {
  if (archive.downloads) archive.downloads = null;
  el('resumeBanner').style.display = 'none';
  saveState();
}

async function runDownload(pins) {
  if (downloadState.isDownloading) { showStatus('Download in progress', 'error'); return; }

  downloadState.isDownloading = true;
  downloadState.completed = 0;
  downloadState.failed = 0;
  downloadState.currentBatch = 0;

  el('downloadProgress').style.display = '';
  el('downloadSelectedBtn').disabled = true;
  updateDownloadProgress();

  archive.downloads = {
    lastRun: new Date().toISOString(),
    completed: 0,
    failed: 0,
    total: pins.length,
  };

  // Skip pins with terminal failures from prior runs
  const terminalSkipped = pins.filter(p => p.terminalFailure);
  pins = pins.filter(p => !p.terminalFailure);
  if (terminalSkipped.length > 0) {
    console.log(`[Pinterest Pin DL] Skipping ${terminalSkipped.length} pins with terminal failures`);
  }

  downloadState.total = pins.length;
  downloadState.totalBatches = Math.ceil(pins.length / downloadSettings.batchSize);
  showStatus(`Downloading ${pins.length} pins...`, 'info');

  for (let i = 0; i < pins.length; i += downloadSettings.batchSize) {
    const batch = pins.slice(i, i + downloadSettings.batchSize);
    downloadState.currentBatch++;
    saveState();

    for (const pin of batch) {
      const result = await downloadPinWithRetry(pin);
      pin.downloadAttempts = (pin.downloadAttempts || 0) + 1;
      if (result.success) {
        downloadState.completed++;
        archive.downloads.completed++;
        pin.downloaded = true;
        pin.downloadedAt = new Date().toISOString();
        pin.downloadError = null;
      } else {
        downloadState.failed++;
        archive.downloads.failed++;
        pin.downloadError = result.error;
        pin.terminalFailure = !result.retryable;
        console.warn(`[Pinterest Pin DL] Download failed for pin ${pin.id}: ${result.error}`,
          `(${result.retryable ? 'retryable' : 'terminal'})`,
          `image: ${pin.image}, thumbnail: ${pin.thumbnail}`);
      }
      updateDownloadProgress();
      await sleep(randomDelay());
    }

    // Batch delay with ±30% jitter to avoid fixed-interval fingerprint
    if (i + downloadSettings.batchSize < pins.length) {
      const jitteredBatchDelay = Math.floor(downloadSettings.batchDelay * (0.7 + Math.random() * 0.6));
      showStatus(`Batch ${downloadState.currentBatch}/${downloadState.totalBatches} done. Pausing...`, 'info');
      await sleep(jitteredBatchDelay);
    }
  }

  // Generate sidecar metadata JSON per board
  await generateSidecarMetadata(pins);

  // Done
  downloadState.isDownloading = false;
  el('downloadSelectedBtn').disabled = false;
  saveState();
  renderPins();

  const msg = `Done: ${downloadState.completed} downloaded, ${downloadState.failed} failed`;
  showStatus(msg, downloadState.failed > 0 ? 'warning' : 'success');

  setTimeout(() => { el('downloadProgress').style.display = 'none'; }, 5000);
}

async function downloadPinWithRetry(pin, attempt = 0) {
  const result = await downloadPin(pin);
  if (result.success) return result;

  // Terminal failures — don't retry
  if (!result.retryable) return result;

  // Rate limit detection — pause the whole batch, don't count against retry budget
  if (/429|rate.?limit|too many requests|challenge/i.test(result.error)) {
    const cooldown = 60000 + Math.floor(Math.random() * 30000);
    console.warn(`[Pinterest Pin DL] Rate limit detected — pausing ${Math.round(cooldown/1000)}s`);
    showStatus(`Rate limited — cooling down ${Math.round(cooldown/1000)}s...`, 'warning');
    await sleep(cooldown);
    return downloadPinWithRetry(pin, attempt); // retry without incrementing attempt
  }

  // Retryable failure — backoff and try again
  if (attempt < downloadSettings.maxRetries) {
    const delay = downloadSettings.exponentialBackoff
      ? Math.min(downloadSettings.maxDelay * Math.pow(2, attempt), 30000)
      : downloadSettings.maxDelay;
    await sleep(delay);
    return downloadPinWithRetry(pin, attempt + 1);
  }
  console.warn(`[Pinterest Pin DL] Download failed after ${attempt + 1} attempts for pin ${pin.id}:`, result.error);
  return result;
}

// Terminal error patterns — will never succeed on retry
const TERMINAL_ERRORS = /SERVER_BAD_CONTENT|FILE_FAILED|SERVER_FORBIDDEN|SERVER_UNAUTHORIZED|URL_INVALID/i;

/** Detect file extension from a Pinterest image URL */
function extFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.(jpe?g|png|gif|webp|svg)$/i);
    return match ? match[0].toLowerCase() : '.jpg';
  } catch { return '.jpg'; }
}

function downloadSingleImage(imageUrl, filename, pinId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: imageUrl,
      filename,
      pinId,
    }, response => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, retryable: true, error: chrome.runtime.lastError.message });
      } else if (response?.success) {
        resolve({ success: true, path: response.path });
      } else {
        const error = response?.error || 'Download returned failure';
        resolve({ success: false, retryable: !TERMINAL_ERRORS.test(error), error });
      }
    });
  });
}

async function downloadPin(pin) {
  const imageUrl = pin.image || pin.thumbnail;
  if (!imageUrl) {
    return { success: false, retryable: false, error: 'No image URL' };
  }

  const prefix = downloadSettings.folderPrefix || 'pinterest';
  const boardSlug = (pin.board || 'uncategorized').replace(/[^a-z0-9]/gi, '_');
  const titleSlug = (pin.title || pin.id).replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const ext = extFromUrl(imageUrl);
  const filename = `${prefix}/${pin.profile || 'unknown'}/${boardSlug}/${titleSlug}_${pin.id}${ext}`;

  const result = await downloadSingleImage(imageUrl, filename, pin.id);
  if (result.success) pin.downloadPath = result.path;

  // Download carousel images (if any) after the primary succeeds
  if (result.success && pin.carouselImages?.length > 1) {
    for (let i = 1; i < pin.carouselImages.length; i++) {
      const carouselUrl = pin.carouselImages[i];
      const carouselExt = extFromUrl(carouselUrl);
      const carouselFilename = `${prefix}/${pin.profile || 'unknown'}/${boardSlug}/${titleSlug}_${pin.id}_${i + 1}${carouselExt}`;
      const carouselResult = await downloadSingleImage(carouselUrl, carouselFilename, pin.id);
      if (!carouselResult.success) {
        console.warn(`[Pinterest Pin DL] Carousel image ${i + 1} failed for pin ${pin.id}: ${carouselResult.error}`);
      }
      await sleep(randomDelay());
    }
  }

  return result;
}

// ── Sidecar metadata ─────────────────────────────────────

/** Export metadata for all downloaded pins in the current profile */
async function exportMetadataOnly() {
  if (!currentProfile) { showStatus('No profile loaded', 'error'); return; }
  const pins = Object.values(archive.pins).filter(p => p.profile === currentProfile && p.downloaded);
  if (pins.length === 0) { showStatus('No downloaded pins to export metadata for', 'error'); return; }
  showStatus(`Exporting metadata for ${pins.length} pins...`, 'info');
  await generateSidecarMetadata(pins);
  showStatus(`Metadata exported for ${pins.length} pins`, 'success');
}

/** Generate a metadata JSON file per board for downloaded pins */
async function generateSidecarMetadata(pins) {
  // Group downloaded pins by board
  const byBoard = {};
  for (const pin of pins) {
    if (!pin.downloaded) continue;
    const board = pin.board || 'uncategorized';
    if (!byBoard[board]) byBoard[board] = [];
    byBoard[board].push(pin);
  }

  const prefix = downloadSettings.folderPrefix || 'pinterest';
  for (const [board, boardPins] of Object.entries(byBoard)) {
    if (boardPins.length === 0) continue;
    const boardSlug = board.replace(/[^a-z0-9]/gi, '_');
    const profile = boardPins[0].profile || 'unknown';

    const metadata = {
      board,
      profile,
      exportedAt: new Date().toISOString(),
      pinCount: boardPins.length,
      pins: boardPins.map(pin => ({
        id: pin.id,
        title: pin.title,
        description: pin.description || '',
        altText: pin.altText || '',
        url: pin.url,
        imageUrl: pin.image,
        carouselImages: pin.carouselImages || null,
        downloadPath: pin.downloadPath || null,
        firstSeen: pin.firstSeen,
        downloadedAt: pin.downloadedAt,
      })),
    };

    const json = JSON.stringify(metadata, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const filename = `${prefix}/${profile}/${boardSlug}/_metadata.json`;

    // Download directly — data: URLs work with chrome.downloads
    await new Promise(resolve => {
      chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'overwrite', saveAs: false }, () => resolve());
    });
  }
}

// ── Rendering ─────────────────────────────────────────────

function renderAll() {
  if (currentProfile && archive.profiles[currentProfile]) {
    el('usernameInput').value = currentProfile;
    renderBoards();
    renderPins();
    renderHarvestVerification();
    checkForResume();
  }
  applySettings();
  updateStats();
}

function renderHarvestVerification() {
  const container = el('harvestVerification');
  if (!container) return;

  const profile = archive.profiles[currentProfile];
  if (!profile?.lastHarvest?.boards?.length) {
    container.style.display = 'none';
    return;
  }

  const h = profile.lastHarvest;
  const rows = h.boards.map(v => {
    const cls = v.match ? 'match' : 'mismatch';
    let counts = `${v.scraped}`;
    if (v.unavailable) counts += ` + <span class="unavailable">${v.unavailable} unavailable</span>`;
    if (v.expected != null) counts += ` of ${v.expected}`;

    return `<div class="board-row"><span class="board-name">${esc(v.boardName)}</span><span class="${cls}">${counts}</span></div>`;
  }).join('');

  const ts = timeAgo(new Date(h.timestamp).getTime());
  container.innerHTML = `<div style="margin-bottom:4px;font-weight:600;font-size:12px">Last harvest: ${h.totalPins} pins (${h.totalNew} new, ${h.totalUpdated} updated) · ${ts}</div>${rows}`;
  container.style.display = '';
}

function renderBoards() {
  const profile = archive.profiles[currentProfile];
  if (!profile) return;

  const boardNames = Object.keys(profile.boards);
  el('boardSection').style.display = boardNames.length ? '' : 'none';
  el('boardCount').textContent = boardNames.length;

  // Profile-level completeness summary
  let totalCaptured = 0, totalExpected = 0, boardsComplete = 0;
  for (const b of Object.values(profile.boards)) {
    if (b.capturedTotal != null && b.pinCount != null) {
      totalCaptured += b.capturedTotal;
      totalExpected += b.pinCount;
      if (b.completionPct >= 0.99) boardsComplete++;
    }
  }
  const summaryEl = el('profileSummary');
  if (summaryEl && totalExpected > 0) {
    const pct = (totalCaptured / totalExpected * 100).toFixed(1);
    summaryEl.textContent = `${boardsComplete}/${boardNames.length} boards complete · ${totalCaptured.toLocaleString()}/${totalExpected.toLocaleString()} pins (${pct}%)`;
    summaryEl.style.display = '';
  } else if (summaryEl) {
    summaryEl.style.display = 'none';
  }

  let truncatedCount = 0;
  const grid = el('boardGrid');
  grid.innerHTML = boardNames.map(name => {
    const b = profile.boards[name];
    const checked = boardSelections[name] !== false;
    const lastFetched = b.lastFetched ? timeAgo(new Date(b.lastFetched).getTime()) : 'never';
    const pinCount = b.pinCount ?? b.pins?.length ?? '?';

    // Flag truncated counts (round thousands suggest "Xk" approximation) — but not if verified by scraping
    const isTruncated = typeof pinCount === 'number' && pinCount >= 1000 && pinCount % 100 === 0 && !b.pinCountVerified;
    if (isTruncated) truncatedCount++;

    const countDisplay = isTruncated
      ? `<span title="Approximate — use Scrape Counts for exact number" style="color:#e65100">~${pinCount}</span>`
      : pinCount;

    // Completeness indicator
    let completionBadge = '';
    if (b.completionPct != null) {
      const pct = Math.round(b.completionPct * 100);
      const cls = pct >= 99 ? 'complete' : pct >= 90 ? 'partial' : 'low';
      completionBadge = ` <span class="completion-badge ${cls}" title="${b.capturedTotal || 0} captured">${pct}%</span>`;
    }

    return `
      <div class="board-card" data-board="${esc(name)}">
        <label class="board-card-inner">
          <input type="checkbox" class="board-checkbox" ${checked ? 'checked' : ''}>
          ${b.coverImage ? `<img src="${esc(b.coverImage)}" class="board-cover" alt="">` : '<div class="board-cover-placeholder"></div>'}
          <div class="board-card-info">
            <div class="board-card-name">${esc(name)}${completionBadge}</div>
            <div class="board-card-meta">${countDisplay} pins &middot; ${lastFetched}</div>
          </div>
        </label>
      </div>
    `;
  }).join('');

  // Alert if boards have truncated counts
  if (truncatedCount > 0) {
    showStatus(
      `${truncatedCount} board${truncatedCount > 1 ? 's have' : ' has'} approximate pin counts (~Xk). Use "Scrape Counts" for exact numbers.`,
      'warning'
    );
  }

  // Attach board checkbox listeners
  grid.querySelectorAll('.board-card').forEach(card => {
    const name = card.dataset.board;
    card.querySelector('.board-checkbox').addEventListener('change', e => {
      boardSelections[name] = e.target.checked;
    });
  });
}

function getVisiblePins() {
  if (!currentProfile) return [];
  return Object.values(archive.pins).filter(p => p.profile === currentProfile);
}

function renderPins() {
  let pins = getVisiblePins();
  if (pins.length === 0) {
    el('pinControls').style.display = 'none';
    el('pinsList').innerHTML = '<div class="empty-state"><h3>No Pins</h3><p>Load a profile and select boards to fetch pins.</p></div>';
    return;
  }

  el('pinControls').style.display = '';

  // Search filter
  const search = el('searchInput').value.toLowerCase();
  if (search) {
    pins = pins.filter(p =>
      (p.title?.toLowerCase().includes(search)) ||
      (p.description?.toLowerCase().includes(search)) ||
      (p.board?.toLowerCase().includes(search))
    );
  }

  // Category filter
  const filter = el('filterSelect').value;
  if (filter === 'new') pins = pins.filter(p => newPinIds.has(p.id));
  else if (filter === 'downloaded') pins = pins.filter(p => p.downloaded);
  else if (filter === 'not-downloaded') pins = pins.filter(p => !p.downloaded);
  else if (filter === 'failed') pins = pins.filter(p => p.downloadError && !p.terminalFailure);
  else if (filter === 'selected') pins = pins.filter(p => p.selected);

  // Group by board
  const groups = {};
  for (const pin of pins) {
    const board = pin.board || 'Uncategorized';
    if (!groups[board]) groups[board] = [];
    groups[board].push(pin);
  }

  const html = Object.entries(groups).map(([boardName, boardPins]) => {
    const downloaded = boardPins.filter(p => p.downloaded).length;
    const selected = boardPins.filter(p => p.selected).length;
    const newCount = boardPins.filter(p => newPinIds.has(p.id)).length;

    const allSelected = boardPins.length > 0 && boardPins.every(p => p.selected);
    const noneSelected = boardPins.every(p => !p.selected);

    return `
      <div class="board-group" data-board-group="${esc(boardName)}">
        <div class="board-header" data-collapsed="true">
          <div class="board-header-left">
            <span class="board-chevron">▶</span>
            <h3 class="board-title">${esc(boardName)}</h3>
          </div>
          <div class="board-stats">
            ${boardPins.length} pins · ${selected} selected · ${downloaded} downloaded${newCount ? ` · <span class="new-badge">${newCount} new</span>` : ''}
            <button class="btn btn-sm btn-secondary board-select-all-btn" data-board="${esc(boardName)}" ${allSelected ? 'disabled' : ''}>${allSelected ? 'All Selected' : 'Select All'}</button>
            <button class="btn btn-sm btn-secondary board-deselect-all-btn" data-board="${esc(boardName)}" ${noneSelected ? 'disabled' : ''}>${noneSelected ? 'None Selected' : 'Deselect All'}</button>
          </div>
        </div>
        <div class="board-pins-list" style="display:none">
          ${boardPins.map(pin => pinHTML(pin)).join('')}
        </div>
      </div>
    `;
  }).join('');

  el('pinsList').innerHTML = html;
  attachPinListeners();
  updateStats();
}

function pinHTML(pin) {
  const isNew = newPinIds.has(pin.id);
  const dlClass = pin.downloaded ? 'downloaded' : '';
  const newDot = isNew ? '<span class="new-dot" title="New since last fetch"></span>' : '';
  const statusText = pin.downloaded ? 'Downloaded' : 'Pending';
  const statusClass = pin.downloaded ? 'completed' : 'pending';

  return `
    <div class="pin-item ${dlClass}" data-pin-id="${pin.id}">
      <input type="checkbox" class="pin-checkbox" ${pin.selected ? 'checked' : ''}>
      ${newDot}
      <img src="${esc(pin.thumbnail || pin.image || '')}" alt="${esc(pin.title || '')}" class="pin-thumbnail">
      <div class="pin-info">
        <div class="pin-title">${esc(pin.title || 'Untitled Pin')}</div>
        <div class="pin-meta">${esc(pin.board || '')} · ${pin.id}</div>
      </div>
      <div class="pin-status">
        <span class="status-badge ${statusClass}">${statusText}</span>
        <button class="view-btn btn btn-sm btn-secondary" data-url="${esc(pin.url || '')}">View</button>
      </div>
    </div>
  `;
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3C/svg%3E';

// Event delegation — registered once, handles all pin list interactions
function initPinListDelegation() {
  el('pinsList').addEventListener('click', e => {
    // Board header collapse/expand
    const header = e.target.closest('.board-header');
    if (header && !e.target.closest('.board-select-all-btn') && !e.target.closest('.board-deselect-all-btn')) {
      const collapsed = header.dataset.collapsed === 'true';
      header.dataset.collapsed = collapsed ? 'false' : 'true';
      header.nextElementSibling.style.display = collapsed ? '' : 'none';
      header.querySelector('.board-chevron').textContent = collapsed ? '▼' : '▶';
      return;
    }

    // Per-board Select All / Deselect All
    const selectAllBtn = e.target.closest('.board-select-all-btn');
    const deselectAllBtn = e.target.closest('.board-deselect-all-btn');
    if (selectAllBtn || deselectAllBtn) {
      e.stopPropagation();
      const group = e.target.closest('.board-group');
      const value = !!selectAllBtn;
      group.querySelectorAll('.pin-item').forEach(item => {
        const pinId = item.dataset.pinId;
        if (archive.pins[pinId]) archive.pins[pinId].selected = value;
        item.querySelector('.pin-checkbox').checked = value;
      });
      updateBoardButtons(group);
      triggerAutosave();
      updateStats();
      return;
    }

    // View button
    const viewBtn = e.target.closest('.view-btn');
    if (viewBtn) {
      const url = viewBtn.dataset.url;
      if (url) chrome.tabs.create({ url });
      return;
    }
  });

  el('pinsList').addEventListener('change', e => {
    // Pin checkbox
    if (e.target.classList.contains('pin-checkbox')) {
      const pinItem = e.target.closest('.pin-item');
      const pinId = pinItem?.dataset.pinId;
      if (pinId && archive.pins[pinId]) {
        archive.pins[pinId].selected = e.target.checked;
        triggerAutosave();
        updateStats();
        const group = pinItem.closest('.board-group');
        if (group) updateBoardButtons(group);
      }
    }
  });
}

function updateBoardButtons(group) {
  const checkboxes = [...group.querySelectorAll('.pin-checkbox')];
  const allChecked = checkboxes.length > 0 && checkboxes.every(c => c.checked);
  const noneChecked = checkboxes.every(c => !c.checked);
  const selBtn = group.querySelector('.board-select-all-btn');
  const deselBtn = group.querySelector('.board-deselect-all-btn');
  selBtn.disabled = allChecked;
  selBtn.textContent = allChecked ? 'All Selected' : 'Select All';
  deselBtn.disabled = noneChecked;
  deselBtn.textContent = noneChecked ? 'None Selected' : 'Deselect All';
}

function attachPinListeners() {
  // Thumbnail error fallback — must be per-element (error events don't bubble)
  el('pinsList').querySelectorAll('.pin-thumbnail').forEach(img => {
    img.addEventListener('error', () => { img.src = PLACEHOLDER_SVG; }, { once: true });
  });
}

function updateStats() {
  const pins = getVisiblePins();
  el('totalPins').textContent = pins.length;
  el('selectedPins').textContent = pins.filter(p => p.selected).length;
  el('downloadedPins').textContent = pins.filter(p => p.downloaded).length;
  el('newPins').textContent = newPinIds.size;
}

function updateDownloadProgress() {
  const done = downloadState.completed + downloadState.failed;
  const pct = downloadState.total > 0 ? (done / downloadState.total * 100) : 0;
  el('progressText').textContent = `Batch ${downloadState.currentBatch}/${downloadState.totalBatches}`;
  el('progressCount').textContent = `${done}/${downloadState.total}`;
  el('progressFill').style.width = `${pct}%`;
}

function checkForResume() {
  if (archive.downloads && (archive.downloads.completed + archive.downloads.failed) < archive.downloads.total) {
    const remaining = archive.downloads.total - archive.downloads.completed - archive.downloads.failed;
    el('resumeBanner').style.display = '';
    el('resumeText').textContent = `Interrupted download: ${remaining} of ${archive.downloads.total} remaining`;
  } else {
    el('resumeBanner').style.display = 'none';
  }
}

// ── Board selection helpers ───────────────────────────────

function setBoardSelections(value) {
  for (const name of Object.keys(boardSelections)) boardSelections[name] = value;
  el('boardGrid').querySelectorAll('.board-checkbox').forEach(cb => { cb.checked = value; });
}

function selectIncompleteBoards() {
  const profile = archive.profiles[currentProfile];
  if (!profile) return;
  for (const name of Object.keys(boardSelections)) {
    const b = profile.boards[name];
    boardSelections[name] = !b?.completionPct || b.completionPct < 0.99;
  }
  el('boardGrid').querySelectorAll('.board-card').forEach(card => {
    const name = card.dataset.board;
    card.querySelector('.board-checkbox').checked = boardSelections[name];
  });
  const count = Object.values(boardSelections).filter(v => v).length;
  showStatus(`Selected ${count} incomplete boards`, 'info');
}

function setAllPinSelections(value) {
  for (const pin of getVisiblePins()) pin.selected = value;
  triggerAutosave();
  renderPins();
}

function resetDownloads() {
  const pins = getVisiblePins();
  let count = 0;
  for (const pin of pins) {
    if (pin.downloaded) {
      pin.downloaded = false;
      pin.downloadPath = null;
      pin.downloadedAt = null;
      count++;
    }
  }
  if (count === 0) { showStatus('No downloaded pins to reset', 'info'); return; }
  saveState();
  renderPins();
  showStatus(`Reset ${count} pins to un-downloaded`, 'success');
}

// ── Persistence ───────────────────────────────────────────

async function loadState() {
  return new Promise(resolve => {
    chrome.storage.local.get(['archive', 'pinsData', 'downloadSettings', 'currentProfile'], result => {
      if (result.archive) {
        archive = result.archive;
      } else if (result.pinsData) {
        // Migrate v1 → v2
        archive = migrateV1(result.pinsData);
      }
      if (result.downloadSettings) {
        downloadSettings = result.downloadSettings;
      }
      if (result.currentProfile) {
        currentProfile = result.currentProfile;
      }
      // Retroactive cleanup: mark pins with no image as terminal failures
      // (stale entries from before unavailable pin detection was added)
      let cleaned = 0;
      for (const pin of Object.values(archive.pins)) {
        if (!pin.image && !pin.thumbnail && !pin.terminalFailure) {
          pin.terminalFailure = true;
          pin.downloadError = pin.downloadError || 'No image URL (unavailable pin)';
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`[Pinterest Pin DL] Marked ${cleaned} imageless pins as terminal failures`);
      resolve();
    });
  });
}

function migrateV1(v1) {
  const a = emptyArchive();
  const username = v1.username || 'unknown';
  a.profiles[username] = { lastFetched: v1.lastFetch, boards: {} };

  // Build boards from v1.boards
  if (v1.boards) {
    for (const [name, pinIds] of Object.entries(v1.boards)) {
      a.profiles[username].boards[name] = {
        url: `/${username}/${name.replace(/\s+/g, '-').toLowerCase()}/`,
        coverImage: null,
        pinCount: pinIds.length,
        lastFetched: v1.lastFetch,
        pins: pinIds,
      };
    }
  }

  // Migrate pins
  if (v1.pins) {
    for (const pin of v1.pins) {
      a.pins[pin.id] = {
        id: pin.id,
        title: pin.title || 'Untitled Pin',
        description: pin.description || '',
        image: pin.image,
        thumbnail: pin.thumbnail,
        url: pin.url,
        board: pin.board || 'Uncategorized',
        profile: username,
        firstSeen: v1.lastFetch || new Date().toISOString(),
        lastSeen: v1.lastFetch || new Date().toISOString(),
        downloaded: pin.downloaded || false,
        downloadPath: pin.downloadPath || null,
        downloadedAt: null,
        selected: pin.selected || false,
      };
    }
  }

  return a;
}

function saveState() {
  chrome.storage.local.set({
    archive,
    downloadSettings,
    currentProfile,
  });
}

let autosaveTimer = null;
function triggerAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveState, 1000);
}

// ── Export / Import ───────────────────────────────────────

function exportArchive() {
  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  chrome.downloads.download({ url, filename: `pinterest_archive_${ts}.json`, saveAs: true });
  showStatus('Export started', 'success');
}

function importArchive(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.version === ARCHIVE_VERSION) {
        archive = data;
      } else if (data.pins && Array.isArray(data.pins)) {
        archive = migrateV1(data);
      } else {
        showStatus('Unrecognized archive format', 'error');
        return;
      }
      saveState();
      renderAll();
      showStatus('Imported successfully', 'success');
    } catch (err) {
      showStatus(`Import error: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ── Settings ──────────────────────────────────────────────

function applySettings() {
  el('minDelay').value = downloadSettings.minDelay;
  el('maxDelay').value = downloadSettings.maxDelay;
  el('batchSize').value = downloadSettings.batchSize;
  el('batchDelay').value = downloadSettings.batchDelay;
  el('maxRetries').value = downloadSettings.maxRetries;
  el('exponentialBackoff').checked = downloadSettings.exponentialBackoff;
  el('folderPrefix').value = downloadSettings.folderPrefix || 'pinterest';
}

function updateSettings() {
  downloadSettings.minDelay = parseInt(el('minDelay').value) || 2000;
  downloadSettings.maxDelay = parseInt(el('maxDelay').value) || 5000;
  downloadSettings.batchSize = parseInt(el('batchSize').value) || 5;
  downloadSettings.batchDelay = parseInt(el('batchDelay').value) || 10000;
  downloadSettings.maxRetries = parseInt(el('maxRetries').value) || 3;
  downloadSettings.exponentialBackoff = el('exponentialBackoff').checked;
  downloadSettings.folderPrefix = el('folderPrefix').value.trim().replace(/^\/+|\/+$/g, '') || 'pinterest';
  if (downloadSettings.minDelay > downloadSettings.maxDelay) {
    downloadSettings.maxDelay = downloadSettings.minDelay;
    el('maxDelay').value = downloadSettings.maxDelay;
  }
  saveState();
}

// ── Utilities ─────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function esc(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function showStatus(msg, type = 'info') {
  const bar = el('statusBar');
  bar.textContent = msg;
  bar.className = `status-message ${type}`;
  if (type === 'success' || type === 'error') {
    setTimeout(() => { bar.className = 'status-message'; }, 5000);
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay() {
  return Math.floor(Math.random() * (downloadSettings.maxDelay - downloadSettings.minDelay + 1)) + downloadSettings.minDelay;
}

// ── Diagnose ──────────────────────────────────────────────

async function runDiagnose() {
  const username = el('usernameInput').value.trim();
  if (!username) { showStatus('Enter a username first', 'error'); return; }

  showStatus('Running diagnostics...', 'info');
  try {
    const tab = await getTab();
    const result = await navigateAndExtract(tab.id, `https://www.pinterest.com/${username}/`, 'diagnose');
    if (result.success) {
      console.log('Pinterest page diagnostic:', JSON.stringify(result.diagnostic, null, 2));
      const d = result.diagnostic;
      showStatus(
        `Diagnostic: ${d.totalLinks} links, data-test-ids: [${d.dataTestIds.join(', ')}], board-pattern links: ${d.boardPatternLinks.length}, PWS: ${d.hasPWSData}, resource_response: ${d.hasResourceResponse}. Check console for full output.`,
        'info'
      );
    } else {
      showStatus(`Diagnostic failed: ${result.error}`, 'error');
    }
  } catch (err) {
    showStatus(`Diagnostic error: ${err.message}`, 'error');
  }
}

function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
