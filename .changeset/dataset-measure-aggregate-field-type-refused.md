---
"@objectstack/service-analytics": minor
"@objectstack/spec": minor
---

feat(service-analytics)!: a dataset measure whose `aggregate` its `field`'s declared type cannot carry is refused at compile time with `400 DATASET_INVALID` (#16737, compile leg of #16099)

<!-- adr-0087: registered dataset-measure-aggregate-field-type-refused -->

**BREAKING** — an accept-set narrowing on a published authoring surface. A dataset
measure pairing `aggregate: 'avg'` with a `Field.datetime` used to compile to
`AVG(col)` and reach the backend; it is now refused by `compileDataset` before any
query is built. Shipped as `minor` under the repo's launch-window convention for
accept-set narrowings; the hand-migration prescription is registered under protocol
major 18 as `dataset-measure-aggregate-field-type-refused`.

The pair is judged against `AGGREGATE_FIELD_TYPE_COMPATIBILITY` — the one table
`@objectstack/spec` declared in #16353 under the director ruling of decision batch
#59 (2026-09-06, "both legs, table in spec"). ⛔ This changeset adds no rows and
restates none: the refusal reads the shipped predicate, so the contract has exactly
one statement.

## What was wrong

The answer to `AVG` over a temporal column was decided by the SQL dialect rather
than by the data. Both halves measured on this card:

```
-- SQLite (better-sqlite3), the canonical UTC-text storage form (#3912)
select typeof(submitted_at), submitted_at from clm_contract limit 1;
  text|2026-05-19T00:00:00.000Z
select avg(submitted_at) from clm_contract;
  2025.5                    <- text->numeric coercion: the average YEAR

-- PostgreSQL 16.13
select avg(submitted_at) from t;
  ERROR:  function avg(timestamp with time zone) does not exist   -- SQLSTATE 42883
```

The silent half is the dangerous one, and SQLite is the default dev datasource:
`derived: { op: 'difference', of: [avg_a, avg_b] }` over two such averages returned
`-0.85` and rendered on a tile labelled "average cycle time delta" — a number
indistinguishable from a correct one. Nothing refused it at any layer: not the
schema, not `os validate` / `os lint`, not the analytics service, not the renderer.

## What it does now

- `compileDataset` refuses an incompatible `aggregate` × `field` pair with
  `DATASET_INVALID` / **400**, naming the measure, the field, its declared type and
  the accepted set (read off the table, never restated). Nothing reaches the driver.
- It reads the declared type from the `sourceFieldMeta` a host already wires, via a
  new optional `DatasetCompileOptions.declaredFieldType` probe.
- **`derived` is covered by construction.** A derived measure's `of` operands are
  base measures of the same dataset, so a dataset carrying a refused base measure
  never finishes compiling and no `derived` op can be handed its output — including
  when the selection names only the derived measure.
- Tiered "cannot answer, do not block" like every sibling probe: no
  `sourceFieldMeta`, an unresolvable field, or a `relationship.field` path (whose
  column lives on a joined object) leaves the pair unjudged.

## ⚠️ Scope: the compile leg executes the TEMPORAL rows only

The gate judges only a measure whose field is declared `date` / `datetime` /
`time`; a field of any other class is never handed to the predicate. The
verdict for the pairs it does judge is the table's — no row is restated — but
which FIELDS are judged is narrower than the table, on purpose:

- **String rows** (`min` / `max` over `text`, `select`, `lookup`,
  `autonumber`, …) are **not enforced here**. They are under #16785, **ruled
  C**: the table itself is to be amended to accept them, because
  `measureResultType` (#15768) already types those results as `'string'` and
  pins them end to end. Enforcing them from this card would pre-empt that
  ruling.
- **Boolean rows** are not a refusal at all any more: #16685 was ruled A and
  #16750 added `boolean` / `toggle` to `sum` / `avg` / `min` / `max`, so the
  table ACCEPTS them and this gate never judged them.
- The table's `sum` × `percent` row is likewise **not** executed by this leg;
  `sum` over a `percent` compiles exactly as it did before.

⇒ The only pairs whose behaviour changes in this release are `avg` / `sum`
over a `date` / `datetime` / `time` field. The full-table leg remains #16099's.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ aggregate: 'avg', field: <a date/datetime/time field> }` | `{ aggregate: 'min' \| 'max', field: <same> }` — a real instant of the field's own type |
| `{ aggregate: 'sum', field: <a date/datetime/time field> }` | store the duration as a number (a computed "days open" field) and `sum`/`avg` that |
| `derived: { op: 'difference', of: ['avg_a', 'avg_b'] }` over temporal averages | fix the two operand measures; the `derived` spec itself is unchanged |

⭐ A duration is not recoverable from an aggregate over instants on any backend.
Where an "average cycle time" is wanted, the cycle length has to exist as a number
before it can be averaged.

## What is deliberately untouched

`date` / `datetime` used as a **dimension** — grouping, bucketing, date-range
filtering — is unchanged; this is about aggregation only. `avg` over a genuine
numeric measure, `min` / `max` over a temporal one, and `count` / `count_distinct`
over anything all behave exactly as before.

⚠️ **Two faces stay uncovered, deliberately.** The refusal lives in
`compileDataset` and reads a `declaredFieldType` probe, so it applies only where
a host wires one: `/analytics/query` — the non-dataset face, whose measures a
Cube infers rather than an author declaring them — is NOT covered, and neither
is any other `compileDataset` caller that passes no probe (those stand down
unjudged rather than guessing). Closing those is #16099's, not this card's.

Alongside the refusal, `service-analytics`' contradictory annotations about what a
SQLite `Field.datetime` column physically holds are reconciled to one statement —
**seven** source sites plus two test narratives, not the four the card quoted. Some
said the column holds an INTEGER epoch and ISO TEXT at once; one said flatly that it
IS an INTEGER epoch. Neither is current: since #3912 the column has ONE
storage form, canonical UTC text, with the epoch surviving only in a database not
yet converged by `backfillCanonicalDatetimes`. The fact is now stated once, on
`AnalyticsServiceConfig.coerceTemporalFilterValue`, and the other sites link to it.
No behaviour changes from that half.
