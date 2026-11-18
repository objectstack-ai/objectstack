---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(flow designer): edge conditions as field rows, and approvals inserted with their approve and reject edges

Clause-②: no
Metadata-protocol: none

- **Edge conditions are filled in by field.** A connection's condition now opens as field / operator / value rows (the list toolbar's filter builder), with Formula one click away. The rows write CEL the engine already runs, for example 「会议日期 晚于 今天」 as `record.meeting_date != null && record.meeting_date > today()`. A stored condition opens as rows only when it is exactly what the rows would write. Any other condition opens in the formula input, unchanged. A row that cannot be written faithfully (case-insensitive contains, a date-time literal, a relative week window) saves nothing and says so.
- **The reference picker leads with business fields, by name.** The trigger record's own fields come before the platform's columns (audit, tenancy, `id`). A field with a label shows that label as its main text, with its spelling beside it.
- **An approval comes with its outcomes.** Inserting an approval node on a connection adds an `approve` edge to the next step and a `reject` edge to a new "Rejected" end. Appending one adds "Approved" and "Rejected" ends. The canvas shows those labels in the designer's language. An approval missing either edge is reported in the Problems tab, on the node.
