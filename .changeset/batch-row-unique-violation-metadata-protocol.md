---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: a batch ROW reports a unique-constraint refusal as `UNIQUE_VIOLATION` — the same wire spelling as the whole-request failure on the same route (#14723)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, `packages/spec` is untouched and `objectstack migrate meta` has nothing to rewrite. What moves is the `code` value one REST response row carries for one condition — the wire report of a driver's unique-constraint refusal on the per-row surface of `POST /api/v1/data/:object/batch` — which now spells the standard-catalog member the whole-request doors and the published protocol docs already use. The consumer note below is guidance for a client branching on that row code; it prescribes no rewrite of any authored artifact. -->

**BREAKING** on the per-row report of `POST /api/v1/data/:object/batch` (and
the multi-object `POST /api/v1/batch`, which rides the same protocol): a row
refused by the engine's `DuplicateRecordError` envelope now reports
`errors[].code: 'UNIQUE_VIOLATION'` where it reported `'DUPLICATE_RECORD'`.
Shipped as `minor` under the repo's launch-window convention for breaking
changes. Maintainer ruling 2026-09-03 on #14723 (verbatim 「同意，然后执行契约
复审」), adopting option A: one wire spelling for a unique-constraint refusal on
every route.

**Why.** `toRowApiError` put a thrown REGISTERED code on the row verbatim, and
`DUPLICATE_RECORD` is registered, so a `DuplicateRecordError` row said
`DUPLICATE_RECORD` while the whole-request failure on the very same route (the
bulk door's classification in `@objectstack/rest`) answered `UNIQUE_VIOLATION`
— the standard-catalog member `content/docs/protocol/kernel/http-protocol.mdx`
documents for the 409 constraint-violation body. Since the bulk doors were
restored to `UNIQUE_VIOLATION`, the two spellings of one condition sat side by
side in one route's responses, which ADR-0112's one-name-per-concept and the
error-code ledger's own header both forbid. The duplication is removed, not
declared: no ledger waiver is added.

**What changes.** The row derivation recognises the engine's envelope by the
same two-part gate the whole-request arm uses — the registered code AND the
class name `DuplicateRecordError`, never message text — and reports
`UNIQUE_VIOLATION`. Everything else on the row is unchanged: `httpStatus: 409`,
the platform sentence (no driver text, no bound value — the driver's error
stays on `cause` and never reaches the row), and the sibling `NOT_ATTEMPTED` /
`ROLLED_BACK` rows.

**What does NOT change.** The engine's thrown identity: `DuplicateRecordError.code`
is still `DUPLICATE_RECORD` for an in-process caller of `engine.insert` /
`engine.update` (a hook, a flow node), and the objectql pins on `insert` /
`insertMany` hold. The single-record `/data` door, which has answered
`UNIQUE_VIOLATION` throughout, does not move. A producer that merely THROWS the
registered `DUPLICATE_RECORD` from its own body without being the engine's
class keeps its own code on the row, exactly as it does at the door.

**Consumer note.** A batch client that branched on a row's `code` reading
`DUPLICATE_RECORD` reads `UNIQUE_VIOLATION` there now — the same value it
already handles for the whole-request 409 on that route and on the
single-record door. Measured in-repo and in the sibling repos (hotcrm, objectui,
non-test sources): zero consumers branch on either spelling of a row code.
