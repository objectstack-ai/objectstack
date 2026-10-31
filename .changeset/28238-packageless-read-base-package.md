---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a same-named row in a dependent package no longer replaces the base package's item for a read that names no package

Clause-②: no
Metadata-protocol: none

When a writable package that depends on a code package saved an item under a name the code package ships (`showcase_task.default` saved into `com.default.acme-custom`), `GET /api/v1/meta/view/showcase_task.default` with no `package` served the dependent package's copy, under the code package's `_packageId`, and so did the layered read's `effective`. The code package that ships the name was not a candidate of that read: the dependent package's row won by being the only stored row.

The by-name read and the layered read that name no package now take their stored content from the code package that ships the name: its own stored row, else the package-unbound row (the overlay Setup writes, which still wins over the code item), else the code item. A read naming the dependent package still serves its own row, and a writable package's own item, a name no code package ships, is still served to the read naming no package. Where a package-less save, delete and the read's `version` land does not move.
