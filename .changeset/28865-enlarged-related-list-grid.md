---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): on a desktop the record page's enlarged related tab draws the child object's list grid, as the phone already does

Clause-②: no
Metadata-protocol: none

The enlarged related tab (the record page's active tab) drew a generic `data-table` on a desktop: rows about 65 px tall where the child object's list page draws 41 px, a name in plain text that did not open the record, and the count twice (on the 全部 chip and on the line under the toolbar). It now renders `object-grid` over the rows the related list already read, the branch the phone has taken since the phone card rows landed, so the tab is the child object's list face: the list page's row height and density, the name as a link that opens the record, and the grid's row actions.

The related list stays the source of truth. Its window, page and sort reach the grid as host props (the ones the list view hands the same grid), so paging and sort are still the server's `$top` / `$skip` / `$orderby`, and its own pager stays the one pager. The filter box, the 全部 / 我的 / 逾期 chips, 新建 and 导出 are unchanged. The host's row actions (`list_item`, and `record_related` inside a parent record) ride to the grid's row menu and still dispatch through the host against the child object and its row, which refreshes the list. While the 全部 chip is on and nothing narrows the rows, the line under the toolbar no longer repeats the chip's count.

One behaviour changes: while the filter box has text, the grid offers no header sort on a relational column (its stored value is an id), as on every list page; the data-table sorted that column by its label in that state. Compact panels in the right column and lists that are not enlarged are unchanged.
