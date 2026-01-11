# How to Generate Icons

The extension requires PNG icon files in three sizes. Here are several methods to create them:

## Method 1: Online Converter (Easiest)

1. Go to https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Convert to PNG at these sizes:
   - 16x16 pixels → save as `icon16.png`
   - 48x48 pixels → save as `icon48.png`
   - 128x128 pixels → save as `icon128.png`
4. Place all three files in the `icons/` folder

## Method 2: ImageMagick (Command Line)

If you have ImageMagick installed:

```bash
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

## Method 3: Inkscape (Desktop App)

1. Open `icon.svg` in Inkscape
2. File → Export PNG Image
3. Set width/height to desired size
4. Export as `iconXX.png`
5. Repeat for all three sizes

## Method 4: GIMP (Desktop App)

1. Open `icon.svg` in GIMP
2. Image → Scale Image
3. Set dimensions
4. Export as PNG
5. Repeat for all sizes

## Method 5: Using Node.js/npm

If you have Node.js installed:

```bash
npm install -g sharp-cli
sharp -i icon.svg -o icon16.png resize 16 16
sharp -i icon.svg -o icon48.png resize 48 48
sharp -i icon.svg -o icon128.png resize 128 128
```

## Quick Test Icons

For testing purposes, you can create simple colored squares:

```bash
# Using ImageMagick
convert -size 16x16 xc:#E60023 icon16.png
convert -size 48x48 xc:#E60023 icon48.png
convert -size 128x128 xc:#E60023 icon128.png
```

Or use any 16x16, 48x48, and 128x128 PNG images you have available.
