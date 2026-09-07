// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0021 — semantic layer] Chart-binding integrity for the surfaces the
 * dashboard rule does not reach (issue #3583, assessment R4).
 *
 * `validate-widget-bindings` already resolves a dashboard widget's
 * `chartConfig` axes against its dataset's declared dimensions and measures
 * (`chart-field-unknown`). It is scoped to `stack.dashboards`, so three other
 * chart surfaces ship unchecked — and the HotCRM audit found exactly the bug
 * that scoping allows: an axis naming a RAW FIELD instead of a dataset measure.
 * Post-ADR-0021 the result rows are keyed by measure NAME (`sum_amount`), not
 * the base column (`amount`), so the axis renders and the series is empty.
 *
 * Surfaces covered here:
 *
 *   1. **Report charts** — `report.chart` and `report.blocks[].chart`.
 *      `ReportChartSchema` narrows `xAxis`/`yAxis` from ChartConfig's
 *      object/array shapes to bare STRINGS, which is why simply pointing the
 *      dashboard rule at reports would find nothing: its `Array.isArray(yAxis)`
 *      guard skips a string silently. `series[].name` keeps the array shape.
 *   2. **List-view charts** — `ListChartConfigSchema` (`dataset` +
 *      `dimensions` + `values`), reachable through `views[].list`,
 *      `views[].listViews.<key>`, and `objects[].listViews.<key>`.
 *   3. **Dataset-bound page chart components** — a `PageComponent` whose
 *      `properties` carry a `dataset` (the `object-chart` component). Same
 *      binding shape as a list chart, but it arrives through the untyped
 *      `properties` bag.
 *
 * Not covered HERE, and deliberately so: the react `<ObjectChart>` block. It is
 * OBJECT-bound (`objectName` + an inline `aggregate`), so its result rows are
 * keyed by the RAW FIELD NAMES rather than by a measure name — the opposite
 * convention, which would make `chart-measure-unknown`'s message a lie. It also
 * arrives as JSX rather than config, so it needs the TypeScript compiler this
 * rule has no business loading. It is checked by `validate-react-page-props`
 * instead, against the naming convention `chartAggregateResultKeys`
 * (`@objectstack/spec/ui`) now pins down (#3701).
 *
 * ## Which positions are BINDINGS, and which are presentation (#15575)
 *
 * `chart-measure-unknown`'s message names a QUERY consequence — *"this series
 * comes back empty"* — and that is only true where the position feeds the
 * dataset query. Read at the pinned `@object-ui` revision (`.objectui-sha`),
 * the three surfaces do not agree, so the tier and the consequence are per
 * POSITION rather than per rule:
 *
 *  - **Report charts.** The chart runs its OWN query out of the two axis
 *    strings — `useDatasetRows(dataset, [xAxis], [yAxis], …)` in
 *    `plugin-report/src/DatasetReportRenderer.tsx`, and in that file's own
 *    words *"the embedded chart queries only `chart.xAxis` × `chart.yAxis`"*.
 *    So `chart.yAxis` IS the binding and keeps `error`. `chart.series[]` is
 *    not: it is *"The author's per-chart override for ONE measure's display
 *    name — the entry of `chart.series[]` whose `name` IS that measure"*,
 *    lowered through `mergeAuthoredSeries`, for which *"an authored entry
 *    naming a measure that is NOT in the dataset selection is **ignored** —
 *    membership belongs to the dataset"* (`@object-ui/core`
 *    `src/utils/chart-presentation.ts`).
 *  - **List-view charts.** `ListChartConfigSchema` is a STRICT object of
 *    `chartType` / `dataset` / `dimensions` / `values`: it declares no
 *    `series` and no `yAxis`, so this rule has no presentation position on
 *    that surface at all. Its one measure position is `values[]`, which
 *    `app-shell/src/views/ObjectView.tsx` hands to the chart component as the
 *    dataset measures (and synthesises the series list FROM). Query binding,
 *    `error`, unchanged.
 *  - **Dataset-bound page chart components.** `plugin-charts/src/ObjectChart.tsx`
 *    queries `{ dimensions: schema.dimensions, measures: schema.values }` and
 *    then REPLACES the authored series wholesale —
 *    `{ ...schema, data, xAxisKey, series: datasetChart.series }`, one derived
 *    entry per selected measure. An authored `properties.series[].name` reaches
 *    the renderer not at all, and an authored `properties.yAxis[].field` is
 *    inert for the same reason (`normalizeChartSchema` synthesises series from
 *    `yAxis[].field` only when there are none, which on this surface means an
 *    empty `values` — a chart with no measures to plot either way). Both are
 *    presentation; `dimensions` / `values` are the binding.
 *
 * So the presentation positions drop to `warning` and state what actually
 * happens, which is the resolution the maintainer ruling on
 * `chart-field-unknown` reached for the same question one rule over (see "The
 * three refused binding keys" in `validate-widget-bindings.ts`). Two things
 * follow that differ from that sibling, and are worth stating rather than
 * leaving to be re-derived:
 *
 *  - **There is no per-position suppression here.** `suppressWarnings` is
 *    declared on the dashboard WIDGET only (`spec/src/ui/dashboard.zod.ts`),
 *    and none of these three surfaces carries the key. A `warning` is advisory
 *    (the consumers split on `severity === 'error'`) but cannot be silenced
 *    individually; declaring the key on these surfaces would be a schema
 *    change, which this rule has no standing to make.
 *  - **The page surface's axis refs and series refs are separate limbs.** They
 *    used to be concatenated into one `series` array before the measure walk,
 *    so every `yAxis[].field` took the SERIES message. Reading both shapes on
 *    that surface is deliberate (the props bag mixes them); giving them one
 *    message was not — the pin refuses the two for different reasons, so they
 *    now carry different sentences.
 *
 * `chart-axis-not-selected` (declared measure, outside the selection) rides the
 * same walk and took the same one-size sentence — *"the query does not return
 * it, so the series plots nothing"*. That is the truth at a query position and
 * not at a presentation one, where no series is derived for the name in the
 * first place, so its consequence is per position too.
 *
 * ## Which SET `chart-axis-not-selected` resolves against (#15734)
 *
 * The consequence is per POSITION; the selection it is measured against is per
 * SURFACE — and on the report surface that selection is not `report.values`.
 * At the same pinned revision `DatasetReportRenderer.tsx` runs
 * `useDatasetRows(dataset, plan.kind === 'series' && xAxis ? [xAxis] : [],
 * wantsQuery && yAxis ? [yAxis] : [], …)` and derives the plotted series with
 * `buildChartSeries(…, [xAxis], [yAxis], …)` — *"the selection is exactly one
 * dimension × one measure, so this takes the helper's single-dimension branch
 * and returns ONE series"*. `report.values` is the selection of the TABLE
 * beneath the chart; the chart's own is the axis pair. Two things follow:
 *
 *  - **Nothing to report at the report `chart.yAxis`.** That position IS the
 *    chart's query, so it cannot fail to select itself. The warning that fired
 *    for a declared measure outside `report.values` stated a query consequence
 *    its own pin refutes: the chart asks for exactly that measure and plots
 *    it. `chart-measure-unknown` at that position is untouched — an UNDECLARED
 *    measure still returns no column, and still gates.
 *  - **`chart.series[].name` resolves against the singleton `{ chart.yAxis }`.**
 *    The override is paired with a DERIVED series and the chart derives one,
 *    so that singleton — not `report.values` — is the set an entry can land
 *    on. An entry naming `chart.yAxis` lands however the table is selected;
 *    one naming any other declared measure lands on nothing.
 *
 * The list-view and page-component surfaces keep `values`: there it IS the
 * measure set the query asks for, so the existing resolution is correct.
 *
 * ## What a REPORT binds, chart or no chart (#16105)
 *
 * A report is dataset-bound in its own right — `ReportSchema` requires
 * `dataset` + `values` on every non-`joined` report and declares `rows` (the
 * down axis) and `columns` (the across axis a `matrix` pivots on, ADR-0021 D2)
 * as dimension names "from the dataset". The chart is optional decoration on
 * top of that binding, not the binding itself.
 *
 * The walk did not read it that way. Every report position reached the resolver
 * through one closure that opened `if (!isRec(chart)) return`, and that closure
 * was the only site `report.dataset` was ever passed to, so:
 *
 *  - a report authored WITHOUT a chart was not checked at all — an unresolvable
 *    `dataset`, an unknown `rows`/`columns` dimension and an unknown `values`
 *    measure all published clean; and
 *  - `rows`/`columns` were passed to the resolver on NO report, charted or not.
 *    On one and the same charted report, `values` was resolved and the
 *    dimension selection beside it was not.
 *
 * So the dataset is resolved once per report and once per block — before the
 * chart question is asked — and fed to two groups of positions: the report's
 * own selection (`rows`/`columns` → `chart-dimension-unknown`, `values` →
 * `chart-measure-unknown`) and, when a chart is present, its axis refs
 * exactly as before. Not a second "chartless reports too" pass after the early
 * return: one path, entered unconditionally, with the chart as the branch it
 * always was. Which is also why an unresolvable dataset on a charted report is
 * still ONE finding — `resolveDataset` runs once per surface, not once per
 * group.
 *
 * `rows`/`columns` take `chart-dimension-unknown` rather than an id of their
 * own: the position is a dataset DIMENSION reference resolved against the
 * dataset's declared dimensions, which is what that rule already means on the
 * list-view and page surfaces, and the spec's own words for the two report
 * keys are "down axis" and "across" — so the rule's existing sentence about an
 * axis rendering with no categories is true where it now fires.
 */

export const CHART_DIMENSION_UNKNOWN = 'chart-dimension-unknown';
export const CHART_MEASURE_UNKNOWN = 'chart-measure-unknown';
export const CHART_DATASET_UNKNOWN = 'chart-dataset-unknown';
export const CHART_AXIS_NOT_SELECTED = 'chart-axis-not-selected';

export type ChartBindingSeverity = 'error' | 'warning';

export interface ChartBindingFinding {
  severity: ChartBindingSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `report "hours_by_status" · chart`. */
  where: string;
  /** Config path, e.g. `reports[2].chart.yAxis`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

// `recordsOf` — the ONE collection reader (`object-graph.ts`), not the
// hand-copied `asArray` this file used to carry. That copy spelled the array
// branch as an unchecked `v as AnyRec[]`, so a junk member (`reports: [null,
// …]`) was dereferenced rather than skipped and the rule threw instead of
// reporting. Behaviour is otherwise identical, including the map branch that
// keeps a member whose value is not a record under the key the author named
// it with; see that function's header for why the seam reports nothing itself.
import { recordsOf, suggestName } from './object-graph.js';
import { walkPageComponents, type AnyRec } from './page-walk.js';

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function list(names: Iterable<string>): string {
  const all = [...names].sort();
  return all.length ? all.join(', ') : '(none)';
}

/** A dataset's declared dimension and measure names. */
interface DatasetNames {
  dimensions: Set<string>;
  measures: Set<string>;
}

function indexDatasets(stack: AnyRec): Map<string, DatasetNames> {
  const out = new Map<string, DatasetNames>();
  for (const ds of recordsOf(stack.datasets)) {
    const name = strName(ds.name);
    if (!name) continue;
    const dimensions = new Set<string>();
    for (const d of recordsOf(ds.dimensions)) {
      const n = strName(d.name);
      if (n) dimensions.add(n);
    }
    const measures = new Set<string>();
    for (const m of recordsOf(ds.measures)) {
      const n = strName(m.name);
      if (n) measures.add(n);
    }
    out.set(name, { dimensions, measures });
  }
  return out;
}

/**
 * One dataset-bound chart to check: the binding, the selection, and where it
 * came from. `xAxis`/`yAxis`/`series` are the ChartConfig-style axis refs;
 * `dimensions`/`values` are the list-chart-style selection.
 */
interface ChartBinding {
  dataset?: string;
  /**
   * Selected dimension names — a LIST of selections, because a report has two
   * of them and the other surfaces have one (#16105). `rows` is a report's
   * down axis and `columns` its across axis (`matrix`, ADR-0021 D2); a list
   * chart and a page chart each carry a single `dimensions` array. Every entry
   * keeps its own path, so a finding names `reports[i].columns[j]` rather than
   * a position in some merged list the author never wrote.
   */
  dimensions?: Array<{ names: string[]; path: string }>;
  /** Selected measure names (list-chart / report shape). */
  values?: { names: string[]; path: string };
  /** Single dimension ref (report `xAxis`). */
  xAxis?: { name: string; path: string };
  /** Single measure ref (report `yAxis`). */
  yAxis?: { name: string; path: string };
  /**
   * `series[].name` refs (ChartConfig shape) — a display-name / presentation
   * override on every surface that has one, never a binding (#15575). `kind`
   * names the surface because the two are refused DIFFERENTLY at the pin: a
   * report entry is matched against the derived series and dropped when it
   * pairs with none; a page component's authored array is replaced wholesale.
   */
  series?: Array<{ name: string; path: string; kind: 'report-series' | 'page-series' }>;
  /**
   * Page-component `yAxis[].field` refs — axis PRESENTATION (#15575). A limb of
   * its own rather than more entries of `series`: the axis keeps its slot and
   * its scale/chrome while the plotted columns come from `values`, which is a
   * different sentence from a series entry that pairs with nothing.
   */
  axes?: Array<{ name: string; path: string }>;
  /**
   * The measures THIS chart's own query selects, when that is narrower than
   * the `values` limb above (#15734). Set on the report surface and nowhere
   * else: the embedded report chart queries `chart.xAxis` × `chart.yAxis`
   * alone and derives exactly ONE series from it, while `report.values` is the
   * selection of the table beneath it. `chart-axis-not-selected` resolves
   * against this set where it is present — which is both why a `series[].name`
   * override is measured against the singleton `{ chart.yAxis }`, and why the
   * report `chart.yAxis` carries no not-selected check at all (a chart cannot
   * fail to select what it queries). The other two surfaces leave it undefined
   * and resolve against `values`, which on them IS the query's measure set.
   */
  ownSelection?: string[];
  where: string;
  /** Path of the binding's container, for the dataset-level finding. */
  path: string;
}

/**
 * A binding whose `dataset` has already been resolved — the positions alone.
 *
 * The report surface resolves its dataset once and then checks two groups of
 * positions against it (the report's own selection, and its chart's axis refs),
 * which is why resolution and position-checking are separate steps rather than
 * one call (#16105).
 */
type ResolvedBinding = Omit<ChartBinding, 'dataset'>;

/**
 * What a measure name is DOING at the position it was written (#15575).
 *
 * `query` is the only one the dataset query reads; the rest are presentation
 * the pinned renderer refuses as a binding. The distinction decides both the
 * severity and the consequence sentence — see the module docblock for the
 * per-surface read that produced it.
 */
type MeasurePosition = 'query' | 'report-series' | 'page-series' | 'page-axis';

/** Presentation position → what actually happens when the name resolves to nothing. */
const UNKNOWN_CONSEQUENCE: Record<Exclude<MeasurePosition, 'query'>, string> = {
  'report-series':
    'On this surface `chart.series[]` is a per-measure DISPLAY-NAME override, not a '
    + 'binding: the renderer derives the series from the chart\'s own `xAxis`/`yAxis` '
    + 'query and pairs an authored entry with the derived series whose key it EQUALS, so '
    + 'an entry naming no declared measure is ignored. The override lands on nothing — '
    + 'the series is still drawn from the dataset selection.',
  'page-series':
    'On this surface `series[]` is presentation, not a binding: the renderer derives one '
    + 'series per selected measure and REPLACES the authored array with the derived one, '
    + 'so this entry never reaches the chart at all. It lands on nothing — the chart is '
    + 'still drawn from `dimensions`/`values`.',
  'page-axis':
    'On this surface `yAxis[].field` is axis PRESENTATION, not a binding: the entry keeps '
    + 'its slot (the count is what turns on a secondary axis) and its scale/chrome, while '
    + 'the plotted columns come from `values`. The key re-points nothing.',
};

/** Presentation position → the shape sentence in the hint. */
const SHAPE_HINT: Record<Exclude<MeasurePosition, 'query'>, string> = {
  'report-series':
    '`series[].name` selects WHICH derived series the label and per-series presentation '
    + 'land on; it cannot add, remove or re-point one.',
  'page-series':
    '`series[].name` cannot add, remove or re-point a series on a dataset-bound chart — '
    + 'membership belongs to the dataset selection.',
  'page-axis':
    '`yAxis[]` carries presentation only (title, min/max, position, gridlines); the '
    + 'plotted columns come from `values`.',
};

/** Position → the consequence of naming a DECLARED measure outside the selection. */
const UNSELECTED_CONSEQUENCE: Record<MeasurePosition, string> = {
  query: 'the query does not return it, so the series plots nothing.',
  'report-series':
    'this entry is a display-name override matched against the ONE series the chart '
    + 'derives (from its own `chart.yAxis` query), so unless it names that measure the '
    + 'override lands on nothing. The series drawn is unaffected.',
  'page-series':
    'the series are derived from `values`, so none is derived for it and this entry '
    + 'lands on nothing. The chart drawn is unaffected.',
  'page-axis':
    'the plotted columns come from `values`, so the axis entry re-points nothing. The '
    + 'chart drawn is unaffected.',
};

export function validateChartBindings(stack: AnyRec): ChartBindingFinding[] {
  const findings: ChartBindingFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const datasets = indexDatasets(stack);
  if (datasets.size === 0 && !stack.reports && !stack.views && !stack.pages) return findings;

  /**
   * Resolve one bound dataset NAME, reporting `chart-dataset-unknown` when it
   * names nothing declared. Returns `undefined` in that case and when nothing
   * is bound at all — either way there is no dataset to resolve positions
   * against, and the shape rules own an absent binding.
   *
   * A step of its own (#16105) so a surface can resolve its dataset BEFORE it
   * asks whether it has a chart. It reports at most once per call, which is
   * what keeps a charted report's unresolvable dataset a single finding.
   */
  const resolveDataset = (
    dsName: string | undefined,
    where: string,
    path: string,
  ): DatasetNames | undefined => {
    if (!dsName) return undefined; // nothing bound — the shape rules own that case
    const ds = datasets.get(dsName);
    if (ds) return ds;
    findings.push({
      severity: 'error',
      rule: CHART_DATASET_UNKNOWN,
      where,
      path: `${path}.dataset`,
      message:
        `binds dataset "${dsName}", which resolves to no declared dataset — ` +
        `there is no data to render.`,
      hint:
        `Declared datasets: ${list(datasets.keys())}.${suggestName(dsName, datasets.keys())} ` +
        `Define it with defineDataset() or fix the reference (ADR-0021).`,
    });
    return undefined;
  };

  const checkAgainst = (ds: DatasetNames, dsName: string, binding: ResolvedBinding) => {
    const dimensionRef = (name: string, path: string) => {
      if (ds.dimensions.has(name)) return;
      findings.push({
        severity: 'error',
        rule: CHART_DIMENSION_UNKNOWN,
        where: binding.where,
        path,
        message:
          `"${name}" is not a dimension declared by dataset "${dsName}". ` +
          `Post-ADR-0021 result rows are keyed by DIMENSION NAME, not the base ` +
          `field, so this axis renders with no categories.`,
        hint:
          `Dataset dimensions: ${list(ds.dimensions)}.${suggestName(name, ds.dimensions)} ` +
          `Declare the dimension on the dataset, or bind an existing one.`,
      });
    };

    const measureRef = (
      name: string,
      path: string,
      position: MeasurePosition,
      selected?: Set<string>,
    ) => {
      if (!ds.measures.has(name)) {
        findings.push({
          // A query position is the only one where an unknown measure breaks
          // the chart; the presentation positions are advisory (#15575, and
          // the `chart-field-unknown` ruling one rule over).
          severity: position === 'query' ? 'error' : 'warning',
          rule: CHART_MEASURE_UNKNOWN,
          where: binding.where,
          path,
          message:
            `"${name}" is not a measure declared by dataset "${dsName}". ` +
            (position === 'query'
              ? `Post-ADR-0021 result rows are keyed by MEASURE NAME (e.g. "sum_amount"), ` +
                `not the base field (e.g. "amount"), so this series comes back empty.`
              : UNKNOWN_CONSEQUENCE[position]),
          hint:
            `Dataset measures: ${list(ds.measures)}.${suggestName(name, ds.measures)} ` +
            (position === 'query'
              ? `Declare the measure on the dataset, or bind an existing one.`
              : `${SHAPE_HINT[position]} Correct the name or drop the entry — this ` +
                `surface carries no \`suppressWarnings\` key to silence the advisory with.`),
        });
        return;
      }
      // Declared, but outside this chart's selection. At a QUERY position that
      // means the query never asks for it and the axis plots nothing; at a
      // presentation position no series is derived for it at all, so the
      // override lands on nothing. Advisory either way — the selection may
      // legitimately be widened at runtime.
      if (selected && selected.size > 0 && !selected.has(name)) {
        findings.push({
          severity: 'warning',
          rule: CHART_AXIS_NOT_SELECTED,
          where: binding.where,
          path,
          message:
            `"${name}" is a declared measure of "${dsName}" but is not in this chart's ` +
            `selected values (${list(selected)}) — ${UNSELECTED_CONSEQUENCE[position]}`,
          hint:
            position === 'report-series'
              ? `Point the entry at the measure this chart plots (\`chart.yAxis\`), or drop it.`
              : `Add "${name}" to \`values\`, or point the ${
                  position === 'query' ? 'axis' : 'entry'
                } at a selected measure.`,
        });
      }
    };

    for (const dimSel of binding.dimensions ?? []) {
      for (let i = 0; i < dimSel.names.length; i++) {
        dimensionRef(dimSel.names[i], `${dimSel.path}[${i}]`);
      }
    }
    const valSel = binding.values;
    const selected = new Set(valSel?.names ?? []);
    // What this chart DERIVES A SERIES FOR — the set `chart-axis-not-selected`
    // is measured against (#15734). Equal to the selection above wherever the
    // chart IS the surface's selection; the narrower `{ chart.yAxis }` on the
    // report surface, whose chart runs its own axis-pair query.
    const derived = binding.ownSelection ? new Set(binding.ownSelection) : selected;
    if (valSel) {
      for (let i = 0; i < valSel.names.length; i++) {
        // The SELECTION itself — the names the dataset query asks for on every
        // surface that has this limb. Always a binding.
        measureRef(valSel.names[i], `${valSel.path}[${i}]`, 'query');
      }
    }
    if (binding.xAxis) dimensionRef(binding.xAxis.name, binding.xAxis.path);
    // No selection is passed at this position: the report `yAxis` IS the query
    // the chart issues, so it cannot name a measure that query does not ask
    // for (#15734). The `chart-measure-unknown` half still runs — an undeclared
    // measure is no column at all.
    if (binding.yAxis) measureRef(binding.yAxis.name, binding.yAxis.path, 'query');
    // Axes before series, the order the page surface reported them in when the
    // two shared one limb — the split (#15575) changes the message, not the
    // walk.
    for (const a of binding.axes ?? []) measureRef(a.name, a.path, 'page-axis', derived);
    for (const s of binding.series ?? []) measureRef(s.name, s.path, s.kind, derived);
  };

  /** Resolve a binding's dataset and check its positions — the one-call form. */
  const check = (binding: ChartBinding) => {
    const ds = resolveDataset(binding.dataset, binding.where, binding.path);
    if (!ds || !binding.dataset) return;
    checkAgainst(ds, binding.dataset, binding);
  };

  // ── 1. Report charts (report.chart + report.blocks[].chart) ──
  const reports = recordsOf(stack.reports);
  for (let ri = 0; ri < reports.length; ri++) {
    const report = reports[ri];
    if (!isRec(report)) continue;
    const reportName = strName(report.name) ?? `#${ri}`;

    /**
     * One report SURFACE — a top-level report, or one of its `blocks[]`. The
     * two carry the same binding keys (`dataset` + `rows`/`columns`/`values`,
     * plus an optional `chart`), so they are one shape applied twice.
     *
     * ONE pass, with the dataset resolved BEFORE the chart question is asked
     * (#16105). The chart closure this replaced opened with
     * `if (!isRec(chart)) return`, and it was the only site that ever received
     * `report.dataset` — so a report authored without a chart was not checked
     * at all, and no report ever had its `rows`/`columns` resolved. Both are
     * dataset bindings that a report declares in its own right: `rows` names
     * the dimensions it groups down by, `columns` the across axis a `matrix`
     * pivots on (ADR-0021 D2), and `values` the measures its table shows.
     *
     * The report's own selection and its chart's axis refs are checked as two
     * groups against the ONE resolved dataset, because they sit at different
     * depths and their findings should say so: `reports[i].rows[j]` under
     * `report "x"`, `reports[i].chart.yAxis` under `report "x" · chart`.
     */
    const checkReportSurface = (container: AnyRec, where: string, path: string) => {
      const dsName = strName(container.dataset);
      const ds = resolveDataset(dsName, where, path);
      if (!ds || !dsName) return;

      // The REPORT's own selection — what the table shows, independent of any
      // chart. `chart-axis-not-selected` reads none of it: on this surface the
      // set a presentation override is measured against is the chart's own
      // `{ chart.yAxis }` (#15734), passed as `ownSelection` below.
      checkAgainst(ds, dsName, {
        dimensions: [
          { names: strList(container.rows), path: `${path}.rows` },
          { names: strList(container.columns), path: `${path}.columns` },
        ],
        values: { names: strList(container.values), path: `${path}.values` },
        where,
        path,
      });

      const chart = container.chart;
      if (!isRec(chart)) return;
      const xAxisName = strName(chart.xAxis);
      const yAxisName = strName(chart.yAxis);
      checkAgainst(ds, dsName, {
        xAxis: xAxisName ? { name: xAxisName, path: `${path}.chart.xAxis` } : undefined,
        yAxis: yAxisName ? { name: yAxisName, path: `${path}.chart.yAxis` } : undefined,
        // The chart's own selection: the ONE measure it queries and derives a
        // series from. Empty when no `yAxis` is authored — the chart plots
        // nothing at all then, which the shape rules own, so no override can
        // be reported as landing on nothing.
        ownSelection: yAxisName ? [yAxisName] : [],
        series: recordsOf(chart.series)
          .map((s, si) => ({
            name: strName(s.name),
            path: `${path}.chart.series[${si}].name`,
            kind: 'report-series' as const,
          }))
          .filter((s): s is { name: string; path: string; kind: 'report-series' } => !!s.name),
        where: `${where} · chart`,
        path: `${path}.chart`,
      });
    };

    checkReportSurface(report, `report "${reportName}"`, `reports[${ri}]`);

    const blocks = Array.isArray(report.blocks) ? report.blocks : [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      if (!isRec(block)) continue;
      checkReportSurface(
        block,
        `report "${reportName}" · block "${strName(block.name) ?? `#${bi}`}"`,
        `reports[${ri}].blocks[${bi}]`,
      );
    }
  }

  // ── 2. List-view charts ──
  const checkListChart = (container: unknown, where: string, path: string) => {
    if (!isRec(container)) return;
    const chart = container.chart;
    if (!isRec(chart)) return;
    check({
      dataset: strName(chart.dataset),
      dimensions: [{ names: strList(chart.dimensions), path: `${path}.chart.dimensions` }],
      values: { names: strList(chart.values), path: `${path}.chart.values` },
      where,
      path: `${path}.chart`,
    });
  };

  const views = recordsOf(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!isRec(view)) continue;
    const viewName = strName(view.name) ?? strName(view.objectName) ?? `#${vi}`;
    checkListChart(view.list, `view "${viewName}" · list chart`, `views[${vi}].list`);
    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        checkListChart(lv, `view "${viewName}" · listViews.${key} chart`, `views[${vi}].listViews.${key}`);
      }
    }
  }

  const objects = recordsOf(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!isRec(obj) || !isRec(obj.listViews)) continue;
    const objName = strName(obj.name) ?? `#${oi}`;
    for (const [key, lv] of Object.entries(obj.listViews)) {
      checkListChart(
        lv,
        `object "${objName}" · listViews.${key} chart`,
        `objects[${oi}].listViews.${key}`,
      );
    }
  }

  // ── 3. Dataset-bound page chart components ──
  // A chart component arrives through the untyped `properties` bag. The
  // presence of a `dataset` key is what marks it dataset-bound (and so
  // checkable); an object-bound chart has none and is left alone.
  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page)) continue;
    const pageName = strName(page.name) ?? `#${pi}`;
    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const props = isRec(component.properties) ? component.properties : undefined;
      if (!props || !strName(props.dataset)) continue;
      // A page chart mixes the list-chart selection (`dataset`/`dimensions`/
      // `values`) with ChartConfig-style axes (`yAxis: [{ field }]`), so both
      // shapes are read here.
      const axisRefs = recordsOf(props.yAxis)
        .map((a, ai) => ({ name: strName(a.field), path: `${path}.properties.yAxis[${ai}].field` }))
        .filter((a): a is { name: string; path: string } => !!a.name);
      const seriesRefs = recordsOf(props.series)
        .map((s, si) => ({
          name: strName(s.name),
          path: `${path}.properties.series[${si}].name`,
          kind: 'page-series' as const,
        }))
        .filter((s): s is { name: string; path: string; kind: 'page-series' } => !!s.name);
      check({
        dataset: strName(props.dataset),
        dimensions: [{ names: strList(props.dimensions), path: `${path}.properties.dimensions` }],
        values: { names: strList(props.values), path: `${path}.properties.values` },
        // #15575 — two limbs, not one concatenated `series` array: the pin
        // refuses an axis `field` and a series `name` for different reasons.
        axes: axisRefs,
        series: seriesRefs,
        where: `page "${pageName}" · ${strName(component.type) ?? 'chart'}`,
        path: `${path}.properties`,
      });
    }
  }

  return findings;
}
