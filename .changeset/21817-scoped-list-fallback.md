---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a package-scoped metadata list serves a package-less customization of an item the package ships, as `getMetaItem` naming the package does (#21817)

Clause-②: no

ADR-0048 lets one item hold a package-less stored `sys_metadata` row, an ordinary customization, beside the package's own artifact or row. `getMetaItem` naming the package serves the package's own row, else the package-less row, the organization's rows before the env-wide rows (ADR-0005). A list scoped to the package (`getMetaItems({ type, packageId })`, `GET /api/v1/meta/:type?package=`, and the `getMetaItemsForExecution` view of it) read only the package's own rows. So it served the package's artifact over a package-less customization of it, and an env-wide row of the package over the organization's package-less row, while `getMetaItem` naming the package served the customization.

Now each slot of a package-scoped list resolves the way `getMetaItem` naming the package does: the package's own row, else the package-less row, by the same order the unscoped list uses. This holds over a registry item, a MetadataService item and a view the package's stored container expands, and in the `previewDrafts` list, where a package-less draft stands in when the package has none. The list's membership is unchanged: it still lists only the items the package ships, and a package-less row of an item the package does not ship adds no item to it. The lock each item reports is unchanged.

No key, export, status or error code changes.
