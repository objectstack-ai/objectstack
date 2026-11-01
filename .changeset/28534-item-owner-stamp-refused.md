---
"@objectstack/objectql": minor
---

fix(objectql)!: a collection item never names its own owning package — package registration refuses a body `_packageId` other than the registering package's

`ObjectQL.registerApp` (a manifest and its nested plugins, seed datasets included) and the `manifest` service's ADR-0130 residual registration now refuse a collection item whose body already carries a `_packageId` other than the package registering it: `VALIDATION_ERROR` / 400 with `issues[]` at `_packageId`, before the item is filed, the envelope of the permission-set owner refusal in the same loop. The registration stamps `_packageId` only while it is unset, so a body could wear another package's id (an installed connector naming the host's own package, or an id nobody holds) and every reader of an item's owner, the connector materializer deciding whose directory a file ref resolves against among them, read the body's claim about itself.

Clause-②: no (narrowing) — package registration refuses a collection item whose body `_packageId` names a package other than the one registering it, which it registered before with the body's stamp kept. Nothing is widened.

Metadata-protocol: narrowed (a collection item's `_packageId`, declared by `MetadataProtectionFields`, may no longer name a package other than the one that registers it)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed, and no value a legitimate producer writes is refused: the registration is the only writer of `_packageId` (`os build` writes none, the package export strips every underscore key, the artifact loader stamps with the very id the registration keys on), so a foreign stamp exists only in a body somebody wrote by hand to claim another owner. A D2 conversion could not tell such a stamp from an agreeing one without the registration that judges it, and the refusal names the item, both ids and the remedy. -->

**BREAKING** accept-set narrowing at package registration (`@objectstack/objectql`), shipped as `minor`.

- **Before.** A manifest `com.acme.app` whose connector carried `_packageId: 'com.acme.host'` registered the connector with that stamp kept, with no refusal and no warning; so did a nested plugin's item, a seed dataset and a multi-package artifact's residual item. `null` and `''` were kept too.
- **Now.** The registration throws `400 VALIDATION_ERROR` with `issues[]` at `_packageId`, naming the item, the stamp and the package registering it, before anything of the item is filed. Through `POST /api/v1/marketplace/install-local` an inline install answers `422 PLUGIN_REGISTER_FAILED` with that message and persists nothing.
- **Unchanged.** An absent `_packageId` and one equal to the registering package register as before. An item object that an earlier registration stamped in place (a module constant handed to a second registration) registers as it always has: only a stamp the object arrives with is judged. Objects (`objects`) are not judged by this seam.
- **Who sees it.** Whoever hand-writes `_packageId` on a manifest item naming another package, which no build, export or install writes.

**The remedy.** Remove `_packageId` from the item. The package an item belongs to is the one that registers it, stamped by the registration.

The `manifest` service also records which door registered each multi-package artifact's residual owner (`ObjectQL.recordResidualOwner` / `residualOwnerSource`: `'code'` for the boot, `'marketplace'` for an install), the only record of that id's origin, since the residual has no package row.
