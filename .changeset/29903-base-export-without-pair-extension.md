---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql, metadata-protocol): a base package's own export carries its objects without its `.custom` pair's extension

Clause-②: yes (widening)
Metadata-protocol: none

After an administrator added a field to a vendor package's object through Studio's Customize (an extension published in `<base>.custom`, for example `region__c`, or a relabelled base field), `GET /api/v1/packages/<base>/export` carried that field and label inside the base's object, as if the vendor had shipped them. The pair's export carries the same extension as its `objectExtensions` entry, so installing the two exports elsewhere declared the customer's field twice, once as the vendor's. ADR-0146 D8 item 3 says the base's export carries the base unchanged.

- **The base's export** (and its entry in `GET /api/v1/packages/export`) now carries each object as the base declares it, with no field, label or other patch from its pair's extension.
- **The pair's export** is unchanged: it carries the extension in `objectExtensions`.
- **Every served read is unchanged**: `GET /api/v1/meta/object/<name>`, the object list, the console and the data API keep serving the object with the pair's field and labels folded in.


`SchemaRegistry.listItems` takes a `withoutExtensionsOf` option beside `includeDisabledPackages`, and `getAllObjects` and `foldObjectExtendersOnto` take the same option: each object is resolved with that package's `extend` contributions left out of the fold. Only the metadata protocol's per-package layer (the package export) passes it.
