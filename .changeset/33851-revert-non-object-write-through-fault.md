---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `revertCommit` reports a restored item of any type whose registry write-through faults

Clause-②: no
Metadata-protocol: none

`revertCommit` now puts a restored `view`, `permission`, `object_extension` or other non-object item into `failed[]` when the runtime registry write-through for its restored body throws, and the answer's `success` is `false`. The entry names the row state ("its row was restored to the body of version N") beside the registry's reason, and carries the reason's `code` where it declares one, the same way a refused `object` has been reported since the previous change to this door. Before, the write-through's non-object branches (the overlay hydration, and the `object_extension` registration) only logged the fault at `warn`, so such a revert answered `success: true` with the item in `reverted[]`, while the process kept serving the body the revert replaced. `rollbackToPackageCommit` carries each such item into its own `failed[]` and answers `success: false`.

This replaces, for the restore limb, the line in the note on the previous change to this door that says such a fault "is still not seen by the revert".

Save and publish do not change. They do not ask the write-through for these faults: under the same fault, `saveMetaItem` and `publishMetaItem` of a non-object item still answer success with no advisory, and the fault is still the same `warn` line in the server log.

Not changed: on the soft-remove limb (an item the reverted commit created), a stop of the registry heal is still only logged at `error`, and the item is still reported as `removed`.
