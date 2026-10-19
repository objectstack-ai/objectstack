---
'@objectstack/rest': minor
---

fix(rest)!: `/meta/:type/:name/layers` and the deprecated `?layers=true` answer a disabled package's non-object item as a missing name, on both transports

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of two runtime read doors for an item whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is removed, and nothing must be rewritten; re-enabling the package restores the reads -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

- **Absent now, byte for byte the missing name's answer (`404 RESOURCE_NOT_FOUND`):** the layered view of an item of every type but `object` and `package` whose owning package is disabled, on `GET /meta/:type/:name/layers` and on `GET /meta/:type/:name?layers=true`, to every caller, an author who may write the item included. One step in the shared layered chain (`createMetaLayeredAnswer`) answers it, so the runtime dispatcher's two spellings answer the same. The owner is the one the by-name read's protection envelope names (`packageId`), read under the request's `?package=` scope, asked of the engine registry's `isPackageDisabled`. Objects already answered `404 OBJECT_PACKAGE_DISABLED` here.
- **Unchanged:** items of enabled packages, a name with nothing behind it, and the protocol's `getMetaItemLayered`, which keeps serving every layer to the readers that resolve with it (the security catalog echo, the packaged-permission-set lock gate).
- **Added, optional:** `MetaItemReadGateSources.isItemOfDisabledPackage` and `MetaLayeredRequest.packageId`. A host that supplies neither answers as before.

What changes for you: re-enable the package to read its items' layered views again.
