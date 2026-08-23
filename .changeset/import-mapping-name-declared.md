---
'@objectstack/spec': patch
---

Declare `mappingName` on `ImportRequestSchema` (and therefore on the aliased
`CreateImportJobRequestSchema`). Both import routes already accepted it on the
wire — `prepareImportRequest` resolves the named `mapping` artifact and refuses
`mappingName` plus an inline `mapping` with `400 CONFLICTING_MAPPING` — but the
published contract could not express it, so the typed SDK call
`client.data.import(object, { mappingName: '…' })` was a TS2353 compile error
(#10330). The key is now declared with the same mutual exclusion as a schema
`.refine()`, so a conflicting pair is rejected at authoring time as well as by
the route. Additive only: the schema is a plain `z.object` that strips unknown
keys, so no existing caller changes behavior.
