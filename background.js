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

// Download image function
async function downloadImage(url, filename, pinId) {
  try {
    const blob = await fetchImageBlob(url);
    if (!blob) {
      return { success: false, error: `Failed to fetch image: ${url}` };
    }

    const extension = blob.type.split('/')[1] || 'jpg';
    const filenameWithExt = filename.replace(/\.(jpg|png|gif|webp)$/i, '') + '.' + extension;
    const objectUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: objectUrl,
        filename: filenameWithExt,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const listener = (delta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);
              chrome.downloads.search({ id: downloadId }, (results) => {
                resolve({
                  success: true,
                  downloadId,
                  path: results?.[0]?.filename || filenameWithExt,
                  pinId,
                });
              });
            } else if (delta.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(listener);
              reject(new Error('Download interrupted'));
            }
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Fetch image blob with fallback: try /originals/ first, fall back to /736x/ */
async function fetchImageBlob(url) {
  // Try the URL as-is first
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const blob = await resp.blob();
      // Accept if it has any size — pinimg.com sometimes returns octet-stream instead of image/*
      if (blob.size > 0) return blob;
    }
  } catch (err) {
    console.log(`[Pinterest Pin DL] Fetch failed for ${url}:`, err.message);
  }

  // If URL was upgraded to /originals/, fall back to the thumbnail resolution
  if (url.includes('/originals/')) {
    const fallback = url.replace('/originals/', '/736x/');
    console.log(`[Pinterest Pin DL] /originals/ failed, trying /736x/: ${fallback}`);
    try {
      const resp = await fetch(fallback);
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 0) return blob;
      }
    } catch { /* give up */ }
  }

  console.warn(`[Pinterest Pin DL] Failed to fetch image: ${url}`);
  return null;
}

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pinterest Pin Downloader installed');
});
