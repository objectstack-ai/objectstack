---
"@objectstack/objectql": minor
---

fix(objectql)!: in `engine.aggregate({ having })`, a `{ $field, addDays }` reference is evaluated only between two temporal columns of one class, with a numeric offset column, as `FieldReferenceSchema.addDays` declares, instead of answering by epoch-millisecond coercion (#20127)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. It enforces on `having` the rule `FieldReferenceSchema.addDays` already declares ("between two temporal columns of the same class (date/date, datetime/datetime)", the offset a whole number or a numeric column), which `driver-sql` already enforces on `where`. A refused pair never had the meaning the declaration gives `addDays`: on a number, a text or a mixed pair, it was answered by the in-memory evaluator's coercion. There is no accepted spelling it can be mechanically rewritten to: whether the author meant two date columns, no offset, or a different column is an authoring decision. `having` is a request-only key: no metadata type stores it, so there is no stored document for `objectstack migrate meta` to rewrite. The table below records the answer each pair had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what `having` accepts on `engine.aggregate`, and on the REST aggregate query (`POST /data/:object/query`) that forwards it there. A `{ $field }` reference that carries `addDays` in one of the six scalar comparisons is now refused with `INVALID_FILTER` / 400 unless the column it filters and the column it references are both `date` or both `datetime`, and an `addDays` offset read from a column reads a numeric one. The refusal is raised once per query, before any driver is asked for a row, on both the native `driver.aggregate()` path and the in-memory fallback, whether or not any group exists. It ships as `minor` under the launch-window convention for accept-set narrowings.

An aggregated row has no declared field types, so each column's class is now read off the query and the object's declaration, before any row exists:

- a groupBy projection takes its field's declared type. A `day` date bucket is a `date`, because its label is `YYYY-MM-DD` on every face. A `week`, `month`, `quarter` or `year` bucket is a text label;
- `count`, `count_distinct`, `sum` and `avg` are numeric;
- `min` and `max` take the type of the field they read.

A column whose class the declaration cannot tell is not judged: an object with no field map, a field it does not declare, or a `formula` field.

`having` resolved every pair through `@objectstack/formula`'s evaluator, which reads a number as epoch milliseconds, while `driver-sql` refuses the same pair on `where`. The refusal reuses `driver-sql`'s sentences for the pair, naming each aggregated column's class where `driver-sql` names a stored type ("is numeric" for "is stored as numeric"), because an aggregated column is computed rather than stored. Measured on the base through `engine.aggregate` on `driver-memory` and `driver-sql`, both paths, and through `POST /data/:object/query` on both, over three groups with a `sum` alias `total`, a `max` of a number `max_cap`, `max` / `min` of two `date` fields, `max` / `min` of two `datetime` fields and a `count` `n`:

| `having` | before | now |
|:--|:--|:--|
| `{ total: { $gt: { $field: 'max_cap', addDays: 1 } } }` (two numeric columns) | no group, no error | refused: "addDays adds whole days to a date or datetime column, and "max_cap" is numeric — an offset has no meaning on it." |
| `{ n: { $gte: { $field: 'n', addDays: 0 } } }` (a count against itself) | every group | refused, in the same words |
| a `date` column against a numeric column, a numeric column against a `date` one, or the `customer_id` groupBy text column against a `date` one | no group | refused, naming both columns and their classes: "… and a cross-class comparison answers differently in SQL (storage-class ordering) than in memory (JS coercion) — compare same-class columns." |
| a `date` column against a `datetime` one | one group | refused, in the cross-class words |
| a `datetime` column against a `date` one | two groups | refused, in the cross-class words |
| a `date` pair whose `addDays` reads a text column or a `date` column | no group | refused: "the addDays offset … is not a numeric column, and a day offset must be a number of days." |

Who is affected: `having` is a request-only key (`QuerySchema.having`, `EngineAggregateOptions.having`), and no metadata type stores it. No `having` in this repository's docs and published skills carries a `{ $field }` reference. Callers of `engine.aggregate` and of the REST aggregate query in a deployment were NOT measured.

Not changed, measured identical before and after on both paths: a `date` / `date` pair and a `datetime` / `datetime` pair, with a positive or negative whole-day literal or with an offset read from a numeric column (`max` of a number, or a `count`); a `day` date bucket against a `date` column; and any `{ $field }` comparison WITHOUT `addDays`, including a numeric pair and a numeric column against a `date` one. A per-aggregation `filter` (`aggregations[i].filter`) is not judged by this rule: it reads the object's raw columns, and this change classifies only the aggregated row's.
