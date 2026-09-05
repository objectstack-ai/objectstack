// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isIncoherentAggregate } from '@objectstack/spec/data';
import { ChartTypeSchema } from '@objectstack/spec/ui';

import { walkFilterFieldKeys } from './filter-walk.js';
import {
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  joinablePrefixes,
  resolveFieldPath,
  suggestName,
  type ObjectGraph,
} from './object-graph.js';
import {
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';

/**
 * Build-time dashboard widget binding diagnostics (issues #1719, #1721).
 *
 * Runs at `objectstack validate`/`compile`/`build` AFTER the stack has been
 * schema-parsed, so every widget's `dataset` reference can be linked to its
 * `defineDataset` and each entry in `dimensions`/`values` resolved to a
 * declared dimension/measure. This is the semantic/cross-reference phase —
 * the rules here cannot run during plain Zod parsing of the raw widget
 * literal (the dataset may even live in another package of the stack).
 *
 * Reference-integrity rules (#1721) — severity `error`, the page is broken:
 *
 * - `widget-dataset-unknown` — `dataset` does not resolve to a declared
 *   `Dataset`.
 * - `widget-dimension-unknown` — a `dimensions[]` entry is not a dimension
 *   name on the bound dataset.
 * - `widget-measure-unknown` — a `values[]` entry is not a measure name on
 *   the bound dataset.
 * - `widget-legacy-analytics-unrenderable` (#1878/#1894) — a widget uses the
 *   removed pre-ADR-0021 inline-analytics shape (`categoryField`/`rowField`/…)
 *   as its ONLY data wiring: no `dataset`, no `object`, no inline `data`. The
 *   renderer reads only the dataset path, so the widget has no data at all and
 *   renders nothing. Errored (not warned) so this class of authoring mistake —
 *   very often an AI emitting a removed shape — fails the build instead of
 *   shipping a blank widget past human review.
 * - `dashboard-filter-field-unknown` (#3365) — a dashboard-level filter
 *   (`dateRange` or a `globalFilters[]` entry) is wired into EVERY widget's
 *   analytics query (#2501), but its EFFECTIVE field (after any `filterBindings`
 *   re-target) does not resolve on a bound widget's dataset object. The widget's
 *   query then references a non-existent column and crashes at render time
 *   (`no such column …`) — a build-decidable invariant that previously escaped
 *   the static gate and failed only when a user opened the dashboard. A widget
 *   opts out with `filterBindings: { <name>: false }` or re-targets to a real
 *   field. This is the same field-existence invariant ADR-0032 enforces for
 *   CEL formula / sharing-rule references, applied to dashboard filter fields.
 *   Resolution is {@link resolveFieldPath}'s (#14275), so a DOTTED effective
 *   field (`account.signed_at`) is walked hop by hop rather than skipped, and a
 *   bare name is judged against the object's OWN injected columns rather than
 *   the object-independent `SYSTEM_FIELDS` union — see "What #14275 closed"
 *   below for why each half was a hole rather than a nicety.
 * - `dashboard-filter-field-not-included` (#14275) — the effective field
 *   RESOLVES, but its relationship prefix is not declared in the bound
 *   dataset's `include`, so ADR-0021 compiles no join for it and the column is
 *   out of the broadcast query's reach. The `include` half of the same two
 *   clauses `widget-filter-field-not-included` applies to the widget's own
 *   `filter`, at the position one level up — a separate id because the fix is a
 *   different edit (declare the join, versus point the filter somewhere real)
 *   and because the family keeps one id per class.
 *
 * Advisory rules — severity `warning`, build stays green:
 *
 * - `chart-field-unknown` (#1721; tier ruled on #15463) — a `chartConfig`
 *   BINDING key names something the widget's selection does not carry:
 *   `xAxis.field` is not one of the widget's dimensions (or a dataset
 *   dimension), or a `yAxis[].field` / `series[].name` is not one of its
 *   selected measures (`values`). Post-cutover (ADR-0021) the result rows are
 *   keyed by measure NAME (e.g. `sum_amount`), not the base column (`amount`),
 *   so a stale base-column reference is the usual way to write one. The pinned
 *   renderer REFUSES all three keys as bindings — see "The three refused
 *   binding keys" below — so the authored key changes nothing that renders: it
 *   is a silent no-op, exactly `widget-legacy-analytics-shape`'s class. Kept as
 *   a finding because the author wrote a binding and believes it is in force.
 * - `chart-config-missing` — a `combo` widget has no `chartConfig`, so no
 *   series carries a mark and the combination chart draws as one uniform
 *   family. Narrowed to `combo` because `chartConfig` carries NO binding:
 *   `DatasetWidget` derives the axis and one series per measure from the
 *   widget's own `dimensions` / `values`, and actively REFUSES an authored
 *   `ChartAxis.field` / `ChartSeries.name`. See "What the renderer actually
 *   derives" below for the pinned contract this now mirrors.
 * - `chart-measures-missing` — a chart-family widget selects NO measures
 *   (`values` empty or absent). The pinned renderer short-circuits to an
 *   authoring placeholder — *"Pick measures (values) for this dataset
 *   widget."* — before any query runs, so no chart is drawn at all. Warning
 *   rather than error because an empty selection is a legitimate
 *   work-in-progress state a build must tolerate; erroring would gate the
 *   `sys_metadata` publish path on a half-authored widget.
 * - `chart-dimensions-missing` — a chart-family widget selects at least one
 *   measure but NO dimensions. The pinned renderer's
 *   `isMetric = METRIC_TYPES.has(widgetType) || dimensions.length === 0`
 *   routes it to the single-value branch, so it renders a KPI number and the
 *   family the author declared is silently ignored. Warning because the
 *   number is real and correct — it is the chart that is gone.
 * - `table-count-only` (#1719) — a `table`/`pivot` widget whose selected
 *   measures are ALL `aggregate: 'count'` and which declares no
 *   `dimensions` asks the analytics service for a single summary row. That
 *   is the shape a `metric` widget wants — for a table it almost always
 *   means the author wanted a per-record listing, which is not an
 *   analytics dataset at all (model it as an object-bound ListView,
 *   ADR-0017). Evaluated on the WIDGET's binding, not the dataset.
 * - `measure-aggregate-incoherent` — a dataset measure aggregates its field
 *   in a way that produces a meaningless number: today, SUM (or
 *   `count_distinct`) of a `percent`/rate field, whose total routinely
 *   exceeds 100%. Rates must AVG. Checked once per dataset (independent of
 *   any widget) when the bound object's field types are known.
 * - `widget-legacy-analytics-shape` (#1878/#1894) — a widget sets a
 *   pre-ADR-0021 inline key (`categoryField`/`valueField`/`xAxisField`/
 *   `yAxisFields`/`aggregate`/`aggregation`/`rowField`/`columnField`) that the
 *   single-form cutover removed. The dashboard renderer routes dataset-bound
 *   widgets through `DatasetWidget` and never reads these, so they are a
 *   silent no-op. Steers the author onto `dataset`+`dimensions`+`values`.
 * - `dashboard-filter-field-unprovisioned` (#8340) — the filter's effective
 *   field RESOLVES (it is a registry-injected system column, so
 *   `dashboard-filter-field-unknown` above rightly stays silent) but the bound
 *   object is ADR-0015 `external`, where the platform registers the anchor and
 *   provisions no storage for it. The filter is still ANDed into the query, so
 *   the widget renders empty instead of crashing — the silent-degradation half
 *   of the same invariant, warned rather than errored because this pass cannot
 *   see the remote schema (#8116's severity reasoning).
 *
 * ── The widget's OWN two references (#14148) ─────────────────────────────────
 *
 * - `widget-filter-field-unknown` — a KEY of the widget's own `filter` resolves
 *   to no column on the bound dataset's object graph.
 * - `widget-filter-field-not-included` — that key RESOLVES, but its relationship
 *   prefix is not declared in the dataset's `include`, so ADR-0021 compiles no
 *   join for it and the column is out of the query's reach.
 * - `widget-sortby-unselected` — `options.sortBy` names neither a `dimensions[]`
 *   nor a `values[]` entry of this widget, so the ordering the author wrote
 *   cannot be applied to a result that will not contain that column.
 *
 * All three are `error`, and the reason is the reporting card's, quoted because
 * it is the sharpest statement of it in the family: the dashboard it was
 * measured on leads with a "not moving" tile — open work untouched >14 days —
 * and *"an empty tile is indistinguishable from a healthy team: a missing
 * number reads as zero, and zero is the answer the manager is hoping for."*
 * The failure is not merely silent, it is silent in the direction the reader
 * WANTS to believe, which is why it gates rather than advises.
 *
 * ### Why these two were the surviving holes
 *
 * On the very same node, the TOKEN was checked and the COLUMN was not:
 * `filter-token-unknown` (#3574) fires path-precise at
 * `…widgets[4].filter.due_date.$lte`, so the traversal already walked the
 * filter tree and already knew the widget's dataset. And the identical
 * resolution already existed one key over — `dashboard-filter-field-unknown`
 * resolves a DASHBOARD-level filter's field against each widget's dataset base
 * object. `widgets[].filter` is the same field-existence invariant on the
 * filter an author is MORE likely to write by hand, and it was simply never fed
 * through it. `options.sortBy` is the declared-≠-enforced half:
 * `DashboardWidgetOptionsSchema.sortBy` states its own contract in prose —
 * *"must be one this widget actually selects"* — and nothing enforced it.
 *
 * ### The `include` clause, and why a dotted path is RESOLVED here
 *
 * A widget's `filter` is ANDed into the dataset query as `runtimeFilter`
 * (`DashboardWidgetSchema.filter`; `dataset-executor.ts` `combineFilters(
 * compiled.filter, selection.runtimeFilter)`), and that compiled query carries
 * ONLY the joins the dataset's `include` declared (`dataset-compiler.ts`: joins
 * are derived from `include`, and `assertDeclared` refuses an undeclared
 * relationship path). So a dotted key here is judged on the same two clauses
 * `validate-dataset-references.ts` applies one level down — existence, then
 * joinability — rather than skipped. The runtime is NOT a backstop for it
 * either — `assertDeclared` runs over `dimensions` and `measures` only, never
 * over `runtimeFilter` — so nothing between the author and the empty tile asks
 * this question.
 *
 * ### What #14275 closed, one position up
 *
 * `dashboard-filter-field-unknown` (a1) shipped with the two limitations the
 * paragraph above used to record as deliberate, and #14275 closed both by
 * migrating that branch onto this same seam:
 *
 *   1. it SKIPPED every dotted effective field (`if (field.includes('.'))
 *      continue;`), which was accurate when nothing in this package could walk
 *      hops and false once {@link resolveFieldPath} landed. The consequence was
 *      the sharper one: a dashboard filter is broadcast to EVERY widget on the
 *      board, so a single unjudged `filterBindings: { dateRange:
 *      'account.signed_at' }` degraded the whole dashboard rather than one tile
 *      — unjudged whether or not `account` existed, whether or not `signed_at`
 *      existed on it, and whether or not `account` was in the dataset's
 *      `include`;
 *   2. it resolved bare names against the object-independent `SYSTEM_FIELDS`
 *      union, which answers "could this be a system column ANYWHERE". The two
 *      differ exactly where it matters: on `ownership: 'none'` the platform
 *      injects no `owner_id`, so the union answered a real defect as
 *      resolvable. Both positions now take skip 3 per object, through
 *      {@link resolveFieldPath}'s use of `injectedColumnsFor`.
 *
 * The #8340 provenance question rides on the migrated branch unchanged, and is
 * now GATED by the verdict's `injected` marker rather than by union membership:
 * a leaf that resolved because it is injected is the only leaf whose anchor can
 * be unprovisioned (an author-DECLARED column of the same name is the author's,
 * #7859), and the marker states that fact where the flat union could not. It
 * also travels: the anchor is looked up on the object the LEAF landed on, so a
 * dotted filter path ending on an ADR-0015 `external` object is answered too.
 *
 * Resolution is {@link resolveFieldPath}'s and its `unknowable` verdicts are
 * never reported (ADR-0072 D1), so the three skips every field-existence rule
 * in this package takes apply unchanged: an object this stack does not define,
 * an object with no readable field map (ADR-0015 `external`), and a
 * registry-injected system column — the last resolved PER OBJECT rather than
 * through the flat `SYSTEM_FIELDS` union, which is what lets a reference to
 * `owner_id` on an `ownership: 'none'` object stay a real finding.
 *
 * ### What the renderer actually derives (#14436)
 *
 * `chart-config-missing` used to fire on EVERY chart family that was not a
 * single-value or tabular type, on the stated grounds that without
 * `chartConfig` "the renderer cannot determine which measure to plot, so the
 * series renders empty". That consequence was false, and it fired on this
 * platform's OWN shipped metadata: the `system_overview` dashboard draws a pie
 * and a bar, each with one dimension and one measure and no `chartConfig`, and
 * both render correctly. A warning-tier rule that mis-fires on first-party
 * metadata is the ADR-0072 D1 cost the whole family exists to avoid — it
 * teaches every reader, human and agent, that this family is noise.
 *
 * The renderer's contract, read at the `@object-ui` revision this repo PINS
 * (`.objectui-sha`), not at objectui's `origin/main` — the Console ships the
 * pin, so the exemption is written against the behaviour the pin has:
 *
 *  - `DatasetWidget` calls `buildChartSeries(rows, dimensions, values, …)`,
 *    which returns `{ data, xAxisKey, series }` — the x-axis key is
 *    `dimensions[0]` and there is exactly one series per entry of `values`.
 *    `chartConfig` is not an argument to it.
 *  - The authored `chartConfig` reaches the chart only through
 *    `mergeAuthoredPresentation` (per-series/axis PRESENTATION merged ONTO
 *    those derived bindings) and `chartConfigPresentation` (chrome: titles,
 *    height, colours, data labels, annotations, legend).
 *  - The BINDING half of an authored `chartConfig` is refused outright. The
 *    renderer pins this by name in
 *    `packages/plugin-dashboard/src/__tests__/DatasetWidget.chartConfig.test.tsx`:
 *    *"ignores an authored axis `field` and keeps the derived axis binding"*,
 *    *"ignores an authored series and keeps one derived series per measure"*,
 *    *"ignores `chartConfig.type` — the widget type owns the chart family"*,
 *    and *"emits none of the presentation keys when no chartConfig is
 *    declared"*.
 *
 * So for every chart family except one, a missing `chartConfig` costs the
 * widget nothing at all, and ADDING one could not have repaired a widget whose
 * selection is empty either — `chart-field-unknown` above reports a
 * `yAxis[].field` that names anything the widget did not select, so
 * `chartConfig` can never supply a measure the `values` array is missing.
 *
 * **The one surviving arm is `combo`**, and it is a real loss rather than an
 * inferred one. A combination chart's whole identity is a per-series MARK, and
 * that mark is authored as `chartConfig.series[].type` — presentation, so it
 * does merge forward. `mergeAuthoredSeries` states the default it falls back
 * to: *"a derived series with no authored entry keeps the family default"*,
 * and `DatasetWidget.comboPresentation.test.tsx` records what that cost when
 * the merge was missing — *"Without it the line measure drew as the second
 * bar."* A `combo` with no `chartConfig` therefore draws every measure with
 * one mark: the author asked for a combination and got a plain one. Warning
 * rather than error, because the numbers are right and the chart renders — it
 * is the shape that is wrong.
 *
 * ⚠️ Two genuinely un-renderable shapes are NOT this id's, because neither is
 * caused by nor repairable with `chartConfig` and folding them in would leave
 * this id misnaming its own condition: a chart-family widget selecting NO
 * measures, and one selecting NO dimensions. They have their own ids —
 * `chart-measures-missing` and `chart-dimensions-missing` — described next.
 *
 * ### The two empty-selection shapes (#15462)
 *
 * Read at the same PINNED `@object-ui` revision (`.objectui-sha`), in
 * `packages/plugin-dashboard/src/DatasetWidget.tsx`:
 *
 *  - `:683` — `if (values.length === 0)` returns the authoring placeholder
 *    `tt('dashboard.pickMeasures', 'Pick measures (values) for this dataset
 *    widget.')`. It stands ABOVE every family branch, so a widget selecting no
 *    measure never reaches a chart, a table or a KPI number: nothing is drawn.
 *  - `:423` — `const isMetric = METRIC_TYPES.has(widgetType) ||
 *    dimensions.length === 0;`, with `METRIC_TYPES` (`:343`) = `metric`, `kpi`,
 *    `gauge`, `solid-gauge`, `bullet`; `:424` is the tabular test
 *    (`table`/`pivot`); and the render branches (`:702`, `:798`, `:854`) route
 *    `isMetric ? KPI : isTable ? table : chart`. A dimensionless `bar` is
 *    therefore drawn as a single KPI number — the failure direction the family's
 *    own docblock names, except worse: the number is REAL, so the missing chart
 *    reads as a design choice rather than as a defect.
 *
 * So "chart family" here is not a hand list — it is what that routing leaves
 * over: a declared `ChartTypeSchema` option that is neither a `METRIC_TYPES`
 * member nor tabular ({@link CHART_FAMILY_WIDGET_TYPES}). The taxonomy supplies
 * the universe and the renderer decides the exceptions, which is the same
 * division #14436 settled for `MARK_MIXING_CHART_TYPES`: this file's copies of
 * the renderer's two sets are held to `ChartTypeSchema` by the rule's tests, so
 * a member that stops being a declared chart type reds instead of going quiet.
 *
 * The two ids never both fire on one widget, and the reason is the pin's own
 * order: with no measures the placeholder returns at `:683` and the `isMetric`
 * branch is never reached, so `chart-dimensions-missing`'s consequence (a KPI
 * number in place of the chart) is not what that widget does. A widget missing
 * both reports `chart-measures-missing` alone, whose hint names the missing
 * dimension too.
 *
 * Both are warnings, per the tier decision on #15462: an empty selection is a
 * state an author passes THROUGH, and the family's errors are reserved for
 * bindings the analytics service cannot satisfy.
 *
 * ### The three refused binding keys (#15463)
 *
 * `chart-field-unknown` shipped at `error` with a message that named a QUERY
 * failure — *"the query result will not contain it"*. Read at the same PINNED
 * `@object-ui` revision (`.objectui-sha`), that consequence never happens,
 * because the renderer never reads these keys as bindings at all. The rule id
 * covers exactly three positions, and all three are refused:
 *
 *  - `chartConfig.xAxis.field` — `axisPresentation`
 *    (`@object-ui/core` `src/utils/chart-presentation.ts`) builds the axis's
 *    presentation MINUS its `field`, and that dropping is structural, not a
 *    guard: the x-axis key is `buildChartSeries`' `xAxisKey`, i.e. the widget's
 *    `dimensions[0]`. An authored `field` re-points nothing.
 *  - `chartConfig.yAxis[].field` — the same `axisPresentation` call, per entry.
 *    The entry keeps its SLOT (the count is what turns on a secondary axis) and
 *    its scale/chrome; only the binding is dropped.
 *  - `chartConfig.series[].name` — `mergeAuthoredSeries` pairs an authored
 *    entry with the derived binding whose `dataKey` it EQUALS, one series per
 *    entry of `values`. A name matching no derived series is *"**ignored** —
 *    membership belongs to the dataset, so an author cannot add, remove or
 *    re-point a series from the chart config"*. So the presentation the author
 *    hung on that entry — the mark, the colour, the stack, the axis side —
 *    lands on nothing.
 *
 * The renderer pins all three by name in
 * `packages/plugin-dashboard/src/__tests__/DatasetWidget.chartConfig.test.tsx`
 * (*"ignores an authored axis `field` and keeps the derived axis binding"*,
 * *"ignores an authored series and keeps one derived series per measure"*).
 *
 * So the failure is not a broken page, it is an ignored key — which is the
 * class `widget-legacy-analytics-shape` above reports at WARNING tier in this
 * same file (*"the dashboard renderer ignores them … a silent no-op"*). All
 * three positions therefore drop from `error` to `warning`, suppressible per
 * widget, and each message states what actually happens instead of a query that
 * never runs. The finding is KEPT rather than deleted: unlike #14436's
 * over-reach the metadata really is wrong — the author wrote a binding and
 * believes it is in force.
 *
 * The tier drop is a behaviour change on the `sys_metadata` publish door: the
 * 2026-08-15 ruling put all SIX of this rule's error ids on that door as one
 * "this board cannot render" class, and this id leaves that set, so a publish
 * carrying only a refused `chartConfig` binding key now SUCCEEDS with the
 * finding on the advisory channel. The remaining five are unchanged; the
 * accept-set is re-pinned in `runtime-gate.test.ts`.
 *
 * Warnings can be deliberately suppressed per widget via
 * `suppressWarnings: ['<rule-id>']`; errors cannot — they describe a
 * binding the analytics service cannot satisfy.
 */

export const WIDGET_DATASET_UNKNOWN = 'widget-dataset-unknown';
export const WIDGET_DIMENSION_UNKNOWN = 'widget-dimension-unknown';
export const WIDGET_MEASURE_UNKNOWN = 'widget-measure-unknown';
export const CHART_FIELD_UNKNOWN = 'chart-field-unknown';
export const CHART_CONFIG_MISSING = 'chart-config-missing';
/**
 * [#15462] A chart-family widget selects no measures, so the pinned renderer
 * draws the "Pick measures (values)" placeholder instead of a chart.
 */
export const CHART_MEASURES_MISSING = 'chart-measures-missing';
/**
 * [#15462] A chart-family widget selects no dimensions, so the pinned
 * renderer's `isMetric` branch draws a KPI number instead of the declared
 * chart family.
 */
export const CHART_DIMENSIONS_MISSING = 'chart-dimensions-missing';
export const TABLE_COUNT_ONLY = 'table-count-only';
export const MEASURE_AGGREGATE_INCOHERENT = 'measure-aggregate-incoherent';
export const WIDGET_LEGACY_ANALYTICS_SHAPE = 'widget-legacy-analytics-shape';
export const WIDGET_LEGACY_ANALYTICS_UNRENDERABLE = 'widget-legacy-analytics-unrenderable';
export const DASHBOARD_FILTER_FIELD_UNKNOWN = 'dashboard-filter-field-unknown';
export const DASHBOARD_FILTER_FIELD_UNPROVISIONED = 'dashboard-filter-field-unprovisioned';
/**
 * [#14275] A dashboard filter's effective field resolves, but its relationship
 * prefix is not declared in the bound dataset's `include`.
 */
export const DASHBOARD_FILTER_FIELD_NOT_INCLUDED = 'dashboard-filter-field-not-included';
/** [#14148] A key of the widget's OWN `filter` that resolves to no column. */
export const WIDGET_FILTER_FIELD_UNKNOWN = 'widget-filter-field-unknown';
/** [#14148] A widget filter key whose relationship prefix is not in `include`. */
export const WIDGET_FILTER_FIELD_NOT_INCLUDED = 'widget-filter-field-not-included';
/** [#14148] `options.sortBy` names nothing this widget selects. */
export const WIDGET_SORTBY_UNSELECTED = 'widget-sortby-unselected';

/**
 * Pre-ADR-0021 inline-analytics keys. The single-form cutover replaced them
 * with the semantic-layer shape (`dataset` + `dimensions` + `values`); the
 * dashboard renderer routes dataset-bound widgets through `DatasetWidget` and
 * never reads these, so authoring one today is a silent no-op. Warned (not
 * errored) because they still parse and a legacy object-bound widget keeps
 * rendering — the author is just being steered to the governed shape.
 * (liveness audit #1878 / #1894).
 *
 * Interplay with `DashboardWidgetSchema.strict()` (framework#3251, protocol 16):
 * on the schema-parsed CLI paths (`compile`, `validate`) strict rejects these
 * keys as a hard parse error *before* binding validation runs, so these rules
 * are effectively preempted there. They remain the friendly, suppressible
 * bridge on the raw-config paths (`lint`, `doctor`) that hand
 * `validateWidgetBindings` un-parsed config — keeping the actionable
 * "steer to the dataset shape" message rather than a bare unknown-key error.
 */
const LEGACY_ANALYTICS_KEYS = [
  'categoryField', 'valueField', 'xAxisField', 'yAxisFields',
  'aggregate', 'aggregation', 'rowField', 'columnField',
] as const;

export type WidgetBindingSeverity = 'error' | 'warning';

export interface WidgetBindingFinding {
  /** `error` = unresolvable binding (broken page); `warning` = advisory. */
  severity: WidgetBindingSeverity;
  /** Diagnostic rule id (registry entry), e.g. `widget-measure-unknown`. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "x" › widget "y"`. */
  where: string;
  /** Config path, e.g. `dashboards[0].widgets[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix (or deliberately suppress) it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * Chart families whose rendered SHAPE depends on `chartConfig` — today exactly
 * one, `combo`, whose per-series mark is authored as `chartConfig.series[].type`
 * and has no other channel.
 *
 * ⛔ This is NOT "the families that need a measure mapping". No family needs one:
 * `DatasetWidget` derives the axis key and one series per measure from the
 * widget's `dimensions` / `values`, and refuses an authored `ChartAxis.field` /
 * `ChartSeries.name` outright — the rule docblock's "What the renderer actually
 * derives" carries the pinned test names that establish it (#14436). The
 * previous spelling of this set was the taxonomy minus a hand-written exemption
 * list, which reported every bar, line and pie that never wrote a `chartConfig`
 * — including this platform's own `system_overview` tiles.
 *
 * Membership is checked against `ChartTypeSchema` in this rule's tests rather
 * than derived from it: a family belongs here because of what its RENDERER does
 * with `chartConfig`, which a taxonomy cannot know. objectui#2945's lesson —
 * that a hand-written list cannot notice the taxonomy growing — survives as
 * that check: a member that stops being a declared chart type reds.
 */
export const MARK_MIXING_CHART_TYPES = new Set<string>(['combo']);

/**
 * [#15462] Widget types the PINNED renderer draws as a single value rather than
 * as a chart. MUST track objectui `DatasetWidget.tsx`'s own `METRIC_TYPES`
 * (`:343` at `.objectui-sha`), the left half of
 * `isMetric = METRIC_TYPES.has(widgetType) || dimensions.length === 0` (`:423`)
 * — the same "mirror the runtime this check shadows" relationship
 * `DATE_RANGE_DEFAULT_FIELD` carries one position up in this file.
 */
export const METRIC_WIDGET_TYPES = new Set<string>([
  'metric', 'kpi', 'gauge', 'solid-gauge', 'bullet',
]);

/**
 * [#15462] Widget types the pinned renderer draws as a table — `isTable`
 * (`DatasetWidget.tsx:424`), which reads `widgetType === 'table' || widgetType
 * === 'pivot'`. Their dimensionless shape is `table-count-only`'s subject, not
 * a chart-family one.
 */
export const TABULAR_WIDGET_TYPES = new Set<string>(['table', 'pivot']);

/**
 * [#15462] The chart family, derived rather than hand-listed: every declared
 * `ChartTypeSchema` option the pinned renderer routes to its CHART branch —
 * i.e. the taxonomy minus the two sets above, which are the renderer's own
 * (`isMetric ? KPI : isTable ? table : chart`, `DatasetWidget.tsx:702`).
 *
 * The direction matters. #14436 retired a `CHART_TYPES` that was "the taxonomy
 * minus a hand-written exemption list" because its PREDICATE was wrong (no
 * family carries its binding in `chartConfig`), not because deriving a
 * population from the taxonomy is. Here the exemptions are not invented: each
 * one is a set the renderer itself branches on, and a chart type that appears
 * in neither is one the renderer really does draw as a chart — including a
 * family added to the taxonomy after this line was written, which is the case a
 * hand list gets wrong (objectui#2945). Membership of both exception sets is
 * held to `ChartTypeSchema` by this rule's tests.
 */
export const CHART_FAMILY_WIDGET_TYPES: ReadonlySet<string> = new Set(
  (ChartTypeSchema.options as readonly string[]).filter(
    (t) => !METRIC_WIDGET_TYPES.has(t) && !TABULAR_WIDGET_TYPES.has(t),
  ),
);

/** [#15462] Does the pinned renderer draw this widget `type` as a chart? */
export function isChartFamilyWidgetType(type: unknown): boolean {
  return typeof type === 'string' && CHART_FAMILY_WIDGET_TYPES.has(type);
}

function list(names: Iterable<string>): string {
  const arr = [...names];
  return arr.length > 0 ? arr.join(', ') : '(none)';
}

// ── dashboard-filter field-existence (#3365) ─────────────────────────────────

/** Reserved filter name for the dashboard's built-in date range (#2501). */
const DATE_RANGE_FILTER_NAME = 'dateRange';
/**
 * Default field of the built-in date range when `dateRange.field` is omitted.
 * MUST track objectui `dashboard-filters.ts` `DATE_RANGE_DEFAULT_FIELD` — the
 * runtime this check shadows. `created_at` is a registry-injected system field,
 * resolved PER OBJECT through `injectedColumnsFor` (#14275), so a bare
 * `dateRange` never false-positives on an object that gets the audit family —
 * and IS reported on one that opts out of it (`systemFields: { audit: false }`),
 * where the broadcast filter really does address a column that is not there.
 */
const DATE_RANGE_DEFAULT_FIELD = 'created_at';

interface DashFilterDef {
  /** Stable filter name — the key widgets bind against in `filterBindings`. */
  name: string;
  /** Default target field when a widget declares no explicit binding. */
  field: string;
  /** Legacy widget-id allow-list; gates the DEFAULT binding only. */
  targetWidgets?: string[];
}

/**
 * Normalize a dashboard's declared filters into `{ name, field, targetWidgets }`
 * defs — the built-in `dateRange` (reserved name) first, then every
 * `globalFilters[]` entry named by its `name` (defaulting to `field`). Later
 * duplicates win. Mirrors objectui `resolveDashboardFilterDefs`.
 */
function dashboardFilterDefs(dash: AnyRec): DashFilterDef[] {
  const byName = new Map<string, DashFilterDef>();

  const dateRange = dash.dateRange;
  if (dateRange && typeof dateRange === 'object') {
    const declared = (dateRange as AnyRec).field;
    const field = typeof declared === 'string' && declared ? declared : DATE_RANGE_DEFAULT_FIELD;
    byName.set(DATE_RANGE_FILTER_NAME, { name: DATE_RANGE_FILTER_NAME, field });
  }

  for (const f of asArray(dash.globalFilters)) {
    if (typeof f.field !== 'string' || !f.field) continue;
    const name = typeof f.name === 'string' && f.name ? f.name : f.field;
    const targetWidgets = Array.isArray(f.targetWidgets)
      ? f.targetWidgets.filter((w): w is string => typeof w === 'string')
      : undefined;
    byName.set(name, { name, field: f.field, targetWidgets });
  }

  return [...byName.values()];
}

/**
 * Resolve which field of `widget` a filter binds to, or `undefined` when the
 * widget is not bound (opted out / not targeted). Precedence mirrors objectui
 * `resolveBoundField`: explicit `filterBindings` entry (string re-targets,
 * `false` opts out — both win) → legacy `targetWidgets` allow-list → the
 * filter's own default `field`. `explicit` distinguishes an author-chosen field
 * (a typo they must fix) from the inherited default (which they may opt out of).
 */
function effectiveFilterField(
  widget: AnyRec,
  def: DashFilterDef,
): { field: string; explicit: boolean } | undefined {
  const bindings = widget.filterBindings;
  const binding = bindings && typeof bindings === 'object'
    ? (bindings as AnyRec)[def.name]
    : undefined;
  if (binding === false) return undefined;
  if (typeof binding === 'string' && binding) return { field: binding, explicit: true };
  if (def.targetWidgets && def.targetWidgets.length > 0) {
    const id = typeof widget.id === 'string' ? widget.id : undefined;
    if (!id || !def.targetWidgets.includes(id)) return undefined;
  }
  return { field: def.field, explicit: false };
}

/**
 * Validate every dashboard widget's dataset binding. Returns the list of
 * findings (empty = clean). Caller decides how to surface them: `error`
 * findings describe bindings the analytics service cannot satisfy and
 * should fail validate/build; `warning` findings are advisory and must
 * never fail the build on their own.
 */
export function validateWidgetBindings(stack: AnyRec): WidgetBindingFinding[] {
  const findings: WidgetBindingFinding[] = [];

  const datasets = new Map<string, AnyRec>();
  for (const ds of asArray(stack.datasets)) {
    if (typeof ds.name === 'string') datasets.set(ds.name, ds);
  }

  // ── (0) dataset measures aggregate their field coherently ──
  // A measure that SUMs a percentage/rate field produces a meaningless total
  // (it can exceed 100%); rates must AVG. This is a dataset-level defect (it
  // does not depend on any widget), so it is checked once over every dataset
  // whose object's field types are known. Advisory — the page still renders.
  const objectFieldTypes = new Map<string, Map<string, string>>();
  for (const o of asArray(stack.objects)) {
    if (typeof o.name !== 'string') continue;
    const fm = new Map<string, string>();
    for (const f of asArray(o.fields)) {
      if (typeof f.name === 'string' && typeof f.type === 'string') fm.set(f.name, f.type);
    }
    objectFieldTypes.set(o.name, fm);
  }
  // [#8340] object name → the injected anchors it registers with NO storage
  // behind them. Built once for the whole stack; empty for every object that is
  // not ADR-0015 `external`, so the filter check below pays one map lookup.
  const unprovisionedAnchors = indexUnprovisionedAnchors(stack);
  // [#14148] The resolution universe for a widget's OWN filter keys. Indexed
  // once for the whole stack and shared by every widget, exactly as
  // `validate-dataset-references.ts` does one level down — the same seam, so
  // the two positions cannot drift into two accounts of one object graph.
  const graph: ObjectGraph = indexObjectGraph(stack);
  const datasetList = asArray(stack.datasets);
  for (let i = 0; i < datasetList.length; i++) {
    const ds = datasetList[i];
    const fieldTypes = typeof ds.object === 'string' ? objectFieldTypes.get(ds.object) : undefined;
    if (!fieldTypes) continue; // cannot judge without the object's field types
    const dsMeasures = asArray(ds.measures);
    for (let k = 0; k < dsMeasures.length; k++) {
      const m = dsMeasures[k];
      const field = typeof m.field === 'string' ? m.field : undefined;
      const aggregate = typeof m.aggregate === 'string' ? m.aggregate : undefined;
      if (!field || !aggregate) continue; // count(*) and underivable measures are fine
      const ftype = fieldTypes.get(field);
      if (ftype && isIncoherentAggregate(aggregate, ftype)) {
        findings.push({
          severity: 'warning',
          rule: MEASURE_AGGREGATE_INCOHERENT,
          where: `dataset "${typeof ds.name === 'string' ? ds.name : `(dataset ${i})`}" › measure "${typeof m.name === 'string' ? m.name : `(measure ${k})`}"`,
          path: `datasets[${i}].measures[${k}]`,
          message:
            `measure "${m.name}" applies ${aggregate} to ${ftype} field "${field}" — ` +
            `summed percentages are meaningless (they can exceed 100%).`,
          hint:
            `Use aggregate "avg" for percentage/rate fields (or "count" of records). ` +
            `If a running total is genuinely intended, suppress with: ` +
            `suppressWarnings: ['${MEASURE_AGGREGATE_INCOHERENT}'] on the measure.`,
        });
      }
    }
  }

  const dashboards = asArray(stack.dashboards);
  for (let i = 0; i < dashboards.length; i++) {
    const dash = dashboards[i];
    const dashName = typeof dash.name === 'string' ? dash.name : `(dashboard ${i})`;
    const widgets = Array.isArray(dash.widgets) ? (dash.widgets as AnyRec[]) : [];
    // Dashboard-level filters (`dateRange` + `globalFilters`) are broadcast into
    // every widget's query (#2501) — resolved once here, checked per widget below.
    const dashFilterDefs = dashboardFilterDefs(dash);

    for (let j = 0; j < widgets.length; j++) {
      const w = widgets[j];
      const widgetId = typeof w.id === 'string' ? w.id : `(widget ${j})`;
      const where = `dashboard "${dashName}" › widget "${widgetId}"`;
      const path = `dashboards[${i}].widgets[${j}]`;
      const suppressed = (rule: string): boolean =>
        Array.isArray(w.suppressWarnings) && w.suppressWarnings.includes(rule);
      // [#14148] `path` defaults to the WIDGET, and a caller may override it
      // with a position inside the widget. The two #14148 limbs do: a filter
      // key is reported at `…widgets[j].filter.<key>` and `sortBy` at
      // `…widgets[j].options.sortBy`, matching the precision `filter-token-unknown`
      // already offers in this exact subtree (`…widgets[4].filter.due_date.$lte`).
      // Reporting a five-key filter's one bad key at the widget is a location the
      // author still has to search.
      const push = (f: Omit<WidgetBindingFinding, 'where' | 'path'> & { path?: string }): void => {
        if (f.severity === 'warning' && suppressed(f.rule)) return;
        findings.push({ ...f, where, path: f.path ?? path });
      };

      // ── (a0) legacy pre-ADR-0021 analytics shape ──
      // Steer authors (very often an AI) off the removed inline shape and onto
      // the semantic-layer `dataset`+`dimensions`+`values`. The renderer reads
      // ONLY the dataset path, so these keys are dead. Two severities:
      //   • ERROR   — the legacy keys are the widget's only (dead) data wiring
      //               (no dataset / object / inline data): it renders nothing.
      //   • warning — a data source is present, so the widget still renders and
      //               the legacy keys are merely ignored noise (suppressible).
      const legacyUsed = LEGACY_ANALYTICS_KEYS.filter((k) => w[k] !== undefined);
      if (legacyUsed.length > 0) {
        const optionsData =
          typeof w.options === 'object' && w.options !== null &&
          (w.options as AnyRec).data !== undefined;
        const hasDataSource =
          w.dataset !== undefined || w.object !== undefined ||
          w.data !== undefined || optionsData;
        const keyList = legacyUsed.map((k) => `\`${k}\``).join(', ');
        const plural = legacyUsed.length > 1;
        const datasetHint =
          `Bind a semantic dataset and select fields BY NAME: ` +
          `\`dataset: '<name>', dimensions: [...], values: [...]\`. ` +
          `Dataset-bound widgets render through DatasetWidget (pivot rows/cols come from ` +
          `\`dimensions\`, cell values from \`values\`).`;
        if (!hasDataSource) {
          push({
            severity: 'error',
            rule: WIDGET_LEGACY_ANALYTICS_UNRENDERABLE,
            message:
              `sets legacy analytics key${plural ? 's' : ''} ${keyList} ` +
              `(removed by the ADR-0021 single-form cutover) and binds no data source ` +
              `(no \`dataset\`, \`object\`, or inline \`data\`) — it renders nothing.`,
            hint:
              `${datasetHint} The renderer ignores the legacy keys, so without a data ` +
              `source this widget has no data at all.`,
          });
        } else {
          push({
            severity: 'warning',
            rule: WIDGET_LEGACY_ANALYTICS_SHAPE,
            message:
              `sets legacy analytics key${plural ? 's' : ''} ${keyList} that the ADR-0021 ` +
              `single-form cutover removed — the dashboard renderer ignores ${plural ? 'them' : 'it'}.`,
            hint:
              `${datasetHint} These inline keys are a no-op. ` +
              `Suppress with suppressWarnings: ['${WIDGET_LEGACY_ANALYTICS_SHAPE}'] if intentional.`,
          });
        }
      }

      // ── (a) dataset reference resolves ──
      const dsName = typeof w.dataset === 'string' ? w.dataset : undefined;
      const dataset = dsName ? datasets.get(dsName) : undefined;
      if (dsName && !dataset) {
        push({
          severity: 'error',
          rule: WIDGET_DATASET_UNKNOWN,
          message: `dataset "${dsName}" does not resolve to a declared dataset.`,
          hint:
            `Declared datasets: ${list(datasets.keys())}.${suggestName(dsName, datasets.keys())} ` +
            `Define the dataset with defineDataset() or fix the reference (ADR-0021).`,
        });
      }
      // A widget with NO `dataset` key at all. `DashboardWidgetSchema.dataset`
      // is REQUIRED, so the schema-parsed paths (`compile`, `validate`) reject
      // this before we run — but `lint`/`doctor` hand us raw, un-parsed config,
      // where it previously fell into the `continue` below and silently
      // bypassed EVERY binding and chart check (issue #3583). Report it rather
      // than skip: an unbound widget resolves no data and renders empty.
      if (!dsName) {
        push({
          severity: 'error',
          rule: WIDGET_DATASET_UNKNOWN,
          message:
            `binds no \`dataset\` — the ADR-0021 widget shape requires one, so this ` +
            `widget resolves no data and renders empty.`,
          hint:
            `Set \`dataset: '<name>'\` (plus \`values\`, and \`dimensions\` where the chart ` +
            `family needs them). Declared datasets: ${list(datasets.keys())}.`,
        });
        continue;
      }
      // A named-but-unresolvable dataset was already reported above; either way
      // there is nothing left to check names against.
      if (!dataset) continue;

      // ── (a1) dashboard filter fields exist on the widget's object (#3365) ──
      // Each dashboard-level filter is ANDed into this widget's analytics query
      // (#2501); a filter whose EFFECTIVE field (after `filterBindings`) is not a
      // column on the bound dataset object emits SQL like `WHERE close_date …`
      // against a table without that column and the widget crashes at query time.
      // Errored (not warned): a broken query, not advice. The opt-out is the
      // author's own `filterBindings: { <name>: false }`, so no suppression needed.
      if (dashFilterDefs.length > 0) {
        const datasetObject = typeof dataset.object === 'string' ? dataset.object : undefined;
        // [#14275] Skips 1 and 2, taken once for the whole widget — exactly as
        // the (a2) limb below does, off the SAME index. An object this stack
        // does not define, or one with no readable field map, is unknowable
        // here; resolving against it would turn one unjudgeable base binding
        // into a finding per dashboard filter.
        const base = datasetObject ? graph.get(datasetObject) : undefined;
        if (datasetObject && base) {
          // ADR-0021 joins ONLY what `include` declares, and the dashboard
          // filter lands in the same `runtimeFilter` slot the widget's own
          // filter does — so the second clause is the same clause.
          const included = joinablePrefixes(dataset.include);
          for (const def of dashFilterDefs) {
            const eff = effectiveFilterField(w, def);
            if (!eff) continue; // opted out / not targeted → filter never applies
            const field = eff.field;
            // [#14275] The effective field is resolved on the object graph — a
            // dotted `account.signed_at` hop by hop, a bare name against THIS
            // object's authored + injected columns. Unjudgeable verdicts are
            // never reported (ADR-0072 D1).
            const verdict = resolveFieldPath(graph, datasetObject, field);
            if (isUnjudgeable(verdict) || !verdict) continue;

            // How this widget came to carry the filter — the half an author
            // acts on, and the reason the two message shapes differ: an
            // explicit `filterBindings` target is a typo they must fix, an
            // inherited default is one they may opt out of.
            const provenance = eff.explicit
              ? `binds dashboard filter \`${def.name}\` to field \`${field}\` (via filterBindings), but `
              : `inherits dashboard filter \`${def.name}(${field})\`, but `;

            if (verdict.kind !== 'ok') {
              // A DOTTED miss is reported through the shared account, which
              // names WHICH hop failed — a bare "has no field `a.b`" would send
              // the author looking for a column nobody wrote. A bare name keeps
              // #3365's shipped wording verbatim: it is the whole existing
              // population, and this PR narrows the accept set rather than
              // re-wording what already fires.
              const account = field.includes('.')
                ? describeFieldPathVerdict(verdict, field, 'the effective field')
                : undefined;
              if (account) {
                push({
                  severity: 'error',
                  rule: DASHBOARD_FILTER_FIELD_UNKNOWN,
                  // #2501 is the fan-out this sentence describes; the id stays
                  // in the comment, never in the string an author reads.
                  message:
                    `${provenance}${account.message} The filter is ANDed into EVERY bound ` +
                    `widget's analytics query, so the query addresses a column that ` +
                    `does not exist.`,
                  hint:
                    `Point filterBindings: { ${def.name}: '<field>' } at a field that resolves on ` +
                    `\`${datasetObject}\` — or at a \`relationship[.relationship].field\` path whose ` +
                    `prefix is declared in dataset "${dsName}"'s \`include\` — or opt out with ` +
                    `filterBindings: { ${def.name}: false }. ${account.detail}`,
                });
                continue;
              }
              push({
                severity: 'error',
                rule: DASHBOARD_FILTER_FIELD_UNKNOWN,
                message: eff.explicit
                  ? `binds dashboard filter \`${def.name}\` to field \`${field}\` ` +
                    `(via filterBindings), but object \`${datasetObject}\` (dataset "${dsName}") ` +
                    `has no field \`${field}\`.`
                  : `inherits dashboard filter \`${def.name}(${field})\`, but object ` +
                    `\`${datasetObject}\` (dataset "${dsName}") has no field \`${field}\`.`,
                hint: eff.explicit
                  ? `Point filterBindings: { ${def.name}: '<field>' } at a field that exists on ` +
                    `\`${datasetObject}\`, or opt out with filterBindings: { ${def.name}: false }.` +
                    `${suggestName(field, base.names)} Object fields: ${list(base.names)}.`
                  : `Set filterBindings: { ${def.name}: false } on this widget to opt out, or ` +
                    `re-target to an existing field with filterBindings: { ${def.name}: '<field>' }.` +
                    `${suggestName(field, base.names)} Object fields: ${list(base.names)}.`,
              });
              continue;
            }

            // [#14275] The field RESOLVES. Second clause: a dotted path is only
            // in this query's reach if its relationship prefix is declared —
            // `assertDeclared` never sees a `runtimeFilter`, so there is no
            // runtime door in front of this one either.
            const cut = field.lastIndexOf('.');
            if (cut >= 0) {
              const prefix = field.slice(0, cut);
              if (!included.has(prefix)) {
                push({
                  severity: 'error',
                  rule: DASHBOARD_FILTER_FIELD_NOT_INCLUDED,
                  // Same #2501 fan-out as above — id in the comment, not the
                  // message: `#NNNN` resolves for nobody downstream of here.
                  message:
                    `${provenance}its relationship prefix "${prefix}" is not declared in dataset ` +
                    `"${dsName}"'s \`include\` — and ADR-0021 joins ONLY declared paths, so no join ` +
                    `is compiled and the column is out of this query's reach. The filter is ANDed ` +
                    `into EVERY bound widget's analytics query, so the whole board renders ` +
                    `empty, not one tile.`,
                  hint:
                    `Add "${prefix}" to dataset "${dsName}"'s include (declaring "a.b" implicitly ` +
                    `includes "a"), filter on a field of "${datasetObject}" itself, or opt out with ` +
                    `filterBindings: { ${def.name}: false }. Declared include paths: ` +
                    `${included.size > 0 ? [...included].sort().join(', ') : '(none)'}.`,
                });
                continue;
              }
            }

            // [#8340] The provenance half, gated by the verdict's `injected`
            // marker (#14275): only a leaf that resolved BECAUSE it is injected
            // can be an anchor with no storage — an author-declared column of
            // the same name is one they vouch for (#7859). Looked up on the
            // object the LEAF landed on, so a dotted path ending on an ADR-0015
            // `external` object is answered too. Warning, not error, on #4330's
            // cost asymmetry: this pass cannot see the remote table, only that
            // the PLATFORM provisions no storage.
            if (!verdict.injected) continue;
            const leafObject = verdict.object;
            const leafField = verdict.field;
            if (!unprovisionedAnchors.get(leafObject)?.has(leafField)) continue;
            push({
              severity: 'warning',
              rule: DASHBOARD_FILTER_FIELD_UNPROVISIONED,
              message:
                `${provenance}${unprovisionedAnchorCause(leafObject, leafField)}. The filter is ANDed ` +
                `into this widget's analytics query (#2501), so it can never match a real value — ` +
                `on SQLite it silently degrades to constant-false and the widget renders empty ` +
                `(HTTP 200, zero rows, no error).`,
              hint:
                `${unprovisionedAnchorHint(leafObject, leafField)} A widget can also opt out ` +
                `with filterBindings: { ${def.name}: false }. Suppress with ` +
                `suppressWarnings: ['${DASHBOARD_FILTER_FIELD_UNPROVISIONED}'] if the remote schema ` +
                `resolves it some other way.`,
            });
          }
        }
      }

      // ── (a2) the widget's OWN filter keys resolve (#14148) ──
      // `filter-token-unknown` already stands inside this exact subtree and
      // judges the VALUES; this asks the question that was missing about the
      // KEYS. The condition is ANDed into the dataset query as `runtimeFilter`,
      // so a key naming no column either widens the scope (the condition is
      // dropped) or empties it — and the widget renders successfully either way.
      if (w.filter !== undefined && w.filter !== null) {
        const filterObject = typeof dataset.object === 'string' ? dataset.object : undefined;
        // Skips 1 and 2, taken once for the whole widget: an object this stack
        // does not define, or one with no readable field map. Resolving against
        // it would turn an unknowable base binding into a finding per filter key.
        const base = filterObject ? graph.get(filterObject) : undefined;
        if (filterObject && base) {
          const included = joinablePrefixes(dataset.include);
          walkFilterFieldKeys(w.filter, `${path}.filter`, ({ field, path: at }) => {
            const verdict = resolveFieldPath(graph, filterObject, field);
            if (isUnjudgeable(verdict) || !verdict) return;

            const account = describeFieldPathVerdict(verdict, field, 'filter key');
            if (account) {
              push({
                severity: 'error',
                rule: WIDGET_FILTER_FIELD_UNKNOWN,
                path: at,
                message:
                  `${account.message} The widget's own \`filter\` is ANDed into the ` +
                  `dataset query as \`runtimeFilter\`, so the condition addresses a column ` +
                  `that does not exist: the widget renders successfully and empty, and ` +
                  `nothing reports the miss.`,
                hint:
                  `Filter on a field that exists on "${filterObject}" (dataset "${dsName}"), ` +
                  `or on a \`relationship[.relationship].field\` path whose prefix is declared ` +
                  `in that dataset's \`include\`. ${account.detail}`,
              });
              return;
            }

            // The key RESOLVES. Second clause: ADR-0021 joins ONLY declared
            // paths, and the compiler's `assertDeclared` never sees a
            // `runtimeFilter` — so an undeclared prefix is a real defect with
            // no runtime door in front of it.
            const cut = field.lastIndexOf('.');
            if (cut < 0) return; // a base column needs no join
            const prefix = field.slice(0, cut);
            if (included.has(prefix)) return;
            push({
              severity: 'error',
              rule: WIDGET_FILTER_FIELD_NOT_INCLUDED,
              path: at,
              message:
                `filter key "${field}" resolves on the object graph, but its relationship ` +
                `prefix "${prefix}" is not declared in dataset "${dsName}"'s \`include\` — ` +
                `and ADR-0021 joins ONLY declared paths, so no join is compiled and the ` +
                `column is out of this query's reach. The widget renders empty.`,
              hint:
                `Add "${prefix}" to dataset "${dsName}"'s include (declaring "a.b" implicitly ` +
                `includes "a"), or filter on a field of "${filterObject}" itself. Declared ` +
                `include paths: ${included.size > 0 ? [...included].sort().join(', ') : '(none)'}.`,
            });
          });
        }
      }

      const dimensionNames = new Set<string>();
      for (const d of asArray(dataset.dimensions)) {
        if (typeof d.name === 'string') dimensionNames.add(d.name);
      }
      const measures = new Map<string, AnyRec>();
      for (const m of asArray(dataset.measures)) {
        if (typeof m.name === 'string') measures.set(m.name, m);
      }

      // ── (b) every dimensions[] entry is a dataset dimension ──
      const dims = asStrings(w.dimensions);
      for (let k = 0; k < dims.length; k++) {
        if (dimensionNames.has(dims[k])) continue;
        push({
          severity: 'error',
          rule: WIDGET_DIMENSION_UNKNOWN,
          message:
            `dimensions[${k}] "${dims[k]}" is not a dimension of dataset ` +
            `"${dsName}" (declared dimensions: ${list(dimensionNames)}).`,
          hint:
            `Widgets select dataset dimensions BY NAME.${suggestName(dims[k], dimensionNames)} ` +
            `Add the dimension to the dataset or fix the reference.`,
        });
      }

      // ── (c) every values[] entry is a dataset measure ──
      const values = asStrings(w.values);
      for (let k = 0; k < values.length; k++) {
        if (measures.has(values[k])) continue;
        push({
          severity: 'error',
          rule: WIDGET_MEASURE_UNKNOWN,
          message:
            `values[${k}] "${values[k]}" is not a measure of dataset ` +
            `"${dsName}" (declared measures: ${list(measures.keys())}).`,
          hint:
            `Widgets select dataset measures BY NAME, not by base column.` +
            `${suggestName(values[k], measures.keys())} ` +
            `Add the measure to the dataset or fix the reference.`,
        });
      }

      // ── (c1) `options.sortBy` names something this widget selects (#14148) ──
      // `DashboardWidgetOptionsSchema.sortBy` states its own contract in prose
      // — "must be one this widget actually selects (a `dimensions` entry or a
      // `values` entry)" — and nothing enforced it. It is lowered into a
      // `DatasetSelection.order`, whose key must name a selected dimension or
      // measure; a key that does not is either dropped in favour of the
      // implicit ordering or refused by the executor (`resolveOrdering`
      // throws `DATASET_INVALID`). Both outcomes lose the order the author
      // wrote, and the first loses it in silence — which is the whole defect
      // where the authored order IS the product rule (ordering business units
      // by a COUNT turns a workload chart into a league table).
      //
      // Resolved against the AUTHORED `dimensions`/`values` arrays, not the
      // validated subset: an entry that does not resolve is rules (b)/(c)'s
      // finding, and re-reporting it here would double-report one typo. Same
      // call `measureField` below makes for `chartConfig`.
      const widgetOptions = (w.options && typeof w.options === 'object' && !Array.isArray(w.options))
        ? (w.options as AnyRec)
        : undefined;
      const sortBy = typeof widgetOptions?.sortBy === 'string' ? widgetOptions.sortBy : undefined;
      if (sortBy && !dims.includes(sortBy) && !values.includes(sortBy)) {
        // A name the DATASET declares but this widget did not select is the
        // more helpful diagnosis — the fix is a `values`/`dimensions` entry,
        // not a spelling correction — so it is named apart from a name the
        // dataset does not declare at all.
        const declaredButUnselected = dimensionNames.has(sortBy) || measures.has(sortBy);
        const selected = [...dims, ...values];
        push({
          severity: 'error',
          rule: WIDGET_SORTBY_UNSELECTED,
          path: `${path}.options.sortBy`,
          message: declaredButUnselected
            ? `options.sortBy "${sortBy}" is declared by dataset "${dsName}" but is not ` +
              `selected by this widget (selects: ${list(selected)}), so the query result ` +
              `will not contain that column and the authored order cannot be applied.`
            : `options.sortBy "${sortBy}" is neither a \`dimensions\` nor a \`values\` entry ` +
              `of this widget (selects: ${list(selected)}) — \`sortBy\` must name one this ` +
              `widget actually selects, so the authored order cannot be applied.`,
          hint: declaredButUnselected
            ? `Add "${sortBy}" to this widget's ${dimensionNames.has(sortBy) ? 'dimensions' : 'values'}, ` +
              `or order by something it already selects.` +
              `${suggestName(sortBy, selected)}`
            : `Point options.sortBy at one of this widget's selected names (${list(selected)}).` +
              `${suggestName(sortBy, selected)} Ordering is applied to the query RESULT, so it ` +
              `can only name a column that result carries.`,
        });
      }

      // ── (d) chartConfig bindings resolve against the widget's selection ──
      const chartConfig = (w.chartConfig && typeof w.chartConfig === 'object')
        ? (w.chartConfig as AnyRec)
        : undefined;
      // [#14436] Not "is this a chart" — the renderer derives every chart's
      // binding from `dimensions`/`values`. This asks the only question a
      // MISSING `chartConfig` can still answer badly: does this family carry
      // its shape in `chartConfig`?
      const isMarkMixing = typeof w.type === 'string' && MARK_MIXING_CHART_TYPES.has(w.type);

      if (chartConfig) {
        // The query result carries the widget's selected dimensions and
        // measures; resolve every chartConfig field against that shape.
        const selectedValues = new Set(values.filter((v) => measures.has(v)));

        // [#15463] All three positions below are WARNING tier. The pinned
        // renderer refuses every one of them as a binding (see "The three
        // refused binding keys" in the module docblock), so the authored key
        // is ignored rather than mis-queried — `widget-legacy-analytics-shape`'s
        // class, and it carries that class's tier and suppressibility.
        const suppressHint =
          `Suppress with suppressWarnings: ['${CHART_FIELD_UNKNOWN}'] if the inert key is intentional.`;

        const xAxis = (chartConfig.xAxis && typeof chartConfig.xAxis === 'object')
          ? (chartConfig.xAxis as AnyRec)
          : undefined;
        // A field naming an entry of the widget's own (already-validated)
        // selection is not re-reported here — rules (b)/(c) own that error.
        if (xAxis && typeof xAxis.field === 'string'
            && !dimensionNames.has(xAxis.field) && !dims.includes(xAxis.field)) {
          push({
            severity: 'warning',
            rule: CHART_FIELD_UNKNOWN,
            message:
              `chartConfig.xAxis.field "${xAxis.field}" does not resolve to a ` +
              `dimension of dataset "${dsName}" (declared dimensions: ${list(dimensionNames)}) — ` +
              `and the dashboard renderer ignores an authored axis \`field\` in any case: ` +
              `\`axisPresentation\` strips it, so the x-axis stays bound to this widget's ` +
              `first dimension (${list(dims)}). The binding is a silent no-op, not a query ` +
              `that fails.`,
            hint:
              `Point xAxis.field at a dataset dimension name, or drop the key — \`xAxis\` ` +
              `carries presentation only (title, format, gridlines) and the axis binding ` +
              `comes from this widget's \`dimensions\`.` +
              `${suggestName(xAxis.field, dimensionNames)} ${suppressHint}`,
          });
        }

        // [#15463] The two measure-side positions are refused for DIFFERENT
        // reasons — an axis `field` is stripped and the derived binding stands,
        // while a `series[].name` is the MATCH KEY and an unmatched entry is
        // dropped whole — so the consequence sentence is per position.
        const measureField = (label: string, field: string, kind: 'axis' | 'series'): void => {
          if (values.includes(field)) return; // resolvable, or already errored via rule (c)
          const declaredButUnselected = measures.has(field);
          const nameClause = declaredButUnselected
            ? `chartConfig.${label} "${field}" is a measure of dataset "${dsName}" ` +
              `but is not selected in the widget's values (${list(values)})`
            : `chartConfig.${label} "${field}" does not resolve to a measure of ` +
              `dataset "${dsName}" (declared measures: ${list(measures.keys())})`;
          const consequence = kind === 'series'
            ? `the dashboard renderer derives one series per selected measure and matches an ` +
              `authored entry BY NAME, so this entry pairs with no series and the presentation ` +
              `on it (mark, colour, stack, axis side) lands on nothing`
            : `the dashboard renderer ignores an authored axis \`field\` — \`axisPresentation\` ` +
              `strips it — so the y-axis bindings stay derived from this widget's values ` +
              `(${list(values)}) and the key re-points nothing`;
          const fixHint = declaredButUnselected
            ? `Add "${field}" to the widget's values, or bind the chart to a selected measure.`
            : `Post-cutover data is keyed by the dataset's measure NAME, not the ` +
              `base column.${suggestName(field, selectedValues.size > 0 ? selectedValues : measures.keys())}`;
          const shapeHint = kind === 'series'
            ? `\`series[].name\` selects WHICH derived series the presentation lands on; it ` +
              `cannot add, remove or re-point one.`
            : `\`yAxis[]\` carries presentation only (title, min/max, position); the bindings ` +
              `come from \`values\`.`;
          push({
            severity: 'warning',
            rule: CHART_FIELD_UNKNOWN,
            message: `${nameClause} — ${consequence}. It is a silent no-op, not a query that fails.`,
            hint: `${fixHint} ${shapeHint} ${suppressHint}`,
          });
        };

        const yAxes = Array.isArray(chartConfig.yAxis) ? (chartConfig.yAxis as AnyRec[]) : [];
        for (let k = 0; k < yAxes.length; k++) {
          const field = yAxes[k]?.field;
          if (typeof field === 'string') measureField(`yAxis[${k}].field`, field, 'axis');
        }
        const series = Array.isArray(chartConfig.series) ? (chartConfig.series as AnyRec[]) : [];
        for (let k = 0; k < series.length; k++) {
          const name = series[k]?.name;
          if (typeof name === 'string') measureField(`series[${k}].name`, name, 'series');
        }
      } else if (isMarkMixing) {
        push({
          severity: 'warning',
          rule: CHART_CONFIG_MISSING,
          message:
            `'${w.type}' widget has no chartConfig — a combination chart takes its ` +
            `per-series mark from \`chartConfig.series[].type\`, and with none declared ` +
            `every measure (${list(values)}) draws with the same default mark, so the ` +
            `chart is not a combination at all. The data and the axis are unaffected: ` +
            `the renderer derives those from this widget's dimensions and values.`,
          hint:
            `Give each measure its mark — chartConfig: { series: [{ name: '<measure>', ` +
            `type: 'bar' | 'line' | 'area' }] } — naming measures this widget selects ` +
            `(${list(values)}). \`series[].name\` selects WHICH derived series the mark ` +
            `lands on; it cannot add, remove or re-point one. If one uniform mark is ` +
            `intentional, prefer that family's own widget type, or suppress with: ` +
            `suppressWarnings: ['${CHART_CONFIG_MISSING}']`,
        });
      }

      // ── (d1) a chart-family widget with an empty selection (#15462) ──
      // Neither shape is about `chartConfig` — the renderer degrades before it
      // is ever consulted — so both are their own ids rather than arms of
      // `chart-config-missing` (which would then misname its own condition).
      // Evaluated on the AUTHORED arrays, exactly as (c1) is: an entry that
      // does not resolve is rules (b)/(c)'s finding, and emptiness is a
      // different question from resolvability.
      //
      // Mutually exclusive, in the pin's own order: `values.length === 0`
      // returns the placeholder at `DatasetWidget.tsx:683`, above every family
      // branch, so a measureless widget never reaches the `isMetric` test the
      // second id describes. Reporting both would attribute to one widget two
      // consequences it cannot have at once.
      if (isChartFamilyWidgetType(w.type)) {
        if (values.length === 0) {
          push({
            severity: 'warning',
            rule: CHART_MEASURES_MISSING,
            message:
              `'${w.type}' widget selects no measures (\`values\` is empty), so the ` +
              `renderer short-circuits to the authoring placeholder "Pick measures ` +
              `(values) for this dataset widget." before any query runs — no chart is ` +
              `drawn at all.`,
            hint:
              `Select at least one measure of dataset "${dsName}" BY NAME — ` +
              `values: ['<measure>'] (declared measures: ${list(measures.keys())}).` +
              (dims.length === 0
                ? ` This widget selects no \`dimensions\` either; a chart family needs one ` +
                  `to plot against (see ${CHART_DIMENSIONS_MISSING}).`
                : '') +
              ` If the widget is deliberately still being authored, suppress with: ` +
              `suppressWarnings: ['${CHART_MEASURES_MISSING}']`,
          });
        } else if (dims.length === 0) {
          push({
            severity: 'warning',
            rule: CHART_DIMENSIONS_MISSING,
            message:
              `'${w.type}' widget selects no dimensions, so the renderer's ` +
              `\`isMetric\` test (\`METRIC_TYPES.has(widgetType) || dimensions.length ` +
              `=== 0\`) is true and it draws a single KPI number instead of a ` +
              `'${w.type}' chart. The number is real, so nothing looks broken — the ` +
              `declared chart family is simply gone.`,
            hint:
              `Plot the chart against a dataset dimension — dimensions: ['<name>'] ` +
              `(declared dimensions: ${list(dimensionNames)}) — or, if a single value ` +
              `IS what this tile should show, declare it as a 'metric' or 'kpi' widget ` +
              `so the type matches what renders. Suppress with: ` +
              `suppressWarnings: ['${CHART_DIMENSIONS_MISSING}']`,
          });
        }
      }

      // ── (e) table/pivot bound to a count-only, dimensionless selection ──
      if (w.type !== 'table' && w.type !== 'pivot') continue;
      // Grouped by at least one dimension → genuinely aggregated rows.
      if (dims.length > 0) continue;
      if (values.length === 0) continue;
      const resolved = values.map((v) => measures.get(v));
      // An unresolvable measure name already errored above — don't guess here.
      if (resolved.some((m) => !m)) continue;

      // Derived measures combine other measures; treat them as non-count even
      // when their (ignored) `aggregate` says otherwise.
      const countOnly = resolved.every((m) => m!.aggregate === 'count' && !m!.derived);
      if (!countOnly) continue;

      push({
        severity: 'warning',
        rule: TABLE_COUNT_ONLY,
        message:
          `a '${w.type}' widget bound to dataset "${dsName}" selects only count ` +
          `measure(s) (${values.join(', ')}) and no dimensions, so it renders a ` +
          `single summary row — not a per-record list.`,
        hint:
          `A flat record listing is not an analytics dataset. Model it as an ` +
          `object-bound ListView (ADR-0017) surfaced through app navigation, and ` +
          `use a 'metric' widget here if you only need the count. If a single-row ` +
          `table is intentional, add an explicit dimension or suppress with: ` +
          `suppressWarnings: ['${TABLE_COUNT_ONLY}']`,
      });
    }
  }

  return findings;
}
