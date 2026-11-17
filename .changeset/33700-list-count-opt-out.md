---
'@object-ui/data-objectstack': patch
'@object-ui/types': patch
'@object-ui/components': patch
'@object-ui/plugin-timeline': patch
---

feat(console): surfaces that never draw a record count decline the list total

Clause-②: no
Metadata-protocol: none

The list door (`GET /data/:object`) runs a `count(*)` over the full predicate beside every paged read, unless the request sends `count=false`. On PostgreSQL that count is now the largest part of a paged list's database time. The ObjectStack adapter never forwarded `$count`, so no Console surface could decline the total.

- `ObjectStackAdapter.find()` now honours `$count: false`. Such a read takes the adapter's raw GET, which sends `count=false`, and the result carries no `total`. The page length is not used in its place. An absent `$count`, or `$count: true`, still gets the total, as before.
- The timeline rail (`object-timeline` and the timeline view), the `element:record_picker` block and the `element:repeater` block draw rows and never a record count, so they now send `$count: false`. Surfaces that print a total keep it: the grid and list footers, related lists, the lookup picker's "showing N of M", kanban lane counts, and the calendar, map, tree and gantt row-ceiling note.
