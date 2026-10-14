---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a delete naming one package keeps the item's other rows registered, a draft save that names no package of an item two or more packages hold is refused `409 RESOURCE_CONFLICT`, and the delete's `_lock` refusal carries the named package's reason (ADR-0048)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: a draft save through the metadata API that names no package, of an item whose active rows two or more packages hold, is refused; the remedy is in the request a caller sends (name the package with `?package=`), never a rewrite of a package source or a stored row. What widens is the runtime registry after a delete that names one package: the item's remaining stored row stays registered, so data CRUD keeps serving an object the item read serves. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so one item can hold one row per package. Since the save and the delete name their package (`?package=` on the REST door, `packageId` in process), three paths still did not take the package they were handed.

**The registry after a delete naming one package.** FROM: `DELETE /api/v1/meta/object/my_object?package=com.acme.a` of an object two packages hold removed `com.acme.a`'s row and the receipt said the other package's row remains, and the item read served that row, but the registry entry was retired as if the deleted row were the whole item. Data CRUD then answered `404 OBJECT_NOT_FOUND` for the object until the next boot or save, and on a kernel whose registry holds the stored rows, registry lookups missed an item of any other type the same way. TO: when a row of the item is still stored after a delete, that row is registered again, as a boot registers it, and nothing is retired. Deleting the last row still retires the item.

**A draft save that names no package.** FROM: `PUT /api/v1/meta/view/my_view?mode=draft` with no `?package=`, of an item whose active rows two packages hold, answered `200` "(env-wide, state=draft)" and stored the draft in whichever package the database returned first. With one package and a package-less row beside it, the draft went into the package or stayed package-less by the same order. TO: the draft inherits the package of the item's active rows when they are bound to one package, whatever the storage order (a package-less row beside it is not a second package). When they are bound to two or more, the save is refused `409 RESOURCE_CONFLICT`, writes nothing, and names the packages with the `?package=` remedy, exactly as the direct save and the delete answer. A draft read that names no package serves the package-unbound draft's version for such an item.

**The delete's `_lock` refusal.** The delete's lock gate now takes the package the delete names, as the save's does. The verdict is unchanged: the lock is the strictest of every package that ships or stores the item, so a delete naming a package is refused whenever the save naming it is. What changes is the prose: when several packages declare the strictest lock, the `ITEM_LOCKED` refusal of a delete naming a package carries that package's reason, where it carried the reason of the package whose id sorts first.

**Remedy.** For an item two or more packages hold, send the draft save with `?package=` naming the package whose draft it is (`packageId` in process). Nothing else asks anything of a caller.
