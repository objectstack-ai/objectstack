---
'@objectstack/connector-openapi': minor
---

fix(connector-openapi): a document that is not OpenAPI 3.x is refused at load — a Swagger 2.0 document included

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export changes: providerConfig.spec keeps its three forms, and what is now refused is an external document the generator never mapped correctly. The fix is to the document, outside the metadata, so there is nothing for a metadata migration to rewrite and no tombstone. -->

The declarative `openapi` provider loaded any JSON object as its document. A Swagger 2.0 document "loaded" with its `host` / `basePath` ignored and its `body` / `formData` parameters dropped, so the instance came up with wrong actions and no error. The provider now checks the document's `openapi` field on every `providerConfig.spec` form (inline object, http(s) URL, package-relative file): absent, or anything but `3.x` (a `swagger: "2.0"` document included), is a configuration fault — fatal at boot, a skipped entry on reload — whose message names the inline document, URL or file and the remedy. The runtime never converts.

**BREAKING** accept-set narrowing at the `openapi` provider's document load. What an upgrader sees: an instance whose `spec` is a Swagger 2.0 document now fails boot with `connector-openapi provider: connector 'NAME' providerConfig.spec file './x.json' is a Swagger "2.0" document; … Convert the document to OpenAPI 3.x offline …`. The document is converted outside the runtime (any Swagger 2.0 → OpenAPI 3 converter); the metadata keeps its shape. A 3.x document (3.0 or 3.1) loads as before.
