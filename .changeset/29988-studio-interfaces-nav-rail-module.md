---
'@object-ui/app-shell': patch
---

internal: move-only — the Studio Interfaces pillar's navigation rail moves out of `StudioDesignSurface.tsx` into its own module (#29988, slice 3)

Clause-②: no
Metadata-protocol: none

No behaviour change. The rail Studio's Interfaces pillar draws for an app's navigation (the nav tree and its groups, the rows a customization package contributes, the off-nav sections for pages, dashboards, reports and views, the two rail contexts, the kind names and kind icons) now lives in `views/studio-design/InterfacesNavRail.tsx`. The moved code is byte-identical apart from its imports and eleven `export`s; `StudioDesignSurface.tsx` imports it from there. The package's public exports are unchanged.
