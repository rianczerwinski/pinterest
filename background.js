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
    const result = await fetchImageAsDataUrl(url);
    if (!result) {
      return { success: false, error: `Failed to fetch image: ${url}` };
    }

    const extension = result.type.split('/')[1] || 'jpg';
    const filenameWithExt = filename.replace(/\.(jpg|png|gif|webp)$/i, '') + '.' + extension;

    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: result.dataUrl,
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

/** Fetch image and convert to data URL (service workers don't have URL.createObjectURL) */
async function fetchImageAsDataUrl(url) {
  // Try the URL as-is first
  const result = await tryFetchAsDataUrl(url);
  if (result) return result;

  // If URL was upgraded to /originals/, fall back to /736x/
  if (url.includes('/originals/')) {
    const fallback = url.replace('/originals/', '/736x/');
    console.log(`[Pinterest Pin DL] /originals/ failed, trying /736x/: ${fallback}`);
    const fallbackResult = await tryFetchAsDataUrl(fallback);
    if (fallbackResult) return fallbackResult;
  }

  console.warn(`[Pinterest Pin DL] Failed to fetch image: ${url}`);
  return null;
}

async function tryFetchAsDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0) return null;
    const type = resp.headers.get('content-type') || 'image/jpeg';
    // Convert ArrayBuffer → base64 data URL
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataUrl = `data:${type};base64,${btoa(binary)}`;
    return { dataUrl, type };
  } catch (err) {
    console.log(`[Pinterest Pin DL] Fetch failed for ${url}:`, err.message);
    return null;
  }
}

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pinterest Pin Downloader installed');
});
