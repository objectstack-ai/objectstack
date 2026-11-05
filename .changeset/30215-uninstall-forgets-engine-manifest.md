---
'@objectstack/objectql': patch
---

fix(objectql): an uninstalled package no longer reads as read-only until a restart

Clause-②: no
Metadata-protocol: none

An administrator who uninstalled a package through `DELETE /api/v1/marketplace/install-local/:id` got a 200 "withdrawn from the running kernel", but on the same instance the package id still read as a booted code package: `POST /api/v1/packages/:id/ensure-customization` answered `writable: false`, and authoring into it was refused with `WRITABLE_PACKAGE_REQUIRED`, until the server restarted. The engine's manifest map, which the ADR-0070 writability check reads first, kept the id after the registry had withdrawn the package.

`SchemaRegistry.uninstallPackage` now announces each completed uninstall to `onPackageUninstalled` listeners, after the package record is gone (never for a refused uninstall), and the engine drops its manifest entry there, so the id is released on whichever door withdrew the package, not per door. A reinstall of the same id registers it again as before. A listener that throws does not turn the completed uninstall into a refusal; it is logged at `error`.
