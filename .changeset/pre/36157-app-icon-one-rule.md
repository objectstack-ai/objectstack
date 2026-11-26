---
'@object-ui/app-shell': patch
---

feat(console): an app's icon is the same everywhere: an app with no logo and no colour gets a solid colour of its own, and Home drops its gradients

Clause-②: no
Metadata-protocol: none

An app that declared neither `branding.logo` nor a hex `branding.primaryColor` was drawn two ways: on one of ten gradients on Home, and on a neutral grey square in the app switcher, its pill, the phone's app list and Studio's package chip. Now every place draws it by one rule:

- **A declared logo** is drawn, as before.
- **A declared hex `primaryColor`** colours the icon's square, as before.
- **Neither:** the icon is a white glyph on a solid square of a colour picked by the app's `name` from the objects' palette (`OBJECT_COLORS` without `gray`: blue, teal, green, amber, orange, red, pink, purple). The pick is djb2 over the name, kept to a signed 32-bit integer, its absolute value modulo eight, so an app keeps its colour on every load and for every viewer. Nothing is written back, and the app's buttons keep the platform's default primary colour.

Home's tiles lose their gradients and draw this same square at their 56 px size. The `tile-grid` page block, which draws Home's tile, takes a solid palette colour keyed by its tile's `href` instead of a gradient. The command palette's "Switch app" items draw the app's mark (its logo, or its square) instead of a bare line icon.
