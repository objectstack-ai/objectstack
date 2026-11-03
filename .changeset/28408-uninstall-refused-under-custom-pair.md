---
'@objectstack/objectql': patch
---

fix(objectql)!: uninstalling a base package is refused while its paired `.custom` package is installed, naming the pair (409, the extender-refusal family) (#28408)

Clause-②: no (narrowing) — `SchemaRegistry.assertPackageUninstallable`, and so `uninstallPackage`, `unregisterObjectsByPackage` without `force`, the protocol's `deletePackage` and `DELETE /api/v1/packages/:id`, now refuse the uninstall of a base while the registry holds its paired customization package (`BASE.custom`), an uninstall that succeeded before; nothing is widened.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches uninstalling a package, so every taught use stays true.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a registry state that refuses an uninstall gains one more cause, answered with the existing RESOURCE_CONFLICT / 409 refusal, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the package uninstall (`@objectstack/objectql`, ADR-0146 D3).

- **Before.** A base package uninstalled while its paired customization package (`hotcrm.custom` for `hotcrm`) was installed. Every customization in the pair was stranded: nothing served it, and nothing said why.
- **Now.** The uninstall is refused `409 RESOURCE_CONFLICT`, in the same refusal an extended object already gets (ADR-0029), before anything is removed. The message names the pair and opens with the way out: delete the pair first, exporting it before that to keep its customizations (`GET /api/v1/packages/PAIR/export`). When the base is also extended, one refusal names the extenders and the pair. The thrown error carries the pair as `customizationPackageId`.
- **Unchanged.** Uninstalling the pair itself; a base with no installed pair; `force`, which still means not asking; a dependent that is not the base's own pair (ADR-0141 D3 still defers it). On `DELETE /api/v1/packages/:id` a base the deployment ships is still refused `422 WRITABLE_PACKAGE_REQUIRED` first.

**The remedy.** Export the pair if you want to keep its customizations, delete it, then uninstall the base.
