---
'@objectstack/spec': minor
'@objectstack/service-analytics': patch
---

feat(spec)!: an analytics cube member's `sql` is a column reference — a SQL expression there is refused at parse, and a derived value is declared on an ADR-0021 dataset (#20943)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

`MetricSchema.sql` and `DimensionSchema.sql` — the `sql` of every member in an
analytics cube's `measures` and `dimensions` — admit a column reference only: a
field of the cube's object (`amount`), a relationship path of bare identifiers
ending in one (`account.amount`, `account.owner.region`), or `'*'` for a count.
Any other value — a `CASE WHEN …`, an aggregate or a ratio of aggregates, a quoted
or `$`-prefixed spelling, an empty string — is refused at parse with a
prescription. This is ADR-0021's "zero raw SQL / zero raw expressions" carried
from the dataset layer to the cube members it compiles to (maintainer ruling D on
the card): an expression names no single field, so no platform check can judge
which fields it reads, and the two analytics strategies never agreed on it — the
raw-SQL path ran it verbatim and the ObjectQL path refused it. The rule is a
`pattern` in the published JSON Schema too, so a document validated against
`json-schema/**` is judged as the parse judges it.

## FROM → TO

A derived value moves to an ADR-0021 dataset over the same object. A conditional
count or sum is a dataset measure with its own structured `filter`; a ratio, sum,
difference or product of measures is `derived: { op, of: [...] }` over measures
named in the same dataset.

```
FROM  defineCube({ name: 'delivery', sql: 'task', measures: {
        done_rate: { label: 'Done Rate (%)', type: 'number',
                     sql: "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)" },
      } })
      -> parsed; the expression ran verbatim on one strategy and was refused on the other
TO    -> ZodError at measures.done_rate.sql (invalid_format): `measures.<metric>.sql` is a
         column reference: a field of the cube's object (`amount`), a relationship path ending
         in one (`account.amount`), or `'*'` for a count. A SQL expression there was retired …

      defineDataset({ name: 'task_metrics', label: 'Task Metrics', object: 'task',
        dimensions: [/* … */],
        measures: [
          { name: 'task_count', aggregate: 'count' },
          { name: 'done_count', aggregate: 'count', filter: { status: 'done' } },
          { name: 'done_rate', derived: { op: 'ratio', of: ['done_count', 'task_count'] }, format: '0.0%' },
        ] })
```

**Mind the scale.** A `derived` ratio is a 0–1 fraction. An expression that
multiplied by 100 returned percentage points; pair the ratio with a `%` numeral
pattern (the server marks a ratio column's percent scale as a fraction) and
re-check any consumer that read the old number raw.

**A dimension that bucketed a column with a CASE expression** has no expression
form in the cube layer or the dataset layer: group by the column itself, or keep
the bucket as a field of the object and name that field.

**The one-line fix:** parse each cube; every refusal at `…sql` is one member to
move — replace it with the column it aggregates, or move the derived value to a
dataset measure as above, and point the dashboards, reports and queries that named
`<cube>.<member>` at the dataset measure.

**What an author who still writes it sees.** `CubeSchema`, `defineCube()`,
`defineStack({ analyticsCubes })` (`STACK_SCHEMA_INVALID` / 422) and the
`analytics_cube` write door refuse the member at its `sql` path with the
prescription. `tsc` does not: the key's type is still `string`.

## The retirement kit

- **Schema.** `MetricSchema.sql` / `DimensionSchema.sql` carry the pattern and
  their prescriptions (`data/analytics.zod.ts`). A column reference parses
  byte-identically to before. The retired metric `filters` guidance and the
  analytics query's `filters` guidance no longer offer "fold the condition into
  the metric's own `sql` expression" as a live channel; the `metric-filters-removed`
  conversion summary and its D3 entry and step-18 rationale fragment say the same.
- **ADR-0087.** The D3 entry `cube-member-sql-expression-retired`, with its
  step-18 rationale fragment. No D2 conversion — an expression has no mechanical
  rewrite into a dataset — and no `RETIRED_KEYS_BY_MAJOR` row: no key left the
  shape, so the authorable-surface, api-surface and JSON-schema manifest
  ratchets are unchanged.
- **Liveness.** The `analytics_cube` ledger rows `measures.sql` and
  `dimensions.sql` stay `live`, re-verified, with the narrowing recorded.
- **Docs.** The `data/analytics` reference page is regenerated.
- **Example.** The showcase cube's `done_rate` expression member moves to the
  `showcase_task_metrics` dataset as `done_count` (a count filtered on
  `status: 'done'`) and `done_rate` (`ratio` over `done_count` and `task_count`,
  format `0.0%`).
- **`@objectstack/service-analytics`** (README only): its query-body section no
  longer tells a reader to fold a per-metric condition into the metric's own
  `sql` expression. The runtime is unchanged: its expression branches remain for
  a cube that reaches the service without meeting the parse, and their deletion
  is a separate change.

## Reach, measured

- This repository: one authored expression member (the showcase `done_rate`),
  moved here. Test fixtures in `@objectstack/service-analytics` that build
  expression members WITHOUT the parse keep exercising the runtime's expression
  branches, unchanged.
- Out-of-repo authored cubes: NOT MEASURED.

<!-- adr-0087: registered cube-member-sql-expression-retired -->
