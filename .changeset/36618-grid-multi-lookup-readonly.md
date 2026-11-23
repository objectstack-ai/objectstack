---
'@object-ui/fields': patch
---

fix(fields): a multi-record lookup column in the line-item grid reads its records, not "undefined", in the read-only table and in list mode

Clause-②: no
Metadata-protocol: none

The line-item grid rendered its read-only lookup cell (the read-only table of a read-only record page or print page, and the list form-factor) without the column's `multiple` flag. A multi-record lookup cell's id list was therefore resolved as one id, and the cell printed "undefined". Both read-only sites now pass `multiple` from the column, as the editable cell already did, so the cell shows one badge per related record. Single-record lookup columns are unchanged.
