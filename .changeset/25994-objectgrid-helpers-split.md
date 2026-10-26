---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s module-level helpers move into sibling modules

Clause-②: no
Metadata-protocol: none

The query helpers (the held filter resolution, the record-source ladder, the find-params signature), the column helpers and column emit types, the record-link cell, the English fallback translations, the display defaults (row height, page sizes, selection default) and the row-version helpers move verbatim out of `ObjectGrid.tsx` into six modules beside it. No logic, name or rendered output changes. `ObjectGrid.tsx` re-exports every name it exported before, and the package entry is unchanged.

What to do: nothing.
