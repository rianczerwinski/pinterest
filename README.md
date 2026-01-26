# Pinterest Pin Downloader

A Chrome extension for managing and downloading Pinterest pins with local tracking and organization.

validated? : no 🌿

**Latest Update**: Added robust anti-bot protection with configurable settings, randomized delays, batch processing, exponential backoff retry logic, and duplicate download prevention.

## Features

- **Fetch Pinterest Pins**: Automatically collect all pins from a Pinterest account
- **Board Organization**: Group pins by boards or view all at once
- **Local Storage**: Automatically saves your pin lists locally
- **Download Management**: Download pins with progress tracking
- **Download Status**: Track which pins have been downloaded to avoid duplicates
- **Search & Filter**: Easily search through your pin collections
- **Export/Import**: Backup and restore your pin data
- **Anti-Bot Protection**: Built-in safeguards to avoid detection and rate limiting
  - Randomized delays between downloads
  - Batch processing with configurable intervals
  - Exponential backoff retry logic
  - Configurable rate limiting controls

## Installation

### Option 1: Load Unpacked Extension (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the folder containing this extension
5. The Pinterest Pin Downloader icon should appear in your extensions toolbar

### Option 2: Create Icons (Required)

Before loading the extension, you need to create icon files. You can:

1. **Use the provided SVG**: Convert `icons/icon.svg` to PNG files at the required sizes
2. **Create your own icons**: Place PNG files in the `icons/` folder with these names:
   - `icon16.png` (16x16 pixels)
   - `icon48.png` (48x48 pixels)
   - `icon128.png` (128x128 pixels)

You can use online tools like:
- https://www.aconvert.com/image/svg-to-png/
- https://cloudconvert.com/svg-to-png
- Or use any image editing software

## Usage

### 1. Fetching Pins

1. Navigate to Pinterest.com and log in to your account
2. Click the extension icon to open the popup
3. Enter your Pinterest username (the part after pinterest.com/)
4. Choose one of the fetch options:
   - **Fetch All Pins**: Gets all pins in a single list
   - **Fetch by Boards**: Organizes pins by their boards

**Note**: Due to Pinterest's dynamic loading, you may need to:
- Be on your Pinterest profile page
- Scroll down to load more pins before fetching
- Click the fetch button multiple times to capture all pins

### 2. Viewing and Organizing

- **Group by Boards**: Use the radio buttons to switch between viewing all pins or grouped by boards
- **Search**: Use the search bar to filter pins by title, description, or board name
- **Select Pins**: Check the boxes next to pins you want to download

### 3. Downloading Pins

1. **Configure Download Settings** (optional):
   - Click "Anti-Bot Protection Settings" to expand the settings panel
   - Adjust delays, batch sizes, and retry logic to your preferences
   - Defaults are set to be safe for most use cases

2. **Select and Download**:
   - Select the pins you want to download (or use "Select All")
   - Click "Download Selected"
   - Downloads will process in batches with randomized delays
   - Progress is shown in real-time with a progress bar
   - Downloaded pins are marked with a green background and "Downloaded" badge

3. **Duplicate Prevention**:
   - Already downloaded pins are automatically excluded from new downloads
   - Download status persists across browser sessions
   - You can re-download individual pins if needed

### 4. Managing Data

- **Autosave**: Enabled by default - saves your data every time you make changes
- **Manual Save**: Click to force an immediate save
- **Export JSON**: Download your pin data as a JSON file for backup
- **Import JSON**: Restore from a previously exported file

### 5. Anti-Bot Protection Settings

The extension includes robust anti-bot protection to avoid triggering Pinterest's rate limiting or detection systems:

**Configurable Settings:**

- **Min Delay (2000ms default)**: Minimum wait time between individual downloads
- **Max Delay (5000ms default)**: Maximum wait time between individual downloads
- **Batch Size (5 default)**: Number of pins to download before taking a longer break
- **Batch Delay (10000ms default)**: Extended wait time between batches
- **Max Retries (3 default)**: Number of times to retry a failed download
- **Exponential Backoff (enabled)**: Progressively increase delay on retry attempts

**How It Works:**

1. **Randomized Delays**: Each download waits a random time between Min and Max delay, making the pattern less predictable
2. **Batch Processing**: Downloads are grouped into batches with longer breaks between batches to mimic human behavior
3. **Smart Retry Logic**: Failed downloads are automatically retried with exponential backoff (1x, 2x, 4x delay)
4. **Progress Tracking**: Real-time progress bar shows current batch and completion status

**Recommended Settings:**

- **Conservative** (safest): Min 3000ms, Max 8000ms, Batch Size 3, Batch Delay 15000ms
- **Balanced** (default): Min 2000ms, Max 5000ms, Batch Size 5, Batch Delay 10000ms
- **Aggressive** (faster, higher risk): Min 1000ms, Max 3000ms, Batch Size 10, Batch Delay 5000ms

**Note**: More aggressive settings may trigger rate limiting. If you encounter issues, switch to more conservative settings.

## File Structure

```
pinterest-pin-downloader/
├── manifest.json          # Extension configuration
├── popup.html            # Main UI
├── popup.js              # Main logic
├── styles.css            # Styling
├── background.js         # Download handling
├── content.js            # Pinterest page interaction
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # This file
```

## How It Works

1. **Content Script**: Runs on Pinterest pages and extracts pin data from the DOM
2. **Popup Interface**: Provides the UI for managing pins
3. **Background Service Worker**: Handles downloading files
4. **Local Storage**: Uses Chrome's storage API to save pin data locally

## Data Storage

All pin data is stored locally in your browser using Chrome's storage API. This includes:
- Pin URLs and metadata
- Board information
- Download status
- Selection state

## Download Organization

Downloaded pins are organized in folders:
```
Downloads/
└── pinterest/
    ├── board-name-1/
    │   ├── pin-title-1_timestamp.jpg
    │   └── pin-title-2_timestamp.jpg
    └── board-name-2/
        └── pin-title-3_timestamp.jpg
```

## Limitations

1. **Pinterest's Dynamic Content**: Pinterest loads content dynamically, so:
   - You need to be on the Pinterest page when fetching
   - You may need to scroll to load all pins before fetching
   - Very large pin collections may require multiple fetch attempts

2. **Rate Limiting Protection**: To avoid triggering Pinterest's anti-bot systems:
   - Downloads use randomized delays and batch processing
   - Large collections will take time to download safely
   - Default settings prioritize safety over speed
   - Adjust settings carefully to balance speed vs. detection risk

3. **Image Quality**: Downloads use the highest quality image available on the page

4. **Browser-Based Scraping**: The extension relies on DOM scraping, which:
   - May break if Pinterest changes their HTML structure
   - Requires being logged in and on the Pinterest website
   - Works best when pins are already loaded on the page

## Troubleshooting

### Pins Not Fetching
- Make sure you're logged into Pinterest
- Navigate to your profile page (pinterest.com/your-username)
- Scroll down to load more pins
- Try refreshing the page and fetching again

### Downloads Not Working
- Check that Chrome has permission to download files
- Ensure you're not blocking downloads in Chrome settings
- Check your default download location has enough space

### Extension Not Loading
- Make sure all icon files exist (icon16.png, icon48.png, icon128.png)
- Check the Chrome extensions page for error messages
- Try removing and re-adding the extension

## Privacy

- This extension runs locally in your browser
- No data is sent to external servers
- All pins and download tracking are stored locally
- The extension only accesses Pinterest.com when you actively fetch pins

## Development

To modify the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## Future Enhancements

Potential features to add:
- Bulk download with pause/resume capability
- Custom folder organization patterns
- Filter by date, size, or other metadata
- Integration with cloud storage
- Advanced statistics and analytics dashboard
- Pinterest API integration (if available)
- Automatic incremental fetching of new pins

## License

This extension is provided as-is for personal use.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review Chrome's extension documentation
3. Check Pinterest's terms of service for any usage restrictions
