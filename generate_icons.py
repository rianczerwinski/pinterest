#!/usr/bin/env python3
"""
Simple script to generate PNG icons for the Chrome extension.
Requires: pip install pillow cairosvg
"""

import os

try:
    from PIL import Image, ImageDraw
    import cairosvg
    HAS_CAIRO = True
except ImportError:
    from PIL import Image, ImageDraw
    HAS_CAIRO = False

ICON_DIR = "icons"
SIZES = [16, 48, 128]
COLOR = "#E60023"  # Pinterest red

def generate_from_svg():
    """Generate PNG icons from SVG if cairosvg is available."""
    if not HAS_CAIRO:
        print("cairosvg not installed. Install with: pip install cairosvg")
        return False

    svg_path = os.path.join(ICON_DIR, "icon.svg")
    if not os.path.exists(svg_path):
        print(f"SVG file not found: {svg_path}")
        return False

    print("Generating icons from SVG...")
    for size in SIZES:
        output_path = os.path.join(ICON_DIR, f"icon{size}.png")
        cairosvg.svg2png(
            url=svg_path,
            write_to=output_path,
            output_width=size,
            output_height=size
        )
        print(f"Created: {output_path}")

    return True

def generate_simple_icons():
    """Generate simple colored square icons as placeholders."""
    print("Generating simple placeholder icons...")

    for size in SIZES:
        # Create a new image with Pinterest red color
        img = Image.new('RGB', (size, size), COLOR)
        draw = ImageDraw.Draw(img)

        # Add a simple "P" or download icon
        # For simplicity, just add a white border
        border = max(1, size // 16)
        draw.rectangle(
            [border, border, size - border - 1, size - border - 1],
            outline='white',
            width=border
        )

        output_path = os.path.join(ICON_DIR, f"icon{size}.png")
        img.save(output_path, 'PNG')
        print(f"Created: {output_path}")

    return True

def main():
    # Create icons directory if it doesn't exist
    os.makedirs(ICON_DIR, exist_ok=True)

    print("Pinterest Pin Downloader - Icon Generator")
    print("-" * 50)

    # Try to generate from SVG first
    if not generate_from_svg():
        # Fall back to simple icons
        print("\nGenerating simple placeholder icons instead...")
        if not generate_simple_icons():
            print("Failed to generate icons!")
            return

    print("\n✓ Icon generation complete!")
    print("\nGenerated files:")
    for size in SIZES:
        print(f"  - icons/icon{size}.png")

    print("\nYou can now load the extension in Chrome:")
    print("  1. Go to chrome://extensions/")
    print("  2. Enable 'Developer mode'")
    print("  3. Click 'Load unpacked'")
    print("  4. Select this directory")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nError: {e}")
        print("\nIf you don't have PIL/Pillow installed:")
        print("  pip install pillow")
        print("\nFor SVG support (optional):")
        print("  pip install cairosvg")
