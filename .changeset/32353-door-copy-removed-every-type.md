---
'@objectstack/metadata': patch
---

fix(metadata)!: a removal deletes the artifact door's in-memory copy for every metadata type, so a removed item stops answering

Clause-②: no (narrowing) — after `MetadataManager.unregister(type, name)` (or `unregisterPackage`, `bulkUnregister`) of a type outside `PACKAGE_SLOTTED_STORE_TYPES` whose item an in-memory (`memory:`) loader holds, `list`, `get` and `exists` no longer answer that loader's copy; a customization removed over an artifact-door item no longer falls back to the door's body.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped: what moves is which in-memory loader a removal deletes from, and nothing an author writes needs converting -->

**BREAKING** only for a caller that removed an item of a type outside the per-package set and relied on the artifact door's (or its own `MemoryLoader`'s) copy answering afterwards.

#32246 made a removal delete from the in-memory loaders (the artifact door's store) for the types stored per `(package, name)`. Every other type kept the residue: `unregisterAt` deleted only from writable `datasource:` loaders, so after an item the door had loaded was removed, every read fell through to the door's copy and served it again, the removed item back as if nothing happened. Now `unregister`'s storage half deletes from a `memory:` loader that can delete, for every type: by `(package, name)` for a type in the set, as before, and by name for every other type (`MemoryLoader.delete` already removes by name for those). One rule covers every type.

**The remedy.** What a caller sees before and after, for a type outside the set (`view`, `object`, `datasource`, `position`, …), in-process `@objectstack/metadata` answers, no HTTP or MCP door:

- After `unregister(type, name)` of an item the artifact door's in-memory store holds: `list`, `get` and `exists` (on the live manager, and on a manager whose registry is empty over the same loaders), and the loader-only reads `load`, `loadDiagnosed`, `loadMany`, `loadManyKeyed`: FROM the door's body TO nothing, until the artifact is loaded again (a reload or a restart restores it). Re-register the item to serve it again.
- The same removal when a customization was registered over the door's item: FROM falling back to the door's package body TO nothing — the rule #32347 applies to the per-package types. To return to the package body, reload the artifact, or re-register the door's body.
- A host that registers its own `MemoryLoader` with `MetadataManager`: `unregister` now deletes the item from it, for every type (before: only for the per-package types).
- First-party reach (census at `2513e3ad`, six removal callers of these types: objectql's runtime object copy, install-local's object and package-datasource withdraws, the datasource admin's delete and its `/meta` follower, plugin-security's `position` echo drop): in their reachable branches four never meet a door copy (the engine registry serves every door object, a code-origin datasource is refused, an echo is never registered over a served declaration); install-local's two withdraws move only for a package the door loaded, where the move is the fix. The manager's `unregisterPackage` and `bulkUnregister` have no first-party caller.

**Unchanged.** A removal still reaches only the node it runs on: a cluster peer's door copy keeps answering there. An item no in-memory loader holds is removed exactly as before. A read the registry answers is unchanged.
