---
'@objectstack/metadata': patch
---

fix(metadata)!: the unscoped plural read counts an action name's holders per `(object, name)`, so a package-less row bound to an object no package binds the name to is the environment's own entry and the boot priming pass registers it beside the holder's, never in its place (#32681)

Clause-②: yes (narrowing) — narrowed: on a host that wires a `DatabaseLoader` (none in the workspace), where one package binds an `action` name to one object (or holds it object-less) and a package-less row binds it to another object (or object-less), after the boot priming pass a read naming that package (`MetadataManager.get`) answers the package's own item, where it answered the package-less row when that row was saved last (a binding the package never declared). Widened: after the pass the registry holds both items, where it held the one saved last alone; `MetadataManager.loadMany`, `loadManyKeyed` and `DatabaseLoader.loadManyKeyed` hand on both entries, where they handed on one.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row is rewritten: what moves is which stored rows an unscoped plural read keeps apart, which the boot pass then registers, so there is nothing for `objectstack migrate meta` to rewrite. Rows stay as stored. -->

**BREAKING** for one kind of host: a host that wires a `DatabaseLoader`, where package ALPHA binds an action name to `account` and a package-less row binds the same name to `contact`, now answers ALPHA's own `account` item to a read naming ALPHA after the boot, instead of the `contact` row. Read the `contact` row with no package, or save it as ALPHA's (`_packageId`) if it is ALPHA's.

What moves, for `action` (seat ruling A on #32681, ADR-0150 D4), with ALPHA and BETA two packages and `approve` the action name:

- `pluralEntryKeys` (the key `MetadataManager.loadMany`, `MetadataManager.loadManyKeyed` and `DatabaseLoader`'s unscoped reads keep one entry per) folds an entry that carries no package into the name's one holder only when that holder binds the name to the entry's own object (or both are object-less), FROM whatever object either was bound to:
  - ALPHA on `account`, a package-less row on `contact`: two entries, FROM one (the row saved last). After the boot pass the registry holds `ALPHA|account>approve` and `contact>approve`, FROM `contact>approve` alone (package-less row saved last) or ALPHA's key alone (saved first); a read naming ALPHA answers ALPHA's `account` item, FROM the `contact` row when that row was saved last; `/actions/account/approve` judges and runs ALPHA's item, and `/actions/contact/approve` the environment's.
  - BETA on `contact` alone, a package-less row on `account`: two entries, FROM one. After the pass a read naming BETA answers BETA's `contact` item, FROM the `account` row when that row was saved last; `/actions/contact/approve` finds BETA's declaration, FROM none.
  - ALPHA on `account` and a package-less object-less row, or ALPHA object-less and a package-less row on `account`: two entries, FROM one, the same way.
- Every read after the pass now answers what the same read without the pass answers for each shape above.

Not changed: a name one package holds on one object beside a package-less row on that object (one entry, the row saved last, as before); a name two packages hold (the package-less row keeps its own entry, as before); types other than `action`; stored rows (no migration).
