---
'@objectstack/metadata': minor
---

fix(metadata)!: removing an action counts and takes its holders by package over every slot of the name, object-bound slots included (ADR-0150 D3/D4)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed — a package-less removal of an action name two packages hold, where one or both bind it to an object, is now refused naming both, where it took both packages' actions.

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped, and no stored row is rewritten: what moves is which in-memory slots and loader rows a removal of an action takes, and when it refuses, so there is nothing for `objectstack migrate meta` to rewrite -->

The metadata service keeps an action bound to an object in its own slot, keyed by package, object and name, while `DatabaseLoader` keeps one row per `(package, name)`. A removal now judges an action's holders the way the row key and the by-name read do: by package, over the name's object-less slot and every object-bound one.

- `unregister('action', name, { packageId })` removes every slot that package holds of the name, object-bound ones included. Before, it removed only the object-less slot: the package's bound action left the artifact door's store and its database row, but stayed in the registry and kept answering `get` and `list`.
- `unregister('action', name)` with no package, of a name two or more packages hold on any of its slots (both on one object, each on its own object, or one bound and one object-less), is refused with `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`) naming every package with the object it binds the name to, before anything is touched. Before, the removal took every package's slot from the registry and the door's store; with a `DatabaseLoader` beside them, the loader's own delete refused, the manager logged it as a failed delete, and announced `deleted` while both rows stayed and kept being served.

One package holding the name — on one object, on several, or object-less — is removed exactly as before. A package-less removal of an object-less name two packages hold is refused exactly as before, with the same message. `unregisterPackage` is unchanged.

**BREAKING** (first-party count: 0 — no first-party caller removes an action by bare name, and none removes a bound action by package through `unregister`):

1. FROM a package-less `unregister('action', name)` of a name two packages hold — both bound to one object, each bound to its own object, or one bound and one object-less — that removed both TO the same call naming the package to remove: `unregister('action', name, { packageId })`.
2. FROM a package-less `MemoryLoader.delete('action', name)` of such a name, which deleted every slot, TO the same `409` refusal; name the package (`delete('action', name, { packageId })`) to remove one package's action.
