---
'@objectstack/runtime': patch
---

feat(runtime): a host can supply where module enable/disable state lives — `createPackageStateStorePlugin(store)` — and a store that refuses a write makes the enable or disable door fail with nothing changed

Clause-②: yes (widening)
Metadata-protocol: none

Package lifecycle state (which packages an operator has disabled) has lived only in a file under `OS_HOME`, which a hosted container loses when it is replaced. `@objectstack/runtime` now exports the seam a host uses to keep it elsewhere:

- **`PackageStateStore`**: `loadDisabledPackageIds(environmentId)` and `setPackageDisabled(environmentId, packageId, disabled)`, either may return a promise.
- **`createPackageStateStorePlugin(store)`** (and the `PackageStateStorePlugin` class it builds): add it to the kernel's plugins. It registers the store as the `PACKAGE_STATE_STORE_SERVICE` (`'package-state-store'`) service under the plugin name `PACKAGE_STATE_STORE_PLUGIN_NAME`, which `AppPlugin` lists in its `optionalDependencies`, so the store is in place before the boot seed reads it whatever slot it is composed in. A store missing either method is refused with a `TypeError`.

With a host store composed, the boot seed reads it instead of the file, and the package doors (install, `PATCH /packages/:id/enable`, `PATCH /packages/:id/disable`, `DELETE /packages/:id`) write to it; the file under `OS_HOME` is neither read nor written. A host store that throws:

- on a write from the enable or disable door: the door changes nothing in memory and answers `503 SERVICE_UNAVAILABLE`, saying the switch did not happen and can be retried. The doors now write the store before they switch the package.
- on a write from install or delete, whose change has already landed: logged at `error`, naming what the next boot will read.
- on the boot read: the boot fails, naming the store, rather than bring every disabled package back enabled.

A store registered under the service name by a plugin of the host's own, which nothing orders ahead of `AppPlugin`, fails `AppPlugin.start()` with the fix (use `createPackageStateStorePlugin`), instead of serving a boot seeded from the file while the doors write to the store.

Without a host store nothing changes: the same file, the same bytes, and a failed file write still only warns.
