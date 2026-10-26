# Extension Icon

The `icon.svg` file is the extension's icon shown in the VSCode marketplace and extension manager.

## Current Icon

A gradient background (indigo → purple → pink) with a large "O" representing Object UI, and small rectangles suggesting UI components.

## To Convert to PNG (for marketplace compatibility)

If you need a PNG version for the marketplace:

```bash
# Using ImageMagick
convert -background none -resize 128x128 icon.svg icon.png

# Using rsvg-convert
rsvg-convert -w 128 -h 128 icon.svg > icon.png

# Using Inkscape
inkscape icon.svg --export-type=png --export-filename=icon.png -w 128 -h 128
```

Then update `package.json` to reference `icon.png` instead of `icon.svg`.

## Design Guidelines

- Size: 128x128 pixels
- Format: PNG or SVG
- Transparent background or solid color
- Simple, recognizable design
- Works well at small sizes
