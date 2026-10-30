---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a package rollback carries every item a revert step refused, and answers `success: false`

Clause-②: no
Metadata-protocol: none

`rollbackToPackageCommit` (`POST /packages/:id/rollback`) reverts each newer `apply` commit with `revertCommit`. A step that refuses an item — for example a restore of a row stored under a non-canonical type (`STORED_TYPE_NOT_CANONICAL`) — reports it in the step's own returned `failed[]` and does not throw. The rollback read only a thrown error, so it answered `success: true` with an empty `failed[]` for a package left half rolled back.

Each refused item now lands in the rollback's `failed[]` as `{ commitId, error }`: the commit it belongs to, and an `error` that names the item (`Item 'TYPE/NAME' was not reverted: ...`) and quotes the step's client-facing refusal text. `success` is false whenever `failed[]` is non-empty, which is what the declared answer (`RollbackToPackageCommitResponseSchema`) already says: "True exactly when nothing failed". The answer's shape is unchanged.

Nothing else moves. A refused item stops neither its commit nor the rollback: the other items of that commit are still reverted, its revert commit is still recorded, and the commit is still listed in `revertedCommits`. A step that throws still lands as one `failed[]` entry for its commit, and the rollback goes on to the next commit, as before.
