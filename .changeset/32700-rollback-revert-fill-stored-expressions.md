---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': minor
---

fix(metadata-protocol): a rollback or revert that makes a changed stored computed field live fills the object's existing rows, as the save and publish doors do, and says so per field

Clause-②: yes (widening) — adds an optional `advisories` key to `RollbackMetaItemResponseSchema`, `RevertPackageCommitResponseSchema` and `RollbackToPackageCommitResponseSchema`
Metadata-protocol: added

`rollbackMetaItem` (`POST /api/v1/meta/:type/:name/rollback`), `revertCommit` (`POST /api/v1/packages/:id/commits/:commitId/revert`) and `rollbackToPackageCommit` (`POST /api/v1/packages/:id/rollback`) wrote the restored definition through to the registry with no storage sync and no fill, so a rollback that changed a stored computed field (a non-`formula` field declaring `expression`) left every existing row on the value the definition it rolled away from computed, or `NULL` for a field the rollback brought back. Totals, filters and reports read those values with no error anywhere.

These doors now sync the restored object's storage and run the same fill the save and publish doors run: each stored computed field the restore makes compute something new (added back, turned from a formula, given another expression, or handed back its owner's expression when a revert removes an object extension) is recomputed over the object's existing rows, and reported per field on the answer's new optional `advisories`, with the elements the save answer already carries (`stored-expression-filled`, `stored-expression-fill-incomplete`, `object-storage-sync-refused`). A package rollback carries every reverted commit's notices in step order. The key is omitted when there is nothing to report, so a clean rollback's or revert's answer is byte-identical to before.
