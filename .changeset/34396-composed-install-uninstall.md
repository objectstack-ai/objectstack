---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): uninstalling a composed app through install-local uninstalls every package body it installed

Clause-②: no
Metadata-protocol: none

A composed release artifact (ADR-0130 D4: one `type: app` package and `type: module` packages) installs through `POST /api/v1/marketplace/install-local` as one install entry that registers every package body. When one module declared `objectExtensions` on the app's objects, the app could not be uninstalled: `DELETE /api/v1/marketplace/install-local/APP_ID` answered `409 RESOURCE_CONFLICT` and told the operator to uninstall the module first, but the module has no install entry of its own (`404 RESOURCE_NOT_FOUND`) and the package door refuses it as read-only (`422 WRITABLE_PACKAGE_REQUIRED`). Nothing could be removed, and the only way out was deleting the cached manifest on the host and restarting.

The install entry's uninstall now removes the same unit its install registered. Every member is withdrawn from the running kernel, and an extension that one member contributes to another member's object decides the order instead of refusing the uninstall: the extending module goes first, then the package it extends. Each member's uninstall cleanups run for its own package id, so the permission sets of a module go with it.

What does not change:

- An extension or a paired customization package from a different install still refuses the uninstall with the registry's own `409 RESOURCE_CONFLICT`, naming that package, and nothing is removed.
- A single-package install is withdrawn alone, as before.
- A module of a composed artifact still has no install entry of its own and is still read-only. It is uninstalled through its artifact's entry.
