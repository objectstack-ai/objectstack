---
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: an install-local install connects and records the datasources the package declares, as a boot of its artifact does

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object or datasource definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the install-local door's accept set: a package whose declared datasource name is already held in the target environment is refused `409` where it was installed `200`. Whether a package is refused depends on what the environment already holds, not on the package's metadata, and the package's metadata stays valid as written; the remedy is the author's choice of a datasource name that is not taken, never a mechanical rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed, only added (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** accept-set narrowing at `POST /api/v1/marketplace/install-local`, alongside the widening below (a new `@objectstack/runtime` export and a new field on the install answer).

- **Before.** A package declaring a datasource whose name the environment already held (the host's `default`, a datasource created in Setup, another package's) installed `200`, and its declaration was dropped: measured on `main` with a package declaring `showcase_external`, the install answered `200` with `hotLoaded: true`.
- **Now.** The same install is refused `409 RESOURCE_CONFLICT`, with `details.datasource` naming the held name, before anything is written. Accepting it now would serve the package's objects from the holder's pool (the connect is idempotent on the name) and, by recording the name as code, make the holder's own datasource read-only.
- **Unchanged.** A package that declares no datasource, or only names nothing else holds, installs as before; a reinstall of the same package is not a collision with itself.
- **Who sees it.** Only an install-local caller (`os package install`, an AI agent, a script) installing a package whose datasource name collides with one the environment already has.

**The remedy.** Give the package's datasource a name the environment does not already hold, and install again.

**What else changes.**

A package installed through `POST /api/v1/marketplace/install-local` had its objects registered and nothing of its datasources: an object bound to the package's own datasource answered `404 OBJECT_NOT_FOUND` on every read and write, and the datasource was not served as code-defined. Now the install, and every restart's rehydrate of the ledger, take the path a boot of the package's artifact takes:

- **One path.** `@objectstack/runtime` exports `connectPackageDatasources`, which `AppPlugin.start` now calls for the booted artifact and install-local calls for an installed package. Each declared datasource is registered in the metadata registry as `origin: 'code'`, stamped with the package (`_packageId`, `_packageVersion`), its name is recorded in the host's code-datasource set, and it is connected through the `datasource-connection` service's `connectDeclared` (the ADR-0062 D2 gate and the host's connect policy apply as on a boot). The boot's own behaviour is unchanged.
- **The install answer** carries `datasources`: each declared datasource's connect verdict (`connected`, or the connection service's own non-`ok` status). Omitted for a package that declares none.
- **A credential that cannot be resolved** is that datasource's named non-`ok` verdict, never a driver gap: the package is installed, Setup → Datasources reports the datasource as `error` with its reason, and a read of an object bound to it answers `503 ERR_DATASOURCE_UNAVAILABLE` naming it. Where a code datasource's credential comes from is not changed here.
- **Reinstall and uninstall.** A reinstall replaces the previous version's datasources; the uninstall closes their pools, removes their registrations and their names, reported as the `runtime.package-datasources` entry in `cleanups`.
