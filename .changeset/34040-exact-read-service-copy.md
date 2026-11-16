---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an exact by-name read (`?package=X`) of a `doc`, a `view` or another type the exact qualifier does not judge no longer answers another package's item from the metadata service

Clause-②: no
Metadata-protocol: none

`GET /api/v1/meta/doc/NAME?package=X` (both transports, and every reader of the protocol's by-name read) answered the other package's doc when two packages ship the name and the other one registered last. The metadata service keeps such a type by name alone, so it holds the item of the package registered last, and the read asked it before the registry. Now that copy is not served at X's address when it is stamped with another installed package (one that is neither X nor X's customization pair). The registry's read naming X answers X's own item instead (ADR-0150 D3: an exact address answers that holder).

The same holds for every type the exact qualifier of ADR-0150 D5 does not judge: `doc`, `view`, `translation`, `field`, `seed`, `datasource`, `external_catalog` and `object_extension`. `position` and `capability` keep one package holder. `object` is not changed: one package owns an object name, and the registry reads it by name. The covered types were already right, because the exact qualifier replaces another package's copy after the layers.

Unchanged: a package that is the only holder, a service copy bound to no package, a copy stamped X, and the read that names no package.
