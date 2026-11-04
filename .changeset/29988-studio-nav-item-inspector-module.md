---
'@object-ui/app-shell': patch
---

internal: move-only — Studio's nav item inspector moves out of `StudioDesignSurface.tsx` into its own module (#29988, slice 1)

Clause-②: no
Metadata-protocol: none

No behaviour change. The menu-entry inspector Studio shows while you edit an app's navigation, with the nav target pickers and the select it draws with, now lives in `views/studio-design/StudioNavItemInspector.tsx`. The moved code is byte-identical apart from its imports and one `export`; `StudioDesignSurface.tsx` imports it from there and re-exports the inspector, so every import of it keeps working. The package's public exports are unchanged.
