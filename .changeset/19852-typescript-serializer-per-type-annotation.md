---
"@objectstack/metadata": patch
---

`TypeScriptSerializer` no longer annotates every `typescript`-format file `ServiceObject` (#19852). A saved view, or any other item that is not an object, used to be written as `export const metadata: ServiceObject = { … }`: a false annotation, which `tsc` refused with TS2353 (for a view, `'"type"' does not exist in type …`).

If you type-check the `.ts` files that `MetadataManager.save()` / `FilesystemLoader.save()` write:

- An `object` file written by the built-in serializer the package wires in is byte-identical: `import type { ServiceObject } from '@objectstack/spec/data'` and `export const metadata: ServiceObject = …`.
- Every other metadata type whose spec type is exactly the `z.input` type of its schema is now annotated with that type instead: `Flow` (`@objectstack/spec/automation`) for a `flow`, `Page` (`@objectstack/spec/ui`) for a `page`, `PermissionSet` (`@objectstack/spec/security`) for a `permission`, and so on: 28 annotated metadata types, `object` included. `tsc` now checks such a file against its own type instead of `ServiceObject`.
- `view`, `book`, `external_catalog` and any other metadata type (a plugin's own, for example) are written with no annotation and no import: `export const metadata = { … };`. `ViewMetadata` is `unknown` and `Book` is narrower than `BookSchema`, so neither would be a true annotation.
- A serializer you wire into `FilesystemLoader` by hand is called as it always was: a custom one, or a subclass that overrides `serialize()`, writes what its `serialize()` writes, and a `TypeScriptSerializer` taken from the package's other entry point (`.` versus `./node`) writes no annotation.
- If you call `TypeScriptSerializer.serialize()` yourself, it now writes no annotation for any item, an object included. It used to write `ServiceObject` whatever the item was, and it cannot know the item's metadata type, so that annotation could be false. The loader picks the annotation through a package-internal function. The public API is unchanged: `SerializeOptions` and every declaration the package exports are as before.

Reading is unchanged: `deserialize` still reads the first JSON block, so a file written before this fix, `ServiceObject` annotation and all, still reads back. The `javascript` format is unchanged.
