---
'@objectstack/metadata': patch
---

fix(metadata)!: the metadata service's own reads keep every locale of a package's email template, and its unscoped plural reads answer every package's item of a by-package type

Clause-②: no (narrowing) — on a host whose `protocol` serves no merged action listing, the action activation door now refuses a flip it wrote before (two packages' same-named action); every served read of a standard stack answers the same bytes, in the same order.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed and no stored row changes shape. The narrowing is a refusal of an activation flip whose one ledger row switched two packages' actions at once; there is nothing to rewrite, because the flip itself is what an operator stops sending (give the actions distinct machine names, as the refusal says). -->

Two places kept one item where the metadata service holds several.

- **A bundled type's members.** A bundled type (`email_template`, one member per `locale`) holds several members under one `(package, name)`. `DatabaseLoader` keeps a row per member, but `MetadataManager`'s in-memory registry and the `MemoryLoader` the artifact door saves into kept one item per `(package, name)`, so a second locale of one package's template overwrote the first and the service's own `list`, `loadMany` and `loadManyKeyed` answered only the locale written last. Each member now has its own key under its slot. The canonical member (`en-US`) keeps the slot's own key, so a template with one locale, and every unbundled type, is stored exactly as before.
- **A by-package type's packages.** For `api`, `agent`, `skill`, `action` and `permission`, the `MemoryLoader`'s unscoped `loadMany` / `loadManyKeyed` and `MetadataManager.loadMany` / `loadManyKeyed` folded two packages' items of one name into the one saved last. They now answer one item per `(package, name)`; a name one package holds answers exactly as before (a package-less item under it is still that holder's, ADR-0150 D4). `DatabaseLoader`'s plural reads are unchanged.

The slot rules still count packages, never members: one package's two locales are one holder, so a read or removal naming no package is refused (`409`, ADR-0150 D3) only when two packages hold the name, and the refusal names each package once. A removal naming a package drops every member of its slot and no other package's. A read of a slot answers its member written last, as before. `unregisterPackage` removes a slot's members together, with the one `deleted` announcement the slot made before. `list` puts each slot's last-written member first, as before.

The served reads (`GET /meta`, the execution read the email send path uses, both with `?package=`, and the by-name reads) answer the same items in the same order: they already read every locale and every package through the ObjectQL registry.

**BREAKING** for the action activation door (`POST /actions/_activation/:object/:action`) on a host whose `protocol` serves no merged listing, where the door reads declarations from the metadata service's `loadMany('action')`. A stack whose `protocol` serves the merged listing (the artifact door on `MetadataPlugin`, `ObjectQLPlugin` and `AppPlugin`) already saw both packages and answers byte for byte as before.

- FROM `200` and one ledger row that switched both packages' actions, TO `409 RESOURCE_CONFLICT` naming both objects and no row: two packages each ship a standalone action of one name, bound to two different objects.
- FROM `200` and one ledger row, TO `404 RESOURCE_NOT_FOUND` and no row: two packages each ship an object-less action of one name. That is the answer the merged-listing stack gives.
- Unchanged: a name one package holds flips and writes its row.

**What an operator does.** Give the two packages' actions distinct machine names, or leave them armed: the ledger addresses an action by its machine name (ADR-0126 §4), so one row cannot switch one of them alone.
