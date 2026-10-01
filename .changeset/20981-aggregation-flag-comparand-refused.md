---
'@objectstack/objectql': minor
---

fix(objectql)!: a per-aggregation `filter` and a `having` refuse a non-boolean `$exists` / `$null` with `INVALID_FILTER` / 400, in the words every driver's `where` refuses it in, instead of reading `$exists` by truthiness and dropping `$null` (#20981)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered filter-query-face-comparands-refused-at-save) this narrows the engine's own in-process evaluator to the rule that registered entry already records: its reason states that every query face refuses a non-boolean $null / $exists flag, its surface names a query having, the data-engine aggregate call's having and an aggregation filter among the carriers, and its replacement is this change's whole migration (a flag is the boolean itself; $null true is "has no value", $exists true is "has a value"). This change makes that statement true on the per-aggregation filter and having positions, which the engine evaluates itself after the driver. No authorable key, spelling, export or published type moves, and no stored row is read or rewritten; a stored filter carrying such a flag is already refused when it is saved, by that entry. -->

**BREAKING**: this narrows what `aggregate` accepts in two positions, `aggregations[i].filter` and `having`, on every driver. A `$exists` or `$null` comparand that is not a boolean (a string such as `"false"`, a number, `null`, an array) is now refused with `INVALID_FILTER` / 400, before any driver is asked for a row, so an empty table refuses it too, at any depth under `$and` / `$or` / `$not`. A plain object or `undefined` there is refused first by the comparand-type check, in its own words, as before; a `{ $field }` reference there, already refused as a reference outside a scalar comparison, is now refused in this entry's words. The published `applyInMemoryAggregation(rows, ast, timezone, fields)` narrows the same way, per row: it throws the same refusal for a row its per-aggregation filter judges on the flag, with or without a `fields` map (an empty `rows` array, or a row a `$or` branch settles first, is not judged there; `engine.aggregate` judges the whole filter once before any row). It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**Why a refusal.** `FieldOperatorsSchema` declares both flags as booleans, and every driver's `where` refuses any other comparand. The engine evaluates a per-aggregation `filter` and a `having` itself, and it read one anyway. Measured through `engine.aggregate` on the in-memory driver and on `SqlDriver` (SQLite), with identical answers: `$exists` was read by truthiness, so `"yes"`, `1` and the string `"false"` selected the rows and groups WITH a value, and `0` / `null` the ones without; and `$null` tested only `true` / `false`, so any other value constrained nothing, and every row and every group came back.

**What an author sees now.** The message `driver-sql` gives the same flag, beginning `Operator "$exists" on field "FIELD" requires a boolean comparand (true or false).`, naming what arrived and the position (`aggregations[1].filter.stage.$exists`, `having.stage.$null`). Unlike a `where` on `SqlDriver`, the field and the value are not withheld: a per-aggregation `filter` and a `having` never carry a merged read scope.

**What to write instead.** Write the boolean itself. `"$exists": true` and `"$null": false` match a field that has a value; `"$exists": false` and `"$null": true` match one that has none.

**Who is affected.** A caller that reaches `engine.aggregate` without the REST query door's schema parse (server-side code, a flow or hook, the analytics bridge that lowers a dataset measure's filter into an aggregation filter, a host calling `applyInMemoryAggregation` directly) and read the count as a real answer. `POST /api/v1/data/:object/query` already refused all three positions with 400 `VALIDATION_FAILED` before the request reached the engine, and still does.

**Unchanged.** `$exists: true` / `false` and `$null: true` / `false` answer exactly as before, on both positions. `$empty` and every other operator, and `where`.
