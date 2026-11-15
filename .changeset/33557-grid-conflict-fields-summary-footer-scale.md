---
'@object-ui/plugin-grid': patch
'@object-ui/fields': patch
---

fix(plugin-grid): a multi-field row conflict lists each field, and a summary column's footer total is formatted as its cells

Clause-②: yes (widening) — `@object-ui/fields` gains the export `summaryDeclaresCurrency`; nothing is removed or narrowed, and the `@object-ui/plugin-grid` changes are internal.
Metadata-protocol: none

**Row save conflicts in the grid.** A row save that changed several fields and met a newer version (409 `CONCURRENT_UPDATE`) opened the conflict dialog with your edit and the current value printed as two raw JSON objects. The dialog now lists each changed field on its own row, under its column header, with your edit and the current value. A one-field conflict looks as before.

**The list footer total of a roll-up (`summary`) field.** The total ignored the field's `scale`, so a summary with `scale: 2` read "Paid 230,000" beside a currency column's "215,000.00". The footer now formats a summary's total the way the list cell draws the same field: as money when the summary declares its currency (`currencyConfig`), else as a number at its declared `scale`. A summary that declares neither keeps its plain total. Money follows the summary's own `currencyConfig`, not the type of the field it sums, as the spec states and as the cell already draws it.
