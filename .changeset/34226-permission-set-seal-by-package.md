---
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-security': patch
---

fix(metadata-protocol, plugin-security): a package's save of its own permission set is no longer refused because a package of another namespace ships a set of that name

Clause-②: yes (widening) — a save, a draft save or a draft's publish that a package addresses to its own permission set N, refused 403 `NOT_OVERRIDABLE` ("provided by a managed package and is sealed") while a package of another namespace ships N, now lands; the exported `MetadataAuthoringGateContext` (`@objectstack/metadata-protocol`) and `PermissionSetLockGateContext` (`@objectstack/plugin-security`) each gain an optional `packageId`; nothing the save door accepted is refused
Metadata-protocol: none

A permission set is `(package, name)`, and a name holds one set per namespace (ADR-0150 D2/D9). The metadata door's managed seal (ADR-0126 / ADR-0131 D6) and plugin-security's packaged-permission-set lock both judged a save of a permission set by its name alone. So when package `crm` shipped a set `N`, a package `hr` of another namespace could not save its own set `N`: the save was refused as if it edited `crm`'s shipped set.

These judges, and the managed seal the store applies to the write a save or a draft's publish hands it, now judge the package the write is addressed to. A save of `N` overrides a set a package `Q` ships, and stays sealed and locked exactly as before, when it names no package, is addressed to `Q`, is addressed to `Q`'s customization pair (whatever namespace the pair declares), or is addressed to a package that shares `Q`'s set of the name (a co-owner of `Q`'s namespace, a platform namespace, a package with no namespace, or a name the platform requests by spelling). Every package that ships the name is judged, so the answer is the same in every registration order. Any other package's save of its own `N` lands, is served at that package, and that package's grants confer its own set.

What moves, for a save of `N` while a package of another namespace ships `N`:

- FROM 403 `NOT_OVERRIDABLE` (sealed) TO saved, for a save addressed to a package of another namespace than every package that ships `N`, which is not the customization pair of any of them. The same holds for a draft save of that set and for its publish.

When a package publish is refused on a runtime that cannot roll back its transaction, the undo of each promotion it made judges the same package the promotion addressed, so a package's own set `N` is taken back out and its draft is put back instead of being reported still live. Rollback and revert of such a set still judge the name alone, and other sealed package-scoped types keep the name-wide seal.

`MetadataAuthoringGateContext` (`@objectstack/metadata-protocol`) gains an optional `packageId`: the package the write is addressed to (a save's `packageId`, a restore's row binding), absent for a write that names none. An authoring gate that judges an item keyed `(package, name)` reads it. Gates that ignore it are unaffected. `PermissionSetLockGateContext` (`@objectstack/plugin-security`), the subset of it the lock gate consumes, gains the same optional `packageId`.

Nothing to migrate.
