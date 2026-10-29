---
'@objectstack/objectql': patch
---

fix(objectql)!: a non-system write to a `secret` field may only seal a new value or keep its own record's reference (#27582)

Clause-②: no (narrowing) — a non-system write to a `secret` field refuses a value already spelled `secret:` unless it is the reference that record's column already holds (so a create always refuses one), where it stored such a value as given before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a write value the engine used to store as given is refused unless it is the record's own reference. The fix for a caller is to send the secret's value, write null, or omit the field, which the refusal says; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing in the credential write path (`@objectstack/objectql`), served by every engine write door and every REST data door that writes through one.

- **Before.** A `secret` field value that starts with `secret:` is read as a reference to a credential already stored, not as a credential. Such a value was stored as given, from any caller, on a create or an update.
- **Now.** From any caller but the system principal, such a value is accepted only when it is the reference that record's column already holds. On an update, every record the write lands on must already hold exactly that value, and the column is then left as it is, as an echoed read mask is. A create has no reference of its own, so it never takes one. Anything else is refused with `400 VALIDATION_ERROR`, naming the object and the field and never the value, before any credential row or record is written. The answer is the same whatever the reference names. This holds on the single and batch create, `insertMany` (the refused row is reported on its own and the others land), the by-id update and the predicate update, so on every REST door that writes through them: create, bulk, import and update.
- **Unchanged.** The system principal (`isSystem: true`: seed replay, migration) still stores such a value as given. A new value is sealed as before, `null` clears, an echoed read mask changes nothing, and reads still mask. The Console's password field sends back the mask it read, so the form round trip is unaffected.
- **Who sees it.** A caller without the system context (an API client, an import, a hook or script) that sends a `secret:` value to a `secret` field other than the reference that record already holds.

**The remedy.** To set the secret, send its value; to clear it, write `null`; to keep it, omit the field or echo the read mask.
