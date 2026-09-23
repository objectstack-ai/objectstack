---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

The Studio view form (`viewForm`, served by `METADATA_FORM_REGISTRY.view`) now offers `pagination` for every view type, not only grids.

`pagination.pageSize` is the one row bound a view carries; for a kanban, gallery or timeline view it is the only one. The form used to place `pagination` inside the grid-only `Table options` section (shown when `type` is `grid` or unset), so an author editing any other view type could not see or set it without editing the metadata by hand. It now has its own collapsed `Pagination` section with no visibility condition. `Table options` keeps `resizable`, `compactToolbar`, `rowHeight` and `selection`, still for grids only.

No schema changed: every view type already accepted `pagination`. `@objectstack/platform-objects` ships the new section's label and description in its metadata-form translation bundles (en, zh-CN, ja-JP, es-ES).
