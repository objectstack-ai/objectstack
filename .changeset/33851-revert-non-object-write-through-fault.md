---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `revertCommit` reports an item of any type whose registry write-through or heal faults

Clause-②: no
Metadata-protocol: none

`revertCommit` now puts a restored `view`, `permission`, `object_extension` or other non-object item into `failed[]` when the runtime registry write-through for its restored body throws, and the answer's `success` is `false`. The entry names the row state ("its row was restored to the body of version N") beside the registry's reason, and carries the reason's `code` where it declares one, the same way a refused `object` has been reported since the previous change to this door. Before, the write-through's non-object branches (the overlay hydration, and the `object_extension` registration) only logged the fault at `warn`, so such a revert answered `success: true` with the item in `reverted[]`, while the process kept serving the body the revert replaced. `rollbackToPackageCommit` carries each such item into its own `failed[]` and answers `success: false`.

A removed item is reported the same way. When the revert soft-removes an item the reverted commit created and the registry heal after the removal stops (a registry throw, or the registry refusing a row of the item still stored under another package), the item goes into `failed[]` naming "its row was removed from sys_metadata" and that the registry may still serve the removed row, with the reason and its `code`. Before, the heal's stop was only an `error` line in the server log, and the item answered `removed`. The `error` line is unchanged.

This supersedes the sentence of the note on the previous change to this door that says a write-through fault of every type other than `object` "is still not seen by the revert": after this change, the revert sees it, and a stopped heal too.

Save, publish and delete do not change. Save and publish do not ask the write-through for these faults: under the same fault, `saveMetaItem` and `publishMetaItem` of a non-object item still answer success with no advisory, and the fault is still the same `warn` line in the server log. `deleteMetaItem`, a publish's undo and a peer's convergence ignore the heal's answer, so a stopped heal still answers what it answered before there, with the same `error` line.
