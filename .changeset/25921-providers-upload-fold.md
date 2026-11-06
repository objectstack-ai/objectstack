---
'@object-ui/fields': patch
'@object-ui/data-objectstack': patch
---

refactor(fields, data-objectstack)!: `UploadProvider` moves into `@object-ui/fields`, the ObjectStack upload adapter into `@object-ui/data-objectstack`, and `@object-ui/providers` is retired

Clause-②: yes (narrowing) — `@object-ui/fields` gains `UploadProvider`, `useUpload`, `UploadProviderProps` and the three upload contract types, and `@object-ui/data-objectstack` gains `createObjectStackUploadAdapter` and `ObjectStackUploadAdapterOptions`; the whole `@object-ui/providers` package is retired, which takes `createS3Adapter`, `createAzureBlobAdapter`, their option types and the exported `createObjectUrlAdapter` with it.
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/providers#*) the retired operand is a published ui package whose entry held a React upload context, its hook, four upload adapter factories and their TypeScript option and result types; no packages/spec schema, registered node type, ADR-0087 conversion surface or stored shape names any of them, so there is nothing for `objectstack migrate meta` to rewrite, and a consumer meets the move at its own import, where the compiler names the missing module -->

**BREAKING.** `@object-ui/providers` is retired: `18.3.0` is its last published version, and it gets no further release. Its one remaining job was the upload context the file, image and avatar widgets of `@object-ui/fields` upload through, so that context now lives in `@object-ui/fields` itself, and the adapter that talks to an ObjectStack server's storage service lives in `@object-ui/data-objectstack`, beside the other fetch logic against that server. The upload contract the two share is `@object-ui/types`'.

What leaves, and what to do:

- FROM `@object-ui/providers` TO `@object-ui/fields` and `@object-ui/data-objectstack`: import `UploadProvider`, `useUpload` and the `UploadProviderProps`, `UploadAdapter`, `UploadOptions` and `UploadResult` types from `@object-ui/fields` (the three contract types also from `@object-ui/types`), and `createObjectStackUploadAdapter` with `ObjectStackUploadAdapterOptions` from `@object-ui/data-objectstack`, then drop the `@object-ui/providers` dependency. `createS3Adapter`, `createAzureBlobAdapter`, `S3AdapterOptions` and `AzureBlobAdapterOptions` had no consumer and leave with no replacement: a host that uploads to its own bucket writes an object with a `name` and an `upload(file, options)` method against the `UploadAdapter` type of `@object-ui/types` and hands it to `UploadProvider`. `createObjectUrlAdapter` is no longer exported: it stays the local `blob:` adapter `useUpload` falls back to when no `UploadProvider` is mounted.

What does not change: `UploadProvider`, `useUpload` and `createObjectStackUploadAdapter` keep their signatures and behaviour, the presigned upload request is the same, and the widgets read the same context.
