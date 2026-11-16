---
'@objectstack/objectql': patch
---

fix(objectql): a roll-up summary field that a package install or upgrade adds is computed on the rows stored before it

Clause-②: yes (widening)
Metadata-protocol: none

A `summary` field that an upgrade adds, for example through `objectExtensions`, used to read `null` on every parent row stored before the upgrade, until one of that parent's children was written. A parent created after the upgrade read `0` for the same empty child set.

`ObjectQL.syncSchemas()` is the sync an install door runs after its hot register, as `MarketplaceInstallLocal` does. It now computes those new roll-ups on every stored row that still holds `NULL`. It uses the aggregate and the system-context parent `update` that the child-write recompute uses. No child row is written, and the rows of every organization are covered. After the upgrade, a pre-existing parent reads what a new parent with the same children reads. For an empty child set that is `0` for `count`/`sum` and `null` for `min`/`max`/`avg`.

The engine records the roll-ups it serves when the boot completes (`kernel:bootstrapped`). Only roll-ups added after that are walked, so a second upgrade that adds none reads and writes nothing for roll-ups. A walk that fails on a row, cannot read an object, or reaches its per-object bound is logged at `error` and is not recorded. The next install's sync walks it again and fills only what is still `NULL`. `os migrate summary-nulls --apply --recompute-undefined-on-empty OBJECT.FIELD` finishes it from the command line.

A roll-up that arrives with a restart rather than through an install door is not walked. This covers a code-defined app's new version and a marketplace install whose hot register failed and loads at the next restart. There, `os migrate summary-nulls --apply` remains the backfill.

New engine members: `ObjectQL.materialiseAddedSummaries()` (re-run it after clearing a logged failure) and `ObjectQL.sealSummariesMaterialisedAtBoot()`, which the ObjectQL plugin calls.
