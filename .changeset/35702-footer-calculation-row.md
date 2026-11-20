---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(ui): a resident footer row on list tables, where a reader who may change the view picks each column's calculation

Clause-②: yes (widening)
Metadata-protocol: none

A list's table view now always ends in one footer row, aligned with the columns and held at the bottom of the table: the record count in its first cell, and under each column its calculation, if any, written as the calculation's name in the secondary text colour and the figure in the normal one, with a space and no colon (`Sum ¥1,234,500`). A `min` / `max` over a date reads Earliest / Latest. The list's own "N records" line at the foot of the page is gone from a table that draws this row; the data-cap notice stays there. A grouped table, the phone's card list and every other view type are unchanged.

A reader who may change the open view clicks a cell to pick the column's calculation from one menu that lists what the field type allows (sum and average on numbers and amounts, earliest and latest on dates, the counts on any field), the current one ticked and None last. The pick shows at once. The console saves it as the column's `summary` on the view: a personal view at once; a shared view, for a reader who may edit it, as a draft through the view settings' own save, which other readers see once it is published. A reader who may not change the view sees the figures and no menu.

New host props, all optional and never authored metadata: `ObjectGrid` takes `residentSummaryRow`, `onColumnSummaryPick(field, summary, drawnFields)` and `onResidentSummaryRowChange(drawn)`; `ListView` takes `onColumnSummaryPick`. `ColumnSummaryResult` gains `name` and `text`, the two halves of its `label`. `@object-ui/i18n` adds the `grid.summary` keys `earliest`, `latest`, `pageName`, `calculate`, `none`, `menuPercentEmpty` and `menuPercentFilled` in every pack.
