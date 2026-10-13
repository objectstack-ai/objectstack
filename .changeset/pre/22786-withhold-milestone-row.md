---
'@objectstack/plugin-audit': patch
---

A `sys_activity` row that an `activityMilestones` entry fired is withheld from a reader who is not served every field a declared milestone watches

Clause-②: no

A fired milestone's row speaks about its watched fields: its `type` and its summary come from the
milestone declaration, beside `metadata.kind`. Narrowing the row column by column left those two
columns speaking to a reader not served a watched field.

The row is now withheld from that reader as a row, on every read (`find`, `findOne`, `count` and
`aggregate`), by the same pre-scan and the same served-field answer that withhold an update whose
every recorded change the reader is not served. A list's total, its pages and a by-id read all
agree with the rows served.

- **A reader served every watched field** is served the row unchanged, with `metadata.kind`.
- **A reader withheld only fields no milestone watches** is served it too.
- **A row no milestone fired**, and a row an app writes itself, are unchanged.
- **If the pre-scan fails**, the read is denied rather than served unjudged.

Rows written before the CRUD mirror declared the watched fields carry no `metadata.kind`, so nothing
on them says a milestone fired; they are judged as before. Nothing you author changes: no key,
option, export or type is added or removed.
