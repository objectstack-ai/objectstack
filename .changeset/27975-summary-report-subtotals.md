---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(plugin-report): a summary report with two or more `rows` levels draws a subtotal per outer group, and no longer repeats the outer value on every row

Clause-②: no
Metadata-protocol: none

**Visible change on existing reports.** Every dataset-bound `summary` report whose `rows` names two or more dimensions now renders grouped on its next render, with nothing for the author to change:

- Each outer group draws a header row naming its value once, then its inner rows with the outer column left blank, then a `Subtotal` row. With three or more levels the groups nest, one header and one subtotal per level above the innermost.
- The subtotals are the server's. The report asks the dataset for every proper prefix of `rows` through `totals.groupings` (`[[owner], []]` for `rows: [owner, stage]`), the way a `matrix` already asks for its row and column totals. They are never summed in the browser, so an `avg` or a distinct count subtotals correctly.
- Groups keep the order their first row arrives in: the declared option order of a select dimension, or the report's own `order`. Rows of one group that an `order` by a measure brings back apart are drawn together under it.
- Clicking a subtotal row drills into the whole group, scoped by the outer dimensions only. Clicking an inner row drills by every dimension, as before.
- The export (CSV and XLSX) writes the grouped table as drawn.

Unchanged: a one-level `summary` (grand-total footer only), a `tabular` report, and a `matrix`, including a matrix without `columns`. A server that does not answer the prefix groupings gets the plain table, with the outer value repeated and no subtotal rows.

`@object-ui/i18n` adds `report.subtotal` to every pack.
