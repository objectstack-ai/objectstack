---
"@objectstack/plugin-audit": patch
---

fix(plugin-audit): stop mirroring chunked-upload progress into the audit ledger (#5202)

`SKIP_OBJECTS` in `audit-writers.ts` excludes operational telemetry / plumbing
from `sys_audit_log` and `sys_activity` — ADR-0057 decision 5, *"stop the
amplifier"*. `sys_upload_session` was the second table missing from group (2)
for the same reason `sys_job_queue` was (#5193): it declares
`lifecycle.class: 'transient'` and its own object comment says what the rows are
worth — *"an upload session is ephemeral state, never business truth"*
(ADR-0057 / #2970 item 4) — but nothing connected that declaration to the
exemption list, which is hand-written.

The audit hooks register for **all** objects and there is no "writes made under
a system context are not audited" exemption, so `StorageMetadataStore`'s own
writes were recorded like user edits. A chunked upload of N parts costs 1 + N
writes — the `createSession()` insert plus one `updateSession()` per chunk — and
then a terminal status update and the row's removal, each producing an
`sys_audit_log` **and** an `sys_activity` row: 2 × (1 + N) rows for one file,
with a `beforeUpdate` snapshot read apiece. Each of those rows was also unusually
fat, because `updateSession()` writes the merged **full** record, so the `parts`
JSON blob that grows with every chunk rode along in each diff's `old_value` /
`new_value`.

Nothing else changes: the exemption is one name in one list, and ordinary
business objects are audited exactly as before. In particular `sys_file` stays
audited — it declares `transient` too, but only to reap tombstones and
unfinished uploads; its rows are mostly permanent business truth and keep their
compliance value.

Operators who tracked upload activity through `sys_activity` should read
`sys_upload_session` (in-progress state) and `sys_file` (the durable record of
what was actually stored) instead.
