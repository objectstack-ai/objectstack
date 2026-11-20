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

A reader who may change the open view clicks a cell to pick the column's calculation from one menu that lists what the field type allows (sum and average on numbers and amounts, earliest and latest on dates, the counts on any field), the current one ticked and None last. The console saves it as the column's `summary` on the view, and nothing else of the reader's layout. On a personal view it is saved at once and stays drawn. On a shared view the console saved, a reader who may edit it saves it as a draft through the view settings' own save: the draft save reloads the list, which then draws the published view again, so the pick shows for a moment and comes back once the draft is published, for every reader (#35932). The menu is offered on the columns the view itself declares; a column the reader added for themselves and a view that declares no columns draw the figures with no menu. A pick that is not saved is taken back, with the refusal said (a view a read-only package ships is refused this way: its changes go to the package's customization). A reader who may not change the view sees the figures and no menu.

New host props, all optional and never authored metadata: `ObjectGrid` takes `residentSummaryRow`, `onColumnSummaryPick(field, summary)` (answer `false` to have the pick taken back), `summaryPickFields` and `onResidentSummaryRowChange(drawn)`; `ListView` takes `onColumnSummaryPick` and `columnSummaryPickFields`. `ColumnSummaryResult` gains `name` and `text`, the two halves of its `label`. `@object-ui/i18n` adds the `grid.summary` keys `earliest`, `latest`, `pageName`, `calculate`, `none`, `menuPercentEmpty` and `menuPercentFilled` in every pack.
