---
'@objectstack/metadata': patch
---

fix(metadata)!: the artifact door's in-memory loader and `DatabaseLoader` store `api`, `agent` and `skill` items per (package, name), and a read that reaches them is answered by package

Clause-②: no (narrowing) — for a type in `PACKAGE_SLOTTED_STORE_TYPES` (`api`, `agent`, `skill`), a read naming no package that reaches the loaders (no registry slot of the name) of a name two packages stored is refused `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`, naming both) where it answered the body saved last; a read naming a package that stored nothing is not found where it answered another package's body; once every slot of a name is removed, the door's stored copy no longer answers.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped: what moves is which stored item a loader keeps and which one a runtime read is answered, and nothing an author writes needs converting -->

**BREAKING** only for a caller that reads a by-package type through the loaders and relied on the body saved last.

ADR-0150 D3/D4 already stored these types per `(package, name)` in `MetadataManager`'s registry (#32069, #32151). The loaders under it did not: the artifact door's `MemoryLoader` and `DatabaseLoader` kept one entry per name, the body saved last, so the first package's stored item was gone at the second package's save; the manager's loader fallback named no package; `list` admitted loader items one per name; and a removal never deleted from the door's store.

- **The rule, once.** Both loaders hold these types under the registry's own keys, by the rules in `package-slotted-store.ts`: a save fills the slot `storeWriteKey` picks (a package-less body under a name one package holds is that holder's customization, D4), a delete takes the slots `storeRemovalKeys` picks, and a by-name read is `readStoreEntry` over the stored items. The manager reads a by-package type that its registry cannot answer from every loader's stored items of the name (`MetadataLoader.loadSlots`, new and optional), through the same `readStoreEntry`, and `list` fills each package's slot from the loaders.
- **Storage.** `DatabaseLoader` keeps one `sys_metadata` row per `(package, name)` with `package_id` filled. A row's package is that column, else the package its stored body names. Versions of these types are numbered per name across the packages' rows, so both packages' `sys_metadata_history` rows are written (the table is unique on `(type, name, version)`). `migrateDatabaseLoaderRowPackages` (`@objectstack/metadata/migrations`) binds the loader's own rows (`source = 'database'`) whose body names a package and leaves a package-less row as it is; the loader runs it once, before its first operation on one of these types, binds every row it saves, and the migration can be re-run any number of times.
- **Removal.** `unregister` and `unregisterPackage` delete a by-package type from the in-memory loaders too (the artifact door's store), by the same key. `unregisterPackage(P)` also removes every item in P's slot, a package-less customization of P's item included. The realtime `created`/`updated` event names the package of an item that carries only the `_packageId` stamp, the way `deleted` already did.
- **Unchanged.** Every other type is stored, read and removed by name, as before (pinned as CONTROL), and its in-memory loader copy is still not deleted from (a separate card). A read the registry answers is unchanged.

**The remedy.** What a caller sees, FROM → TO, for a type in the set, with first-party reach:

- a read naming no package that reaches the loaders, of a name two packages stored: FROM the body saved last TO `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`), as the registry already answers it; also `MemoryLoader.load`, `DatabaseLoader.load` and `MetadataManager.load`/`loadDiagnosed`, which rethrow the refusal instead of reporting it as an outage. First-party reach: `DatabaseLoader` production wiring 0; cluster writers that notify on these types 0; production `load`/`loadDiagnosed` callers are on `action` only. Name the package in the read.
- a read naming a package that stored nothing, where another package did: FROM that package's body TO not found.
- a read naming a package that reaches the loaders: FROM the body saved last TO that package's own item.
- `list` over the loaders: FROM one item per name TO each package's item.
- after the last slot of a name is removed on an artifact-door boot: `list`, `get` and `exists` FROM the body saved last TO nothing. First-party removal callers on these types: 0.
- `DatabaseLoader.save`: FROM one row per name with `package_id` empty TO one row per `(package, name)` with it filled; `delete` naming no package of a name two packages hold: FROM deleting the row TO refused.
- the realtime `created`/`updated` event of a `_packageId`-only item (any type): FROM no `packageId` TO the package. First-party `subscribeMetadata` callers: 0.
- `unregisterPackage(P)`: FROM leaving a package-less customization in P's slot TO removing it. First-party callers: 0.

**Recorded, not built.** A cluster peer's replay of a name-level change still drops every slot of the name; it now re-reads each package's item from the per-package storage, and only a slot no loader holds is lost, as for every type on `main` (per-slot invalidation was not ruled in). `unregisterPackage`'s membership (`packageId`, `package` or `_packageId` on the body) stays a second rule beside the slot rule, documented on `isPackageMember`. A package-less item beside two package slots keeps its own package-less row and is removable by name only once both packages are gone. `DatabaseLoader`'s rollback, `getHistoryRecord` and `queryHistory` stay keyed by `(type, name)`: rolling back one package's row is a follow-up.
