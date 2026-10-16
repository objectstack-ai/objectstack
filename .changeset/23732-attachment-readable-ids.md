---
'@objectstack/service-storage': minor
---

feat(service-storage): the `sys_attachment` read gate writes one `ReadableIds` leaf per parent object and does no pre-scan, so a broad read is judged over every row, not a 2,000-row window (ADR-0139 D4, D5)

Clause-②: yes

The gate serves an attachment only when the caller may read the record it is attached to. Until now each read first scanned at most 2,000 candidate rows as the system, then asked which of those rows' parent records the caller could read. Past that window the gate failed closed: the unscanned rows were left out, the list's `total` agreed with the short answer, and a warning said so.

The gate now writes one branch per object the metadata registry holds (except `sys_attachment` itself): `{ parent_object: P, parent_id: { $in: ReadableIds.of(P) } }`. The engine composes the leaf from the security service's `canReadObject` and `getReadFilter` for `P`, and the SQL drivers evaluate it as one subquery against `P`'s table, inside their own tenant wall. A list, its `total` and a grouped count are each one statement over every row the caller may read. A parent object the caller may not read is answered with no rows, without reading it as the caller, so no denial is logged for it.

What a reader sees:

- A broad read of `sys_attachment` is served every attachment whose parent record the caller may read, with a true `total`, whatever the table size. An attachment whose parent the caller may not read, whose parent no longer exists, or that names no parent is still never served. A read scoped to one record (the attachments panel) is unchanged.
- Three classes still read through the bounded probe, chosen before any leaf is written: a delegated (on-behalf-of) caller; a parent an object-scoped read middleware narrows (for example `sys_comment`, `sys_comment_reaction`, `sys_activity` and `sys_audit_log`); and a parent bound to another datasource than `sys_attachment`. The whole read also stays on the probe when the security service offers no `canReadObject`, or when none is registered.
- A read whose probe finds no candidate row is now narrowed to no rows rather than left unfiltered. It served nothing before either.
- On a driver that does not compile the leaf (`driver-mongodb`), a read of `sys_attachment` now fails with `INTERNAL_ERROR` / 500 naming the driver and the leaf, instead of serving a capped list. The gate does not turn that refusal into an empty answer. This is ADR-0139's ruled behaviour until a pipeline form is measured for that driver.

For a host that installs the gate itself: `installAttachmentReadVisibility(engine, logger, getAdmission?)` takes an optional third argument that resolves the security service on every read. `StorageServicePlugin` passes it. A call without it keeps every read on the bounded probe and says so once.
