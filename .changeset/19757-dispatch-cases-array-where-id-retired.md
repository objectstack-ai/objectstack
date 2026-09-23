---
"@objectstack/metadata-core": patch
---

`ENGINE_DELETE_DISPATCH_CASES` and `ENGINE_UPDATE_DISPATCH_CASES` retire their three ARRAY `where.id` rows (#19757)

The engine-double conformance tables no longer carry these three rows:

- delete's `array id, no multi`
- update's `array id, no multi`
- update's `a SCALAR data.id beside an ARRAY where.id`

Each row puts `where: { id: ['a', 'b'] }` in the equality slot. Since this release's `@objectstack/spec` change, the shared comparand-shape face refuses an array in that slot with `INVALID_FILTER` / 400. The face runs at the engine's lowering seam, which every verb crosses before the dispatch runs, so the real engine never reaches the dispatch predicate with such an input. A row claiming a dispatch verdict for it would pin a branch the engine cannot reach. It was measured red against the real engine: `ObjectQL.delete` / `ObjectQL.update` refused the input with the face's words, not the dispatch's.

The predicates themselves are unchanged. `resolveEngineDeleteDispatch` / `resolveEngineUpdateDispatch` and the `assert*` helpers still answer an array `where.id` with `reject`, and `scalarDeleteId` / `scalarUpdateId` still treat an array as not-an-id. A test double bound to them therefore still refuses such a call, with the dispatch's sentence. No double runs the shared filter face, for this shape or for any other face refusal. The `$in` rows keep the "a non-scalar `where.id` is not an id" coverage, including the #11230 refusal beside a scalar payload id.

If you run these tables against your own engine double, it has three fewer cases to answer. Nothing else changes.
