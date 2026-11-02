---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

docs(metadata-protocol, objectql): three docblocks say where a code package's `objectExtensions` go: never stored as `object_extension` items or into the metadata service, but registered by the engine's `registerApp` as `'extend'` contributors (#28874)

Clause-②: no
Metadata-protocol: none

Comment only, with no behaviour change. The header of `protocol-object-extension-item.ts`, the `foldObjectExtendersFromRegistry` docblock in `protocol.ts` and the `SchemaRegistry#foldObjectExtendersOnto` docblock each said that a compiled artifact's `objectExtensions` are stored (as `object_extension` items, or as a separate collection of the metadata service). They are not. The ObjectQL engine's `registerApp` registers each one as an `'extend'` contributor of its target object. The artifact loader maps the collection to `object_extension` but files no item from it, because an extension carries `extend` and no `name`. The type's items are the stored rows the `/api/v1/meta` doors write. The wording matches the `@objectstack/spec` registry row comment (#28873). A patch changeset is used because the corrected docblocks ship in each package's `dist` declarations.
