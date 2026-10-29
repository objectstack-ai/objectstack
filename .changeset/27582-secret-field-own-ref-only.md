---
'@objectstack/objectql': patch
---

fix(objectql): a non-system write to a `secret` field may only seal a new value or keep its own record's reference (#27582)

Clause-②: no
Metadata-protocol: none

- **The rule.** A `secret` field value that starts with `secret:` is read as a reference to a credential already stored, not as a credential. From any caller but the system principal, such a value is now accepted only when it is the reference that record's column already holds: on an update, every record the write lands on must already hold exactly that value, and the column is then left as it is, as an echoed read mask is. A create has no reference of its own, so it never takes one. Any other reference is refused with `VALIDATION_ERROR` / 400 before anything is written, and the answer is the same whatever the reference names.
- **Every engine write door.** The single and batch create, `insertMany` (the refused row is reported on its own and the others land), the by-id update and the predicate update, and so every REST door that writes through them (create, bulk, import, update).
- **Unchanged.** The system principal (`isSystem: true`: seed replay, migration) still stores such a value as given. A new value is sealed as before, `null` clears, the echoed mask changes nothing, and reads still mask.
