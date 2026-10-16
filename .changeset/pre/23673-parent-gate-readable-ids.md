---
'@objectstack/plugin-audit': minor
---

feat(plugin-audit): the `sys_activity` and `sys_audit_log` read gates write one `ReadableIds` leaf per parent object and do no pre-scan, so a broad read is judged over every row, not a 2,000-row window (ADR-0139 D4, D5)

Clause-②: no

Both gates serve a row only when the caller may read the record it is about. Until now each read first scanned at most 2,000 candidate rows as the system, then asked which of those rows' parent records the caller could read. Past that window the gate failed closed: the unscanned rows were left out, the list's `total` agreed with the short answer, and a warning said so.

Each gate now writes one branch per object the metadata registry holds (outside the audit writer's excluded objects and the gated object itself): `{ object_name: P, record_id: { $in: ReadableIds.of(P) } }`. The engine composes the leaf from the security service's `canReadObject` and `getReadFilter` for `P`, and the SQL drivers evaluate it as one subquery against `P`'s table, inside their own tenant wall. A list, its `total` and a grouped count are each one statement over every row the caller may read. A parent object the caller may not read is answered with no rows, without reading it as the caller, so no denial is logged for it.

What a reader sees:

- `sys_audit_log`: a broad read is served every row about a record the caller may read, and every row about no record, with a true `total`, whatever the table size. The rows about no record (`config_change`, `import`, `platform_admin_standing_change`, an auth event with no session) are now a filter on the ledger's own columns rather than a list of ids the scan saw. A holder of `view_all_audit_log` is still not narrowed. A row about a session is still served when that session is readable.
- `sys_activity`: the gate itself has no window any more, but the stream's withheld-update rule still pre-scans 2,000 rows as the system, so a broad read stays bounded by that rule until it becomes a predicate (ADR-0139 E6). A read about one record is unchanged.
- Three classes still read through the bounded probe, chosen before any leaf is written: a delegated (on-behalf-of) caller; a parent an object-scoped read middleware narrows (for example `sys_attachment`, `sys_comment_reaction`, `sys_approval_request` and the settings objects); and a parent bound to another datasource than the gated object, which covers every parent on a deployment that registers the `telemetry` datasource. The whole read also stays on the probe when the security service offers no `canReadObject`, or when none is registered, as before.
- On a driver that does not compile the leaf (`driver-mongodb`), a read of either object now fails with `INTERNAL_ERROR` / 500 naming the driver and the leaf, instead of serving a capped list. The gates do not turn that refusal into an empty answer. This is ADR-0139's ruled behaviour until a pipeline form is measured for that driver.
