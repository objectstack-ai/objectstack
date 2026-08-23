---
"@objectstack/service-storage": patch
"@objectstack/cli": patch
---

feat(storage): report-only inventory for stranded `sys_file` orphans, plus `os storage orphans` (#10950)

The tombstone repairs in #10171 (update verb) and #10240 (delete verb) are forward-only:
they changed what the next write does and touched no row already written. Every
attachments-scope file orphaned before them still sits at `status='committed'` with
`deleted_at` NULL and no `sys_attachment` join row — and `sys_file`'s declared lifecycle
nominates a sweep candidate only via `ttl { field: 'deleted_at' }` or
`retention { onlyWhen: { status: 'pending' } }`, so such a row matches **neither**. It is
never a candidate, the reap guard is never asked about it, and its bytes are never
reclaimed. The leak is permanent rather than late.

This ships the measurement half only, per the maintainer's ruling on #10950:

- `inventoryStrandedFileOrphans()` — a read-only reconciliation pass that walks
  attachments-scope committed `sys_file` rows and reports how many are stranded, their
  byte magnitude, and why each excluded row was excluded. `formatStrandedOrphanInventory()`
  renders it; both are exported from `@objectstack/service-storage`.
- `os storage orphans` — the operator-invoked surface, with `--json` for a machine-readable
  payload. There is no `--apply` and no write path, deliberately.

**It writes nothing, tombstones nothing and deletes nothing.** Authorising the destructive
backfill is a separate decision that these numbers exist to inform; a tombstone written
here would start a 30-day clock ending in an irreversible byte delete.

The ownership question is not reimplemented. `createSysFileReapGuard`'s "is anything still
holding this file?" test — zero `sys_attachment` join rows **and** empty `ref_*` ownership
columns — is extracted as `findFileHolder()` and called by both the guard and the
inventory, so "the same question, never a weaker one" is a property of the code rather
than a claim in a comment. A file with zero join rows that is `ref_*`-owned (ADR-0104 /
#3459) is a live file and is excluded from the count.

Behaviour of the reap guard is unchanged — the extraction is a pure refactor, and the
guard's existing pins cover it. Both counts are labelled `attachments` scope: files in the
other scopes are governed by the field-reference seam and are reconciled by
`verifyFileReferences`, which skips attachments-scope files, so the two passes partition
the population rather than overlapping.
