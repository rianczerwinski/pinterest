// ── Archive state ─────────────────────────────────────────
// v2 archive: pins keyed by ID, boards under profiles, download checkpoints.

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
    initEventListeners();
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
  el('deselectAllBoardsBtn').addEventListener('click', () => setBoardSelections(false));
  el('loadSelectedBoardsBtn').addEventListener('click', loadSelectedBoards);

  // Diff
  el('selectNewPinsBtn').addEventListener('click', selectNewPins);
  el('dismissDiffBtn').addEventListener('click', () => { el('diffSection').style.display = 'none'; });

  // Pins
  el('selectAllPinsBtn').addEventListener('click', () => setAllPinSelections(true));
  el('deselectAllPinsBtn').addEventListener('click', () => setAllPinSelections(false));
  el('downloadSelectedBtn').addEventListener('click', downloadSelected);
  el('searchInput').addEventListener('input', debounce(renderPins, 300));
  el('filterSelect').addEventListener('change', renderPins);

  // Resume
  el('resumeBtn').addEventListener('click', resumeDownload);
  el('clearResumeBtn').addEventListener('click', clearResume);

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

async function findPinterestTabs() {
  return chrome.tabs.query({ url: ['https://*.pinterest.com/*', 'https://pinterest.com/*'] });
}

async function refreshTabStatus() {
  const tabs = await findPinterestTabs();
  const dot = el('tabStatusDot');
  const text = el('tabStatusText');
  const openBtn = el('openPinterestBtn');

  if (tabs.length === 0) {
    dot.className = 'status-dot red';
    text.textContent = 'No Pinterest tab';
    openBtn.style.display = '';
    selectedPinterestTab = null;
  } else {
    selectedPinterestTab = tabs[0];
    dot.className = 'status-dot green';
    text.textContent = `Connected: ${tabs[0].title?.substring(0, 40) || tabs[0].url}`;
    openBtn.style.display = 'none';
  }
}

function openPinterest() {
  chrome.tabs.create({ url: 'https://www.pinterest.com', active: false }, () => {
    setTimeout(refreshTabStatus, 2000);
  });
}

async function getTab() {
  if (selectedPinterestTab) {
    try {
      const tab = await chrome.tabs.get(selectedPinterestTab.id);
      if (tab?.url?.includes('pinterest.com')) return tab;
    } catch { /* tab closed */ }
  }
  await refreshTabStatus();
  if (!selectedPinterestTab) throw new Error('No Pinterest tab. Open Pinterest first.');
  return selectedPinterestTab;
}

// ── Navigation + extraction ───────────────────────────────

async function navigateAndExtract(tabId, url, mode, options = {}) {
  await chrome.tabs.update(tabId, { url });
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

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for Pinterest's client-side rendering
        setTimeout(resolve, 2000);
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
  showStatus('Loading boards...', 'info');
  el('loadProfileBtn').disabled = true;

  try {
    const tab = await getTab();
    const result = await navigateAndExtract(tab.id, `https://www.pinterest.com/${username}/`, 'boards');

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

  const previousPinIds = new Set(Object.keys(archive.pins).filter(id => archive.pins[id].profile === username));
  let totalNew = 0;
  let totalPins = 0;

  try {
    const tab = await getTab();

    for (let i = 0; i < selectedBoards.length; i++) {
      const boardName = selectedBoards[i];
      const boardMeta = profile.boards[boardName];
      if (!boardMeta?.url) continue;

      showStatus(`Loading board ${i + 1}/${selectedBoards.length}: ${boardName}...`, 'info');

      const result = await navigateAndExtract(
        tab.id,
        `https://www.pinterest.com${boardMeta.url}`,
        'pins'
      );

      if (!result.success || !result.pins?.length) continue;

      const boardPinIds = [];
      for (const pin of result.pins) {
        boardPinIds.push(pin.id);
        totalPins++;

        const existing = archive.pins[pin.id];
        if (existing) {
          // Update lastSeen, preserve download state
          existing.lastSeen = new Date().toISOString();
          existing.title = pin.title || existing.title;
          existing.image = pin.image || existing.image;
          existing.thumbnail = pin.thumbnail || existing.thumbnail;
        } else {
          // New pin
          archive.pins[pin.id] = {
            ...pin,
            board: boardName,
            profile: username,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            downloaded: false,
            downloadPath: null,
            downloadedAt: null,
            selected: false,
          };
          totalNew++;
        }
      }

      boardMeta.pins = boardPinIds;
      boardMeta.lastFetched = new Date().toISOString();
    }

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

    renderPins();
    showStatus(`Loaded ${totalPins} pins (${totalNew} new) from ${selectedBoards.length} boards`, 'success');
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }

  el('loadSelectedBoardsBtn').disabled = false;
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
  if (!archive.downloads?.checkpoint) return;
  const cp = archive.downloads.checkpoint;
  const pins = Object.values(archive.pins)
    .filter(p => p.profile === currentProfile && p.selected && !p.downloaded);
  if (pins.length === 0) { showStatus('Nothing to resume', 'info'); clearResume(); return; }
  await runDownload(pins);
}

function clearResume() {
  if (archive.downloads) {
    archive.downloads.checkpoint = null;
  }
  el('resumeBanner').style.display = 'none';
  saveState();
}

async function runDownload(pins) {
  if (downloadState.isDownloading) { showStatus('Download in progress', 'error'); return; }

  downloadState.isDownloading = true;
  downloadState.completed = 0;
  downloadState.failed = 0;
  downloadState.total = pins.length;
  downloadState.totalBatches = Math.ceil(pins.length / downloadSettings.batchSize);
  downloadState.currentBatch = 0;

  el('downloadProgress').style.display = '';
  el('downloadSelectedBtn').disabled = true;

  archive.downloads = {
    lastRun: new Date().toISOString(),
    checkpoint: null,
    completed: 0,
    failed: 0,
    total: pins.length,
  };

  showStatus(`Downloading ${pins.length} pins...`, 'info');

  for (let i = 0; i < pins.length; i += downloadSettings.batchSize) {
    const batch = pins.slice(i, i + downloadSettings.batchSize);
    downloadState.currentBatch++;

    // Save checkpoint before each batch
    archive.downloads.checkpoint = { pinIndex: i };
    saveState();

    for (const pin of batch) {
      const ok = await downloadPinWithRetry(pin);
      if (ok) {
        downloadState.completed++;
        archive.downloads.completed++;
        pin.downloaded = true;
        pin.downloadedAt = new Date().toISOString();
      } else {
        downloadState.failed++;
        archive.downloads.failed++;
      }
      updateDownloadProgress();
      await sleep(randomDelay());
    }

    // Batch delay
    if (i + downloadSettings.batchSize < pins.length) {
      showStatus(`Batch ${downloadState.currentBatch}/${downloadState.totalBatches} done. Pausing...`, 'info');
      await sleep(downloadSettings.batchDelay);
    }
  }

  // Done
  downloadState.isDownloading = false;
  archive.downloads.checkpoint = null;
  el('downloadSelectedBtn').disabled = false;
  saveState();
  renderPins();

  const msg = `Done: ${downloadState.completed} downloaded, ${downloadState.failed} failed`;
  showStatus(msg, downloadState.failed > 0 ? 'warning' : 'success');

  setTimeout(() => { el('downloadProgress').style.display = 'none'; }, 5000);
}

async function downloadPinWithRetry(pin, attempt = 0) {
  try {
    return await downloadPin(pin);
  } catch (err) {
    if (attempt < downloadSettings.maxRetries) {
      const delay = downloadSettings.exponentialBackoff
        ? Math.min(downloadSettings.maxDelay * Math.pow(2, attempt), 30000)
        : downloadSettings.maxDelay;
      await sleep(delay);
      return downloadPinWithRetry(pin, attempt + 1);
    }
    console.warn(`Download failed for pin ${pin.id}:`, err);
    return false;
  }
}

function downloadPin(pin) {
  return new Promise((resolve, reject) => {
    const imageUrl = pin.image || pin.thumbnail;
    if (!imageUrl) { resolve(false); return; }

    const boardSlug = (pin.board || 'uncategorized').replace(/[^a-z0-9]/gi, '_');
    const titleSlug = (pin.title || pin.id).replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const filename = `pinterest/${pin.profile || 'unknown'}/${boardSlug}/${titleSlug}_${pin.id}.jpg`;

    chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: imageUrl,
      filename,
      pinId: pin.id,
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        pin.downloadPath = response.path;
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// ── Rendering ─────────────────────────────────────────────

function renderAll() {
  if (currentProfile && archive.profiles[currentProfile]) {
    el('usernameInput').value = currentProfile;
    renderBoards();
    renderPins();
    checkForResume();
  }
  applySettings();
  updateStats();
}

function renderBoards() {
  const profile = archive.profiles[currentProfile];
  if (!profile) return;

  const boardNames = Object.keys(profile.boards);
  el('boardSection').style.display = boardNames.length ? '' : 'none';
  el('boardCount').textContent = boardNames.length;

  const grid = el('boardGrid');
  grid.innerHTML = boardNames.map(name => {
    const b = profile.boards[name];
    const checked = boardSelections[name] !== false;
    const lastFetched = b.lastFetched ? timeAgo(new Date(b.lastFetched).getTime()) : 'never';
    const pinCount = b.pinCount ?? b.pins?.length ?? '?';

    return `
      <div class="board-card" data-board="${esc(name)}">
        <label class="board-card-inner">
          <input type="checkbox" class="board-checkbox" ${checked ? 'checked' : ''}>
          ${b.coverImage ? `<img src="${esc(b.coverImage)}" class="board-cover" alt="">` : '<div class="board-cover-placeholder"></div>'}
          <div class="board-card-info">
            <div class="board-card-name">${esc(name)}</div>
            <div class="board-card-meta">${pinCount} pins &middot; ${lastFetched}</div>
          </div>
        </label>
      </div>
    `;
  }).join('');

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

    return `
      <div class="board-group">
        <div class="board-header">
          <h3 class="board-title">${esc(boardName)}</h3>
          <div class="board-stats">
            ${boardPins.length} pins · ${selected} selected · ${downloaded} downloaded${newCount ? ` · <span class="new-badge">${newCount} new</span>` : ''}
          </div>
        </div>
        ${boardPins.map(pin => pinHTML(pin)).join('')}
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
      <img src="${esc(pin.thumbnail || pin.image || '')}" alt="${esc(pin.title || '')}" class="pin-thumbnail"
        onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3C/svg%3E'">
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

function attachPinListeners() {
  el('pinsList').querySelectorAll('.pin-checkbox').forEach(cb => {
    cb.addEventListener('change', e => {
      const pinId = e.target.closest('.pin-item').dataset.pinId;
      if (archive.pins[pinId]) {
        archive.pins[pinId].selected = e.target.checked;
        triggerAutosave();
        updateStats();
      }
    });
  });

  el('pinsList').querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const url = e.target.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
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
  if (archive.downloads?.checkpoint) {
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

function setAllPinSelections(value) {
  for (const pin of getVisiblePins()) pin.selected = value;
  triggerAutosave();
  renderPins();
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
}

function updateSettings() {
  downloadSettings.minDelay = parseInt(el('minDelay').value) || 2000;
  downloadSettings.maxDelay = parseInt(el('maxDelay').value) || 5000;
  downloadSettings.batchSize = parseInt(el('batchSize').value) || 5;
  downloadSettings.batchDelay = parseInt(el('batchDelay').value) || 10000;
  downloadSettings.maxRetries = parseInt(el('maxRetries').value) || 3;
  downloadSettings.exponentialBackoff = el('exponentialBackoff').checked;
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

function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
