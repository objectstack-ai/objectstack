---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity row serves a parent field's value only to a reader the security service serves that field (#21081)

Clause-②: no

The activity stream's CRUD mirror composes each row once, at write time, as the system. The row's summary, its record label and its recorded change can carry the values of the parent record's fields. The activity read gate keeps a row for every reader who can read the parent record, so a reader who may not read one of that record's fields was served the field's stored value through the row. This held for a field served masked to the reader, a field gated by `requiredPermissions` the reader does not hold, and a field a permission set the reader holds marks non-readable. The data plane answered the same reader masked or without the key.

The rows are now redacted at read time, keyed on the reading caller, through the security service's own answer: the read projection intersected with the query-side answer, whose difference the contract defines as exactly the fields served masked. The recorded change drops every key the reader is not served. The summary and the record label are each served whole or dropped whole: the mirror now declares, in the row, which parent fields each was composed from, and a text composed from a field the reader is not served is dropped. A text composed only from served fields is kept. The full row stays at rest, and system reads are unchanged.

Rows written before this release carry no such declaration. Their summary and record label are served only to a reader who is served every field of the parent record, until the rows age out with the stream's retention. Rows an app writes itself are served as written, except that a recorded change in the mirror's shape is narrowed the same way.
