---
'@object-ui/permissions': patch
---

feat(permissions): `RecordFieldAccessScope` answers one record's field locks from the server's record-scoped projection

Clause-②: yes (widening)
Metadata-protocol: none

Below `RecordFieldAccessScope`, `checkField(object, field, 'write')` for the scoped record answers from the server's projection of that record wherever `/auth/me/permissions` reports a field-level lock. That reader holds no row, so it reports a lock that applies only from a stage onward (a field permission `when`) on every row; the scope replaces that one input with the write gate's verdict for the stored row. The object-grant fallback, the owner-transfer rule, `read` and `create`, and every other object keep the enclosing provider's answer. Until the answer arrives, and when there is none, the row-blind lock stands. When its `revision` prop moves (the row was saved or re-read), it asks again and the lock stands until the new answer lands. The client never evaluates `when`. A nested scope for the same record asks once.
