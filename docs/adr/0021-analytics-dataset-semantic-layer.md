# ADR-0021: Analytics — one semantic `dataset` layer, `report` / `dashboard` become pure presentation

**Status**: Proposed — **revised 2026-05-31**: implementation scan folded in, and the gating decisions **D-A / D-B / D-C resolved** + open questions Q1–Q3 closed, optimised for the AI-authors / human-reviews design center (see "Decision" and "Resolved decisions")
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0019](./0019-app-as-consumer-unit.md) + [ADR-0020](./0020-state-machine-converge-and-enforce.md) (the "one engine, fold the parasitic concept into its host" principle — applied here to analytics), [ADR-0017](./0017-object-has-many-view.md) (object-bound ListView is the row-level lens), [ADR-0010](./0010-nl-to-flow-authoring.md) + [ADR-0011](./0011-actions-as-ai-tools.md) (AI authoring is the design center)
**Consumers**: `@objectstack/spec` (`ui/report.zod.ts`, `ui/dashboard.zod.ts`, `ui/view.zod.ts`, `data/query.zod.ts`, `kernel/metadata-type-schemas.ts`), `@objectstack/objectql` (query engine), `@objectstack/analytics-service`, all `examples/*`

> **Migration posture: big-bang, no back-compat.** This ADR redesigns the analytics surface from a clean sheet. The next minor version switches over in one shot — old `Report` / `DashboardWidget` shapes are *removed*, not deprecated-in-parallel. A one-time codemod rewrites existing metadata (see §6). We are explicitly **not** carrying the three legacy inline-query shapes forward.

---

## TL;DR

The platform's **query *schema*** (`QuerySchema`, [`query.zod.ts:586`](../../packages/spec/src/data/query.zod.ts#L586)) already *describes* `joins` (inner/left/right/full + strategies + subquery + cross-datasource), `aggregations`, `groupBy` (with date bucketing), `having`, and `windowFunctions`.

> **Correction (revised 2026-05-31).** An implementation scan found the *runtime* does **not** match the schema: `groupBy` + `aggregations` execute (single-object only), but `joins` / `having` / `windowFunctions` are **schema-only — not executed** by `IDataEngine` or the SQL driver. A separate, already-implemented **Cube semantic layer** (`IAnalyticsService` + `CubeSchema`) is the *only* path that emits cross-object joins today (and it bypasses RLS/tenant). This reframes the work and the naming — see the "Implementation scan" section. The decisions below stand; the cost and the build-vs-reuse choice change.

But **three presentation surfaces each re-implement their own crippled, single-object query inline** instead of using it:

| Surface | Data binding | Joins? | Uses `query.zod`? | Inline query fields |
|---|---|---|---|---|
| `Report` | single `objectName` | ❌ | ❌ | `columns[] + groupingsDown/Across + filter + blocks` |
| `DashboardWidget` | single `object` | ❌ | ❌ | `categoryField + valueField + aggregate + measures[] + filter + compareTo` |
| `ListView` chart (`ListChartConfigSchema`) | single object | ❌ | ❌ | `valueField + groupByField` ("Distinct from the full-featured chart") |

This produces three structural defects that are fatal for an **enterprise core-business** platform:

1. **No joins ⇒ half of real reporting is impossible.** "Revenue by account region" needs `order ⋈ account`. The engine can do it; the presentation layer can't reach it.
2. **Triple double-write ⇒ metric drift.** "Revenue" is defined three times in three different grammars. Finance numbers diverge across a report, a dashboard tile, and a list chart. This is a governance red line.
3. **No single source of truth ⇒ no drill-through, no certification, no reuse.** A dashboard tile cannot drill into the report behind it because there is no shared definition behind either.

**Decision.** Introduce **one semantic layer — `dataset`** — a named, reusable analytical definition (base object + included relationships + declared **dimensions** and **measures**) that **compiles to the existing Cube analytics runtime**, *not* a wrapper exposing raw `QuerySchema` joins. Then **collapse `report` and `dashboard` to pure presentation** that binds to a dataset by reference and selects dimensions/measures *by name* — never re-declaring `object` / `field` / `aggregate`. Chart visualization config (`ChartConfigSchema`) stays shared (it already was). `report` and `dashboard` remain **two metadata types** because their *render grammars* genuinely differ (pivot grid vs. widget canvas) — but neither owns a query anymore.

This is the industry-convergent shape (Looker LookML / Power BI dataset+model / dbt metrics / Salesforce CRM-Analytics dataset): **a governed semantic layer below; thin presentations above.** It keeps Airtable's authoring ergonomics (an inline single-object dataset auto-desugars, see §4) while gaining the governance Airtable lacks.

---

## Context

### Why two presentations is right, but two (three) queries is wrong

The earlier instinct "report and dashboard are two things" is correct — but for the wrong layer. They differ in **how they render**:

- **Report** renders a **pivot grid**: rows × columns × measures, with subtotals, drill-to-record, export. Its grammar is the matrix/pivot.
- **Dashboard** renders a **widget canvas**: a grid of independent charts/KPIs with global filters and refresh. Its grammar is layout + per-tile chart.

These two render grammars do not reduce to one another (a matrix report is not a single chart series). So **two presentation types stay.** What must *not* be duplicated is the layer *below* the render — "which object(s), which joins, which filter, which aggregation, what does `revenue` mean." That is one thing, and today it is three things.

### What "perfect" looks like — the semantic layer

Mature analytics stacks all converge on a three-layer model. We adopt it verbatim:

```
┌─ Presentation   report (pivot)   ·   dashboard (canvas)   ·   listView (row lens)
│                       │ reference by name, select dims/measures
├─ Semantic        dataset  — base object + included relationships + declared dimensions/measures   ← single source of truth
│                       │ compiles to
└─ Runtime         Cube analytics runtime (IAnalyticsService) — RLS/tenant-enforced join + aggregation
```

- **Runtime** — the **already-implemented Cube analytics runtime** (`IAnalyticsService`, `service-analytics`) executes joins + aggregations. The dataset *compiles to* it (resolved decision **D-A=(c)**). We do **not** build a third query path, and we do **not** expose the raw `QuerySchema` join grammar to authors.
- **Semantic** (`dataset`, NEW) — a **declarative, closed** surface that is deliberately *smaller* than `QuerySchema`: an author declares a base object, which **relationships** to include (by name — joins are *derived from the object graph*, never hand-written), and the **dimensions** (groupable axes) and **measures** (aggregatable values, with format + certification). `revenue` is defined *once* here. No raw SQL, no hand-authored join predicates.
- **Presentation** — `report` / `dashboard` / `listView`-chart reference a dataset and pick dimensions/measures *by name*. Zero query fields.

### Why widgets bind to `dataset`, not to `report`

A reasonable objection: "Salesforce/ServiceNow dashboards reference *reports* — why don't ours?" Because **"dashboard → report" is a symptom of having no semantic layer, not the target architecture.** In Salesforce/ServiceNow there is no `dataset`, so the Report is the only reusable data unit and is forced to double as one. The more mature the stack, the more the tile's dependency moves *off* the report and *onto* a dedicated semantic layer:

| Stack | Tile data source | True source of record |
|---|---|---|
| Salesforce / ServiceNow (no semantic layer) | → **report** | the report itself (doing double duty) |
| Power BI | pinned *from* a report, **but** | **dataset / model** |
| Looker | → Look or Explore | **Explore + LookML measures** |
| dbt / modern stack | → semantic model | **semantic model** |

Binding a *chart* tile to a *report* is actively worse than binding it to a dataset:

1. **Presentation pollution.** A report is a pivot grid (rows/columns/sort/subtotals). A chart wants only dimensions + measures. Sourcing a chart from a report means reverse-engineering a measure out of a presentation ("which report column is my Y-axis?"). A dataset exposes `revenue` by name directly.
2. **Report sprawl.** Different tiles want the same metric grouped differently (by month / region / product). Tile→report breeds one report per grouping (Salesforce's signature disease — half of all reports exist only to back a tile). Tile→dataset: one dataset's measures feed many tiles, and the *grouping is the tile's own `dimensions`* — nothing new is created.
3. **Layering integrity.** `report` and `dashboard` are *siblings* (both presentations). Making one depend on the other inverts the layering — a presentation becomes a data source — and blocks a chart-only metric (no report) or a table-only report (no dashboard) from being first-class. Dataset-below / presentations-beside is a clean DAG.
4. **Drill-through is decoupled, not lost.** The legitimate "click the tile → see detail" need is preserved by `widget.drillTo: reportName` — an *optional navigation link*, not the data dependency. The tile draws data from the dataset and *additionally* may jump to a report for the tabular drill.

The kernel of truth in "reference a report" is **reuse of a fully-specified analysis** — relocated here to its correct layer (the dataset) plus two escape hatches: `drillTo` for navigation, and the report-embed widget below for genuine table-in-dashboard composition.

#### Report-embed widget (presentation composition ≠ data dependency)

When an author literally wants a report's *table* rendered inside a dashboard (not a chart sourced from report data), that is a presentation-layer composition and is allowed via a distinct widget kind:

```ts
// a widget may EITHER source chart data from a dataset (default), OR embed a report for display
widget: { id: 'pipeline_table', report: 'pipeline_by_stage', layout: { x:0, y:0, w:12, h:6 } }
```

`widget.report` (embed a rendered report) and `widget.dataset` (source chart/KPI data) are mutually exclusive. This keeps "show this table here" possible without letting chart data flow *through* a presentation.

### Precedent

| Product | Semantic layer | Pivot/report | Dashboard tile source |
|---|---|---|---|
| Looker | **Explore + LookML measures/dimensions** | Look (table) | tile → Look/Explore |
| Power BI | **Dataset + model (DAX measures)** | Report visual | tile pinned from report |
| dbt | **metrics / semantic models** | downstream BI | downstream BI |
| Salesforce CRM Analytics | **Dataset (recipe)** | Lens | dashboard widget → dataset/lens |
| Airtable (counter-example) | **none** — tile redefines query inline, single table | — | tile → table/view inline |

Airtable's flat model is exactly our current `DashboardWidget`. It suits Airtable's market and **cannot carry enterprise core systems** (no joins, no governed metric). We keep its *ergonomics* (§4) and discard its *architecture*.

### Design center: AI authors this

Per ADR-0010/0011 the author is increasingly an AI and the human is a reviewer. This is **not a soft constraint — it is the criterion that resolves every open decision below.** Its imperative is singular: **shrink "what an author may write" to the smallest, most closed, most declarative surface possible.** A named `dataset` with declared `measures: [{ name: "revenue", aggregate: "sum", field: "amount" }]` gives the model a **stable, enumerable vocabulary**: a widget says `measures: ["revenue"]` and cannot invent a divergent `valueField/aggregate` pair.

Six principles follow, and they drive the resolved decisions:

| Principle | Why (AI-writes / human-reviews) |
|---|---|
| **One legal way to express a thing** | Multiple shapes are a hallucination trap (ADR-0020). The model picks the wrong one of N. |
| **Closed, enumerable, introspectable sets** | The AI selects from declared measures/dimensions instead of inventing fields — the strongest guardrail. An Agent can ask "what measures exist here?" exactly like ADR-0020's "what state transitions are legal?" |
| **Zero raw SQL / zero raw expressions** | Every escape hatch is at once a hallucination source, an injection risk, and an un-reviewable blob. Reviewing `measures: ["revenue"]` is O(1); auditing a hand-written join+SQL is O(n). |
| **Joins derived from the relationship graph, never hand-authored** | The object model already declares `lookup`/`master_detail`. The AI says "include `account.region`"; the compiler derives the join. The AI never writes an `ON` clause — the single biggest safety win. |
| **Safety enforced by the engine, not the author** | The AI will not reliably add a tenant/RLS filter and a reviewer will not reliably catch a missing one. RLS must be automatic (drives D-C). |
| **`certified` measures are the review checkpoint** | A human blesses a measure once; the AI reuses it; reviewing AI output collapses to "did it use certified measures correctly," not "is this query correct." |

This is the **third application of the ADR-0019/0020 "one engine, converge the shapes" principle**: analytics intent is today expressible four ways (Cube DSL, `QuerySchema`, inline report query, inline widget query). The AI-author center *demands* converging to **one** author-facing semantic shape.

---

## Decision

Three decisions.

### D1 — Introduce `dataset` as the single analytical source of truth

A new top-level metadata type `dataset`. It is **not** a wrapper over `QuerySchema` — that would expose hand-authored joins, exactly the surface the AI-author center forbids. Instead it is a **declarative, closed surface, deliberately smaller than `QuerySchema`**, that **compiles to the Cube analytics runtime** (D-A=(c)). The author declares a base object, which **relationships to include** (joins derived from the object graph), and named dimensions/measures. No raw SQL, no `ON` clauses, no window/having grammar in the author surface.

```ts
// packages/spec/src/ui/dataset.zod.ts  (NEW)
//
// Naming (D-B): this type takes the high-prior names `dataset` / `measure` /
// `dimension` (LookML/dbt/Cube/PowerBI vocabulary — densest in the model's
// priors). The colliding seed `DatasetSchema` is renamed to `Seed`/`SeedData`
// (a more accurate name anyway); the Cube layer's `Dimension`/`Metric` are
// ABSORBED here (D-A converges them — they are the same concept), so the
// collision dissolves rather than being worked around.

export const DimensionSchema = z.object({
  name: SnakeCaseIdentifierSchema,            // referenced by presentations
  label: I18nLabelSchema.optional(),
  /** A field on the base object, OR a `relationship.field` path. The join is
   *  DERIVED from the declared relationship — the author never writes a predicate. */
  field: z.string(),
  type: z.enum(['string','number','date','boolean','lookup']).optional(),
  dateGranularity: DateGranularity.optional(),// default bucketing for date dims
});

export const MeasureSchema = z.object({
  name: SnakeCaseIdentifierSchema,            // e.g. "revenue" — defined ONCE
  label: I18nLabelSchema.optional(),
  aggregate: AggregationFunction,             // reuse query.zod enum (sum/avg/count/...)
  field: z.string().optional(),               // base/relationship field; optional for count(*)
  filter: FilterConditionSchema.optional(),   // measure-scoped filter (e.g. won_amount)
  format: z.string().optional(),              // "$0,0.00", "0.0%"
  certified: z.boolean().default(false),      // governance: blessed metric (the review checkpoint)

  /** Q1 RESOLVED — derived measures are first-class from day one, but CLOSED:
   *  a derived measure references OTHER measures BY NAME only. No raw fields,
   *  no raw SQL. `{ ratio: 'won_amount', of: 'total_amount' }` → won/total. */
  derived: z.object({
    op: z.enum(['ratio','sum','difference','product']),
    of: z.array(SnakeCaseIdentifierSchema),   // names of other measures in this dataset
  }).optional(),
});

export const DatasetSchema = z.object({
  name: SnakeCaseIdentifierSchema,
  label: I18nLabelSchema,
  description: I18nLabelSchema.optional(),

  /** Base object — the FROM. */
  object: z.string(),

  /** Relationships to include, BY NAME (lookup/master_detail field names on the
   *  object graph). Joins are compiled from these — the author writes no ON clause.
   *  v1 (D-C): only declared relationships are joinable; no arbitrary predicates. */
  include: z.array(z.string()).optional(),

  /** Definition-level filter (the dataset's intrinsic scope, e.g. "non-deleted"). */
  filter: FilterConditionSchema.optional(),

  /** The semantic contract presentations bind to. */
  dimensions: z.array(DimensionSchema),
  measures: z.array(MeasureSchema),

  protection: ProtectionSchema.optional(),
  ...MetadataProtectionFields,
});
```

**RLS/tenant is enforced by the runtime, not declared here** (D-C). The dataset compiles to a Cube query whose execution applies the sharing middleware's read filter **per joined object** — there is **one** place to reason about access, and the author cannot forget it.

### D2 — `report` becomes a pure pivot presentation over a dataset

`ReportSchema` loses `objectName`, `columns`, `groupingsDown/Across`, `filter`, `blocks`, `chart`-as-query. The `tabular / summary / matrix` enum collapses into one pivot grammar (tabular = no groupings; summary = rows only; matrix = rows + columns). `joined` becomes `sections[]` — each section is just another dataset reference.

```ts
export const ReportSchema = z.object({
  name: SnakeCaseIdentifierSchema,
  label: I18nLabelSchema,
  description: I18nLabelSchema.optional(),

  dataset: z.string().describe('Dataset name — the only data binding'),

  /** Pivot layout — dimension/measure NAMES from the dataset, never fields. */
  rows: z.array(z.string()).optional(),        // dimension names down
  columns: z.array(z.string()).optional(),     // dimension names across (matrix)
  values: z.array(z.string()),                 // measure names

  /** Presentation-only. */
  runtimeFilter: FilterConditionSchema.optional(), // user scope, ANDed at render (NOT the definition)
  display: ReportDisplaySchema.optional(),     // totals, conditional formatting, number format overrides
  chart: ChartConfigSchema.optional(),         // optional viz of the same pivot
  drilldown: z.boolean().default(true),        // click a cell → underlying records (free, dataset-backed)

  /** Multi-section ("joined") report = several dataset-backed panels. */
  sections: z.array(ReportSectionSchema).optional(),

  aria: AriaPropsSchema.optional(),
  performance: PerformanceConfigSchema.optional(),
  protection: ProtectionSchema.optional(),
  ...MetadataProtectionFields,
});
```

### D3 — `dashboard` widgets reference a dataset and pick measures/dimensions by name

`DashboardWidgetSchema` loses `object`, `categoryField`, `categoryGranularity`, `valueField`, `aggregate`, `measures[]`, and inline `filter`/`compareTo`-as-query. A widget now **selects** from its dataset's declared semantics:

```ts
export const DashboardWidgetSchema = z.object({
  id: SnakeCaseIdentifierSchema,
  title: I18nLabelSchema.optional(),
  layout: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),

  /** Data binding — EXACTLY ONE of `dataset` (chart/KPI) or `report` (embed a rendered table). */
  dataset: z.union([z.string(), DatasetSchema]).optional(), // name (governed) or inline (sugar, §4)
  report: z.string().optional(),               // embed a rendered report table (presentation composition)

  dimensions: z.array(z.string()).optional(),  // dimension names (X / group / split) — dataset path only
  measures: z.array(z.string()).optional(),    // measure names (Y) — "revenue", not amount+sum

  viz: ChartConfigSchema.optional(),           // chart type + axes mapping (shared, unchanged)
  colorVariant: WidgetColorVariantSchema.optional(),

  /** Presentation directives over the dataset's declared date dimension. */
  compareTo: CompareToSchema.optional(),       // previousPeriod / previousYear / {offset} — engine shifts the query
  drillTo: z.string().optional(),              // report name to open on click (navigation, not data dep)

  requiresObject: z.string().optional(),       // runtime capability gate (kept)
  requiresService: z.string().optional(),
  responsive: ResponsiveConfigSchema.optional(),
  aria: AriaPropsSchema.optional(),
}).superRefine((w, ctx) => {
  // exactly one data binding
  if (!!w.dataset === !!w.report)
    ctx.addIssue({ code: 'custom', message: 'widget requires exactly one of `dataset` or `report`' });
  // dimensions/measures only meaningful on the dataset path
  if (w.report && (w.dimensions || w.measures))
    ctx.addIssue({ code: 'custom', message: '`dimensions`/`measures` are not allowed with `report` (embed) widgets' });
});
```

Dashboard-level `globalFilters` and `dateRange` bind to **dimension names**, not raw fields — so a global filter is valid by construction and applies uniformly because every widget speaks the same dataset vocabulary.

`ListView`'s `type: 'chart'` variant (`ListChartConfigSchema`) is retired the same way: a charted list view references a dataset. The object-bound *row-level* lenses (grid/kanban/calendar/gallery — ADR-0017) are unaffected; they were never analytics.

---

## Consequences

**Gained**
- **Joins everywhere, safely.** Any report/widget can be multi-object because the dataset includes relationships that compile to the Cube runtime's join path (with RLS enforced per joined object, D-C). The #1 enterprise blocker is gone — without exposing hand-authored joins.
- **One definition of every metric.** `revenue` lives in one dataset measure; every surface references it. No drift; `certified` enables governance.
- **Drill-through is free.** A widget and the report behind it share a dataset, so a tile can `drillTo` a report or expand to underlying records natively.
- **Smaller protocol.** Three inline query grammars (`Report.columns/groupings`, `Widget.category/value/aggregate/measures`, `ListChartConfig`) delete down to one (`dataset.dimensions/measures`). Net schema shrinks.
- **AI authoring is safer.** Closed, enumerable set of legal dimensions/measures per dataset.

**Costs**
- **Big-bang migration** (accepted, §6). Every existing report/dashboard/list-chart is rewritten by codemod.
- **One more indirection** for the trivial "single-object count" case — mitigated by inline desugaring (§4).
- **Engine must support presentation directives** — `compareTo` time-shift and `runtimeFilter` ANDing happen at query compile time against a dataset.

---

## §4 — Keeping Airtable ergonomics: inline desugaring

The objection to a semantic layer is "now a one-number KPI needs a whole dataset file." We remove that cost: a presentation may inline an **anonymous dataset** which the loader desugars into a real (unnamed) dataset at registration:

```ts
// authoring sugar — single object, no named dataset needed
widget: {
  id: 'open_deals', viz: { type: 'metric' },
  dataset: { object: 'opportunity', filter: { stage: { $ne: 'closed' } },
             dimensions: [], measures: [{ name: 'v', aggregate: 'count' }] },
  measures: ['v'],
}
```

`dataset` accepts **either** a `string` (named reference — the governed path) **or** an inline `DatasetSchema` (the Airtable-style quick path). Same author ergonomics as today; same single engine underneath. Reach for a named dataset when a metric is shared or must be certified.

---

## §5 — Metadata-type registry changes

[`metadata-type-schemas.ts`](../../packages/spec/src/kernel/metadata-type-schemas.ts):

```diff
+ dataset: DatasetSchema,
  dashboard: DashboardSchema,   // shape replaced (D3)
  report: ReportSchema,         // shape replaced (D2)
```

`report` and `dashboard` stay as types (two presentations, §Context). `dataset` is added. No type is removed — but two are re-shaped.

---

## §6 — One-shot migration (codemod, next minor)

A deterministic codemod runs over all package/app metadata. No parallel old+new period.

| Old | New |
|---|---|
| `Report{ objectName, columns, groupingsDown/Across, filter }` | extract `dataset{ object, filter, dimensions:(groupings), measures:(aggregate columns) }`; `Report{ dataset, rows, columns, values }` |
| `Report{ type:'joined', blocks }` | one dataset per block → `Report{ sections:[{dataset}] }` |
| `DashboardWidget{ object, categoryField, valueField, aggregate, filter }` | anonymous dataset (inline) or named if shared; `widget{ dataset, dimensions:[category], measures:[{aggregate,valueField}→name] }` |
| `DashboardWidget{ measures[] }` (multi-measure) | dataset `measures[]` + widget `measures:[names]` |
| `ListView{ type:'chart', ListChartConfig }` | `dataset` reference; drop `ListChartConfigSchema` |

Duplicate inline definitions that the codemod detects as identical (same object+field+aggregate across surfaces) are **hoisted into one named, `certified: false` dataset** and referenced — converting accidental duplication into an explicit shared metric the team can then bless. The codemod emits a report of every hoist so authors can review and name them.

**Files removed:** `ListChartConfigSchema` (in `view.zod.ts`); the inline-query fields enumerated above. **Files added:** `ui/dataset.zod.ts`. **Files reshaped:** `ui/report.zod.ts`, `ui/dashboard.zod.ts`.

---

## Implementation scan (revised 2026-05-31) — reality, gaps, task list

A four-area code scan (spec, runtime, frontend, examples) produced the following. **Three findings change the plan; read them before estimating.**

### Finding 1 — the runtime does not match `QuerySchema`

| Capability | Schema | Runtime reality |
|---|---|---|
| `groupBy` + `aggregations` | ✅ | ✅ executed — `in-memory-aggregation.ts` + `driver-sql` groupBy; **single-object only** |
| `joins` | ✅ | ❌ **not executed** — `engine.find/aggregate` never read `joins`; SQL driver `find`/`aggregate` emit no JOIN. Cross-object is only FK-expand (`expandRelatedRecords`, N+1, *nested* — not a flat join, unusable for grouped aggregation) |
| `having` | ✅ | ❌ not evaluated |
| `windowFunctions` | ✅ | ❌ dead code (`findWithWindowFunctions` never called by `ObjectQL`) |

So "revenue by `account.region`" — the headline dataset use case — **cannot run through `IDataEngine` today.** Joins are the gating runtime gap.

### Finding 2 — a parallel semantic layer already exists (must reconcile)

`data/analytics.zod.ts` `CubeSchema` + `contracts/analytics-service.ts` `IAnalyticsService` are **implemented** (`AnalyticsService` in `service-analytics`, `MemoryAnalyticsService` in `driver-memory`): a Cube.io-style `{ measures, dimensions, timeDimensions }` layer — conceptually the same "semantic layer" this ADR proposes. Its `NativeSQLStrategy` is the **only** code that emits cross-object `LEFT JOIN` (single-hop), but via raw `engine.execute()` which **bypasses the sharing-middleware RLS and tenant isolation** ([`engine.ts:2077`](../../packages/objectql/src/engine.ts#L2077) warns explicitly). It loads opt-in (`requires: ['analytics']`), and its grammar is **disjoint from `QuerySchema`** — nothing compiles `QuerySchema.joins/having/window` to execution.

**Implication:** do not build a *third* semantic layer. Either (b) adopt/extend Cube as the dataset, or (c) compile `dataset` → `AnalyticsQuery` and reuse the Cube runtime (then harden its RLS/tenant). Both are far cheaper than teaching `IDataEngine` to join.

### Finding 3 — naming collisions

The ADR's `DatasetSchema` / `DimensionSchema` / `MeasureSchema` are all taken: `DatasetSchema` = seed data (`data/dataset.zod.ts`, widely consumed); `DimensionSchema` + `MetricSchema` = the existing Cube layer (`data/analytics.zod.ts`). The new type must be renamed or namespaced (e.g. `AnalyticsDataset` / `Measure`). **The ADR's literal names cannot land as-is.**

### Other scan facts that size the work

- **Rendering is in the sibling repo `objectui`**, not here — Dashboard/Report renderers, `useReportData`, builders, the `data-objectstack` adapter. Any field change is a **two-repo change** + a `.objectui-sha` bump.
- **`ReportSchema` (pivot) has no runtime executor** — `plugin-reports` is a separate saved-query/CSV emailer; pivoting happens entirely client-side in `useReportData.ts`.
- **Registration touches 4 surfaces**, not 1: `kernel/metadata-type-schemas.ts`, `kernel/metadata-plugin.zod.ts` (enum + `DEFAULT_METADATA_TYPE_REGISTRY`, `loadOrder` < report/dashboard), `shared/metadata-collection.zod.ts` (`MAP_SUPPORTED_FIELDS` + `PLURAL_TO_SINGULAR`), `objectql/engine.ts` `metadataArrayKeys` (**two** lists, L806 + L961).
- **Migration scope:** 7 reports (2 files) + 64 widgets (4 files; heaviest `chart-gallery.dashboard.ts` = 38) + 2 chart-views (2 files) = **8 source files, two inline shapes**. Tests to rewrite: `view.test.ts` (214) + `dashboard.test.ts` (146) + `report.test.ts` (51) + `report-service.test.ts` + `view-expand.test.ts` + 3 example integration tests. No JSON/seed instance data. JSON-schema regenerates via `pnpm gen:schema`.

### Resolved decisions (gate everything) — decided 2026-05-31 on the AI-author / human-review criterion

| # | Decision | **Resolution** | Rationale (AI writes / human reviews) |
|---|---|---|---|
| **D-A** | Relationship to the existing Cube layer | **(c) — `dataset` is the one author-facing semantic type; it compiles to the existing Cube runtime; the author-facing Cube DSL is retired/absorbed.** Don't build a third layer; don't keep two author surfaces. | Converging to one shape is the ADR-0019/0020 principle. The dataset surface is *smaller* than both Cube-with-raw-SQL and `QuerySchema` — the minimal closed surface the model can't misuse. |
| **D-B** | Naming collisions | **Take the high-prior names `dataset` / `measure` / `dimension` for the analytics type.** Rename the seed `Dataset` → `Seed`/`SeedData` (more accurate, rarely AI-authored). The Cube `Dimension`/`Metric` are absorbed by D-A, so that collision dissolves. `measure` over `metric` (majority vocabulary). | Give the best-prior name to the surface the AI authors most. Seed data is the lower-AI-traffic collider, so it yields the name. |
| **D-C** | Join execution + safety | **Reuse the Cube `NativeSQLStrategy` join path, but make RLS + per-joined-object tenant scoping mandatory and automatic; and in v1 allow joins ONLY along declared relationships (no arbitrary predicates).** | The AI won't reliably add tenant/RLS filters and a reviewer won't reliably catch a missing one — so the engine must enforce it. Relationship-only joins bound both the safety surface and the AI surface. |

### Task list (workstreams; S≈½d, M≈1–3d, L≈1wk, XL≈2wk+) — updated for the resolved decisions

**WS0 · Design close-out — ✅ DONE**
- D-A / D-B / D-C resolved (above); this revision re-merges the ADR with the chosen direction (dataset → compiles to Cube; high-prior names + rename seed; relationship-only joins with engine-enforced RLS).

**WS1 · Spec / Schema (this repo) — L**
- `ui/dataset.zod.ts` per §D1 (names per D-B; `object` + `include` relationships + dimensions/measures + derived measures; **no `QuerySchema` exposure**). Rename seed `data/dataset.zod.ts` `Dataset` → `Seed`/`SeedData` and update its consumers (`stack.zod.ts`, `seed-loader-service.ts`, `metadata-collection.zod.ts`). Absorb the Cube `Dimension`/`Metric` types (D-A).
- Refactor `report.zod.ts` (→ `dataset`/`rows`/`columns`/`values`/`sections`), `dashboard.zod.ts` (widget → `dataset`/`report`/`dimensions`/`measures`/`viz`/`drillTo` + `superRefine`; globalFilters/dateRange → dimension names), `view.zod.ts` (drop `ListChartConfigSchema` + `type:'chart'`).
- Wire the 4 registration surfaces (above). Rewrite `report.form.ts`/`dashboard.form.ts` + add `dataset.form.ts`. Adjust `analytics-service`/`report-service`/`ui-service` contracts. Run `pnpm gen:schema`.

**WS2 · Runtime / engine (this repo) — L (was XL; halved by D-A=(c))**
- **Dataset → Cube compiler**: lower a `dataset` (object + include + dimensions/measures + derived) to an `AnalyticsQuery`/Cube definition; resolve `include` relationship names to join specs from the object graph.
- **Harden the Cube `NativeSQLStrategy` join path**: inject the sharing-middleware read filter + tenant scope **per joined object** (D-C — the current raw-SQL path bypasses both); reject any join not backed by a declared relationship.
- Derived-measure evaluation (Q1): compute ratio/sum/difference/product over already-aggregated named measures.
- Dataset executor (dataset + selected dims/measures + `runtimeFilter`/`compareTo` → Cube query → chart data); server-side `compareTo` time-shift; dataset metadata loading.

**WS3 · Frontend + designers (sibling repo `objectui`, cross-repo) — XL**
- Rework `DashboardRenderer.getComponentSchema()` and `useReportData.ts` to bind to dataset+measures; adapt `data-objectstack` `aggregate()`; convert `WidgetConfigPanel`/`DashboardEditor`/`ReportDesigner`/`ReportConfigPanel` from field pickers to dataset+measure pickers; new dataset editor + picker; bump `.objectui-sha`.

**WS4 · Migration codemod + tests (this repo) — L**
- Codemod (two inline shapes) over 8 files; hoist duplicate inline definitions into named datasets. Rewrite the listed tests + barrels/`setup.app.ts`.

**WS5 · Docs / skills (this repo) — M**
- ~9 mdx pages + `meta.json` nav; `skills/objectstack-ui/SKILL.md` (major) + `objectstack-query` (minor).

**Critical path:** WS1 ∥ WS2 → WS3 → WS4 (WS0 done). **Rough order of magnitude:** ~4–6 weeks for one senior engineer across both repos — D-A=(c) reusing the Cube runtime turned WS2 from XL to L.

## Resolved open questions (Q1–Q3)

Closed 2026-05-31 on the AI-author / human-review criterion — the throughline is *shrink the author surface; defer anything that adds a writable concept.*

1. **Calculated/derived measures — RESOLVED: first-class now, but closed.** AI authoring will demand ratios/derived metrics immediately; with no slot it would fake fields or mis-author formulas. So `MeasureSchema.derived` ships in v1 (see §D1), constrained to **reference other measures by name only** — no raw fields, no raw SQL — keeping it enumerable and reviewable. Runtime lands with WS2.
2. **Dataset parameters — RESOLVED: deferred; `runtimeFilter` only in v1.** Parameters (`:region` templating) are an imperative concept and another hallucination surface; `runtimeFilter` covers global-filter/report-scope declaratively. Fewer writable concepts wins. Revisit only if a real need can't be expressed as a filter.
3. **Cross-dataset dashboard filters — RESOLVED: deferred; conformed dimensions later.** A global filter spanning widgets on *different* datasets should not rely on fragile dimension-`name` string matching. The long-term answer is **conformed dimensions** that resolve to the same underlying `object.field`, with the filter binding to that semantic key. v1 supports single-dataset dashboards; conformed dimensions are a follow-up ADR.
