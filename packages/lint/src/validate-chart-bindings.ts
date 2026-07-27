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
 * Deliberately NOT covered: the react `<ObjectChart>` block. It is
 * OBJECT-bound (`objectName` + an inline `aggregate`), not dataset-bound, and
 * nothing in the repo pins down what the runtime names the aggregated result
 * column — so there is no defensible answer for what its `yAxis[].field`
 * should resolve against. Guessing one would manufacture false positives on
 * the single authored usage. Its `aggregate.field` / `groupBy` ARE checkable
 * against the object's fields, but only by reading JSX attribute values, which
 * `validate-react-page-props` does not do today. Left for a follow-up rather
 * than half-built (ADR-0078 §5: verify, then enforce).
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

import { walkPageComponents, type AnyRec } from './page-walk.js';

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function suggest(target: string, known: Iterable<string>): string {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of known) {
    const d = distance(target, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
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
  for (const ds of asArray(stack.datasets)) {
    const name = strName(ds.name);
    if (!name) continue;
    const dimensions = new Set<string>();
    for (const d of asArray(ds.dimensions)) {
      const n = strName(d.name);
      if (n) dimensions.add(n);
    }
    const measures = new Set<string>();
    for (const m of asArray(ds.measures)) {
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
  /** Series names — measure refs (ChartConfig shape). */
  series?: Array<{ name: string; path: string }>;
  where: string;
  /** Path of the chart container, for the dataset-level finding. */
  path: string;
}

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
          `Declared datasets: ${list(datasets.keys())}.${suggest(dsName, datasets.keys())} ` +
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
          `Dataset dimensions: ${list(ds.dimensions)}.${suggest(name, ds.dimensions)} ` +
          `Declare the dimension on the dataset, or bind an existing one.`,
      });
    };

    const measureRef = (name: string, path: string, selected?: Set<string>) => {
      if (!ds.measures.has(name)) {
        findings.push({
          severity: 'error',
          rule: CHART_MEASURE_UNKNOWN,
          where: binding.where,
          path,
          message:
            `"${name}" is not a measure declared by dataset "${dsName}". ` +
            `Post-ADR-0021 result rows are keyed by MEASURE NAME (e.g. "sum_amount"), ` +
            `not the base field (e.g. "amount"), so this series comes back empty.`,
          hint:
            `Dataset measures: ${list(ds.measures)}.${suggest(name, ds.measures)} ` +
            `Declare the measure on the dataset, or bind an existing one.`,
        });
        return;
      }
      // Declared but not part of this chart's selection: the query never asks
      // for it, so the axis still plots nothing. Advisory — the selection may
      // legitimately be widened at runtime.
      if (selected && selected.size > 0 && !selected.has(name)) {
        findings.push({
          severity: 'warning',
          rule: CHART_AXIS_NOT_SELECTED,
          where: binding.where,
          path,
          message:
            `"${name}" is a declared measure of "${dsName}" but is not in this chart's ` +
            `selected values (${list(selected)}) — the query does not return it, ` +
            `so the series plots nothing.`,
          hint: `Add "${name}" to \`values\`, or point the axis at a selected measure.`,
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
        measureRef(valSel.names[i], `${valSel.path}[${i}]`);
      }
    }
    if (binding.xAxis) dimensionRef(binding.xAxis.name, binding.xAxis.path);
    if (binding.yAxis) measureRef(binding.yAxis.name, binding.yAxis.path, selected);
    for (const s of binding.series ?? []) measureRef(s.name, s.path, selected);
  };

  // ── 1. Report charts (report.chart + report.blocks[].chart) ──
  const reports = asArray(stack.reports);
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
        series: asArray(chart.series)
          .map((s, si) => ({ name: strName(s.name), path: `${path}.chart.series[${si}].name` }))
          .filter((s): s is { name: string; path: string } => !!s.name),
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

  const views = asArray(stack.views);
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

  const objects = asArray(stack.objects);
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
  const pages = asArray(stack.pages);
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
      const axisRefs = asArray(props.yAxis)
        .map((a, ai) => ({ name: strName(a.field), path: `${path}.properties.yAxis[${ai}].field` }))
        .filter((a): a is { name: string; path: string } => !!a.name);
      const seriesRefs = asArray(props.series)
        .map((s, si) => ({ name: strName(s.name), path: `${path}.properties.series[${si}].name` }))
        .filter((s): s is { name: string; path: string } => !!s.name);
      check({
        dataset: strName(props.dataset),
        dimensions: { names: strList(props.dimensions), path: `${path}.properties.dimensions` },
        values: { names: strList(props.values), path: `${path}.properties.values` },
        series: [...axisRefs, ...seriesRefs],
        where: `page "${pageName}" · ${strName(component.type) ?? 'chart'}`,
        path: `${path}.properties`,
      });
    }
  }

  return findings;
}
