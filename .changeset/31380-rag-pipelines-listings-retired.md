---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata': minor
'@objectstack/runtime': minor
---

refactor(spec): retire the `ragPipelines` collection listings no stack can declare, and with them the `rag_pipeline` metadata type at the `/meta` door (#31380)

Clause-②: no (narrowing) — `PLURAL_TO_SINGULAR` (a published `@objectstack/spec` export, typed `Record<string, string>`) loses its `ragPipelines` row, so `/meta/rag_pipeline` leaves the URL-spelling contract and a write there is refused where it was stored before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: registered meta-type-rag-pipeline-retired -->

**BREAKING** for a client that writes metadata under the type `rag_pipeline` through `PUT /meta/rag_pipeline/:name`, or that reads `PLURAL_TO_SINGULAR.ragPipelines` / `SINGULAR_TO_PLURAL.rag_pipeline`.

- **`@objectstack/spec`.** `ragPipelines` is removed from `PLURAL_TO_SINGULAR` (and so from `SINGULAR_TO_PLURAL` and the generated `META_URL_TO_SINGULAR`). The stack schema never declared the key, so `defineStack({ ragPipelines })` was refused before and still is, now with a prescription instead of the bare unrecognized-key message; no stack could ever ship one. Retiring the row takes `rag_pipeline` out of the `/meta` URL-spelling contract, as the `themes` row's retirement did for `theme`: the type now gets the unrecognised-type refusal (`400 INVALID_REQUEST`, "'rag_pipeline' is not a metadata type") at the write door instead of the no-schema branch that stored any JSON, and `GET /meta/types` no longer advertises it as creatable. The upgrade guide carries the semantic entry `meta-type-rag-pipeline-retired`. No ADR-0087 conversion: no stack source can hold the key, so `os migrate meta` has nothing to rewrite.
- **`@objectstack/objectql`.** `ragPipelines` leaves the collections the engine registers from a manifest and from a nested plugin. A parsed stack never carried it; only a hand-built manifest handed straight to `registerApp` could, and its `ragPipelines` array is now ignored like any other undeclared key.
- **`@objectstack/metadata`.** `ragPipelines` leaves the artifact field map; the strict stack parse already refused an artifact definition that carried it.
- **`@objectstack/runtime`.** `ragPipelines` leaves the app-payload probe that decides whether a bundle with no app id was meant to register an app.
- **Package export.** `GET /packages/:id/export` and `GET /packages/export` build their collections from `PLURAL_TO_SINGULAR`, so a `rag_pipeline` row a deployment wrote under a package through the old door is no longer exported. Such a row is not rewritten: `/meta` reads still answer and `DELETE /meta/rag_pipeline/:name` still works, so delete the residue rather than rely on an export to carry it. An older export carrying a non-empty `ragPipelines` array is refused by a customization-pair install, which names the key; an empty one is skipped as before.

**The remedy.** Delete any `ragPipelines` key from a stack source, artifact or hand-built manifest, and stop writing `/meta/rag_pipeline`; nothing replaces it. Retrieval sources are described by the knowledge-source schemas in `@objectstack/spec/ai` and indexed by the knowledge service a deployment installs, not by a stack collection.
