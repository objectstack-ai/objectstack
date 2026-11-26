---
"@objectstack/mcp": patch
---

Clause-②: yes (widening)
Metadata-protocol: none

`query_records` says when a page hit its row cap. The tool asks for one row more than the page; when that row comes back, it serves the page and adds `truncated: true`. The member is present only when true, so a page that holds every matching row, exactly `limit` rows included, is unchanged. The tool description now tells a model not to sum, count or rank a truncated page as if whole, and to read on with `offset` or use `aggregate_records` for totals.

The stdio door's `query_records` now answers the same page facts as the HTTP door: a paged read is counted under the same filter, as the caller, so `total` is the match total and `hasMore` says whether rows remain. Before, a capped stdio page answered `total` equal to the page length. If the count fails, `total` is left out and is never estimated.

When the host's read window (`OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`) would refuse the extra row, the page is read as asked, and the door's counted `hasMore` decides `truncated`.
