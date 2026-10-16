---
'@objectstack/objectql': patch
---

fix(objectql): an uninstall refused because another package extends one of its objects answers `409 RESOURCE_CONFLICT` with the way out, instead of `500 INTERNAL_ERROR` (ADR-0029)

Clause-②: no

`SchemaRegistry.assertPackageUninstallable` refuses to uninstall a package while another package extends an object it owns (a manifest's `objectExtensions`, ADR-0029). `unregisterObjectsByPackage` and `uninstallPackage` raise the same refusal, because they ask it. When the refusal happens does not change, and a refused uninstall still removes nothing. Only the error it throws changes.

**FROM.** The error was a bare `Error` with no `code` and no `status`. Its message, `Cannot uninstall package "P": object "O" is extended by E. Uninstall extenders first.`, named only the first extended object. `DELETE /api/v1/packages/P` answered `500 INTERNAL_ERROR`, a server failure, although the caller can change the state that blocks the uninstall.

**TO.** The error carries `code: 'RESOURCE_CONFLICT'` and `status: 409` (and `httpStatus: 409`), so `DELETE /api/v1/packages/P` answers `409 RESOURCE_CONFLICT`. The message starts with the way out: `Uninstall the package that extends an object of "P" first (E), then uninstall "P" again: …`. It then names every extended object with the packages that extend it: the first five objects, then a count of the rest. The thrown error also carries `packageId`, `extendedObjects` and `extenders`.

**Unchanged.** A package is refused in the same cases as before. A refused uninstall changes nothing: the `sys_packages` row, the registry entry, the stored metadata rows and the disable record all stay. `unregisterObjectsByPackage(id, true)` still does not ask.

**If you matched the old text.** Match `error.code === 'RESOURCE_CONFLICT'` (HTTP `409`) instead. The message still contains `Cannot uninstall package "P": object "O" is extended by E`, after the way out. The closing `Uninstall extenders first.` is gone.
