---
"@objectstack/rest": minor
---

fix(rest)!: an import ROW report spells a unique-constraint refusal `UNIQUE_VIOLATION` — the same wire code as the whole-request failure on the same route (#14723)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, `packages/spec` is untouched and `objectstack migrate meta` has nothing to rewrite. What moves is the `code` value one import row report carries for one condition — the wire report of a driver's unique-constraint refusal on the per-row surface of `POST /api/v1/data/:object/import` — which now spells the standard-catalog member the whole-request door and the published protocol docs already use. The consumer note below is guidance for a client branching on that row code; it prescribes no rewrite of any authored artifact. -->

**BREAKING** on the per-row results of the import runner
(`POST /api/v1/data/:object/import` and the import job): a row refused by the
engine's `DuplicateRecordError` envelope now reports `code: 'UNIQUE_VIOLATION'`
where it reported `'DUPLICATE_RECORD'`. Shipped as `minor` under the repo's
launch-window convention for breaking changes. Maintainer ruling 2026-09-03 on
#14723 (verbatim 「同意，然后执行契约复审」), adopting option A: one wire
spelling for a unique-constraint refusal on every route.

**Why.** `toFailedResult` relayed the thrown error's own `code`, and the engine's
envelope carries the registered `DUPLICATE_RECORD` — while the whole-request
failure on the same import route answered `UNIQUE_VIOLATION` through
`mapDataError`. Two spellings of one condition on one route, which ADR-0112's
one-name-per-concept and the error-code ledger's header both forbid. The
duplication is removed, not declared: no ledger waiver is added.

**What changes.** The import row derivation applies the whole-request arm's own
predicate — the registered code AND the class name `DuplicateRecordError`,
exported from `error-response.ts` as `isEngineDuplicateRecordEnvelope` and now
shared by the arm and the row report — and reports `UNIQUE_VIOLATION`. A
field-level finding still takes precedence (the envelope carries none), the
row's sentence is unchanged (the platform sentence, sanitised as before; no
driver text), and a producer that merely throws the registered
`DUPLICATE_RECORD` without being the engine's class keeps its own code.

**What does NOT change.** The whole-request doors (single-record, bulk, import,
metadata, UI) already answered `UNIQUE_VIOLATION` and keep doing so; the arm's
logic is untouched beyond reading the shared predicate. The engine's thrown
identity stays `DUPLICATE_RECORD` in-process. This package's `error-response.ts`
docblock that disclosed the fork under the #14541 contract review now states
the converged rule.

**Consumer note.** An import client that branched on a row's `code` reading
`DUPLICATE_RECORD` reads `UNIQUE_VIOLATION` there now — the same value it
already handles for the whole-request 409. Measured in-repo and in the sibling
repos (hotcrm, objectui, non-test sources): zero consumers branch on either
spelling of a row code.
