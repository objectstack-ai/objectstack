---
'@object-ui/types': patch
---

feat(types): `@object-ui/types` publishes the upload adapter contract, `UploadAdapter`, `UploadOptions` and `UploadResult`

Clause-②: yes (widening)
Metadata-protocol: none

The three interfaces the file, image and avatar widgets upload through, unchanged in shape from the `@object-ui/providers` package they leave. They live here, as `DataSource` does, because `@object-ui/fields` (whose `UploadProvider` reads an adapter) and `@object-ui/data-objectstack` (whose `createObjectStackUploadAdapter` builds one) do not depend on each other. A host that writes its own adapter types it from here. Nothing existing changes.
