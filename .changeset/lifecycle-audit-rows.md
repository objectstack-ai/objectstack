---
'@objectstack/metadata-protocol': patch
---

Record the whole metadata lifecycle in the audit trail, not only `save`.

`publishMetaItem` and `rollbackMetaItem` reached `recordMetadataAudit` only
through `assertLockAllowsWrite`, which writes a row on the **deny** path and
returns before any write on allow — so a *refused* publish was audited and a
*successful* one was not. The 409 `METADATA_CONFLICT` refusal is raised outside
that helper and wrote nothing either, leaving a caller who repeatedly lost an
optimistic-concurrency race indistinguishable, in the trail, from one who never
tried.

A successful publish now writes an `operation: 'publish'` row and a successful
rollback an `operation: 'rollback'` row, both `outcome: 'allowed'`, in the same
position and shape as the existing `save` and `delete` rows. All four routes
that can raise the 409 (save, publish, rollback, delete) now write one
`outcome: 'denied'`, `code: 'metadata_conflict'` row through a single shared
helper. Audit writes remain best-effort: a failing audit table logs and never
fails the underlying operation.

Batch `publishPackageDrafts` is deliberately unchanged — it promotes drafts
inside one `engine.transaction()`, where an audit row would roll back with the
batch rather than record the attempt, which is a different contract from the
sites above. Tracked separately.
