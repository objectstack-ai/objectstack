---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

perf(console): the first load stops downloading the grid and detail packages; `@object-ui/plugin-detail/core` publishes the detail helpers without registering anything

Clause-②: yes (widening) — one new published `exports` subpath, `@object-ui/plugin-detail/core`, joins what the package accepts; nothing is removed or renamed, and the package root exports the same names as before
Metadata-protocol: none

`@object-ui/plugin-detail` registers its detail and record-page renderers with `ComponentRegistry` when its root entry is evaluated, and the root reaches every detail surface (and, in the console's build, the grid it draws with). A host that imported one pure helper from the root therefore kept the whole package. The package now publishes a `/core` subpath that registers nothing: `isRefusedFeedRead`, `relatedListEntryNames`, `RELATED_ARRANGEMENT_RECORD_VERSION`, `relatedArrangementFromRecord`, `relatedArrangementToRecord`, `deriveFieldGroupDetailSections`, `deriveHighlightFields`, `resolveDetailSections`, `isWideFieldType`, `prefetchRelatedCounts`, `relatedCountTargetsIn`, `COMPACT_RELATED_ROWS`, `normalizeRelatedListSort`, `seedQueueClaimDecision`, `seedRecordFieldAccess`, `seedRecordVerdict`, and the type `RelatedArrangement`.

The same names stay exported from the package root, unchanged; nothing to migrate. The subpath ships ESM only (`import`), as the other `/core` subpaths do. The package's ESM build now emits one file per source module (`dist/index.js`, `dist/core.js` and the modules they import), so the record-page caches a `/core` seed writes are the ones the root's hooks read; the UMD build (`dist/index.umd.cjs`) is unchanged.

The console (`@object-ui/console`, and the shell it draws, `@object-ui/app-shell`) takes these helpers from the subpath, draws the record pointer card's key fields and the approval decision's child tables through `lazy()`, loads the dev-only row-actions page lazily, and registers the tags the grid and detail packages register (`object-grid`, `view:grid`, `detail-view`, `detail-section`, `view:detail`, and the eleven `record:` blocks `details`, `related_list`, `highlights`, `activity`, `chatter`, `discussion`, `path`, `quick_actions`, `history`, `reference_rail`, `alert`) as lazy stubs with the namespaces those registrations declare. Neither package is downloaded on the first load any more; the list and record routes load them with their own route chunks, and any other surface loads them, and registers once, the first time it draws a grid or a detail block. What every page draws is unchanged.
