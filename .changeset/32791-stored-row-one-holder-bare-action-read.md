---
'@objectstack/metadata': patch
---

fix(metadata): a stored package-less row the boot pass files under the host's package is one holder of an action name, not two, when a read naming no package is judged over the loaders (ADR-0150 D4)

Clause-②: no — the fix removes a refusal ADR-0150 D4 already denies ("A package-less row that bears a package-held name is a customization, never a second item. … it never arms beside the item it shadows (E1) and never makes the name ambiguous."), and the refusal it removes is #32560's, which has not shipped: the refusal and its removal first ship in the same release, so no released accept set widens. On a host that declares its package, after the boot priming pass and before any write that carries no package, `MetadataManager.get('action', NAME)` and `getDiagnosed` of a name one package holds beside a package-less stored row saved last go from `409 RESOURCE_CONFLICT` naming the host's package to the package-less row, that package's customization (or the environment's own item where the package binds the name to another object); beside two packages the `409` no longer names the host's package.
Metadata-protocol: none — no key, value or metadata type an author writes changes; what moves is how many holders a read naming no package counts for one stored row.

On a host that declares its package (`MetadataPlugin`'s `packageId`), the boot priming pass stamps a package-less `sys_metadata` row with the host's package before it registers it, so the registry holds that row in the host's slot. A read naming no package of an action name is judged over the registry's slots and the loaders' stored slots together (#32560), and the loaders still store that row package-less: the one row was counted twice, once as the host's package and once as the environment, and the refusal named a holder that does not exist.

The judged view now files such a row (an item a stored-row loader, `datasource:`, handed out for no package, held in the registry slot of the package it is stamped with, whose registration replaced no item registered in memory or by code, while a loader still stores it) the way the store files a write that carries no package: in the slot of the name's one package holder, as its customization, or else in the bare slot, as the environment's own item. It keeps the write order of the registry slot it came from, and that slot is not counted beside it.

Moved, all `action`, every read naming no package (`get` and `getDiagnosed` agree); FROM is `main` with #32676:

| Host declares | Rows of `helper` (save order); items in memory | FROM | TO |
|:--|:--|:--|:--|
| another package | ALPHA's row, a package-less row | `409` host, ALPHA, environment | the package-less row |
| another package | ALPHA's row on an object, a package-less row on the same object | `409` host, ALPHA, environment | the package-less row |
| another package | ALPHA's row on an object, an object-less package-less row; or ALPHA's object-less row, a package-less row on an object | `409` host, ALPHA | the package-less row (the environment's own item) |
| another package | ALPHA's rows on two objects (either order), a package-less row on one of them; or ALPHA's object-less row and its row on an object (either order), an object-less package-less row | `409` host, ALPHA, environment | the package-less row (written last) |
| another package | a package-less row; ALPHA's item in memory, before or after the pass | `409` host, ALPHA, environment | the package-less row |
| another package | BETA's row and a package-less row, ALPHA's item in memory before the pass; or a package-less row, and ALPHA's and BETA's items in memory (both before the pass in either order, or ALPHA's before and BETA's after) | `409` ALPHA, host, BETA, environment | `409` ALPHA, BETA, environment |
| ALPHA | a package-less row; another package's item in memory before the pass | `409` that package, ALPHA, environment | the package-less row |

Unchanged: a host that declares no package; every two-package stored composition; the package's row saved last; every read that names a package; every other type stored per `(package, name)` (their bare read reads the registry alone); a host's own item registered in memory after the pass, which is still a holder; an unstamped row the registry filed in its one holder's slot (that holder's customization); a stamped row whose registration replaced an item the host's package held in memory before the pass, which leaves that package a holder (beside a second package's row or item the read is still refused, naming both and the environment; beside none it answers the row), and a repeated priming pass keeps the overwrite mark: the pass run again on the same manager hands out a new row object, which carries the mark of the row it replaces, so these compositions answer the same after it; and the row removed from the table behind the manager, after which the host's slot is a holder again. The candidates a refusal names are a set: their order follows the judged view and is not promised.

Scope: this holds in the boot state. After a write that carries no package (`register` or `registerInMemory` of the name), the registry files the written body in the host's slot and the bare read names the host's package again, as on `main` (#32812). A removal naming no package is judged without this filing and is still refused naming the host's package, so in these compositions the read and the removal do not count the same holders until #32813.

No first-party composition wires a `DatabaseLoader` under a host that declares its package, and none registers an `action` in memory, so no answer changes in this repository.
