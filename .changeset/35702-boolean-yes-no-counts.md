---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(spec): `count_true` / `count_false` column summaries — a boolean column's Yes and No counts in the list footer and group headers

Clause-②: yes (widening)
Metadata-protocol: added

`ListColumn.summary` accepts two more members, `count_true` and `count_false`: the number of rows whose boolean (or toggle) cell is true, and the number whose cell is false. A cell with no value is neither; it stays `count_empty`'s, so `count_true + count_false = count_filled`.

Both are answered on the server with no new aggregation function: booleans aggregate as numbers on every backend, so `count_true` is `SUM(field)` and `count_false` is `COUNT(field) − SUM(field)`, read off the group header row (or the footer's whole-set row) by `deriveColumnSummary`. `COLUMN_SUMMARY_AGGREGATION`'s derived rows now carry `reads`, every node the member reads (`from` is its first); `columnSummaryNodeFunctions(mapping)` is the one reading of a row's nodes, which the group header compiler, the footer's whole-set query and the lint now share. `COLUMN_SUMMARY_FIELD_TYPES` / `isColumnSummaryCompatibleWithFieldType` say the two members apply to `boolean` and `toggle` only.

`@objectstack/lint` refuses `count_true` / `count_false` over any other field type under `list-view-summary-field-type-refused` (an error, so `os validate` and the save door fail): over a number the same `SUM(field)` is a total, and the footer would print it as a count.

`@object-ui/plugin-grid`'s footer menu offers Count of Yes and Count of No first on a boolean or toggle column, and only there; the footer draws them as `Yes 12` / `No 3`, from the whole matched set when the server answers it and from the page, labelled as the page's, when it does not. `@object-ui/i18n` adds the `grid.summary` keys `countTrue`, `countFalse`, `menuCountTrue` and `menuCountFalse` in every pack.
