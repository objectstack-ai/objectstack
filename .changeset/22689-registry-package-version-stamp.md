---
'@objectstack/objectql': patch
---

An app, object or other item registered through `ObjectQL.registerApp` is now served with its package's `_packageVersion`, as the artifact loader already serves it

Clause-②: no

`_packageVersion` ("Owning package version") is declared on the protection envelope, and the metadata plugin's artifact loader stamps it. The registry load path stamped only `_packageId`: `ObjectQL.registerApp(manifest)` called `SchemaRegistry.registerItem` and `registerObject` with the package id alone. So `GET /api/v1/meta/app` served such an app with no version, and a console waiting for an upgrade could not tell the new app from the old one that a stale kernel still serves.

`registerApp` now stamps `manifest.version` on every item it registers: owned objects, object extensions, apps, every metadata collection, seed datasets, and the objects, app and collections of a nested plugin, which carry their owning package's version. A multi-package stack's residual top-level objects, which the engine registers under the stack's own id, now carry the stack's version too, as the metadata door stamps them. Each item is stamped before it reaches the registry, with the artifact loader's own call, `applyProtection(item, { packageId, packageVersion })`. The registry's stamp knows the id only, and it keeps a version that is already set. No signature changes: `SchemaRegistry.registerItem`, `registerObject` and `registerApp` keep theirs.

A caller that passes only a package id still stamps the id alone. No version is looked up or invented. Those callers are the metadata-service re-sync and the facade, which pass along the stamp the artifact loader already put on the item; the stored-row hydration, whose rows are tenant-authored; and the security catalog's built-ins.
