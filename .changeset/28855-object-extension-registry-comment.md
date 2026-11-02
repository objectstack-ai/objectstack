---
'@objectstack/spec': patch
---

docs(spec): the `object_extension` registry row's comment now says what happens to a code package's `objectExtensions`

Clause-②: no
Metadata-protocol: none

The `//` comment above the `object_extension` row of `DEFAULT_METADATA_TYPE_REGISTRY` (`src/kernel/metadata-plugin.zod.ts`, which ships in the package) said the artifact loader stores a code package's `objectExtensions` under this type. It does not: the ObjectQL engine's `registerApp` registers each extension as an `'extend'` contributor of its target object, and the artifact loader files no item from that collection because an extension carries `extend` and no `name`. The comment now says so, and that this type's items are the stored rows the `/api/v1/meta` doors write. Comment only: no key, row field or schema changes.
