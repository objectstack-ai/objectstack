---
'@objectstack/spec': minor
---

feat(spec)!: retire the cube metric types `number`, `string` and `boolean` — a measure's `sql` is a column reference, so the custom-SQL-expression types had nothing left to compute (#21000)

**BREAKING** — three members leave `AggregationMetricType`, so a cube measure's
`measures.<metric>.type` no longer accepts `number`, `string` or `boolean`. ADR-0049
enforce-or-remove. They declared "a custom SQL expression returning a number /
string / boolean": the measure's `sql` was the whole computation. A cube member's
`sql` is a column reference since `cube-member-sql-expression-retired` (#20943), so
the three were left naming nothing: measured before this change, the raw-SQL
analytics path returned the referenced column UNAGGREGATED (a bare column in a
grouped statement — by SQL's own rules an error on PostgreSQL and an arbitrary row's
value on SQLite), and the ObjectQL path refused the measure. The six aggregates — `count`, `sum`,
`avg`, `min`, `max`, `count_distinct` — are unchanged and are now the whole
vocabulary.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `measures.<metric>.type: 'number'`, `'string'` or `'boolean'` | the aggregate the measure means: `sum`, `avg`, `min` or `max` over the column; `count` (over `'*'` for a row count, or over a column for its non-null values); or `count_distinct`. |
| a measure whose old expression computed a value per row | keep that value as a field of the object (a stored or formula field) and aggregate the field. |
| a measure whose old expression combined measures (a ratio, a difference) | `derived: { op, of: [...] }` on an ADR-0021 dataset over the same object. |

**The one-line fix: give the measure an aggregate type.** There is no mechanical
rewrite — the column alone does not say whether `amount` meant its sum, its average
or its largest value — so `os migrate meta` lists nothing for this change.

Each retired member is refused at parse with a prescription naming the six
aggregates, at the measure's `type`, and in `tsc` (the members are gone from the
`AggregationMetricType` type). A value the enum never declared keeps zod's own
message.

### The retirement kit

- **Value-level retirement.** `AggregationMetricType` is declared through
  `enumWithRetiredValues` (`shared/retired-key.ts`), with the prescriptions
  module-private. No authorable KEY and no def changed, so nothing lands in
  `RETIRED_KEYS_BY_MAJOR`, and the four surface ratchets (`api-surface`,
  `authorable-surface`, `json-schema.manifest`, `api-surface-signatures`) are
  byte-identical.
- **No D2 conversion, by design.** A stored or built cube that still carries one of
  the three is REFUSED, never rewritten or dropped: the boot door
  (`ObjectStackDefinitionSchema`, which a built artifact is parsed through), the
  `analytics_cube` write door and `defineStack` refuse it with the prescription, and
  the rehydration seam replays no conversion over it.
- **D3 entry `cube-metric-expression-types-retired`**, with its step-18 rationale
  fragment, carries the judgement the upgrader owes: which aggregate each measure
  meant.
- **Liveness.** The `analytics_cube` row `measures.type` stays `live`, re-verified
  2026-10-02, with the narrowing recorded.
- **Docs.** The `data/analytics` reference page is regenerated.
- **No deprecation window**, per the project's startup-stage posture.

### Reach, measured

- This repository authors no cube measure of the three types outside tests:
  `examples/**`, `packages/**` (the platform objects included) and the skills and
  docs carry none. The showcase cube's `type: 'string'` entries are dimensions,
  whose `DimensionType` is a separate enum and is unchanged.
- objectui at its pinned commit carries no `AggregationMetricType` mirror and no
  cube measure of the three types.
- Out-of-repo authored cubes: NOT MEASURED.

Clause-②: no (narrowing)

<!-- adr-0087: registered cube-metric-expression-types-retired -->
