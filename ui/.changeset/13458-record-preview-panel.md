---
"@object-ui/plugin-list": patch
"@object-ui/plugin-map": patch
"@object-ui/plugin-timeline": patch
"@object-ui/plugin-grid": patch
"@object-ui/plugin-view": patch
"@object-ui/core": patch
"@object-ui/react": patch
---

Clause-②: no
Metadata-protocol: none

The record overlay opened from a list, gallery, map or timeline view now mounts `RecordDetailPanel` from `@object-ui/plugin-detail`, as the grid, tree, kanban, calendar and gantt overlays already did, in place of a raw dump of the record's keys and values. A record previewed from any view reads with the object's declared labels and typed values, and without its `hidden` fields. The panel is read-only there, as on the grid and the tree; a row with no object name or id keeps the plain reading.

Drifted copies folded: `GANTT_CONFIG_SPELLING` is exported once from `@object-ui/core` (used by `ListView` and `ObjectView`); `isSameAuthoredFilter` is exported from `@object-ui/react` and `ObjectGrid` drops its copy; `@object-ui/core` exports `isPlainObject` (a non-null, non-array object) for private copies to switch to when their file is next touched.
