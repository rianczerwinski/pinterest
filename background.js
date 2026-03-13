// Background service worker for handling downloads

// Listen for extension icon clicks - open in new tab
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('popup.html')
  });
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    downloadImage(message.url, message.filename, message.pinId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Relay overlay control messages from content script → popup tab
  if (message.action?.startsWith('overlay-')) {
    // Find the popup tab (it's our own extension page)
    chrome.tabs.query({}, tabs => {
      const popupTab = tabs.find(t => t.url?.includes(chrome.runtime.id));
      if (popupTab) {
        chrome.tabs.sendMessage(popupTab.id, message);
      }
    });
    sendResponse({ success: true });
    return false;
  }
});

// Download image — pass URL directly to chrome.downloads (no fetch/base64 needed)
async function downloadImage(url, filename, pinId) {
  const result = await tryDownload(url, filename, pinId);
  if (result.success) return result;

  // Fallback: /originals/ → /736x/
  if (url.includes('/originals/')) {
    const fallback = url.replace('/originals/', '/736x/');
    console.log(`[Pinterest Pin DL] /originals/ failed, trying /736x/: ${fallback}`);
    return await tryDownload(fallback, filename, pinId);
  }

  return result;
}

function tryDownload(url, filename, pinId) {
  return new Promise(resolve => {
    let settled = false;
    const settle = (result) => { if (!settled) { settled = true; resolve(result); } };

    // Timeout — don't hang forever
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      settle({ success: false, error: 'Download timed out after 60s' });
    }, 60000);

    const listener = delta => {
      if (delta.id === undefined) return; // guard for pre-download events
      if (!pendingDownloadId || delta.id !== pendingDownloadId || !delta.state) return;
      chrome.downloads.onChanged.removeListener(listener);
      clearTimeout(timeout);

      if (delta.state.current === 'complete') {
        chrome.downloads.search({ id: pendingDownloadId }, results => {
          settle({ success: true, downloadId: pendingDownloadId, path: results?.[0]?.filename || filename, pinId });
        });
      } else if (delta.state.current === 'interrupted') {
        settle({ success: false, error: `Download interrupted: ${delta.error?.current || 'unknown'}` });
      }
    };

    // Register listener BEFORE starting download to avoid race condition
    chrome.downloads.onChanged.addListener(listener);
    let pendingDownloadId = null;

    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    }, downloadId => {
      if (chrome.runtime.lastError) {
        chrome.downloads.onChanged.removeListener(listener);
        clearTimeout(timeout);
        settle({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      pendingDownloadId = downloadId;

      // Check if already completed (fast downloads beat the listener)
      chrome.downloads.search({ id: downloadId }, results => {
        const state = results?.[0]?.state;
        if (state === 'complete') {
          chrome.downloads.onChanged.removeListener(listener);
          clearTimeout(timeout);
          settle({ success: true, downloadId, path: results[0].filename || filename, pinId });
        } else if (state === 'interrupted') {
          chrome.downloads.onChanged.removeListener(listener);
          clearTimeout(timeout);
          settle({ success: false, error: `Download interrupted: ${results[0].error || 'unknown'}` });
        }
        // else still in_progress — listener will handle it
      });
    });
  });
}

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pinterest Pin Downloader installed');
});
