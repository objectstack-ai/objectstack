---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a `null` comparand in an analytics `where` is a null predicate, not `= ''` (#5332)

`{stage: null}` compiled to `stage IS NULL`, while `{stage: {$eq: null}}` — the
same predicate — compiled to `stage = $1` binding the empty **string**. One
meaning had two answers inside one file: the bare-`null` spelling took
`fieldLeaves`' `raw === null` branch, the operator spelling fell through to the
`MONGO_TO_CUBE_OP` map, and `stringifyForCube(null)` handed it `''`.

Measured before the fix, on cube `deals` / column `stage`:

| `where` | WHERE | bindings |
|---|---|---|
| `{stage: null}` | `stage IS NULL` | `[]` |
| `{stage: {$eq: null}}` | `stage = $1` | `['']` |
| `{stage: {$ne: null}}` | `stage != $1` | `['']` |
| `{stage: {$null: true}}` | `stage IS NULL` | `[]` |

The failure was **silent, not loud**: an "is empty" dashboard widget drew zero
rows — never an error — because a real value can never equal a NULL column, and
the author saw "no data" rather than anything to debug. On a text column the
`$ne` direction was worse than empty: in SQLite / MySQL `''` is a value rows
genuinely store, so "stage is not empty" compiled to `stage != ''` and excluded
exactly the rows it was asked to keep, while "stage is empty" returned the one
row that is emphatically not null.

`$eq: null` and `$null: true` are not near-synonyms to be reconciled by taste —
`driver-mongodb`'s translator **rewrites** the latter into the former, so they
are one predicate in the contract, and `read-scope-sql.ts` (this package's other
SQL compiler), `driver-sql`, `driver-memory` and `formula` all compile them
alike. This module was the one dissenting half of one package; `fieldLeaves` now
emits the same `notSet` / `set` leaves for all three spellings, so both
strategies, the ObjectQL engine filter and the `/analytics/sql` display echo
follow with no new cases.

The #5146 NULL-safe `$not` guard table moved in the **same** commit, because it
describes this file's emitter rather than a sibling's: while `$eq: null` was a
value comparison the guard correctly classified it as one, and left alone it
would have wrapped `stage IS NOT NULL AND stage IS NULL` — an always-false
conjunction — and negated it to **every** row for a filter meaning "stage is not
empty". `nullValueSatisfiesOperator` and `operatorIsNullTotal` now carry the
`value === null` arms their `read-scope-sql` counterparts have, and
`{$not: {stage: {$eq: null}}}` returns the rows the other three backends already
return for it.

Scoped deliberately to the two spellings `filter.zod.ts` gives a null *meaning*.
`stringifyForCube`'s `v == null` arm is untouched: it still serves comparand
positions no ruling covers (`$gt: null`, `$in: [null]`), where `''` is a
placeholder rather than an answer. An empty-string comparand also stays a value
comparison — `{stage: {$eq: ''}}` still binds `''` — since reading `''` as null
would be the same defect with its sign flipped.

Authoring is unchanged; only the compiled predicate is. A widget that worked
around the old behaviour by filtering on the literal empty string (`{$eq: ''}`)
keeps working and still means the empty string; one that wrote `{$eq: null}` and
saw nothing now gets its rows.
