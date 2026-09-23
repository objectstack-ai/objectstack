---
"@objectstack/metadata": patch
---

`TypeScriptSerializer` no longer annotates every `typescript`-format file `ServiceObject` (#19852). A saved view, or any other item that is not an object, used to be written as `export const metadata: ServiceObject = { … }`: a false annotation, which `tsc` refused with TS2353 (for a view, `'"type"' does not exist in type …`).

If you type-check the `.ts` files that `MetadataManager.save()` / `FilesystemLoader.save()` write:

- An `object` file is byte-identical: `import type { ServiceObject } from '@objectstack/spec/data'` and `export const metadata: ServiceObject = …`.
- Every other metadata type whose spec type is exactly the `z.input` type of its schema is now annotated with that type instead: `Flow` (`@objectstack/spec/automation`) for a `flow`, `Page` (`@objectstack/spec/ui`) for a `page`, `PermissionSet` (`@objectstack/spec/security`) for a `permission`, and so on, 28 metadata types in all. Such a file now fails `tsc` only where its content is not a valid item of its own type.
- `view`, `book`, `external_catalog` and any other metadata type (a plugin's own, for example) are written with no annotation and no import: `export const metadata = { … };`. `ViewMetadata` is `unknown` and `Book` is narrower than `BookSchema`, so neither would be a true annotation.
- If you call `TypeScriptSerializer.serialize()` yourself, pass the item's metadata type as the new optional `SerializeOptions.metadataType` to get its annotation. Without it the file carries no annotation (it used to carry `ServiceObject`).

Reading is unchanged: `deserialize` still reads the first JSON block, so a file written before this fix, `ServiceObject` annotation and all, still reads back. The `javascript` format is unchanged.
