---
'@objectstack/core': patch
---

fix(core): an activation switch never binds one of two package-less ledger rows for an item; the doors refuse it `409 RESOURCE_CONFLICT`, naming both rows

Clause-②: no
Metadata-protocol: none

`ObjectStoreMetadataActivationStore.setActive`, the one writer behind the flow toggle (`POST /automation/:name/toggle`), the action switch (`POST /actions/_activation/:object/:action`) and the security catalog switch (`POST /security/_activation/:type/:name`), used to update the first `sys_metadata_activation` row it found for the item and give it the package the switch names. On an item with two rows naming no package (rows stored while the package-less index did not stand), one click bound one of the pair: the next boot built the `uniq_sys_metadata_activation_packageless` index over what was left, the boot backfill stopped reporting the duplicate, and which switch applied was still picked by storage order.

The write now updates the one row it could mean and writes nothing when there is more than one. For the action and catalog switches (a store addressed by name), the rows it could mean are the ones the boot backfill reports for the same item: two or more naming no package, or one naming none beside the row of the package the switch names (and, with neither, two or more rows of other packages). For the flow toggle (a store addressed by package and name), they are the flow's package's own row, or, when that package holds the name alone and has no row yet, the rows naming no package it would take over: two or more of those are refused instead of the first being adopted. A flow switch never writes another package's row; it adds its own beside it, as before.

Who sees it: an administrator who switches such an item on or off. Every door answers `409 RESOURCE_CONFLICT` naming each row (id, package, switch) and the remedy: delete the row that should not apply from `sys_metadata_activation` (by the id named), then switch the item again. No row is bound, deleted or flipped, and nothing changes in process. An item with one row switches exactly as before, including a package-less row taking the package the switch names, and an item's one row of another package being re-addressed to it.
