---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(plugin-grid): inline edit opens no cell editor on a row the server's record-grained write verdict refuses

Clause-②: no
Metadata-protocol: none

An editable grid gated its cells on the object-level grant only, while the row kebab on the same rows also read the server's record-grained `update` verdict. A row that sharing, ownership or RLS refuses lost Edit from its kebab but still opened a cell editor, and the save was refused by the server. Now the cells read the same verdict as the kebab:

- **A refused row reads as read-only.** No click, double-click or Enter opens an editor on it, and its cells show no edit cursor. A click on such a cell reaches the row as it does on a read-only grid. Selection, navigation and the row menu are unchanged.
- **One verdict, fail open.** The cells and the kebab read one batched explain probe for the rows on screen. A row with no answer yet, a failed or absent probe, or a row with no id keeps the object-level behaviour, as before. An editable grid with no kebab Edit now asks the same probe.
- **New runtime slot `DataTableSchema.isRowEditable`.** `(row) => boolean`, supplied by the host and read by `data-table` before it opens a cell editor. It only narrows `editable`: absent, every row follows `editable` and the column locks as before. It is a function, not metadata, so the zod mirror refuses an authored value by name.
