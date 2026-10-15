---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a save naming a package of a runtime object whose owner is its package-less definition is refused before any write, with a way out that moves the object into that package (ADR-0029 D9.9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten, converted or deleted by this change, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the object save door for one shape: a save naming a package of an object whose registry owner is its package-less definition (the `sys_metadata` sentinel) is refused, where it was written and then discarded by the registry. The remedy is in the requests a caller sends (delete the package-less definition without `dropStorage`, then send the save again), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

An object has exactly one registry entry, so it has exactly one owner (ADR-0029 D3), and `sys_metadata` must not describe a shape the registry cannot hold (D9.9). A runtime object first saved naming no package is owned by that package-less row. A save naming package `Q` beside it was written and answered `200`, but the registry refused `Q`'s row into a warning and kept the package-less definition: the metadata read served `Q`'s row while the data plane served the package-less one, before and after a boot, and at boot `Q`'s row was counted in `errors`. The package-less state is no authoring destination (ADR-0070), so the refusal does not say "bind it to `sys_metadata`": it names the way into `Q`.

What changes for you, where object `NAME` is owned by its package-less definition and `Q` is any package:

- FROM `PUT /api/v1/meta/object/NAME?package=Q` (`saveMetaItem({ type: 'object', name: NAME, packageId: Q, … })`) answering `200` "Saved object … package=Q" with a `Q`-bound row stored that nothing served, TO `422 OBJECT_OVERLAY_PACKAGE_MISMATCH` with nothing written: "Move object 'NAME' into package 'Q' first: delete its package-less definition without dropStorage, which keeps its table and records … then send this save again. …". The error carries `packageId: Q` and `ownerPackageId: null`.

**Remedy, in one line.** `DELETE /api/v1/meta/object/NAME` (no `package`, no `dropStorage`), then send the same `PUT /api/v1/meta/object/NAME?package=Q` again: `Q`'s row becomes the owner at once and at every later boot, and the table and its records are kept.

**Unchanged.**

- A save naming no package over the package-less owner (its own re-save).
- The D9.9 refusal for an owner bound to a real package: same code, status and prescription.
- An object with no owner, and an object a code package ships.
- Every type except `object`.
- Rows stored before this change stay as they are. Nothing is rewritten on upgrade.
