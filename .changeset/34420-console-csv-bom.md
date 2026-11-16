---
'@object-ui/core': patch
'@object-ui/components': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-report': patch
'@object-ui/app-shell': patch
---

fix(ui): CSV files the Console builds in the browser start with a UTF-8 byte-order mark, so Excel shows Chinese and other non-ASCII text correctly

Clause-②: no
Metadata-protocol: none

Excel reads a CSV file that has no byte-order mark in the computer's own code page, so Chinese names and other non-ASCII values opened as garbled text. The server export already writes the mark. Six Console downloads build their CSV in the browser and did not:

- the list view's export when the data source cannot export on the server;
- the grid's export in the same case;
- the data table's Export CSV button;
- a report's CSV export;
- the bulk action's Download error CSV;
- the temporary-password CSV after an identity import.

All six now build their file with the new `csvBlob(text)` from `@object-ui/core`. It puts one mark (U+FEFF, the bytes EF BB BF) before the text and types the file `text/csv;charset=utf-8`. The core package also exports the mark as `UTF8_BYTE_ORDER_MARK`. The CSV import already removes one leading mark, so a downloaded file can still be imported again. The data table's file is now typed with `charset=utf-8` too.
