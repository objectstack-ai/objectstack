---
'@objectstack/metadata': patch
---

fix(metadata)!: `DatabaseLoader` keeps a row for each object one package binds an action name to, so none is lost on restart (ADR-0150 D4/D6)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored body is rewritten: `DatabaseLoader` fills the existing `bundle_member` column of an action row it writes, so there is nothing for `objectstack migrate meta` to rewrite -->

One package may bind one action name to several objects (ADR-0150 D6; for example `log_call` on five objects), and the metadata service keeps each binding as its own item, keyed by package, object and name (D4). `DatabaseLoader` kept one `sys_metadata` row per `(package, name)`, so saving the second binding updated the first binding's row in place. A read of the rows (a cold boot over the database without the artifact) then served only the binding saved last, with no error and no warning.

- An object-bound action row now records its object in `bundle_member`, and an object-less one leaves it NULL. The table's unique key `(type, name, package_id, bundle_member)` is unchanged and no DDL runs, so each binding has its own row. `list('action')` over the rows serves every binding.
- A row written before this release (its `bundle_member` NULL) is read by the object its body is bound to. Its column is filled in the first time the loader writes that package's slot of the name (a save or a rollback), so it never collides with the object-less binding's row. The fill touches that column only. A binding an earlier save already overwrote is not recoverable from the row; its versions remain in `sys_metadata_history`.
- A rollback by name restores the row of the object the restored body is bound to. When that binding has no row (a row written before was later re-bound to another object), the rollback recreates the binding as its own row and leaves the other binding in place. Before, it overwrote the one row.
- An object name longer than `bundle_member` holds (100 characters) is refused when it is written, naming the action, the object and the limit. It is never truncated.
- `migrateDatabaseLoaderRowPackages` reads an action's slot with its object, so a package's legacy row on one object is bound beside that package's bound row on another object.

Unchanged: `load`, `loadMany` and `loadManyKeyed` still answer one item per action name, the binding saved last, as the in-memory store's unscoped reads do. Removal by package takes every binding's row, and one package on several objects is still one holder (#32352). `email_template` rows are untouched.

**BREAKING** (first-party count: 0 — the longest first-party object name is 32 characters): `DatabaseLoader.save` of an action bound to an object whose name is longer than 100 characters, which stored it, now refuses it. FROM such an object name TO one of at most 100 characters.
