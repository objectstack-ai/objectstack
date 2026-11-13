---
'@object-ui/core': patch
'@object-ui/plugin-gantt': patch
---

feat(plugin-gantt): the gantt draws up to 10,000 rows before it truncates, instead of the 2,000 the other non-grid views share

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/plugin-gantt`:** a gantt now fetches and draws up to `GANTT_ROW_CEILING` (10,000) rows of its filtered result set; past it, it draws the first 10,000 and shows the same "Showing the first N of M records" note as before. A schedule of 2,001 to 10,000 rows that used to draw its first 2,000 with that note now draws whole, with no metadata change. The ceiling is still not authorable: an authored `pagination.pageSize` or `limit` does not reach the gantt's query, and a datasource's `external.rowCap` is not read. Calendar, map and tree keep the shared 2,000.
- **`@object-ui/core`:** exports `GANTT_ROW_CEILING` beside `NON_GRID_ROW_CEILING`, and the `NonGridRowCeiling` type (the closed set of the two). `nonGridRowCeilingQuery(ceiling?)` and `applyNonGridRowCeiling(result, ceiling?)` take an optional ceiling from that set; leaving it out keeps the shared 2,000, so existing callers are unchanged.
