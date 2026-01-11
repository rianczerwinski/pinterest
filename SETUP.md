# Quick Setup Guide

## Step 1: Create Icons (Required)

The extension needs three icon files before it can be loaded into Chrome. Choose one option:

### Option A: Use Simple Placeholder Icons
Create three small colored images (any PNG files will work):
- Name them: `icon16.png`, `icon48.png`, `icon128.png`
- Place them in the `icons/` folder
- Recommended sizes: 16x16, 48x48, and 128x128 pixels

### Option B: Convert the SVG
Use an online tool like https://cloudconvert.com/svg-to-png to convert `icons/icon.svg` to PNG at the three required sizes.

See `icons/GENERATE_ICONS.md` for detailed instructions.

## Step 2: Load Extension into Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select this folder
6. The extension should now appear in your toolbar

## Step 3: Use the Extension

1. Go to Pinterest.com and log in
2. Navigate to your profile
3. Click the extension icon
4. Enter your username
5. Click "Fetch All Pins" or "Fetch by Boards"
6. Select pins and download

## Troubleshooting

### Error: "Failed to load extension"
- Make sure all three icon files exist in the `icons/` folder
- Check that manifest.json is valid JSON

### Error: "Cannot read manifest"
- Ensure you selected the correct folder (the one containing manifest.json)

### Pins Not Loading
- Make sure you're on Pinterest.com
- Navigate to your profile page first
- Scroll down to load pins before clicking fetch

## Need Help?

Check the full README.md for detailed documentation and troubleshooting.
