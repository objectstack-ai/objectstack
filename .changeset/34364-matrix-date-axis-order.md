---
'@object-ui/plugin-report': patch
---

fix(plugin-report): a matrix report lays out each header dimension on its own, so a date axis reads by bucket key and a select axis keeps its option order whatever the report's `order`

Clause-②: no
Metadata-protocol: none

A dataset matrix collected its row and column headers in row-arrival order. When the server's empty-bucket fill and its default ascending time order did not run (a selection with limit/offset, an order on a measure, `compareTo`, or a grid over 2,000 cells), a date column axis came out in first-seen order: one ascending run per row bucket, end to end. And any report `order` switched off the select option layout on both axes, so ordering by the date dimension turned a `priority` row axis from Low / Medium / High / Critical into the stored-value order Critical / High / Low / Medium.

The matrix now decides per header dimension. A dimension the report's `order` names keeps the order the server applied, so an explicit `desc` on a date axis stays descending. A select dimension it does not name takes its declared option order, as before with no `order`. A date dimension it does not name (its answer column is typed `time`, at any `dateGranularity`) takes its bucket keys ascending, compared by the raw key and not the localized label, with the empty bucket last. Any other dimension keeps its arrival order.

Only the two header lists are permuted. Every cell is still placed by its bucket ids and every drill click still carries its own bucket, so no row is re-sorted and nothing a truncated page holds is reordered. Flat tables and embedded charts are unchanged.
