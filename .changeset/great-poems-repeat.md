---
'@objectstack/spec': patch
---

`translatePage` now resolves copy for components nested in a container's declared `properties.children` array, recursively — previously it visited region-level components only, so copy authored under `pages.<name>.components.<id>` for a nested id parsed happily and was never applied (measured: four KPI labels nested in a `page:card` stayed English on an otherwise fully translated page).

The published translation face does not change; the resolver widens to match the face it already accepted. When an id appears more than once, a region-level component carrying it wins outright, and among nested components the document-order first match takes the entry. The descent follows `children` only — `body` remains a renderer-side back-compat spelling, not an authoring key — and is depth-capped and cycle-safe, since `children` is authored data.
