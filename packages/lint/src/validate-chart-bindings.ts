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
  /** Selected dimension names (list-chart shape). */
  dimensions?: { names: string[]; path: string };
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
  where: string;
  /** Path of the chart container, for the dataset-level finding. */
  path: string;
}

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

  const check = (binding: ChartBinding) => {
    const dsName = binding.dataset;
    if (!dsName) return; // nothing bound — the shape rules own that case
    const ds = datasets.get(dsName);
    if (!ds) {
      findings.push({
        severity: 'error',
        rule: CHART_DATASET_UNKNOWN,
        where: binding.where,
        path: `${binding.path}.dataset`,
        message:
          `binds dataset "${dsName}", which resolves to no declared dataset — ` +
          `the chart has no data to render.`,
        hint:
          `Declared datasets: ${list(datasets.keys())}.${suggestName(dsName, datasets.keys())} ` +
          `Define it with defineDataset() or fix the reference (ADR-0021).`,
      });
      return;
    }

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

    const dimSel = binding.dimensions;
    if (dimSel) {
      for (let i = 0; i < dimSel.names.length; i++) {
        dimensionRef(dimSel.names[i], `${dimSel.path}[${i}]`);
      }
    }
    const valSel = binding.values;
    const selected = new Set(valSel?.names ?? []);
    if (valSel) {
      for (let i = 0; i < valSel.names.length; i++) {
        // The SELECTION itself — the names the dataset query asks for on every
        // surface that has this limb. Always a binding.
        measureRef(valSel.names[i], `${valSel.path}[${i}]`, 'query');
      }
    }
    if (binding.xAxis) dimensionRef(binding.xAxis.name, binding.xAxis.path);
    if (binding.yAxis) measureRef(binding.yAxis.name, binding.yAxis.path, 'query', selected);
    // Axes before series, the order the page surface reported them in when the
    // two shared one limb — the split (#15575) changes the message, not the
    // walk.
    for (const a of binding.axes ?? []) measureRef(a.name, a.path, 'page-axis', selected);
    for (const s of binding.series ?? []) measureRef(s.name, s.path, s.kind, selected);
  };

  // ── 1. Report charts (report.chart + report.blocks[].chart) ──
  const reports = recordsOf(stack.reports);
  for (let ri = 0; ri < reports.length; ri++) {
    const report = reports[ri];
    if (!isRec(report)) continue;
    const reportName = strName(report.name) ?? `#${ri}`;

    const checkReportChart = (
      chart: unknown,
      dataset: string | undefined,
      values: string[],
      where: string,
      path: string,
    ) => {
      if (!isRec(chart)) return;
      check({
        dataset,
        // `values` is the report's measure SELECTION, not a chart ref; feeding
        // it in lets the yAxis "declared but not selected" check work without
        // reporting the selection itself twice.
        values: { names: values, path: `${path}.values` },
        xAxis: strName(chart.xAxis) ? { name: strName(chart.xAxis)!, path: `${path}.chart.xAxis` } : undefined,
        yAxis: strName(chart.yAxis) ? { name: strName(chart.yAxis)!, path: `${path}.chart.yAxis` } : undefined,
        series: recordsOf(chart.series)
          .map((s, si) => ({
            name: strName(s.name),
            path: `${path}.chart.series[${si}].name`,
            kind: 'report-series' as const,
          }))
          .filter((s): s is { name: string; path: string; kind: 'report-series' } => !!s.name),
        where,
        path: `${path}.chart`,
      });
    };

    checkReportChart(
      report.chart,
      strName(report.dataset),
      strList(report.values),
      `report "${reportName}" · chart`,
      `reports[${ri}]`,
    );

    const blocks = Array.isArray(report.blocks) ? report.blocks : [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      if (!isRec(block)) continue;
      checkReportChart(
        block.chart,
        strName(block.dataset),
        strList(block.values),
        `report "${reportName}" · block "${strName(block.name) ?? `#${bi}`}" chart`,
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
      dimensions: { names: strList(chart.dimensions), path: `${path}.chart.dimensions` },
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
        dimensions: { names: strList(props.dimensions), path: `${path}.properties.dimensions` },
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
