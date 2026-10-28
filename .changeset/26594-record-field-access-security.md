---
'@objectstack/plugin-security': minor
---

feat(plugin-security): `getRecordFieldAccess` — a record's field projection from the write gate's own verdict

Clause-②: yes (widening)
Metadata-protocol: added

The `security` service answers `getRecordFieldAccess(object, recordId, context)`. It reads the row as the caller reads it (the reader the write gate's pre-image comes from) and asks the field-level write gate itself, `computeForbiddenFieldWrites`, for an update of that row naming every field, over the same permission sets, posture and delegator intersection the gate takes. A field permission whose `when` names only some rows therefore locks the field only on those rows, and the answer cannot disagree with a write of that row. A row that is absent or unreadable answers `null`. `getWritableFields` and every other row-less reader are unchanged and still apply each row-conditioned entry as its lock.
