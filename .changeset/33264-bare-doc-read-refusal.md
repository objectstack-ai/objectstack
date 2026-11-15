---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql): a by-name read of a doc that names no package refuses a name two enabled packages hold, naming both

Clause-②: no
Metadata-protocol: none
Clause-② arm: narrowing — the bare read of a two-holder doc name moves from the first holder's body to 409 RESOURCE_CONFLICT (contract review owed)

A read of a `doc` by its name alone (`GET /api/v1/meta/doc/NAME`, the doors that read through it, and `MetadataFacade.get('doc', name)` / `getEntry`) answered one holder's doc when two packages ship the same name: the registry's first-registered copy, or on a composed server the metadata service's copy, which is the package registered last. It now answers `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`), naming every enabled package that holds the name, in either registration order. `MetadataFacade.exists` answers `true` for such a name.

Unchanged: a doc name one package holds reads as before; a read that names the package (`?package=` on the REST door, a package caller in process) is not changed; the environment's own saved doc of the name still answers first. A disabled package holds no name: beside one enabled holder the read is not refused, and the facade serves the enabled holder's doc. `doc` keeps its global literal name and its addressing (ADR-0150 D1 bucket 1).

FROM → TO, for a doc name two enabled packages ship:

- FROM `200` with one holder's doc, chosen by registration order, TO `409 RESOURCE_CONFLICT` naming each holder. The fix for a caller: name the package (`?package=PACKAGE_ID`, or pass the package id in process).
