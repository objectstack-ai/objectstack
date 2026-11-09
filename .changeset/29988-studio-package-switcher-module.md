---
'@object-ui/app-shell': patch
---

internal: move-only — Studio's top-bar package switcher moves out of `StudioDesignSurface.tsx` into its own module (#29988, slice 2)

Clause-②: no
Metadata-protocol: none

No behaviour change. The package switcher in Studio's top bar (the package list, New package, the package detail sheet and the deleted-package eviction), with the package-list toast id and the Studio landing path it shares with the surface, now lives in `views/studio-design/PackageSwitcher.tsx`. The moved code is byte-identical apart from its imports and three `export`s; `StudioDesignSurface.tsx` imports it from there. The package's public exports are unchanged.
