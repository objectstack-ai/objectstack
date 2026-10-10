---
'@objectstack/objectql': patch
---

An app, object or other item registered through `ObjectQL.registerApp` is now served with its package's `_packageVersion`, as the artifact loader already serves it

Clause-②: no

`_packageVersion` ("Owning package version") is declared on the protection envelope, and the metadata plugin's artifact loader stamps it. The registry load path stamped only `_packageId`: `ObjectQL.registerApp(manifest)` called `SchemaRegistry.registerItem` and `registerObject` with the package id alone. So `GET /api/v1/meta/app` served such an app with no version, and a console waiting for an upgrade could not tell the new app from the old one that a stale kernel still serves.

`registerApp` now passes `manifest.version` to every stamping call it makes: owned objects, object extensions, apps, every metadata collection, seed datasets, and the objects, app and collections of a nested plugin, which carry their owning package's version. `SchemaRegistry.registerItem`, `registerObject` and `registerApp` take an optional trailing `packageVersion` argument for this.

A caller that passes only a package id still stamps the id alone. No version is looked up or invented. Those callers are the metadata-service re-sync and the facade, which pass along the stamp the artifact loader already put on the item; the stored-row hydration, whose rows are tenant-authored; and the security catalog's built-ins.
