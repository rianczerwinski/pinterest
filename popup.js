// State management
let pinsData = {
  pins: [],
  boards: {},
  lastFetch: null,
  username: ''
};

let currentGrouping = 'all';
let autosaveEnabled = true;
let autosaveTimeout = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initializeEventListeners();
  renderPins();
  updateStats();
});

// Event listeners
function initializeEventListeners() {
  // Fetch buttons
  document.getElementById('fetchAllBtn').addEventListener('click', fetchAllPins);
  document.getElementById('fetchByBoardBtn').addEventListener('click', fetchByBoards);

  // Grouping options
  document.querySelectorAll('input[name="grouping"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      currentGrouping = e.target.value;
      renderPins();
    });
  });

  // Save/Export/Import buttons
  document.getElementById('manualSaveBtn').addEventListener('click', manualSave);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importData);

  // Download controls
  document.getElementById('downloadSelectedBtn').addEventListener('click', downloadSelected);
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);
  document.getElementById('deselectAllBtn').addEventListener('click', deselectAll);

  // Search
  document.getElementById('searchInput').addEventListener('input', debounce(handleSearch, 300));
}

// Fetch all pins from Pinterest
async function fetchAllPins() {
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) {
    showStatus('Please enter a Pinterest username', 'error');
    return;
  }

  showStatus('Fetching pins... This may take a while', 'info');
  document.getElementById('fetchAllBtn').disabled = true;

  try {
    // Send message to content script to fetch pins
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('pinterest.com')) {
      showStatus('Please navigate to Pinterest.com first', 'error');
      document.getElementById('fetchAllBtn').disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: 'fetchPins',
      username: username,
      mode: 'all'
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        document.getElementById('fetchAllBtn').disabled = false;
        return;
      }

      if (response && response.success) {
        processFetchedPins(response.pins, username);
        showStatus(`Successfully fetched ${response.pins.length} pins!`, 'success');
      } else {
        showStatus('Failed to fetch pins. Try again.', 'error');
      }
      document.getElementById('fetchAllBtn').disabled = false;
    });
  } catch (error) {
    showStatus('Error: ' + error.message, 'error');
    document.getElementById('fetchAllBtn').disabled = false;
  }
}

// Fetch pins by boards
async function fetchByBoards() {
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) {
    showStatus('Please enter a Pinterest username', 'error');
    return;
  }

  showStatus('Fetching pins by boards... This may take a while', 'info');
  document.getElementById('fetchByBoardBtn').disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('pinterest.com')) {
      showStatus('Please navigate to Pinterest.com first', 'error');
      document.getElementById('fetchByBoardBtn').disabled = false;
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: 'fetchPins',
      username: username,
      mode: 'boards'
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        document.getElementById('fetchByBoardBtn').disabled = false;
        return;
      }

      if (response && response.success) {
        processFetchedPins(response.pins, username, response.boards);
        showStatus(`Successfully fetched ${response.pins.length} pins from ${Object.keys(response.boards).length} boards!`, 'success');
      } else {
        showStatus('Failed to fetch pins. Try again.', 'error');
      }
      document.getElementById('fetchByBoardBtn').disabled = false;
    });
  } catch (error) {
    showStatus('Error: ' + error.message, 'error');
    document.getElementById('fetchByBoardBtn').disabled = false;
  }
}

// Process fetched pins
function processFetchedPins(pins, username, boards = {}) {
  pinsData.username = username;
  pinsData.lastFetch = new Date().toISOString();

  // Merge new pins with existing, preserving download status
  const existingPinsMap = new Map(pinsData.pins.map(p => [p.id, p]));

  pins.forEach(pin => {
    const existing = existingPinsMap.get(pin.id);
    if (existing) {
      // Preserve download status
      pin.downloaded = existing.downloaded || false;
      pin.downloadPath = existing.downloadPath || null;
      pin.selected = existing.selected || false;
    } else {
      pin.downloaded = false;
      pin.downloadPath = null;
      pin.selected = false;
    }
  });

  pinsData.pins = pins;

  if (Object.keys(boards).length > 0) {
    pinsData.boards = boards;
  } else {
    // Group pins by board if not already grouped
    pinsData.boards = {};
    pins.forEach(pin => {
      const boardName = pin.board || 'Uncategorized';
      if (!pinsData.boards[boardName]) {
        pinsData.boards[boardName] = [];
      }
      pinsData.boards[boardName].push(pin.id);
    });
  }

  triggerAutosave();
  renderPins();
  updateStats();
}

// Render pins in the UI
function renderPins() {
  const pinsList = document.getElementById('pinsList');
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();

  let filteredPins = pinsData.pins;
  if (searchTerm) {
    filteredPins = pinsData.pins.filter(pin =>
      (pin.title && pin.title.toLowerCase().includes(searchTerm)) ||
      (pin.description && pin.description.toLowerCase().includes(searchTerm)) ||
      (pin.board && pin.board.toLowerCase().includes(searchTerm))
    );
  }

  if (filteredPins.length === 0) {
    pinsList.innerHTML = `
      <div class="empty-state">
        <h3>No Pins Found</h3>
        <p>Enter a Pinterest username and click "Fetch Pins" to get started.</p>
      </div>
    `;
    return;
  }

  if (currentGrouping === 'boards') {
    renderByBoards(filteredPins, pinsList);
  } else {
    renderAllPins(filteredPins, pinsList);
  }
}

// Render all pins in a single list
function renderAllPins(pins, container) {
  container.innerHTML = pins.map(pin => createPinHTML(pin)).join('');
  attachPinEventListeners();
}

// Render pins grouped by boards
function renderByBoards(pins, container) {
  const boardGroups = {};

  pins.forEach(pin => {
    const boardName = pin.board || 'Uncategorized';
    if (!boardGroups[boardName]) {
      boardGroups[boardName] = [];
    }
    boardGroups[boardName].push(pin);
  });

  const html = Object.entries(boardGroups).map(([boardName, boardPins]) => {
    const downloaded = boardPins.filter(p => p.downloaded).length;
    const selected = boardPins.filter(p => p.selected).length;

    return `
      <div class="board-group">
        <div class="board-header">
          <h3 class="board-title">${escapeHtml(boardName)}</h3>
          <div class="board-stats">
            ${boardPins.length} pins | ${selected} selected | ${downloaded} downloaded
          </div>
        </div>
        ${boardPins.map(pin => createPinHTML(pin)).join('')}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  attachPinEventListeners();
}

// Create HTML for a single pin
function createPinHTML(pin) {
  const statusClass = pin.downloaded ? 'completed' : 'pending';
  const statusText = pin.downloaded ? 'Downloaded' : 'Pending';
  const downloadedClass = pin.downloaded ? 'downloaded' : '';

  return `
    <div class="pin-item ${downloadedClass}" data-pin-id="${pin.id}">
      <input type="checkbox" class="pin-checkbox" ${pin.selected ? 'checked' : ''}>
      <img src="${pin.thumbnail || pin.image}" alt="${escapeHtml(pin.title || 'Pin')}" class="pin-thumbnail" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3Ctext fill=%22%23999%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22%3ENo Image%3C/text%3E%3C/svg%3E'">
      <div class="pin-info">
        <div class="pin-title">${escapeHtml(pin.title || 'Untitled Pin')}</div>
        <div class="pin-url">${escapeHtml(pin.url)}</div>
      </div>
      <div class="pin-status">
        <span class="status-badge ${statusClass}">${statusText}</span>
        <div class="pin-actions">
          <button class="view-btn" data-url="${pin.url}">View</button>
          ${pin.downloaded ? `<button class="redownload-btn">Re-download</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Attach event listeners to pin items
function attachPinEventListeners() {
  document.querySelectorAll('.pin-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const pinItem = e.target.closest('.pin-item');
      const pinId = pinItem.dataset.pinId;
      const pin = pinsData.pins.find(p => p.id === pinId);
      if (pin) {
        pin.selected = e.target.checked;
        triggerAutosave();
        updateStats();
      }
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const url = e.target.dataset.url;
      chrome.tabs.create({ url });
    });
  });

  document.querySelectorAll('.redownload-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const pinItem = e.target.closest('.pin-item');
      const pinId = pinItem.dataset.pinId;
      const pin = pinsData.pins.find(p => p.id === pinId);
      if (pin) {
        downloadPin(pin);
      }
    });
  });
}

// Download selected pins
async function downloadSelected() {
  const selectedPins = pinsData.pins.filter(p => p.selected && !p.downloaded);

  if (selectedPins.length === 0) {
    showStatus('No pins selected for download', 'error');
    return;
  }

  showStatus(`Starting download of ${selectedPins.length} pins...`, 'info');

  for (const pin of selectedPins) {
    await downloadPin(pin);
    // Small delay between downloads to avoid overwhelming the browser
    await sleep(500);
  }

  showStatus(`Download complete! ${selectedPins.length} pins downloaded.`, 'success');
  renderPins();
  updateStats();
}

// Download a single pin
async function downloadPin(pin) {
  return new Promise((resolve) => {
    const imageUrl = pin.image || pin.url;
    const filename = generateFilename(pin);

    chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: imageUrl,
      filename: filename,
      pinId: pin.id
    }, (response) => {
      if (response && response.success) {
        pin.downloaded = true;
        pin.downloadPath = response.path;
        triggerAutosave();
      }
      resolve();
    });
  });
}

// Generate filename for download
function generateFilename(pin) {
  const boardName = (pin.board || 'uncategorized').replace(/[^a-z0-9]/gi, '_');
  const pinTitle = (pin.title || pin.id).replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const timestamp = Date.now();
  return `pinterest/${boardName}/${pinTitle}_${timestamp}.jpg`;
}

// Select/Deselect all
function selectAll() {
  pinsData.pins.forEach(pin => pin.selected = true);
  triggerAutosave();
  renderPins();
  updateStats();
}

function deselectAll() {
  pinsData.pins.forEach(pin => pin.selected = false);
  triggerAutosave();
  renderPins();
  updateStats();
}

// Update statistics
function updateStats() {
  document.getElementById('totalPins').textContent = pinsData.pins.length;
  document.getElementById('selectedPins').textContent = pinsData.pins.filter(p => p.selected).length;
  document.getElementById('downloadedPins').textContent = pinsData.pins.filter(p => p.downloaded).length;
}

// Search functionality
function handleSearch() {
  renderPins();
}

// Storage functions
function loadState() {
  chrome.storage.local.get(['pinsData'], (result) => {
    if (result.pinsData) {
      pinsData = result.pinsData;
      if (pinsData.username) {
        document.getElementById('usernameInput').value = pinsData.username;
      }
      renderPins();
      updateStats();
    }
  });
}

function saveState() {
  chrome.storage.local.set({ pinsData }, () => {
    console.log('State saved');
  });
}

function triggerAutosave() {
  if (!autosaveEnabled) return;

  clearTimeout(autosaveTimeout);
  autosaveTimeout = setTimeout(() => {
    saveState();
    showAutosaveIndicator();
  }, 1000);
}

function showAutosaveIndicator() {
  const indicator = document.getElementById('autosaveStatus');
  indicator.textContent = 'Autosave: Saved ✓';
  setTimeout(() => {
    indicator.textContent = 'Autosave: Enabled';
  }, 2000);
}

function manualSave() {
  saveState();
  showStatus('Data saved successfully!', 'success');
}

// Export/Import
function exportData() {
  const dataStr = JSON.stringify(pinsData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `pinterest_pins_${timestamp}.json`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });

  showStatus('Export started!', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);

      if (confirm('This will replace your current data. Continue?')) {
        pinsData = imported;
        saveState();
        renderPins();
        updateStats();
        showStatus('Data imported successfully!', 'success');
      }
    } catch (error) {
      showStatus('Error importing data: Invalid JSON', 'error');
    }
  };
  reader.readAsText(file);

  // Reset file input
  event.target.value = '';
}

// Utility functions
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('fetchStatus');
  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusEl.className = 'status-message';
    }, 5000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadComplete') {
    const pin = pinsData.pins.find(p => p.id === message.pinId);
    if (pin) {
      pin.downloaded = true;
      pin.downloadPath = message.path;
      triggerAutosave();
      renderPins();
      updateStats();
    }
  }
});
