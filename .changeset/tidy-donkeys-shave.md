---
"@objectstack/cli": patch
---

`objectstack serve` now mounts the local-install surface on a runtime with the cloud switched off (#8343).

`OS_CLOUD_URL=off` — the value the self-hosted EE compose file documents for a fully self-hosted box — used to skip the entire marketplace wiring block, including `MarketplaceInstallLocalPlugin`. That plugin serves `os package install ./dist/objectstack.json`, the documented air-gapped path, whose inline-manifest branch reads no cloud URL at all. The result, measured on a customer deployment: `GET` and `POST /api/v1/marketplace/install-local` both 404 with no other package-install surface available, so the deployment could not install a package by any route.

The registration condition is now split by what each surface actually needs. The control-plane clients (marketplace browse proxy, cloud-connection, pushed runtime-config) still require a resolved cloud URL; the local install surface mounts regardless, pinned to no control plane so its catalog branch answers `503 MARKETPLACE_UNAVAILABLE` locally rather than dialling out. A host config that wires its own install-local keeps it, and the runtime host-kernel skip is unchanged.

Only runtimes that explicitly disabled the cloud (`off`/`none`/`local`/`disabled`) change behaviour: they gain the install-local routes and the "Installed Apps" Setup entry that ships with them. A plain `objectstack dev` sets no `OS_CLOUD_URL`, which resolves to the public default cloud, so it already mounted both and is unaffected.
