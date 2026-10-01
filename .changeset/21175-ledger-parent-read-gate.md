---
'@objectstack/plugin-audit': minor
---

fix(plugin-audit)!: a read of the compliance ledger returns only the rows about records the caller can read, the same way a read of the activity stream is narrowed (#21175)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a narrowing of what a READ returns, on one platform object, decided at request time: a sys_audit_log row that names a record (object_name, record_id) is served to a caller exactly when that caller's own engine read of the record finds it. No authorable key, spelling, value domain, export or stored metadata shape moves: the sys_audit_log object definition is byte-identical, every query shape parses as before, the package barrel exports nothing new and nothing less, and no stored row is rewritten. There is therefore nothing for an author to convert and nothing for `objectstack migrate meta` to reach. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a read-visibility rule and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a published TypeScript declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what a read of `sys_audit_log` returns to every caller that is not system context, admins included. Some rows an admin was served before are no longer served. It ships as `minor` under the repo's launch-window convention for narrowings.

**What changes.** `AuditPlugin` now mounts the activity stream's parent-record read gate on the compliance ledger. It is an engine middleware, so it narrows `find`, `findOne`, `count` and `aggregate`, which on the generic data doors are the list, its `total`, the by-id read and both query shapes. A ledger row that names a record (`object_name`, `record_id`) is returned only when the caller's own engine read of that record finds it, so the parent object's sharing, RLS and object-level permissions decide. Parent reads are batched, one per parent object. The gate's mechanism is one module shared with the activity stream's gate.

**Rows no longer served:**

- to a caller who cannot read the record a row is about: that row;
- to every caller that is not system context, admins included, because the gate has no readable record to judge them by:
  - a row about a record that no longer exists: every `delete` row, and every other row about a deleted record;
  - a sign-out row, and a sign-in row whose session has since been removed (sign-out removes the session the row names);
  - a create, read, update or delete row that names no record, a row naming an object the engine does not know, and a row naming the ledger itself.

**Unchanged.** The rows stay stored, and system-context reads still return every row. Rows about no record are served as before, under the ledger's own grant: `config_change` rows, the run-level user-import row, the platform-admin standing rows, and an auth event that carried no session id. A caller who can read a record keeps every row about it, and the field-level redaction of the before/after snapshots applies to the rows that are served, as before. A broad read whose pre-scan reaches the gate's 2,000-row bound fails closed and logs a warning, as the activity stream's does.

**Migration.** No metadata, code or configuration change is needed. A view or report that lists deletions or sign-outs from `sys_audit_log` through the data API now shows fewer rows. A server-side job that must read every ledger row reads it under system context, which this gate does not narrow.
