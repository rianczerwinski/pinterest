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
    // First, fetch the image to get the actual blob
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Determine file extension from blob type
    const extension = blob.type.split('/')[1] || 'jpg';
    const filenameWithExt = filename.replace(/\.(jpg|png|gif|webp)$/i, '') + '.' + extension;

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

        // Monitor download progress
        const listener = (delta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);

              // Get download info to get the final path
              chrome.downloads.search({ id: downloadId }, (results) => {
                if (results && results.length > 0) {
                  resolve({
                    success: true,
                    downloadId: downloadId,
                    path: results[0].filename,
                    pinId: pinId
                  });
                } else {
                  resolve({
                    success: true,
                    downloadId: downloadId,
                    path: filenameWithExt,
                    pinId: pinId
                  });
                }
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

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pinterest Pin Downloader installed');
});
