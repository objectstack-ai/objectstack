---
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an install-local install judges who holds a datasource name with one judge that reads the engine too and fails closed, and a restart's rehydrate no longer takes over a name another holder owns

Clause-②: yes (widening)
The widening: `@objectstack/runtime` now exports `datasourceNameHolder` and the type `DatasourceNameHolding`, and `POST /api/v1/marketplace/install-local` gains a `503 SERVICE_UNAVAILABLE` answer.
Metadata-protocol: none

Three edges `POST /api/v1/marketplace/install-local`'s datasource-name check left open, each measured on `main`:

- **A holder that cannot be read.** When the metadata registry's read of a declared datasource name threw, the check skipped it and the install went ahead (`200`). It now answers `503 SERVICE_UNAVAILABLE` with `details: { datasource, reading }` and writes nothing: a check that did not run is never taken for "no holder". Retry once that store answers.
- **A datasource registered on the data engine only** (the legacy `onEnable` bridge, which leaves no metadata item) was not seen: the install answered `200` and reported that pool as the package's `already-registered`. It now holds its name, `409 RESOURCE_CONFLICT` like every other holder.
- **A package installed before the check existed.** A restart's rehydrate replayed such a package's datasources over a datasource created in Setup under the same name: the Setup item was overwritten by the package's code registration, the name joined the code-defined set (the Setup row turned read-only), and the package's uninstall closed and evicted the Setup row's pool. The rehydrate now leaves a held name alone: it is not registered, recorded or connected for the package, one `error` line names it, its holder and the remedy, and the uninstall does not touch it. An uninstall also closes only the pools the package's own connect opened, never one it found already registered.

`@objectstack/runtime` exports `datasourceNameHolder`, the one judge both the install door and the rehydrate use: the host's `default`, a metadata item not stamped with the package (a Setup row, another package's), a name in the code-datasource set the package did not record, then a driver on the data engine.

**The remedy** for a package the rehydrate now reports: rename the package's datasource and install it again, or remove the datasource holding the name and restart.
