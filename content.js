// Content script for interacting with Pinterest pages

console.log('Pinterest Pin Downloader content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPins') {
    fetchPinsFromPage(message.username, message.mode)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Fetch pins from the current Pinterest page
async function fetchPinsFromPage(username, mode) {
  try {
    console.log('Fetching pins for:', username, 'Mode:', mode);

    // Navigate to user's pins page if not already there
    const currentUrl = window.location.href;
    const targetUrl = `https://www.pinterest.com/${username}/pins/`;

    if (!currentUrl.includes(username)) {
      window.location.href = targetUrl;
      return {
        success: false,
        error: 'Navigating to user profile. Please click fetch again after the page loads.'
      };
    }

    // Wait for pins to load
    await waitForPins();

    // Extract pins from the page
    const pins = extractPinsFromDOM();

    if (mode === 'boards') {
      // Also fetch board information
      const boards = await extractBoardsInfo(username);
      return {
        success: true,
        pins: pins,
        boards: boards
      };
    } else {
      return {
        success: true,
        pins: pins
      };
    }
  } catch (error) {
    console.error('Error fetching pins:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Wait for pins to load on the page
function waitForPins(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkForPins = () => {
      // Look for Pinterest pin elements
      const pinElements = document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper, [class*="Pin"]');

      if (pinElements.length > 0) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for pins to load'));
      } else {
        setTimeout(checkForPins, 500);
      }
    };

    checkForPins();
  });
}

// Extract pins from the DOM
function extractPinsFromDOM() {
  const pins = [];
  const seenIds = new Set();

  // Try multiple selectors to find pin elements
  const selectors = [
    '[data-test-id="pin"]',
    '[data-test-id="pinWrapper"]',
    '.pinWrapper',
    '[class*="Pin"][class*="wrapper"]',
    'div[data-grid-item="true"]'
  ];

  let pinElements = [];
  for (const selector of selectors) {
    pinElements = document.querySelectorAll(selector);
    if (pinElements.length > 0) break;
  }

  console.log('Found pin elements:', pinElements.length);

  pinElements.forEach((element, index) => {
    try {
      const pin = extractPinData(element, index);
      if (pin && pin.id && !seenIds.has(pin.id)) {
        pins.push(pin);
        seenIds.add(pin.id);
      }
    } catch (error) {
      console.error('Error extracting pin:', error);
    }
  });

  // If no pins found using standard selectors, try alternative method
  if (pins.length === 0) {
    const alternativePins = extractPinsFromScripts();
    return alternativePins;
  }

  return pins;
}

// Extract pin data from a DOM element
function extractPinData(element, index) {
  // Try to find the link
  const link = element.querySelector('a[href*="/pin/"]');
  const href = link ? link.getAttribute('href') : null;

  // Extract pin ID from URL
  let pinId = null;
  if (href) {
    const match = href.match(/\/pin\/(\d+)/);
    pinId = match ? match[1] : `pin_${Date.now()}_${index}`;
  } else {
    pinId = `pin_${Date.now()}_${index}`;
  }

  // Try to find the image
  const img = element.querySelector('img');
  const imageUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;

  // Try to find title/description
  const title = element.querySelector('[data-test-id="pinTitle"]')?.textContent ||
    element.querySelector('h1')?.textContent ||
    element.querySelector('h2')?.textContent ||
    img?.getAttribute('alt') ||
    'Untitled Pin';

  // Try to find board name
  const boardLink = element.querySelector('a[href*="/board/"]');
  const boardName = boardLink ? extractBoardNameFromUrl(boardLink.getAttribute('href')) : null;

  // Get the full URL
  const fullUrl = href ? `https://www.pinterest.com${href}` : null;

  return {
    id: pinId,
    title: title.trim(),
    description: title.trim(),
    image: imageUrl,
    thumbnail: imageUrl,
    url: fullUrl || `https://www.pinterest.com/pin/${pinId}/`,
    board: boardName,
    selected: false,
    downloaded: false,
    downloadPath: null
  };
}

// Extract pins from page scripts (fallback method)
function extractPinsFromScripts() {
  const pins = [];
  const scripts = document.querySelectorAll('script');

  for (const script of scripts) {
    if (script.textContent.includes('"resource_response"') || script.textContent.includes('"data"')) {
      try {
        // Try to find JSON data in scripts
        const jsonMatch = script.textContent.match(/\{[\s\S]*"resource_response"[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          if (data.resource_response && data.resource_response.data) {
            const pinData = data.resource_response.data;
            if (Array.isArray(pinData)) {
              pinData.forEach(pin => {
                if (pin.id) {
                  pins.push(formatPinFromAPI(pin));
                }
              });
            }
          }
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }
  }

  return pins;
}

// Format pin data from Pinterest API response
function formatPinFromAPI(apiPin) {
  return {
    id: apiPin.id,
    title: apiPin.title || apiPin.grid_title || 'Untitled Pin',
    description: apiPin.description || apiPin.title || '',
    image: apiPin.images?.orig?.url || apiPin.images?.['736x']?.url || null,
    thumbnail: apiPin.images?.['236x']?.url || apiPin.images?.['136x136']?.url || null,
    url: `https://www.pinterest.com/pin/${apiPin.id}/`,
    board: apiPin.board?.name || null,
    selected: false,
    downloaded: false,
    downloadPath: null
  };
}

// Extract boards information
async function extractBoardsInfo(username) {
  const boards = {};

  // Try to navigate to boards page and extract board info
  // This is a simplified version - in practice, you'd need to navigate and scrape
  const currentPins = extractPinsFromDOM();

  currentPins.forEach(pin => {
    const boardName = pin.board || 'Uncategorized';
    if (!boards[boardName]) {
      boards[boardName] = [];
    }
    if (!boards[boardName].includes(pin.id)) {
      boards[boardName].push(pin.id);
    }
  });

  return boards;
}

// Extract board name from URL
function extractBoardNameFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/([^\/]+)\/$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Utility function to scroll and load more pins
async function scrollAndLoadMore(maxScrolls = 10) {
  let scrollCount = 0;
  let lastHeight = document.body.scrollHeight;

  while (scrollCount < maxScrolls) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      break; // No more content to load
    }

    lastHeight = newHeight;
    scrollCount++;
  }
}

// Auto-fetch pins when extension is active (optional feature)
function setupAutoFetch() {
  // This could be enhanced to automatically detect when user is on their profile
  // and offer to fetch pins
}

// Initialize
setupAutoFetch();
