---
"@objectstack/objectql": patch
---

Clause-②: no
Metadata-protocol: none

fix(objectql): a refused first install leaves nothing of itself, even over a tenant's object

A first install of a package that `ObjectQL.registerApp` refuses part-way now leaves nothing of itself registered in every case, including when the package layers over an object a tenant already holds (with or without the tenant's own overlay), over an overlay with no owner, or over another package's extension of one of its objects. Afterwards there is no package record, object, extension, app, item, picklist extension, namespace, navigation contribution, contributed kind or datasource definition of the package, and the tenant's object, its overlay and the other package's extension read exactly as before the attempt. A persisted "disabled" state for that id still applies to its next install. What is refused, and every refusal's code, status and words, is unchanged.

Every registration is now put back by the registry itself when it is refused, the way a refused upgrade already was. This supersedes the line of the pending `28697-refused-registration-leaves-nothing` changeset saying the engine passes `{ keepBootSeed: true }` to `SchemaRegistry.uninstallPackage`: the engine no longer uninstalls a refused first install. The option itself stays available and unchanged.
