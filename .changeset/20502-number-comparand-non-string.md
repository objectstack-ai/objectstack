---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

fix(spec)!: a boolean, a `Date` or an array compared against a number field is refused with `INVALID_FILTER` / 400 at `where`, a per-aggregation `filter` and `having`, the same as a non-numeric string

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a filter COMPARAND value at the engine's query door, decided by the published number-comparand verdict: no authorable key, spelling, export or stored shape moves (the verdict's function, its case table and its words keep their names; three exports are added), and no stored row is read or rewritten. What is refused is a boolean, a Date or an array compared against a declared numeric field or a numeric aggregated column; which number the caller meant is not something a ledger entry can decide (reading true as 1 is exactly the silent coercion this refuses). The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers a filter comparand (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter may compare a number field with. `numberComparandDoorVerdict`, the published verdict the engine's number-comparand door consumes, judged strings only; it now also answers `door-refusal` for a boolean, a `Date` and an array, so the engine refuses them before any read, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. The string rule is unchanged, and so are both packages' root exports except three additions to `@objectstack/spec/data`: `NON_NUMERIC_VALUE_FORMS` and the types `NonNumericValueForm` and `NonNumericComparandForm` (the refusal's `form` and the refusal site's `value` widen to carry a non-string).

FROM `true` / `false`, a `Date`, or an array where one value belongs (a scalar operator's comparand, or a member of `$in` / `$nin` / `$between`), compared against a `number`, `currency`, `percent`, `rating`, `slider`, `progress` or `summary` field (or a `count` / `sum` / `avg`, or a numeric `min` / `max` / groupBy column in `having`) → TO `INVALID_FILTER` / 400, naming the field, its declared type, the comparand, its position and what is wrong with it. The fix is one line: send the number the filter means (`12`, `-3.5`, `1e3`), or compare a `Date` with a date or datetime field.

Measured through `engine.find` / `engine.aggregate` and `POST /data/:object/query`, three rows (5, 12, 30) of a `number` field:

| position | comparand | before: memory · SQLite · PostgreSQL 16 | now, on all three |
|:--|:--|:--|:--|
| `where` | `$gt true` | no rows · every row · `DATABASE_ERROR` (500) | `INVALID_FILTER` / 400 |
| `where` | `$ne true` | every row · every row · 500 | `INVALID_FILTER` / 400 |
| `where` | `$between [true, 20]` | no rows · two rows · 500 | `INVALID_FILTER` / 400 |
| `where` | `$gt` a `Date` (in-process callers) | no rows · no rows · 500 | `INVALID_FILTER` / 400 |
| `where` | `$gt [1]` | a driver's own 400, in each driver's words | `INVALID_FILTER` / 400, in one set of words |
| `where` | a `$in` member `[1]` | no rows · a driver 400 · a driver 400 | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | `$gt true` / `$gt [1]` (`$gt` a `Date`) | count 3 (count 0), on all three | `INVALID_FILTER` / 400 |
| `having` on `sum(amount)` | `$gt true` / `$gt [1]` (`$gt` a `Date`) | every group (no group), on all three | `INVALID_FILTER` / 400 |
| all three positions | `$gt 10` (the numeric control) | 2 rows / count 2 / both groups | the same |

**Who is affected.** A caller that compares a number field with a boolean or an array through any door that reaches the engine (a `where`, `$filter` or `filter` body of `POST /data/:object/query`, or an in-process engine call), or with a `Date` in-process (a flow, a hook, server code). No example app, platform object or other in-repo producer compares a number field that way.

**Unchanged.** A number, a `bigint` (narrowed or refused by the comparand-type door, as before) and `null` (the null test) are answered as before. A value outside the accepted comparand types (`undefined`, a plain object, a `Map`) keeps the comparand-type door's own refusal and words. An array at an equality slot (implicit, `$eq`, `$ne`) keeps the comparand-shape door's refusal. A boolean or a `Date` compared against a boolean, date or datetime field is not this door's subject. Driver-direct callers that never pass through the engine keep each driver's native binding.
