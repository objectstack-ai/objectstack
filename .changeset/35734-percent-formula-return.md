---
'@objectstack/lint': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

fix: a `percent` or `currency` formula is a KPI chip on the record header; the lint prescription names all six return types

Clause-②: no
Metadata-protocol: none

A `formula` field whose `returnType` is `percent` drew percentages in its list cells, and the record header strip drew it without the figure typography a `percent` field's chip has. The strip now reads a formula's declared `returnType` before it picks its face, for the two return types the spec reads as a field type, `percent` and `currency`. Both are KPI chips on the header strip. A formula of any other return type chips as before.

The grid's footer formatting reads the same two return types, so a browser-computed footer over a `percent` formula reads `Sum: 75%` rather than `Sum: 0.75`, and over a `currency` formula reads as money. That is not a supported authoring shape: a `sum`, `avg`, `min` or `max` column summary over a `formula` field is refused at authoring by `list-view-summary-field-type-refused`, whatever its `returnType`, because a formula is computed on read and stored in no column, and the whole-set footer query answers `400 INVALID_FIELD`. The formatting reaches only an ungrouped, one-page footer the browser computes over a declaration `os validate` refuses. To total a formula's value, make it a stored field of its own, of the formula's `returnType` and carrying the same `expression`, which the engine computes and stores on every write, and summarise that field.

`os explain dimension-virtual-field-refused` told the author to make a stored copy "of the formula's `returnType` (`number`, `text`, `boolean`, `date` or `currency`)", which named no type for a `percent` formula. It now lists all six, and a test holds the list to the spec's own `returnType` enum.
