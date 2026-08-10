---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the delete heal no longer unregisters an object bound to an installed package

Deleting a metadata overlay row for an `object` whose `package_id` names an installed package took the object off the whole data plane until the next restart: every CRUD call answered `OBJECT_NOT_FOUND` / 404 while the table still held the rows, and the delete receipt said `reset: true`.

`SchemaRegistry.registerObject` replaces (splices out) the same-package `own` contributor rather than shadowing it, so hydrating such a row destroys the packaged definition at write time and stamps `_provenance: 'org'`. Tier 3 of `restoreArtifactRegistryView` then consulted `isArtifactBacked` — which for an `object` is exactly that provenance — and read "not code-shipped" for an object the package still ships.

Tier 3 now also refuses when the owner contributor's package binding names a currently-installed package, and says so in the log. The binding survives the overwrite (the replacement fires only when the package ids match); the definition does not.

Known cost, deliberate: a package-bound runtime-authored object is indistinguishable from a package-shipped one by binding alone, so a genuinely deleted one stays registered until the next restart — listable, and rowless. A surplus entry is the cheap error here; a wrongly retired one 404s data CRUD for every tenant.
