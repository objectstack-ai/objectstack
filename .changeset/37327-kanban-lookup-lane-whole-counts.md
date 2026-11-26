---
'@object-ui/plugin-kanban': patch
---

fix(kanban): a list view board whose lanes come from a lookup field counts and totals each whole lane, and draws a lane whose records all sit past the first page

Clause-②: no
Metadata-protocol: none

A list view board whose lanes it cannot know before the query (lanes over a lookup field) is handed one page of records. Its lane header count and a foot `count` counted that page with no `+`, its `summarizeField` header total summed that page, and a lane whose records all sat past the first page was not drawn.

- The board's one grouped lane read (`DataSource.queryGroupHeaders`, the read that already answers its `sum`, `avg`, `min` and `max`) now also asks each lane's record count and the `SUM` of the view's `summarizeField`, and is asked whether or not the view draws a lane statistic. It is still one read per board, never one per lane.
- Each lane header and a foot `count` read the whole lane's count; the header total reads the whole lane's sum.
- The read's groups name every lane, so a lane whose records all sit past the page is drawn after the page's lanes, titled by its referenced record.
- Over a source without that door, a refused read or a cut answer, the counts and the header total are the page's, marked `+`, and no lane past the page is drawn.
- The swimlane layout and the trailing "Uncategorized" lane are unchanged.
