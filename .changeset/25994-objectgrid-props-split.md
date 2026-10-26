---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s host-facing props types and its footer-summary reporter move into sibling modules

Clause-②: no
Metadata-protocol: none

`ObjectGridColumnState`, `ObjectGridFooterSummary` and `ObjectGridExternalPaginationProps` move verbatim out of `ObjectGrid.tsx` into `objectGridProps.ts`, and the renderless `FooterSummaryReport` moves into `objectGridFooterSummaryReport.tsx`. No logic, name or rendered output changes. `ObjectGrid.tsx` re-exports the three types, so every name it exported before is still importable from the same path, and the package entry is unchanged.

What to do: nothing.
