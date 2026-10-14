---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: an uninstall without `keepData` of a package holding an object another stored row also holds is refused `409 RESOURCE_CONFLICT` before anything is removed, instead of half-uninstalling the package (ADR-0048)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime door: an uninstall that would drop an object's table while another stored row of the object stays is refused before anything durable; the remedy is in the request a caller sends (`keepData`, or delete a row of the object first), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so one object can hold one row per package, and a package-less row beside them, all served over the one table its name maps to. An uninstall drops each of its objects' tables unless `keepData` is set, and a table is dropped only with the object's last stored row.

**FROM.** `DELETE /api/v1/packages/com.acme.a` (`deletePackage({ packageId: 'com.acme.a' })` in process), for a package whose object a second package `com.acme.b` (or the package-less row) also holds, deleted the package's `sys_packages` row and its other rows, then met the per-object table-drop refusal and answered `400 PACKAGE_DELETE_PARTIAL` with that object in `failed[]`. The package was no longer installed, while its row of the shared object stayed stored and served: a half-uninstalled package.

**TO.** Such an uninstall is refused `409 RESOURCE_CONFLICT` before its first durable step: the `sys_packages` row, the registry entry, every row, the tables and their records all stay. The message names each shared object and the rows that keep it, and the ways out.

**Unchanged.** An uninstall with `keepData` drops no table, so a shared object does not refuse it. An uninstall whose objects no other row holds still drops their tables.

**Remedy.** Uninstall with `?keepData=true` (`keepData: true` in process) to keep every table of the package; or first delete the package's own row of each shared object without `dropStorage` (`DELETE /api/v1/meta/object/NAME?package=com.acme.a`), which keeps that table for the other rows, then uninstall again to drop the tables the package alone held.
