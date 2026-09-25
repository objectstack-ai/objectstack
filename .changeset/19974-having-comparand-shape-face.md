---
"@objectstack/objectql": minor
---

fix(objectql)!: `engine.aggregate({ having })` walks through the shared comparand-shape face, so `having: { total: [5] }` is refused exactly as the same shape in `where` is (#19974)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered filter-equality-array-comparand-refused, filter-between-blank-endpoint-refused, filter-between-field-reference-endpoint-refused) this change adds no new transition. It puts the `having` clause of `engine.aggregate` behind refusals the shared comparand-shape face already makes for `where` and `aggregations[i].filter` on the same verb. The arms whose transitions are on the ledger are named: the equality-slot array, the blank `$between` endpoint and the `{ $field }` `$between` endpoint. The first two prescriptions apply to a `having` as written, and so does the third one's literal-bound half; its column-to-column half does not, because `having` resolves no `{ $field }` reference in any slot (a gap this change does not touch, stated in the table below). The null list member, the null `$between` endpoint and the null ordering comparand were ruled at the face with no ledger entry (their changesets declared no-migration-prescription), and the non-list `$in` / `$nin` / `$between` refusal is the face's original rule. `having` is a request-only key: no metadata type stores it, so there is no stored document for `objectstack migrate meta` to rewrite. The table below is the author-facing remedy for each arm, not a mechanical rewrite. -->

**BREAKING**: this narrows what `having` accepts on `engine.aggregate` (and on the REST aggregate query that forwards it there). A `having` carrying one of the shapes below used to answer; it is now refused with `INVALID_FILTER` / 400, before any driver is asked for a row. The refusal is the shared face's own message, byte for byte the refusal the same shape gets in `where`, with the path rooted at `having` instead of `where`. It ships as `minor` under the launch-window convention for accept-set narrowings.

The 2026-09-23 ruling on #19757 refuses an array in the equality slot at the shared comparand-shape face (`assertListComparandShapes` in `@objectstack/spec/data`) "for every driver at once". The face already ran on `where` and on each `aggregations[i].filter`. `having` never reaches a driver: the engine evaluates it itself after aggregation, on both the native `driver.aggregate()` path and the in-memory fallback. That evaluator answered every shape the face refuses. Measured on the base through `engine.aggregate` on `driver-memory` and `driver-sqlite-wasm`, over three groups with totals 500, 1250 and 20:

| you wrote in `having` | what it did before | write instead |
|:--|:--|:--|
| `{ total: [500] }` or `{ total: { $eq: [500] } }`, at any depth under `$and` / `$or` / `$not` | kept the 500 group: JS `500 == [500]` is true | `{ total: 500 }`, or `{ total: { $in: [500, 1250] } }` for "one of these" |
| `{ total: [] }` | kept no group | drop the condition, or write the value you meant |
| `{ customer_id: { $in: 'c1' } }` / `{ customer_id: { $nin: 'c1' } }` | `$in` kept no group; `$nin` kept every group | `{ customer_id: 'c1' }` / `{ customer_id: { $ne: 'c1' } }`, or wrap the value in a list |
| `{ customer_id: { $in: ['c1', null] } }` (or `$nin`) | the null member was compared as a value | `{ $or: [{ customer_id: { $in: ['c1'] } }, { customer_id: { $null: true } }] }` |
| `{ total: { $gt: null } }` (or `$gte` / `$lt` / `$lte`) | `$gt` / `$gte` kept every group; `$lt` / `$lte` kept none | `{ total: { $eq: null } }` for "has no value", `{ total: { $ne: null } }` for "has a value" |
| `{ total: { $between: 500 } }` or `{ total: { $between: [500] } }` | the scalar kept every group; the one-bound list kept the groups at or above it | `{ total: { $between: [min, max] } }` |
| `{ total: { $between: [null, 1000] } }`, `['', 1000]` or `[undefined, 1000]` | the blank bound compared as a value | `{ total: { $lte: 1000 } }` for a one-sided range, or the bound you meant |
| `{ total: { $between: [{ $field: 'order_count' }, 1000] } }` | the reference compared as a value | literal bounds. ⚠️ The refusal's own text suggests a two-bound `{ $field }` comparison, which `having` does not evaluate: a `{ $field }` reference in any `having` slot is compared as a value and keeps no group. That gap is not changed here |

The gate is ONE call in `engine.aggregate`, ahead of both `having` evaluations, so the two paths cannot disagree, and the verdict belongs to the filter rather than to the data: an empty grouped set refuses the same `having` a populated one does. Whatever arm the shared face gains later, `having` gains with it.

Who is affected: `having` is a request-only key (`QuerySchema.having`, `EngineAggregateOptions.having`), and no metadata type stores it. Every `having` in this repository's docs and published skills is a scalar comparison (`{ order_count: { $gt: 5 } }` and the like), and none authors a refused shape. Callers of `engine.aggregate` and of the REST aggregate query in a deployment were NOT measured.

Not changed: scalars, `null` in the equality slot (the has-no-value predicate), `$in` / `$nin` lists including the empty list, a two-bound `$between`, and scalar ordering bounds all answer exactly as before, on both paths. `$ne` with a list is not judged by the face yet, so `having` still answers it. Neither the comparand-TYPE door nor the unknown-field and declared-type gates that `where` also passes are run on `having`; this change adds the comparand-shape face only.
