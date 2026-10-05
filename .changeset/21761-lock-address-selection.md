---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: an item's lock is the strictest lock among the stored rows in scope for its address, at the write doors and on both reads (#21761)

Clause-②: no (narrowing)

ADR-0048 lets one item (type, name, organization scope) hold several stored `sys_metadata` rows: one per package (`?package=` saves) and a package-less one. The ADR-0010 `_lock` gate asked for the item with no package and bound whichever row the store returned first, while `getMetaItem` and `getMetaItemLayered` naming a package reported that package's row. So a read and the door could state two different locks for one item, and the door's answer depended on row order.

Now every caller selects the lock from the item's address through one function: the strictest lock among the item's stored rows in scope. The scope is ADR-0005's (the organization's rows when it holds any row of the item, else the env-wide rows), and within it every row of the item counts, whichever package it is bound to. The strictest lock refuses a write when any of those rows refuses it, and a delete likewise; two rows that refuse different verbs (`no-overlay` and `no-delete`) give `full`. Both reads report that lock in `lock`, `editable` and `deletable`, the served body carries its `_lock` family, and the list item and the `getMetaDiagnostics` locked count follow it. Content stays prefer-local: a read naming a package is still served that package's own row.

**What moves for consumers.** The door now refuses where it used to depend on which row the store returned first:

- a package-less row declaring no lock and a package's row declaring `full`: a save or delete, with or without `?package=`, is refused `403 ITEM_LOCKED` in every row order, where it was admitted when the package-less row came back first;
- a package's row declaring `none` and a package-less row declaring `full`: refused in every row order, where it was admitted when the package's row came back first. A package row's explicit `none` is not a grant over another row's lock;
- two rows refusing different verbs (`no-overlay`, `no-delete`): both a save and a delete are refused, where each was admitted under the row order that bound the other row;
- another package's row of the same name declaring a lock binds a save naming this package too, as it did under the row order that returned it first.

No write the door refused before is admitted now. Both reads become stricter in exactly those arrangements: a read naming a package whose own row declares `none` now reports `editable: false` when another row in scope declares `full`. No key, export, status or error code changes.

<!-- adr-0087: not-required (no-migration-prescription) the write doors refuse, by the strictest lock among the stored rows in scope, writes they used to admit when the store returned a looser row first. No authorable key, spelling, export or stored shape moves: every stored row keeps parsing, nothing is read or rewritten at rest, and which row an administrator meant to lock is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the lock gate (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
