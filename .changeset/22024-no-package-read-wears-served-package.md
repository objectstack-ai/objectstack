---
'@objectstack/metadata-protocol': patch
---

A by-name metadata read that names no package now wears the package of the body it serves

Clause-②: no

- **What was wrong.** `getMetaItem` with no `packageId` (behind `GET /api/v1/meta/TYPE/NAME` when no package is named) merges the registry artifact's protection envelope, `_packageId`, `_packageVersion` and `_provenance`, over the body it serves. With no package named, that envelope was the first-registered package's. When two installed packages ship one name and the body served was the other package's, the answer carried that body under the wrong package. Two cases were measured. In the first, both packages ship a view container and one of them stores a copy of it: the read served the copy's view and named the first-registered package. In the second, a stored row of the name is bound to one package. The answer's top-level `packageId` / `provenance` / `packageVersion` fields, which are read off the served item, said the same wrong thing.
- **What it does now.** With no package named, the envelope is looked up at the package the served item is bound to. That is the stored row's package, the package of the container copy that expands the name, or the `_packageId` of the MetadataService or registry item. This is the rule the `GET /api/v1/meta/TYPE` list already applies to each item it serves, so the list and the by-name read now give one envelope for one served body.
- **Unchanged.** Which body the read serves. A read naming a package. The lock family and the `lock` / `editable` / `deletable` envelope, which still come from the item-lock resolution over the read's own address. A served item bound to no package (a package-less stored row or copy, or a registry entry with no package) keeps the package-less lookup it had, so for a name only one package ships, a tenant's package-less overlay still wears that package's envelope. The layered read (`/layers`) is not changed.
- ⛔ No public export, signature, schema or accept-set change. Nothing is accepted or refused differently.
