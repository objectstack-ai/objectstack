---
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
---

feat(app-shell): every metadata type's list is drawn by ObjectGrid, and its New on a read-only base creates in the base's paired `.custom` package

Clause-②: no
Metadata-protocol: none

- `@object-ui/plugin-grid`: `ObjectGrid` takes two generic host props for its table view — `hostCells` (a host draws a column's cells) and `rowTint` (a palette name per row, over `rowColor`).
- `@object-ui/app-shell`: the metadata list (Setup and Studio's All metadata area) is an `ObjectGrid` fed a declared schema and the page's rows in the list's own order; diagnostics tint, lock, the Active switch, Clone, the served columns and the 「修改时间」 column (its time, its unpublished-changes mark and its `changed` sort, objectstack#36898) are the page's cells; sort, search and page live in the address. The grid's personal columns, export, selection and inline edit are off for it.
- On a read-only base in Studio, the list's New creates in the paired `.custom` package (ADR-0146 D3): an object (with its organization-wide sharing default) and a flow (from a starting point) open the list's create dialog; another type opens the area's create in the pair. Under the customization wall no New is offered.
