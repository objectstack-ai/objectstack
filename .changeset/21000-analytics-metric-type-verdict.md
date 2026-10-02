---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: both analytics strategies refuse a cube measure whose `type` names no aggregate, in the spec's words — the custom-SQL `EXPRESSION_METRIC_TYPES` partition is gone with the three types it named (#21000)

**BREAKING** — `@objectstack/spec` retired the cube metric types `number`, `string`
and `boolean` from `AggregationMetricType` (a measure's `sql` is a column reference,
so they had nothing left to compute). Every door that parses a cube refuses them;
this release removes the runtime branches that still served them for a cube that
reached the analytics service WITHOUT meeting that parse — one a host registers
in-process from a literal, through `AnalyticsServicePlugin({ cubes })` or
`AnalyticsService({ cubes })` (the registry never parses).

| | before | now |
| --- | --- | --- |
| `NativeSQLStrategy`, a measure typed `number` / `string` / `boolean` | served: the column emitted UNAGGREGATED in the statement (`amount AS "m"` beside `GROUP BY`) | refused, nothing executed |
| `ObjectQLStrategy`, the same measure | refused `INVALID_FIELD` / 400 | refused, nothing executed |
| either strategy, a type the spec never declared (`median`) | native: refused; ObjectQL: forwarded to `executeAggregate` as the method (the auto-bridge refused it; a host's own executor received it), and `/analytics/sql` echoed `MEDIAN(amount)` | refused, nothing executed |

**The one refusal** is `aggregateOfMeasure`'s, shared by both strategies and both
doors (`POST /analytics/query` and `POST /analytics/sql`): it names the measure and
the cube, then quotes the spec's own verdict on the type — for a retired type the
retirement prescription (the six aggregates to choose from, and where a per-row or
derived value goes instead), for anything else zod's message listing the six. It is
a bare `Error`, the undeclared-500 tier this package assigns to a cube that never
met the parse, so the HTTP answer is `500` with the message readable in the body
(measured through the dispatcher's analytics route), never a caller-blaming `400`.
The ObjectQL envelope for the three retired types therefore moves from
`INVALID_FIELD` / 400 to that tier.

**The fix:** give the measure one of the six aggregate types — `count`, `sum`,
`avg`, `min`, `max`, `count_distinct` — or parse the cube through `CubeSchema`
before registering it, which refuses the same types with the same prescription.

**Removed export:** `EXPRESSION_METRIC_TYPES` from
`strategies/native-sql-strategy.ts` (internal to the package; not re-exported from
its entry point). **Unchanged:** every aggregate measure on both strategies, the
auto-bridge's own parse of an engine method (still pinned, driven directly), and
`GET /analytics/meta`, which keeps publishing each registered measure's `type` as
registered.

Clause-②: no (narrowing)

<!-- adr-0087: registered cube-metric-expression-types-retired -->
