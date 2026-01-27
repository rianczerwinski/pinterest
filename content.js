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

    // Step 1: Ensure we're on the exact pins page
    const targetUrl = `https://www.pinterest.com/${username}/pins/`;
    const currentUrl = window.location.href;

    // Normalize URLs for comparison (remove trailing slashes, query params, hash)
    const normalizeUrl = (url) => url.split('?')[0].split('#')[0].replace(/\/$/, '');

    if (normalizeUrl(currentUrl) !== normalizeUrl(targetUrl)) {
      // Not on the pins page - navigate there
      window.location.href = targetUrl;
      return {
        success: false,
        error: `Navigating to pins page. Please wait 3-4 seconds and click fetch again.`,
        needsRetry: true
      };
    }

    // Step 2: Wait for initial pins to load
    await waitForPins();

    // Step 3: Scroll to load ALL pins dynamically
    console.log('Starting auto-scroll to load all pins...');
    const pinsBeforeScroll = document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper').length;
    console.log(`Initial pins visible: ${pinsBeforeScroll}`);

    // Call scrollAndLoadMore to load all pins
    const totalPinsLoaded = await scrollAndLoadMore(50);
    console.log(`After scrolling: ${totalPinsLoaded} pins loaded`);

    // Step 4: Extract all pins from the DOM
    const pins = extractPinsFromDOM();

    if (mode === 'boards') {
      const boards = await extractBoardsInfo(username);
      return {
        success: true,
        pins: pins,
        boards: boards,
        scrolledPins: totalPinsLoaded
      };
    } else {
      return {
        success: true,
        pins: pins,
        scrolledPins: totalPinsLoaded
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
async function scrollAndLoadMore(maxScrolls = 50) {
  let scrollCount = 0;
  let lastPinCount = 0;
  let sameCountIterations = 0;

  console.log('Starting auto-scroll...');

  while (scrollCount < maxScrolls) {
    // Scroll to bottom
    window.scrollTo(0, document.body.scrollHeight);

    // Wait for new content to load using MutationObserver
    await waitForNewPins(1500);

    // Count pins instead of just checking scroll height
    const currentPinCount = document.querySelectorAll('[data-test-id="pin"], [data-test-id="pinWrapper"], .pinWrapper').length;

    console.log(`Scroll ${scrollCount + 1}: ${currentPinCount} pins loaded`);

    // Check if pin count has stopped increasing
    if (currentPinCount === lastPinCount) {
      sameCountIterations++;

      // If no new pins for 3 consecutive scrolls, we've reached the end
      if (sameCountIterations >= 3) {
        console.log('No new pins loading - reached end');
        break;
      }
    } else {
      sameCountIterations = 0; // Reset counter if we found new pins
    }

    lastPinCount = currentPinCount;
    scrollCount++;
  }

  // Scroll back to top for better UX
  window.scrollTo(0, 0);

  console.log(`Auto-scroll complete. Total scrolls: ${scrollCount}, Total pins: ${lastPinCount}`);

  return lastPinCount;
}

// Wait for new pins to load using MutationObserver
function waitForNewPins(timeout) {
  return new Promise((resolve) => {
    let timer;
    let observer;

    const complete = () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
      resolve();
    };

    // Set maximum wait time
    timer = setTimeout(complete, timeout);

    // Watch for new pin elements being added to DOM
    observer = new MutationObserver((mutations) => {
      const hasNewPins = mutations.some(m =>
        Array.from(m.addedNodes).some(node =>
          node.nodeType === 1 && (
            node.matches?.('[data-test-id="pin"]') ||
            node.matches?.('[data-test-id="pinWrapper"]') ||
            node.matches?.('.pinWrapper') ||
            node.querySelector?.('[data-test-id="pin"]') ||
            node.querySelector?.('[data-test-id="pinWrapper"]') ||
            node.querySelector?.('.pinWrapper')
          )
        )
      );

      if (hasNewPins) {
        // Reset timer when new pins detected
        clearTimeout(timer);
        timer = setTimeout(complete, 500); // Wait 500ms after last pin loads
      }
    });

    // Observe the main container where pins are added
    const container = document.querySelector('[data-test-id="user-pins-container"]') ||
                      document.querySelector('[role="main"]') ||
                      document.body;
    observer.observe(container, { childList: true, subtree: true });
  });
}

// Auto-fetch pins when extension is active (optional feature)
function setupAutoFetch() {
  // This could be enhanced to automatically detect when user is on their profile
  // and offer to fetch pins
}

// Initialize
setupAutoFetch();
