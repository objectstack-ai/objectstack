---
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an install-local install connects and records the datasources the package declares, as a boot of its artifact does

Clause-②: yes (widening)
Metadata-protocol: none

A package installed through `POST /api/v1/marketplace/install-local` had its objects registered and nothing of its datasources: an object bound to the package's own datasource answered `404 OBJECT_NOT_FOUND` on every read and write, and the datasource was not served as code-defined. Now the install, and every restart's rehydrate of the ledger, take the path a boot of the package's artifact takes:

- **One path.** `@objectstack/runtime` exports `connectPackageDatasources`, which `AppPlugin.start` now calls for the booted artifact and install-local calls for an installed package. Each declared datasource is registered in the metadata registry as `origin: 'code'`, stamped with the package (`_packageId`, `_packageVersion`), its name is recorded in the host's code-datasource set, and it is connected through the `datasource-connection` service's `connectDeclared` (the ADR-0062 D2 gate and the host's connect policy apply as on a boot). The boot's own behaviour is unchanged.
- **The install answer** carries `datasources`: each declared datasource's connect verdict (`connected`, or the connection service's own non-`ok` status). Omitted for a package that declares none.
- **A credential that cannot be resolved** is that datasource's named non-`ok` verdict, never a driver gap: the package is installed, Setup → Datasources reports the datasource as `error` with its reason, and a read of an object bound to it answers `503 ERR_DATASOURCE_UNAVAILABLE` naming it. Where a code datasource's credential comes from is not changed here.
- **Reinstall and uninstall.** A reinstall replaces the previous version's datasources; the uninstall closes their pools, removes their registrations and their names, reported as the `runtime.package-datasources` entry in `cleanups`.
- **A name already held** — the host's `default`, a datasource created in Setup, another package's — refuses the install `409 RESOURCE_CONFLICT` (`details.datasource`) before anything is written.
