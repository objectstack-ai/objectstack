---
'@object-ui/console': patch
---

fix(console): the PWA manifest declares the branding icon's real type and size, and adds 192 px and 512 px PNG icons when the branding has no large enough square raster

Clause-②: no
Metadata-protocol: none

The Console's runtime web app manifest declared every icon as `image/svg+xml` at `sizes: 'any'`, so a PNG or ICO branding favicon was mis-declared, and a small one left the branded Console not installable (Chrome: `no-acceptable-icon`, minimum 144 px). An SVG favicon (and the default icon) keeps the single scalable entry. A raster favicon now declares its own MIME type and the pixel size it measures at; one whose type or size cannot be established is left out rather than guessed. When the branding offers no square raster of at least 192 px, the Console's own `icon-192.png` and `icon-512.png`, rendered from its default `favicon.svg`, are added, so such a Console installs with the default icon at launcher sizes. The favicon is measured off the boot path: the manifest link lands once the measurement settles. `start_url`, `scope` and the absolute icon URLs are unchanged.
