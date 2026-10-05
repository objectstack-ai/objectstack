---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a package's slot in the metadata list serves the package's own stored row in every row order, as `getMetaItem` naming that package does (#21804)

Clause-②: no

ADR-0048 lets one item (type, name, organization scope) hold a package's stored `sys_metadata` row beside a package-less one. `getMetaItem` naming the package has always served the package's own row (prefer-local), and the organization's rows before the env-wide rows (ADR-0005). The list (`getMetaItems`, and the `getMetaItemsForExecution` view of it) built each package's slot from the LATEST of the package's row and the package-less row in the order the store returned them. So with both rows stored, the list served the package-less body for the package in one row order, and an env-wide row of the package could beat the organization's package-less row.

Now the list and the by-name read take one resolution: the organization's rows, then the env-wide rows; within each, the type's canonical spelling, then the other; within each, the package's own row, then the package-less row, never another package's. A package's list slot serves the row `getMetaItem` naming that package serves, whatever the row order, and the `previewDrafts` list previews the draft the by-name read previews. A package with no row of its own still falls back to the package-less row, as before. The lock the list item reports is unchanged: it is still the strictest lock among the item's rows in scope.

No key, export, status or error code changes. A list request scoped to one package (`packageId`) reads only that package's rows and is unchanged.
