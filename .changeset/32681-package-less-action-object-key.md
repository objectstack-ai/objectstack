---
'@objectstack/metadata': patch
---

fix(metadata)!: `DatabaseLoader` keys a package-less action row bound to an object per `(object, name)`, as the in-memory store does, so a package-less save is the customization of the one package binding the name to that object, and never a row of a package that binds it elsewhere (#32681)

Clause-②: yes (narrowing) — narrowed: on a host that wires a `DatabaseLoader` (none in the workspace), a package-less `action` save bound to an object that a package binds the name to only elsewhere is stored as the environment's own row, where it was stored as that package's row bound to the object, so an address naming that package reached a binding it never declared. Widened: none.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row is rewritten: what moves is which existing row a new save writes, and which package a slot read files a stored package-less row under, so there is nothing for `objectstack migrate meta` to rewrite. Rows earlier saves wrote stay as stored. -->

**BREAKING** for one kind of host: a host that wires a `DatabaseLoader`, where package BETA binds an action name to `contact` and nobody binds it to `account`, now stores a package-less save of that name on `account` as the environment's own row. A read naming BETA no longer reaches the `account` binding that save wrote; save it as BETA's (`_packageId`) if it is BETA's.

What moves, for `action` (seat ruling A on #32681, ADR-0150 D4), with ALPHA and BETA two packages:

- `DatabaseLoader.save` of a package-less body bound to an object counts the holders of its `(object, name)`, FROM the holders of its name:
  - ALPHA binds the name to `account`, BETA to `contact`: a package-less save on `account` updates ALPHA's `account` row (its customization), FROM a new package-less row beside it.
  - BETA binds it to `contact` alone: a package-less save on `account` is a new package-less row, FROM a new BETA row bound to `account`.
  - ALPHA binds it to `account` alone: a package-less object-less save is a new package-less row, FROM a new ALPHA object-less row.
  - A package-less row on `o1`, then a package's save on `o2`: the package's own new row, and the `o1` row keeps its column, FROM the package's save taking the row over.
- `DatabaseLoader.save` of a package's first body on an object takes over a stored package-less row of that `(object, name)`, as the in-memory store's first package item takes over the bare slot: BETA binds the name to `contact` and a package-less row is on `account`, ALPHA's first `account` save updates that row, FROM a third row beside it.
- `DatabaseLoader.loadManySlots` (and `loadSlots`) hands on a stored package-less row bound to an object that exactly one package binds the name to, under a name two or more packages hold, held for that package, FROM held for none. So with no boot pass, a read naming ALPHA (`MetadataManager.get`) answers the package-less `account` row, and `list('action')` lists it alone in ALPHA's slot, FROM ALPHA's own row (and both rows), as after the pass. The row is not rebound.

Not changed: types other than `action`; how the boot pass files the rows it reads (the unscoped plural read the pass registers still folds a package-less row into the name's one holder by name, so beside BETA's `contact` binding alone a read naming BETA after the pass still answers the package-less `account` row; that half follows #32680's keyed-entry stamping); and stored rows (no migration; rows earlier saves wrote are listed by the ADR-0150 D10 report as before).
