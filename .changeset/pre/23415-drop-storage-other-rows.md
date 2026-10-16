---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a metadata delete with `dropStorage` drops an object's table only with the object's last stored row, and is refused `409 RESOURCE_CONFLICT` while another row of the object remains (ADR-0048)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: a metadata delete that asks to drop an object's table, while another stored row of the object stays after it, is refused before anything is written; the remedy is in the request a caller sends (drop the opt-in, or delete the other rows first), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so one object can hold one row per package, and a package-less row beside them. Every such row serves the object over the one table its name maps to.

**FROM.** `DELETE /api/v1/meta/object/my_object?package=com.acme.a&dropStorage=true` (`deleteMetaItem({ type: 'object', name, packageId, dropStorage: true })` in process), of an object a second package `com.acme.b` also holds, removed `com.acme.a`'s row, answered `200` with a receipt saying `com.acme.b`'s row remains, and dropped the object's table. The object stayed defined and served by `com.acme.b`'s row while its records were gone: its next data read answered `500`. The same held for a package-less row left beside the deleted package's row, and for an uninstall (`deletePackage`, which deletes each of the package's rows with `dropStorage` unless `keepData` is set).

**TO.** Such a delete is refused `409 RESOURCE_CONFLICT` before anything is written: both rows, the table and its records stay. The message names the rows that remain and the way out. An uninstall of a package holding such an object, without `keepData`, is refused whole, `409 RESOURCE_CONFLICT`, before anything is removed; its message names the object, the rows that keep it, and the ways out.

**Unchanged.** The delete of an object's last stored row with `dropStorage` still drops its table. A delete without `dropStorage` still removes the named package's row and keeps the table, and its receipt names the rows that remain. Only `active` rows count: a draft is never materialised, so a remaining draft does not keep the table.

**Remedy.** To remove one package's row of an object another row still holds, send the delete without `dropStorage`. To drop the table, delete the object's other rows first, then send the last row's delete with `dropStorage`.
