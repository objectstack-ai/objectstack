---
'@objectstack/spec': minor
---

feat(spec)!: the analytics row wildcard `'*'` is admitted only where a `count` consumes it — a cube or dataset measure over `'*'` under any other aggregate, and a cube dimension over `'*'`, are refused at parse (#21409)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

`'*'` is the row wildcard: what a `count` aggregates (`COUNT(*)`), reading no
field value. It is now admitted in exactly one place, a measure that counts:

- `MetricSchema.sql` — a cube measure's `sql` — admits `'*'` under
  `type: 'count'` only; under any other `type` it is refused at `sql`
  (code `custom`).
- `DatasetMeasureSchema.field` — an ADR-0021 dataset measure's `field` — admits
  `'*'` under `aggregate: 'count'` only; under any other aggregate, or on a
  measure with no aggregate (a `derived` one), it is refused at `field`
  (code `custom`). A count may still omit `field`.
- `DimensionSchema.sql` — a cube dimension's `sql` — never admits `'*'`
  (code `invalid_format`): it takes the column path without the wildcard arm,
  the pattern a dataset dimension's `field` already takes.

Each refusal names the slot and the aggregate the author wrote, and prescribes
the two ways out: a `count`, or a column. A column or a relationship path parses
byte-identically to before on every slot, and so does a `count` over `'*'`.

Why: no aggregate but `count` has a column to read over `'*'`, and a dimension
has no aggregate at all, yet the contract admitted the wildcard on any measure
and on a cube dimension, and the analytics strategies sent it to the database as
written. Measured at `POST /api/v1/analytics/dataset/query` over a real SQLite
driver, on the native-SQL and the ObjectQL strategy alike: a dataset measure
aggregating `'*'` under `sum`, `avg`, `min`, `max` or `count_distinct` answered
`500 DATABASE_ERROR`. A dataset measure compiles to the cube measure it names
verbatim, so the same reading covers an authored cube measure. Such a member
never produced an answer, so no working document changes meaning: the failure
moves from the query to the authoring parse. The two measure slots ask ONE
shared predicate; the rule is cross-field (the slot and its aggregate), so it is
a refinement, which the published JSON Schema cannot carry — both sites are
declared in `dropped-refinements.baseline.json`. The dimension half is a
`pattern`, so `json-schema/**` states it.

## FROM → TO

```
FROM  { name: 'deal_metrics', label: 'Deal Metrics', object: 'deal',
        dimensions: [{ name: 'stage', field: 'stage' }],
        measures: [{ name: 'deals', aggregate: 'sum', field: '*' }] }
      -> DatasetSchema.parse accepted it; a dataset query selecting `deals`
         answered 500 DATABASE_ERROR
TO    -> DatasetSchema.parse throws a ZodError at measures.0.field (custom):
         `measures[].field` is the row wildcard `'*'` under `aggregate: 'sum'`. …
         defineStack({ datasets }) refuses it at datasets.N.measures.0.field (422
         STACK_SCHEMA_INVALID), and POST /api/v1/analytics/dataset/query answers
         400 VALIDATION_FAILED for an inline or a saved copy

      measures: [{ name: 'deals', aggregate: 'count' }]                  // a row count
      measures: [{ name: 'deal_value', aggregate: 'sum', field: 'amount' }] // an aggregate of a column

FROM  defineCube({ name: 'deals', sql: 'deal',
        measures: { total: { label: 'Total', type: 'sum', sql: '*' } },
        dimensions: { everything: { label: 'All', type: 'string', sql: '*' } } })
TO    -> refused at measures.total.sql (custom) and dimensions.everything.sql (invalid_format)

      measures: { total: { label: 'Total', type: 'sum', sql: 'amount' } },
      dimensions: { stage: { label: 'Stage', type: 'string', sql: 'stage' } }
```

**The one-line fix:** parse each cube and dataset; every refusal at `…sql` /
`…field` naming `'*'` is one member to change — declare a `count` to count rows,
or name the column the measure aggregates (a dimension names the column it
groups by). On a `derived` dataset measure, delete `field`: nothing read it.
There is no mechanical rewrite: `os migrate meta` rewrites nothing for it, and
lists the entry `analytics-row-wildcard-outside-count-refused` as a manual
change that requires your judgment.

**What a stored document meets.** A metadata read still serves it as stored,
with the refusal on its read diagnostics (`_diagnostics`), and a re-save through
the metadata write door is refused at the slot. `POST
/api/v1/analytics/dataset/query` parses every dataset it is handed, inline or
saved, so a stored dataset carrying such a measure answers `400
VALIDATION_FAILED` at `measures.N.field` on every query — including a query that
selects only its other measures, which used to answer — until the member is
fixed: it fails closed. An authored cube reaches the analytics runtime through
the stack definition, whose parse refuses it.

## The kit

- **Schema.** `data/analytics-column-reference.ts` (not published API) declares
  the predicate `rowWildcardOutsideCount` and its refusal once; `MetricSchema`
  and `DatasetMeasureSchema` call both from a refinement, and
  `DimensionSchema.sql` takes `ANALYTICS_COLUMN_PATH`. No export, key or enum
  member changes, so the api-surface, authorable-surface and JSON-schema
  manifest ratchets are unchanged.
- **ADR-0087.** D3 entry `analytics-row-wildcard-outside-count-refused`. No D2
  conversion: rewriting to `count` would change the figure the author asked for,
  and only the author can name the column. No `RETIRED_KEYS_BY_MAJOR` row.
- **Dropped refinements.** `data/Metric` and `ui/DatasetMeasure` gain their root
  site, and every published schema embedding them gains the embedded site.
- **Liveness.** `analytics_cube` `measures.sql` / `dimensions.sql` and `dataset`
  `measures.field` stay `live`, re-verified, their notes re-pointed here.
- **Docs.** The `ui/dataset` reference page is regenerated.
- **Runtime.** Unchanged.

## Reach, measured

- This repository: no example, platform object, doc, skill, script or test
  fixture authors `'*'` outside a `count` at the three slots (`git grep` of every
  `field` / `sql` value spelled `'*'`, 173 hits, each read in its enclosing
  object: 154 under a `count`, the rest QueryAST aggregations, comments and
  strategy-level literals). One spec pin admitted `'*'` on a cube dimension; it
  now pins the refusal.
- objectui at the pinned `.objectui-sha`: zero `field` / `sql` values spelled
  `'*'` (lit controls: 51 `aggregate: 'sum'`, 438 `field: 'amount'`).
- Out-of-repo authored metadata: NOT MEASURED.

<!-- adr-0087: registered analytics-row-wildcard-outside-count-refused -->
