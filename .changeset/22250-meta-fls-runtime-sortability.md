---
"@objectstack/metadata-core": minor
"@objectstack/rest": minor
"@objectstack/runtime": patch
---

fix(metadata): the object read's `sortability` follows the caller's field permission for every caller class

Clause-②: yes (widening)

- **What was wrong.** ADR-0106 D4 serves a caller holding `manage_metadata`, `studio.access` or `setup.access` (a platform admin, and an organization admin through `setup.access`) the object schema UNMASKED, because Studio and Setup authoring need the whole definition. The `sortability` projection served beside it on `GET /meta/object/:name` (and the runtime dispatcher's `/metadata/object/:name`) was derived from that unmasked document, so it marked a field `sortable: true` that the same caller's field permission marks unreadable, while the data route refuses a sort or filter on that field with `403 PERMISSION_DENIED`. A client building its sort picker from the projection offered a click the server refuses.
- **What changes.** `sortability` is now derived from the caller's runtime view: the served document for every caller the mask projects (unchanged), and for a D4-exempt caller the fields their own field permission reads. The definition (`item.fields`) is unchanged for every class: whole for an exempt caller, masked for everyone else. The data route and `/auth/me/permissions` are unchanged.
- **Caching.** On the cached `GET /meta/object/:name` branch an exempt caller's ETag folds a fingerprint of the fields withheld from their projection, and the conditional request is judged after it is folded. An exempt caller whose permission withholds nothing keeps the byte-identical ETag. An exempt caller and a projected caller denied the same field never share a validator.
- **Failure posture.** The exempt caller's field permission is asked lazily, only by the item read that serves `sortability`, and never turns their definition read into a fault: if the security service throws or cannot answer, `sortability` is derived from the served document as before, with one `warn`.
- **New in `@objectstack/metadata-core`.** `resolveObjectSchemaRuntimeView(document, posture)` returns `{ document, withheld, fingerprint }`, the view the runtime projections beside an object schema are derived from. The types `ObjectSchemaRuntimeView` and `ObjectSchemaRuntimeFieldPosture` are exported with it, and the `passthrough` member of `ObjectSchemaMaskPosture` gains an optional `runtime` (set on an `exempt` posture for a capability-exempt caller in a deployment with a `security` service).
- **New in `@objectstack/rest`.** `translateMetaEnvelope` takes an optional fifth argument, `runtimeDocument` (default: the served document), and `MetaItemAnswerSources.translateEnvelope` an optional third. Nothing is removed, renamed or narrowed.
