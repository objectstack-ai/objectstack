---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql)!: a by-name read of a doc that names no package refuses a name two enabled packages hold, naming both

Clause-②: no (narrowing) — narrowed: a by-name read of a doc that names no package (`GET /meta/doc/NAME` and the doors that read through it, `MetadataFacade.get`/`getEntry`), of a name two or more enabled packages hold, moves from one holder's body, picked by registration order, to `409 RESOURCE_CONFLICT` naming every holder. Unchanged: one holder, a read that names the package, the environment's own item.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is the answer a by-name doc read gives when two packages ship the name, so there is nothing for a migration to rewrite and no tombstone -->

**BREAKING** for a caller that reads a doc by its name alone while two enabled packages ship that name: it now gets `409 RESOURCE_CONFLICT` naming the packages, where it got one of them. The fix: name the package (`?package=PACKAGE_ID` on the REST door, the package id in process). A doc name one package ships reads as before.

A read of a `doc` by its name alone (`GET /api/v1/meta/doc/NAME`, the doors that read through it, and `MetadataFacade.get('doc', name)` / `getEntry`) answered one holder's doc when two packages ship the same name: the registry's first-registered copy, or on a composed server the metadata service's copy, which is the package registered last. It now answers `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`), naming every enabled package that holds the name, in either registration order. `MetadataFacade.exists` answers `true` for such a name.

Unchanged: a doc name one package holds reads as before; a read that names the package (`?package=` on the REST door, a package caller in process) is not changed; the environment's own doc of the name, as the server holds it, still answers first. A disabled package holds no name: beside one enabled holder the read is not refused, and the facade serves the enabled holder's doc. `doc` keeps its global literal name and its addressing (ADR-0150 D1 bucket 1).

FROM → TO, for a doc name two enabled packages ship:

- FROM `200` with one holder's doc, chosen by registration order, TO `409 RESOURCE_CONFLICT` naming each holder. The fix for a caller: name the package (`?package=PACKAGE_ID`, or pass the package id in process).
