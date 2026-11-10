---
'@objectstack/core': patch
'@objectstack/objectql': patch
---

fix(core, objectql): the activation ledger's package backfill binds no row of an item that has more than one, so the package-less index keeps refusing until an operator deletes the duplicate

Clause-②: no
Metadata-protocol: none

The boot-time package backfill of `sys_metadata_activation` no longer gives a package to a row while the item it switches has another row: two or more rows naming no package, or one naming none beside one that already names the item's package. Before, it bound the first-stored of two package-less rows. That let the `uniq_sys_metadata_activation_packageless` index build over the pair on the next boot, so the duplicate was never reported again and which switch applied was picked by storage order; and the second write's unique-key refusal stopped the whole pass, so no row stored after the pair was ever bound, on that boot or any later one.

Who sees it: an operator whose database holds such an item reads one `error` line per boot naming the item, the package that holds it and each of its rows (id, package, switch), with the remedy: delete the row that should not apply from `sys_metadata_activation`, then restart, and the next boot binds the row left. Nothing is deleted automatically, the package-less index keeps refusing until then, and every other row is still bound.

A row whose write fails is now named in one `warn` line with its error, and the rows after it are still bound. The line saying the backfill stopped now appears only when the ledger could not be read or a holder could not be resolved, which happens before any row is written, and it says no row was written. `backfillActivationLedgerPackages` returns both cases in two new report fields, `duplicated` and `failed` (`ActivationLedgerDuplicateRow` names one row of a duplicated item).
