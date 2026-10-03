---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/objectql': patch
---

fix: when the store refuses an uninstall's `sys_packages` delete, the uninstall now answers the failure and removes nothing else, instead of answering success and coming back after the next restart (#21276)

Clause-②: no

**`@objectstack/metadata-protocol`.** `deletePackage` now deletes the package's `sys_packages` row first, before its `sys_metadata` rows, its tables, its registry entry and the rows the uninstall cleanups own. When the `package` service refuses that delete, whether it returns `{ success: false }` or throws, `deletePackage` throws and nothing else is removed. A store fault answers `500`, with `DATABASE_ERROR` from a live SQL driver and `INTERNAL_ERROR` otherwise. A declared 4xx refusal is passed through unchanged. Before this, the refusal was logged as a warning, and `DELETE /api/v1/packages/:id` answered `200` after the package's metadata, tables and grants had been removed. The package then came back after the next restart.

Before that store delete, `deletePackage` now also asks the registry whether the uninstall would be refused because another package extends an object this package owns (ADR-0029). If so, it throws the registry's own refusal with nothing removed. A registry without the new question is not asked, and the refusal then surfaces at the registry withdrawal, as before.

**`@objectstack/objectql`.** New: `SchemaRegistry.assertPackageUninstallable(packageId)`. It throws the refusal `unregisterObjectsByPackage` and `uninstallPackage` raise for an object another package extends, with the same message, and it changes nothing. `unregisterObjectsByPackage` now calls it, so there is still one copy of that check.

**`@objectstack/runtime`.** `DELETE /api/v1/packages/:id` now asks `deletePackage` before it touches anything. It checks that the package exists with a read, and it withdraws the package from the running registry and clears its saved disable record only after `deletePackage` has answered. So when the store refuses, the door answers `500`, the same process keeps serving the package, and a package that was disabled stays disabled after a restart. Before this, the door withdrew the package and cleared its disable record first. A refused delete then left the package missing until a restart, and brought a disabled package back enabled.

An uninstall refused because another package extends an object this package owns still answers `500` with nothing changed: the stored rows, the registry entry and the disable record all stay as they were, in the same process and after a restart. That refusal is now decided before the store delete, instead of by the door withdrawing the package first. An ordinary uninstall, and a host with no `package` service, are unchanged.
