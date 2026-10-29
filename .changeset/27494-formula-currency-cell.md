---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

fix(plugin-grid, plugin-detail): a formula declaring `returnType: 'currency'` reads as money in list cells and on the record page

Clause-②: no
Metadata-protocol: none

A `Field.formula` with `returnType: 'currency'` and its own `currencyConfig` read as a bare grouped number (`90,000.00`) beside the currency fields it was computed from (`$150,000.00`). The formula cell already draws a declared currency through the currency cell, but the grid's configured columns and the record page's field enrichment rebuilt the field from a picked key list that left `returnType` out, so the cell never saw it. Both now hand `returnType` through beside `currencyConfig`, and the formula reads `$90,000.00`. A formula declaring `number`, or nothing, keeps the bare number.
