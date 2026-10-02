---
'@objectstack/metadata-protocol': patch
---

fix: when the store refuses an uninstall's `sys_packages` delete, the uninstall now answers the failure and removes nothing else, instead of answering success and coming back after the next restart (#21276)

Clause-②: no

`deletePackage` now deletes the package's `sys_packages` row first, before its `sys_metadata` rows, its tables, its registry entry and the rows the uninstall cleanups own. When the `package` service refuses that delete, whether it returns `{ success: false }` or throws, `deletePackage` throws and nothing else is removed. A store fault answers `500`, with `DATABASE_ERROR` from a live SQL driver and `INTERNAL_ERROR` otherwise. A declared 4xx refusal is passed through unchanged. Before this, the refusal was logged as a warning, and `DELETE /api/v1/packages/:id` answered `200` after the package's metadata, tables and grants had been removed. The package then came back after the next restart.

`DELETE /api/v1/packages/:id` now answers `500` for that refusal, and after a restart the package is served again with its metadata. That door still withdraws the package from the running registry before it calls `deletePackage`, so the same process stops serving the package until it restarts. An ordinary uninstall, and a host with no `package` service, are unchanged.
