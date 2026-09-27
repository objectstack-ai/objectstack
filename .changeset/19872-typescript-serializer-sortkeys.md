---
"@objectstack/metadata": patch
---

`sortKeys` — a declared `MetadataSaveOptions` field, already honoured by the `json` and `yaml`
formats — is now honoured by the `typescript` / `javascript` formats too (#19872).

`TypeScriptSerializer` wraps a JSON body in `export const metadata = { … };`. Both its public
`serialize()` and the package-internal `serializeTypeScriptForMetadataType()` (the one
`FilesystemLoader.save()` calls for the built-in `typescript` serializer, `save()`'s default
format) share one `renderModule()` code path, and neither read `options.sortKeys` — so a caller
saving metadata to the filesystem with `sortKeys: true` got unsorted keys in the default format,
silently. `javascript` shares the same `TypeScriptSerializer` class and the same path, so it was
affected too and is fixed the same way.

The body is now sorted with the exact recursive (deep) key sort `JSONSerializer` already applies
— extracted into one shared, package-internal helper (`sort-object-keys.ts`, not published from
any `@objectstack/metadata` `exports` entry) so there is one sort implementation, not two.
`sortKeys` absent or `false` is unchanged: byte-identical output to before this fix, for every
format, including through `FilesystemLoader.save()`.

No public API changes — `SerializeOptions` already declared `sortKeys`; this closes the gap
between the declaration and the `typescript`/`javascript` formats' enforcement of it.
