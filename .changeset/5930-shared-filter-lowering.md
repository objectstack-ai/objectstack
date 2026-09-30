---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/plugin-security': minor
---

feat(spec, objectql, plugin-security): one shared filter lowering, run once at the engine and RLS seams (ADR-0053 D-D1, amended)

Clause-②: yes

`@objectstack/spec/data` exports `lowerFilterCondition(filter, options?)` and its `FilterLoweringOptions` type. It is not exported from the package root entry. It is a pure `FilterCondition → FilterCondition` rewrite that applies three rules once:

- `$between` becomes `$gte` its minimum and `$lte` its maximum.
- A `$lte` whose comparand is a bare `YYYY-MM-DD` day becomes `$lt` the next day, in the calendar-string domain. On the last supported day (`9999-12-31`) a lone `$lte` becomes `{ $null: false }`, and a `$between` keeps only its minimum.
- The NULL-polarity guards the drivers already compile. A `$ne` of a value, a `$nin` or a `$notContains` holds for a row with no value. Every leaf of a `$not` operand is made total.

The rewrite is copy-on-write, idempotent and never refuses. A node it rewrites keeps its filter-subtree provenance mark. With `options.isDatetimeColumn` (a typed seam), the first two rules change only a declared `datetime` column. Without it they apply to every column.

As ADR-0053 D-D1 (amended 2026-09-30) requires, the seams now run it once, after the comparand doors and after filter-token resolution:

- **`@objectstack/objectql`** runs it on every filter position, typed by the object's declared fields. That covers `where` on `find`, `findOne`, `count`, `update` and `delete`, and `aggregate`'s `where`, `aggregations[i].filter` and `having`. `having` is typed by the aggregated row's columns, so `max` of a `datetime` field counts as a `datetime`. Drivers receive the lowered filter. A date macro such as `{today}` is resolved before the lowering reads it.
- **`@objectstack/plugin-security`** runs it on every compiled RLS policy filter (`using` and `check`), right after the two comparand faces. `SecurityPlugin` now hands the compile seam the object's declared `datetime` columns (`RlsFieldGuard.datetime`). A guard without that set treats no column as `datetime`.

Row answers stay the same on every driver. Each driver keeps its own copy of these rules, and every copy gives the same answer on lowered input. One result changes. The engine evaluates `aggregate`'s `aggregations[i].filter` and `having` itself, and that evaluator now treats a row or group with no value the way every driver's `where` already does. It no longer counts such a row in a `$between` on a `datetime` column. It now keeps such a row under a `$not` over an ordering such as `$lt`.

Nothing is removed or renamed, and there is nothing to migrate.
