---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
---

feat(metadata-core,objectql): publish `assertEngineFindOnePredicate` — the read-side member of the engine-double contract family (#11957)

`ObjectQL.findOne` applies `limit: 1`, so a query naming no particular record
would return an ARBITRARY row. `requireFindOnePredicate` (#4419) REFUSES that
call. Every in-memory test double in the repo instead read an absent filter as
"match everything" and answered happily, so a production call site that violates
#4419 read as *working* under every unit suite and only failed on a real engine.

That is measured, not hypothetical. `AuthManager.isBootstrapCreation` probed the
bootstrap population with `findOne({ where: [] })` inside a `try/catch`; on a
real engine that throws, the `catch` read the refusal as "users exist", and the
declared first-run bypass became permanently inert on real deployments — while a
641-line unit matrix over the double stayed green, including a case named
"bootstrap: the very first signup is admitted" (#11767).

New public API, mirroring the two write-side dispatch predicates
(`assertEngineDeleteDispatch`, `assertEngineUpdateDispatch`) exactly — the
implementation lives in `@objectstack/metadata-core` so that packages
`@objectstack/objectql` itself depends on can reach it, and `@objectstack/objectql`
re-exports every symbol:

- `assertEngineFindOnePredicate(object, query)` — the line a fake engine's
  `findOne` opens with; throws the engine's own message, object name included.
- `resolveEngineFindOnePredicate(object, query)` — the same decision without the
  throw, for a double that wants to classify.
- `engineFindOnePredicateRefusalMessage(object)` — the refusal text, so an
  assertion pins the producer's wording rather than a paraphrase.
- `ENGINE_FINDONE_PREDICATE_CASES` — the shared conformance case-set, driven
  against the REAL engine by
  `packages/objectql/src/engine-findone-predicate.test.ts`, so the predicate
  cannot drift from `engine.ts` unnoticed.

Nothing is removed and no existing behaviour changes: the engine's own guard is
untouched, and this publishes the decision it already makes so a double can
import it instead of re-deriving it.
