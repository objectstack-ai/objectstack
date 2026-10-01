---
'@objectstack/types': minor
---

feat(types): the data-error classification table (`mapDataError` and its judgements) is exported from `@objectstack/types` (#20919)

The classification half of `@objectstack/rest`'s error boundary — `mapDataError`
(a thrown error → the `{ status, body }` ADR-0112 answer, without emitting it),
`declaredHttpStatus`, `declaredServerFaultAnswer`, `sandboxBusinessMessage`,
`boundedDeclaredUserMessage`, `boundedDeclaredRefusalMessage` and
`isEngineDuplicateRecordEnvelope` — moved here unchanged, beside the primitives it
composes, so the bulk-import runner in `@objectstack/core` judges a failed row with
the same table the REST door answers with. `@objectstack/rest` keeps the emitters
and re-exports every name it exported before. The module also exports the eight
helpers the REST emitters compose (`truncateClientMessage`, `thrownCodeFields`,
`withoutDeclaredCodePrefix`, `withDeclaredUserMessage`, `isSandboxOrigin`,
`isSandboxCrash`, `fiveXxArmDisplacesDeclared4xx`, `structuredCodeAnswer`).
