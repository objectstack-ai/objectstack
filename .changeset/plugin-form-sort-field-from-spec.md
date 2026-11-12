---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the master-detail inline grid takes its line-position field from `@objectstack/spec`

`deriveDetail` now asks `deriveInlineGridSortField` from `@objectstack/spec/data` for the child field the grid stamps on drag-reorder and orders the lines by, and the renderer's own copy of the sort-position names is gone. The spec's names and rule are the ones the renderer used (the first child field, in field-map order, named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`), so no grid changes behaviour: the grid columns, the row form and the line-position field now read one list, and the `field-no-consumers` lint rule credits the same field the grid reads.

Clause-②: no
Metadata-protocol: none
