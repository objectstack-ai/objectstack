---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol, objectql): a disabled package's export carries its items, so a re-install no longer loses them

Clause-②: no
Metadata-protocol: none

`GET /api/v1/packages/:id/export` and the whole-deployment bundle `GET /api/v1/packages/export` answered a disabled package as an empty package: its id, name and version, and none of its objects, views, dashboards or other items. Installing that entry elsewhere answered 200 and left the items absent. The bundle's own contract (`PackageExportBundleSchema`) exports every package "enabled or not" and installs it enabled, so a tenant who switched a package off and exported the deployment silently lost its contents.

The export reads each package through the protocol's per-package layer (`getMetaItemsPerPackage`), and that layer hid a disabled package's items the way the served reads do. It now keeps them: a disable leaves the items stored, and the package's own address still holds them. Every served and executed read (`/meta/*`, the console, the automation engine) still hides them, unchanged.

`SchemaRegistry.listItems(type, packageId, options)` gains an optional third argument, `{ includeDisabledPackages: true }`, which only the per-package layer passes. Without it the list hides a disabled package's items, as before.
