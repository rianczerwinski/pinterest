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
    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    }, downloadId => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      const listener = delta => {
        if (delta.id !== downloadId || !delta.state) return;
        chrome.downloads.onChanged.removeListener(listener);

        if (delta.state.current === 'complete') {
          chrome.downloads.search({ id: downloadId }, results => {
            resolve({ success: true, downloadId, path: results?.[0]?.filename || filename, pinId });
          });
        } else if (delta.state.current === 'interrupted') {
          resolve({ success: false, error: `Download interrupted: ${delta.error?.current || 'unknown'}` });
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
  });
}

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pinterest Pin Downloader installed');
});
