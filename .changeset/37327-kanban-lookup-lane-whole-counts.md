---
'@object-ui/plugin-kanban': patch
'@object-ui/i18n': patch
---

fix(kanban): a list view board whose lanes come from the data counts and totals each whole lane, and a board laned by a lookup draws a lane whose records all sit past the first page

Clause-②: no
Metadata-protocol: none

A list view hands its board one page of records when it cannot know the lanes before the query: the lane field has no options (a lookup, or a text, number, boolean or date field). That board's lane header count and a foot `count` counted the page with no `+`, its `summarizeField` header total summed the page, and a lane whose records all sat past the first page was not drawn.

- The board's one grouped lane read (`DataSource.queryGroupHeaders`, the read that already answers its `sum`, `avg`, `min` and `max`) now also asks each lane's record count and the `SUM` of the view's `summarizeField`, and is asked whether or not the view draws a lane statistic. It is still one read per board, never one per lane.
- Each lane header and a foot `count` read the whole lane's count, and the header total reads the whole lane's sum, printed without binary residue (`0.3`, never `0.30000000000000004`), as the page's total is. The foot `sum` gets the same rounding. The trailing "Uncategorized" lane, when it is drawn, reads its whole count and total too.
- On a board laned by a lookup (a field that names the object it references), the read's groups name every lane, so a lane whose records all sit past the page is drawn after the page's lanes, titled by its referenced record, and says how many cards it did not load (new string `kanban.notLoaded`, in every locale). A board laned by any other field draws the page's lanes only.
- Over a source without that door, a refused read or a cut answer, the counts and the header total are the page's, marked `+`, and no lane past the page is drawn.
- Unchanged: the swimlane layout, and an "Uncategorized" lane whose records all sit past the page, which is still not drawn.
