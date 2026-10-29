---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: a datasource create may not name a stored credential reference; it stores only the one its own secret is bound under (#27722)

Clause-②: no (narrowing) — the datasource admin door's create refuses a draft that names `external.credentialsRef`, where it stored the value as given before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a create draft value the admin door used to store as given is refused. The fix for a caller is to send the credential as `secret` and leave the key out, which the refusal says; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the datasource admin door's create (`POST /api/v1/datasources`, `IDatasourceAdminService.createDatasource`), the same rule #27582 set for `secret` fields: a write may only seal a new value or keep its own record's stored reference.

- **Before.** A create draft's `external.credentialsRef` was stored as given, beside or instead of the reference a supplied `secret` is bound under.
- **Now.** A create has no stored reference of its own, so a draft that names `external.credentialsRef` is refused with `400` before anything is written: no record, no secret, no pool. The message names the key and never the value, and the answer is the same whatever the value names. The only reference a create stores is the one its own `secret` is bound under.
- **Unchanged.** An update keeps the record's own reference unless a supplied `secret` rewraps it, as before. A create with a `secret` and no `external.credentialsRef` binds it as before. The Console's datasource form never sends the key, so it is unaffected.
- **Who sees it.** A caller of the admin door's create that sends `external.credentialsRef`.

**The remedy.** Send the credential as `secret` and leave `external.credentialsRef` out; the door binds it and stores the reference.
