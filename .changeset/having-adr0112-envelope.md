---
"@objectstack/objectql": patch
---

fix(objectql): put `having`'s operator refusals inside the ADR-0112 envelope (#7047)

`having-filter.ts`'s `unknownOperator()` returned a bare `new Error(...)` from
**both** of its branches — the RETIRED spellings (`$regex`, `$options`) and the
unknown ones (`$nand`, `$median`, a mistyped `$icontain`) — so the thrown error
carried `code: undefined` and `status: undefined`. `rest` served it through the
unclassified-fault branch, and a **400-class author mistake reached the client
500-shaped**.

This is the last of the five filter-refusal faces to join the envelope, and the
only one that disagreed. Measured by EXECUTING each face rather than by grep
(#6993), before and after:

| face | `code` before | `code` after |
|:--|:--|:--|
| driver-sql, driver-sqlite-wasm, driver-turso (local + remote) | `INVALID_FILTER` / 400 | unchanged |
| driver-memory (`filter-refusal.ts`), driver-mongodb | `INVALID_FILTER` / 400 | unchanged |
| **objectql `having`** | **`undefined` / `undefined`** | **`INVALID_FILTER` / 400** |

The refusal itself, and its message, are unchanged — the retired branch already
printed `RETIRED_FILTER_OPERATORS[op].why` verbatim like the four driver faces.
Only the envelope was missing, which is the half of #5324 that a refusal does
not fix on its own and the half `FilterTextRejectionCase.code` exists to pin.
The code is `INVALID_FILTER` because this joins the contract the other four
already speak; a caller swapping HAVING for a driver-side `where` must not have
to catch two shapes for one mistake.

**Client-visible change.** Code catching a `having` refusal by message
substring, or branching on the absence of `err.code`, sees `INVALID_FILTER` /
400 where it previously saw an uncoded `Error`. Over HTTP the status moves from
500 to 400, which is the point of the change.

Both `unknownOperator()` returns are covered, deliberately: enveloping only the
retired path would have left `{ $nand: [...] }` and every operator typo
arriving 500-shaped — the same defect, one operator name away, and the more
likely of the two to be typed.

The envelope constructor is now shared with the package's other filter-refusal
site (`filter-comparand-shape.ts`'s `invalidFilterError`, exported for this)
rather than copied, so objectql's two refusal sites cannot answer one mistake
with two envelopes.

Test coverage moved with it. The rejection assertions in `having-filter.test.ts`
were `toThrow(/message/)` only, which is green whether or not the error carries
an envelope (#6142/#6050) — that is how the defect survived the PR that wrote
those messages. They now pin `code` + `status` + the verbatim prescription, on
both branches and through `applyHaving`, the entry point the engine calls. A new
`having-filter-text-conformance.test.ts` drives this face against
`FILTER_TEXT_CASES` — the standard the driver suites answer — so the faces
cannot drift apart silently again; `having` had no conformance-table coverage at
all, which is why both of the last two defects on it (#5905, this one) were
found by a hand-run census rather than by CI.
