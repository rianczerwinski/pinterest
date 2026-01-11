# Pinterest Pin Downloader - Project Overview

## What This Extension Does

This Chrome extension helps you manage and download your Pinterest pins locally. It provides:

1. **Pin Collection**: Fetches all pins from your Pinterest account
2. **Organization**: Groups pins by boards or shows them all at once
3. **Local Management**: Saves pin lists locally with autosave
4. **Batch Download**: Downloads selected pins with progress tracking
5. **Status Tracking**: Marks which pins have been downloaded
6. **Search & Filter**: Find specific pins quickly

## Architecture

### Core Components

1. **manifest.json**: Extension configuration and permissions
2. **popup.html/popup.js**: Main user interface and logic
3. **content.js**: Runs on Pinterest pages to extract pin data
4. **background.js**: Service worker handling downloads
5. **styles.css**: Modern, Pinterest-inspired UI styling

### Data Flow

```
Pinterest Page → content.js (extracts pin data)
                      ↓
                  popup.js (manages state)
                      ↓
              Chrome Storage (saves data)
                      ↓
              background.js (handles downloads)
                      ↓
              Local Filesystem
```

### Storage Structure

```javascript
{
  pins: [
    {
      id: "123456789",
      title: "Pin Title",
      image: "https://...",
      thumbnail: "https://...",
      url: "https://pinterest.com/pin/...",
      board: "Board Name",
      selected: false,
      downloaded: false,
      downloadPath: null
    }
  ],
  boards: {
    "Board Name": ["pin_id_1", "pin_id_2"]
  },
  username: "your_username",
  lastFetch: "2024-01-11T..."
}
```

## Key Features Implemented

### 1. Autosave
- Automatically saves state after any change
- 1-second debounce to prevent excessive writes
- Visual indicator shows save status

### 2. Pin Fetching
- Extracts pin data from Pinterest's DOM
- Handles dynamic content loading
- Supports both "all pins" and "by board" modes
- Preserves existing download status when re-fetching

### 3. Download Management
- Sequential downloading with delays
- Progress tracking per pin
- Status badges (Pending/Downloading/Completed/Failed)
- File organization by board

### 4. UI Features
- Search/filter pins
- Select all/none buttons
- View toggle (all/by boards)
- Manual save option
- Export/import JSON data
- View pin on Pinterest
- Re-download option

### 5. Download Organization
Downloads are saved to:
```
Downloads/pinterest/
  ├── board-name-1/
  │   ├── pin-title-1_timestamp.jpg
  │   └── pin-title-2_timestamp.jpg
  └── board-name-2/
      └── pin-title-3_timestamp.jpg
```

## Technical Highlights

### Content Script Strategy
The content.js script tries multiple methods to extract pins:
1. Standard DOM selectors (data-test-id attributes)
2. Alternative class-based selectors
3. Fallback: Extract from page JavaScript/JSON

### Download Handling
Uses Chrome's downloads API with:
- Blob conversion for reliable downloads
- Conflict resolution (uniquify)
- Progress monitoring
- Path tracking

### State Management
- Single source of truth (pinsData object)
- Automatic persistence to chrome.storage
- Merge strategy for re-fetched pins
- Selection and download status preservation

## Browser Permissions

- **storage**: Save pin data locally
- **downloads**: Download pin images
- **tabs**: Interact with Pinterest tabs
- **activeTab**: Access current tab
- **pinterest.com**: Content script injection
- **pinimg.com**: Download images from Pinterest CDN

## Limitations & Considerations

1. **Pinterest's Dynamic Loading**
   - Pins load as you scroll
   - May need multiple fetch attempts for large collections
   - Requires being on Pinterest page during fetch

2. **Rate Limiting**
   - Sequential downloads with delays
   - Prevents overwhelming browser/network

3. **Image Quality**
   - Downloads highest available quality from page
   - Quality depends on Pinterest's served images

4. **No Authentication**
   - Uses Pinterest's public-facing data
   - Requires manual navigation to profile
   - Cannot access private boards without manual navigation

## Future Enhancement Ideas

### Short Term
- [ ] Pause/resume download queue
- [ ] Download progress bar
- [ ] Custom download folder selection
- [ ] Keyboard shortcuts
- [ ] Dark mode

### Medium Term
- [ ] Duplicate detection
- [ ] Image size/quality selection
- [ ] Bulk operations (delete, re-categorize)
- [ ] Download history/statistics
- [ ] Scheduled auto-fetch

### Long Term
- [ ] Cloud sync (Google Drive, Dropbox)
- [ ] Image similarity detection
- [ ] AI-powered categorization
- [ ] Multi-account support
- [ ] Analytics dashboard

## Development Notes

### Adding New Features

1. **UI Changes**: Modify popup.html and styles.css
2. **Logic Changes**: Update popup.js
3. **Pinterest Interaction**: Modify content.js
4. **Download Handling**: Update background.js
5. **Permissions**: Add to manifest.json if needed

### Testing Checklist

- [ ] Fetch pins (all and by boards)
- [ ] Select/deselect pins
- [ ] Download single pin
- [ ] Download multiple pins
- [ ] Search functionality
- [ ] View toggle (all/boards)
- [ ] Manual save
- [ ] Export/import
- [ ] Re-download
- [ ] Autosave indicator

### Debugging Tips

1. **Extension Console**: Right-click extension icon → Inspect popup
2. **Content Script**: Open DevTools on Pinterest page
3. **Background Worker**: chrome://extensions/ → service worker
4. **Storage**: DevTools → Application → Storage → Extensions

## File Sizes

Approximate file sizes:
- manifest.json: ~0.5 KB
- popup.html: ~3 KB
- popup.js: ~15 KB
- styles.css: ~8 KB
- content.js: ~10 KB
- background.js: ~3 KB
- Total: ~40 KB (very lightweight)

## Browser Compatibility

- Chrome: ✓ (Manifest V3)
- Edge: ✓ (Chromium-based)
- Brave: ✓ (Chromium-based)
- Firefox: ✗ (Requires Manifest V2 adaptation)
- Safari: ✗ (Different extension format)

## Credits

Built with vanilla JavaScript, HTML, and CSS - no external dependencies.

## License

Personal use. Check Pinterest's Terms of Service for any restrictions on downloading content.
