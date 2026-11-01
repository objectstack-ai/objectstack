---
"@objectstack/objectql": patch
---

Clause-②: yes (widening) — `SchemaRegistry.uninstallPackage` gains an optional `options` parameter
Metadata-protocol: none

fix(objectql): a package refused while it registers leaves nothing of itself registered

When `ObjectQL.registerApp` refuses a package, the package is no longer left partly registered. Before, the package record, its objects and its apps could stay in the running system until restart. What is refused, and every refusal's code, status and words, is unchanged.

- **A first install that is refused** (a fresh package id) leaves no package record, object, extension, app, item, picklist extension, navigation contribution, contributed kind, datasource definition or nested-plugin namespace behind. The same id can then be installed again once the package is fixed. A persisted "disabled" state for that id still applies to its next install.
- **A refused upgrade of an installed package** whose body alone is at fault (for example an item that names another package as its owner) leaves the installed version serving, untouched.
- `SchemaRegistry.uninstallPackage(id, options?)` takes an optional `{ keepBootSeed: true }`. The engine passes it when it withdraws a refused first install. An operator's uninstall omits it and behaves as before.

A body with more than one defect may now be refused for a different one of them than before, because refusals that depend only on the body are now checked before the others.
