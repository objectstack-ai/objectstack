---
'@objectstack/service-analytics': patch
---

Clause-②: no
Metadata-protocol: none

The record-currency refusal on a cube measure (`INVALID_FIELD` / 400, a `sum` / `avg` / `min` / `max` over a `currencyMode: 'record'` amount the query does not group by its code) no longer advises a grouping for an amount that follows its parent's currency (`currencyField: 'MASTER_DETAIL.CODE'`). No grouping makes such an amount one currency — a dimension over the parent path groups by the parent's column, and the engine admits none either — so following that advice was refused again. The refusal now names the stored home-currency field alone. A sibling code field keeps both remedies, the home field and the grouping over the code.
