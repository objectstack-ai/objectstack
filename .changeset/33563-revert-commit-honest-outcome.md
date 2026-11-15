---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `revertCommit` answers only what the running process acted on

Clause-②: no
Metadata-protocol: none

`revertCommit` now reports an item whose row was written but whose next step did not land in `failed[]`, not `reverted[]`, and the answer's `success` is `false`. The steps are: the runtime registry refusing the restored object, its storage not following the restored body (the `object-storage-sync-refused` advisory stays on `advisories`), the mutation projector failing, and any step after the row write throwing. The entry names the row state ("its row was restored to the body of version N", or "its row was removed from sys_metadata") beside the step that failed, and quotes no driver text. The revert's own commit still records the row change. Before, each of these answered `success: true` with the item in `reverted[]`, against the method's own contract ("a revert that answers `success: true` is one the running process has already acted on"). `rollbackToPackageCommit` carries each such item into its own `failed[]` and answers `success: false`.

A write-through fault the registry helper only logs (every metadata type other than `object`) is still not seen by the revert.

A revert is now itself revertible, as ADR-0067 D3 says. The revert's own commit records, for each row it changed, the version that row held before the revert, so reverting the revert brings that body back, and an item the revert removed is written again. An item recorded as existing before the commit but carrying no version to restore, which is how every revert commit recorded by an earlier release records the items it restored, is named in `failed[]` with nothing written. Before, it was skipped: it appeared in neither `reverted[]` nor `failed[]`. To undo such an older revert, restore each item from its own version history (`GET /api/v1/meta/:type/:name/history`, then `POST /api/v1/meta/:type/:name/rollback`).
