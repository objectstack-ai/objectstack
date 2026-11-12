---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a column summary over a `record`-mode amount no longer costs the other footer columns their whole-set totals

Clause-②: no
Metadata-protocol: none

When a list or grid view shows one page of more rows, its footer asks the server for the whole matched set's figures in one query. A column summary of `sum`, `avg`, `min` or `max` over an amount in `currencyMode: 'record'` (its `currencyField` a sibling code field or a parent path such as `invoice.currency_code`) was asked in that query. The platform refuses a raw aggregate across currencies (ADR-0144 D6), so the whole query was refused. Every other summarised column then showed only the current page's figure, and each page load sent one refused request.

The query now leaves out a money aggregate over a `record`-mode amount, so the other columns keep their whole-set figures and no refused request is sent. The record-mode column itself still draws no figure, as before. While the grid is still reading the object's fields, a `sum`, `avg`, `min` or `max` column waits for them before the query is sent, and the footer shows the page's figures, labelled as the page's, until then. Counts over the amount are still asked. A per-currency total is not part of this change.
