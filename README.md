# Pinterest Pin Downloader

A Chrome extension for managing and downloading Pinterest pins with local tracking and organization.

validated? : no 🌿

## Features

- **Fetch Pinterest Pins**: Automatically collect all pins from a Pinterest account
- **Board Organization**: Group pins by boards or view all at once
- **Local Storage**: Automatically saves your pin lists locally
- **Download Management**: Download pins with progress tracking
- **Download Status**: Track which pins have been downloaded
- **Search & Filter**: Easily search through your pin collections
- **Export/Import**: Backup and restore your pin data

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

1. Select the pins you want to download (or use "Select All")
2. Click "Download Selected"
3. Downloads will start automatically and save to your default downloads folder
4. Downloaded pins are marked with a green background and "Downloaded" badge
5. Progress is tracked and saved automatically

### 4. Managing Data

- **Autosave**: Enabled by default - saves your data every time you make changes
- **Manual Save**: Click to force an immediate save
- **Export JSON**: Download your pin data as a JSON file for backup
- **Import JSON**: Restore from a previously exported file

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

2. **Rate Limiting**: To avoid overwhelming your browser:
   - Downloads happen sequentially with small delays
   - Large collections may take time to download

3. **Image Quality**: Downloads use the highest quality image available on the page

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
- Bulk download with pause/resume
- Custom folder organization
- Filter by date, size, or other metadata
- Duplicate detection
- Integration with cloud storage
- Download queue management
- Statistics and analytics

## License

This extension is provided as-is for personal use.

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review Chrome's extension documentation
3. Check Pinterest's terms of service for any usage restrictions
