---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix: when the store refuses an uninstall's `sys_packages` delete, the uninstall now answers the failure and removes nothing else, instead of answering success and coming back after the next restart (#21276)

Clause-②: no

**`@objectstack/metadata-protocol`.** `deletePackage` now deletes the package's `sys_packages` row first, before its `sys_metadata` rows, its tables, its registry entry and the rows the uninstall cleanups own. When the `package` service refuses that delete, whether it returns `{ success: false }` or throws, `deletePackage` throws and nothing else is removed. A store fault answers `500`, with `DATABASE_ERROR` from a live SQL driver and `INTERNAL_ERROR` otherwise. A declared 4xx refusal is passed through unchanged. Before this, the refusal was logged as a warning, and `DELETE /api/v1/packages/:id` answered `200` after the package's metadata, tables and grants had been removed. The package then came back after the next restart.

**`@objectstack/runtime`.** `DELETE /api/v1/packages/:id` now asks `deletePackage` before it touches anything. It checks that the package exists with a read, and it withdraws the package from the running registry and clears its saved disable record only after `deletePackage` has answered. So when the store refuses, the door answers `500`, the same process keeps serving the package, and a package that was disabled stays disabled after a restart. Before this, the door withdrew the package and cleared its disable record first. A refused delete then left the package missing until a restart, and brought a disabled package back enabled.

One refusal can still come after the stored rows are deleted. If another package extends an object this package owns, the running registry refuses to withdraw it. The door then answers `200` with `registryRemoved: false`, and the package leaves the running process at the next restart. Before this change, the door refused that delete up front with a `500` and changed nothing. An ordinary uninstall, and a host with no `package` service, are unchanged.
