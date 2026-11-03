---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(objectql, metadata-protocol, runtime): a package's export carries the `objectExtensions` it was installed with, and the extended object's owner's export does not

Clause-②: yes (widening)
Metadata-protocol: none

A package installed through `POST /api/v1/marketplace/install-local` (what `os package install` sends, and how every entry of a whole-deployment export is restored) that extends another package's object exported without its `objectExtensions`: `GET /api/v1/packages/<id>/export` answered the package's other items and no extension, while the extension's fields were folded into the owner's export instead, as if the owner had shipped them. So a deployment restored from an export lost those fields on its next export, with no error, and a `.custom` pair installed from its export no longer exported its extension.

- **The extending package's export** (and its entry in `GET /api/v1/packages/export`) now carries every extension it contributes as `objectExtensions`, however it was installed: an extension published through `/api/v1/meta/object_extension` (as before) or a manifest's `objectExtensions` entry (install-local, or a code package). A published extension is exported as it is stored; a manifest entry as it was registered, with `priority` written only when it is not the default `200`.
- **The extended object's owner's export** now carries the object as the owner declares it, without the fields, field patches or labels of ANY other package's extension. Until now only its own `.custom` pair's extension was left out; an extension from any other installed package was folded in.
- **Every served read is unchanged**: `GET /api/v1/meta/object/<name>`, the object list, the console and the data API keep serving the object with every extension folded in.

`SchemaRegistry` gains `getObjectExtensionsOf(packageId)`, which reads a package's `extend` contributions back as the `objectExtensions` entries they were registered from (the inverse of `registerObjectExtension`). `listItems`, `getAllObjects` and `foldObjectExtendersOnto` take an `onlyExtensionsOf` option beside `withoutExtensionsOf`: each object is resolved with only that package's `extend` contributions folded in. The metadata protocol's per-package layer (the package export) now passes `onlyExtensionsOf`, naming the listed package, and no longer passes `withoutExtensionsOf`, which keeps its meaning for any other caller.

Supersedes, in the same release: the `.custom` pair note for #29903 says an extension contributed by any other installed package is still folded into the base's object in the base's export. After this change it is not: the base's export leaves out every other package's extension, and that package's own export carries it.
