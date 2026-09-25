---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the analytics `where` door refuses a non-boolean `$null` / `$exists` flag, which it used to read as IS NOT NULL, the way every backend and the read-scope compiler already refuse it (#20040)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no ADR-0087 ledger entry names the $null / $exists boolean domain: the refusals driver-sql makes (#5347, #5369) and the read-scope compiler makes (#6387) were never registered, and this change adds no new transition. It brings the analytics object-form `where`, its dataset and measure filters and the draft-data preview under the refusal every other face already makes. No ledger entry could carry it: a non-boolean flag has no boolean it can be mechanically rewritten to, because the backends disagreed on which one it meant and the string "false" is truthy. Which boolean the author meant is an authoring decision. The table below records the verdict each cell had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A `$null` or `$exists` flag whose value is not a boolean used to compile, in a caller `where`, a dataset `filter` or a measure `filter`, at any depth under `$and` / `$or` / `$not` or inside a nested relation. That covers a string such as `"false"`, a number, `null`, an array, a `Date` and a `{ $field }` reference. It is now refused with `INVALID_FILTER` / 400, in a message that names the operator, the field and the path, before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.

| flag in an object-form `where` | before | now |
|:--|:--|:--|
| `$null` or `$exists` with a string, a number, `null`, an array, a `Date` or a `{ $field }` reference | read as IS NOT NULL on the native SQL path, the `/analytics/sql` echo and the ObjectQL engine path (the engine received `{ "$ne": null }`); `POST /api/v1/analytics/query` and `/analytics/dataset/query` answered 200 | refused 400: `Operator "$null" on field "stage" requires a boolean comparand (true or false). Received …` |
| the same, under `$not` | the negation of IS NOT NULL: the rows with no value | refused 400 |
| the same, in the draft-data preview | refused 400 as an operator the preview does not evaluate | refused 400, in the published door's words |
| `true` or `false` | IS NULL or IS NOT NULL, per the contract | unchanged: the compiled tree, the SQL and the engine `where` are byte-identical |
| `undefined`, or a plain object | refused 400 by the shared comparand-type face | unchanged, in that face's words |

`FieldOperatorsSchema` in `@objectstack/spec` declares both flags as booleans. The #5347 and #5369 rulings refuse a non-boolean one in every position and on every backend, because the backends read one in opposite directions: `driver-sql` compiled IS NULL for anything but `false`, and the JavaScript drivers compiled IS NOT NULL for anything but `true`. `driver-sql` refuses it, and so does this package's read-scope compiler. This door read every non-boolean as IS NOT NULL, so `"true"` and `"false"` asked for the same rows, and `{ "$null": "true" }` asked for the rows it excludes.

The repair is to write the boolean the filter means. `"$null": true` matches rows with no value and `"$null": false` rows with one; `$exists` is the exact inverse.

Over HTTP, both routes type the `where`, the `runtimeFilter` and the inline `dataset.filter` as `FilterConditionSchema`, whose field entries are open, so the body parse admitted the flag and the service served it. Both routes now answer 400 `INVALID_FILTER` from the service, with no statement run.

A `where` that carries a non-boolean flag and also a defect this compiler finds only while lowering (a field constraint mixing `$` and non-`$` keys, an operator outside the vocabulary, a zero-operator constraint) is now answered with the flag refusal. The code and status are the same 400 `INVALID_FILTER`. A shape or type defect elsewhere in the same `where` is still answered first.

Who is affected: nothing in this repository's examples, seeds, docs or package sources authors a non-boolean flag. A text scan over 4598 tracked non-test files found 22 matches: 21 are code comments, and one is an operator-name lookup table in `driver-memory`, not a filter. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured.

Not changed: a `true` or `false` flag; the `FilterArray` spelling, whose `is_null` and `is_not_null` take their boolean from the operator name; the read-scope door, which already refused a non-boolean flag in its own withheld envelope.
