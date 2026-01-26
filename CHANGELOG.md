# Changelog

All notable changes to the Pinterest Pin Downloader extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-26

### Added
- **Smart Pinterest Tab Detection**: Extension now intelligently detects and connects to Pinterest tabs
  - Automatically connects to a single Pinterest tab
  - Shows selector UI when multiple Pinterest tabs are open
  - Offers to open Pinterest in a new tab when none are found
  - Visual status indicator with color coding (green/orange/red)
  - Refresh button to re-scan for Pinterest tabs
  - Session persistence for selected tab
- **Robust Anti-Bot Protection**: Comprehensive download protection system
  - Randomized delays between downloads (configurable 2-5 seconds default)
  - Batch processing with extended delays between batches
  - Exponential backoff retry logic for failed downloads
  - Configurable settings panel with 6 adjustable parameters
  - Real-time progress tracking with visual progress bar
  - Three preset configurations: Conservative, Balanced, Aggressive
- **Enhanced Download Management**
  - Download status persistence across browser sessions
  - Automatic duplicate detection and prevention
  - Smart retry system with up to 3 attempts per pin
  - Batch status notifications during download process

### Changed
- **Extension UI**: Now opens in a full browser tab instead of a popup
  - Provides more screen space for managing pins
  - Allows extension to stay open while browsing Pinterest
  - Better support for multi-tab workflows
- **Tab Detection Logic**: Switched from active tab detection to cross-window Pinterest tab scanning
  - Finds Pinterest tabs across all browser windows
  - Works seamlessly with extension in its own tab
  - Maintains connection even when Pinterest tab is in background

### Fixed
- "Please navigate to Pinterest.com first" error when extension opens in new tab
- Tab detection now works correctly when extension and Pinterest are in separate tabs
- Improved error handling and user feedback for tab connectivity issues

## [1.0.0] - 2026-01-26

### Added
- Initial release of Pinterest Pin Downloader
- Fetch pins from Pinterest accounts
- Board organization and grouping
- Local storage with autosave
- Download management system
- Search and filter functionality
- Export/Import JSON data
- Manual save option
- Pin selection controls (Select All / Deselect All)
- Download status tracking with visual indicators
- Basic retry logic for failed downloads
- Organized file structure by board names

### Features
- Chrome Manifest V3 compatibility
- Content script for DOM scraping
- Background service worker for downloads
- Responsive UI with Pinterest-themed styling
- Real-time status updates
- Persistent data storage using Chrome Storage API

### Known Limitations
- Requires being on Pinterest.com when fetching pins
- Dynamic content loading may require scrolling before fetch
- Large collections may need multiple fetch attempts
- Browser-based scraping dependent on Pinterest's HTML structure

---

## Version History

- **1.1.0** (2026-01-26): Major update with anti-bot protection and smart tab detection
- **1.0.0** (2026-01-26): Initial release with core functionality

## Upgrade Notes

### Upgrading to 1.1.0

When upgrading from 1.0.0 to 1.1.0:

1. **Reload the extension** in `chrome://extensions/` after pulling the update
2. **Tab detection** will automatically scan for Pinterest tabs on first load
3. **Download settings** will use default values initially
   - Configure anti-bot settings by expanding "Anti-Bot Protection Settings"
   - Settings are saved automatically and persist across sessions
4. **Existing pin data** is fully compatible and will load normally
5. **Download history** is preserved - already downloaded pins remain marked

No manual migration or data conversion is required.

## Breaking Changes

### Version 1.1.0
- **None**: All changes are backward compatible with existing pin data and settings

## Security Notes

- All data processing happens locally in your browser
- No data is sent to external servers
- Extension only accesses Pinterest.com when you explicitly fetch pins
- Download settings include built-in protections against rate limiting
- Anti-bot measures help maintain a low profile with Pinterest's systems

## Contributing

For bug reports, feature requests, or contributions, please check the repository's issue tracker.

## License

This extension is provided as-is for personal use. See LICENSE file for details.
