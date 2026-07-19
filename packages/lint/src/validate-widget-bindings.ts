// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isIncoherentAggregate } from '@objectstack/spec/data';

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
 * - `chart-field-unknown` — a `chartConfig` binding names a field the query
 *   result will not contain: `xAxis.field` must be one of the widget's
 *   dimensions (or a dataset dimension), and each `yAxis[].field` /
 *   `series[].name` must be one of the widget's selected measures
 *   (`values`). Post-cutover (ADR-0021) the result rows are keyed by
 *   measure NAME (e.g. `sum_amount`), not the base column (`amount`) — a
 *   stale base-column reference renders the axis but an empty series.
 * - `widget-legacy-analytics-unrenderable` (#1878/#1894) — a widget uses the
 *   removed pre-ADR-0021 inline-analytics shape (`categoryField`/`rowField`/…)
 *   as its ONLY data wiring: no `dataset`, no `object`, no inline `data`. The
 *   renderer reads only the dataset path, so the widget has no data at all and
 *   renders nothing. Errored (not warned) so this class of authoring mistake —
 *   very often an AI emitting a removed shape — fails the build instead of
 *   shipping a blank widget past human review.
 *
 * Advisory rules — severity `warning`, build stays green:
 *
 * - `chart-config-missing` — a chart-type widget (bar/line/pie/…) has no
 *   `chartConfig`, so the renderer cannot tell which measure to plot.
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
export const TABLE_COUNT_ONLY = 'table-count-only';
export const MEASURE_AGGREGATE_INCOHERENT = 'measure-aggregate-incoherent';
export const WIDGET_LEGACY_ANALYTICS_SHAPE = 'widget-legacy-analytics-shape';
export const WIDGET_LEGACY_ANALYTICS_UNRENDERABLE = 'widget-legacy-analytics-unrenderable';

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
 * Chart families whose renderer needs a `chartConfig` measure mapping.
 * Single-value types (metric/kpi/gauge/…) plot their lone value and tabular
 * types (table/pivot) render every column, so they are exempt.
 */
const CHART_TYPES = new Set([
  'bar', 'horizontal-bar', 'column',
  'line', 'area',
  'pie', 'donut', 'funnel',
  'scatter', 'treemap', 'sankey', 'radar',
]);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Nearest declared name for a typo'd/stale reference, or undefined when
 * nothing is close. Containment is checked first because the cutover's
 * canonical drift is base column → prefixed measure name (`amount` →
 * `sum_amount`), which is far in edit distance but obvious to a human.
 */
function didYouMean(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    let score: number;
    if (input.length >= 3 && (c.includes(input) || input.includes(c))) {
      score = Math.abs(c.length - input.length);
    } else {
      const d = levenshtein(input, c);
      if (d > Math.max(2, Math.floor(input.length / 3))) continue;
      score = 100 + d;
    }
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function suggest(input: string, candidates: Iterable<string>): string {
  const s = didYouMean(input, candidates);
  return s ? ` Did you mean "${s}"?` : '';
}

function list(names: Iterable<string>): string {
  const arr = [...names];
  return arr.length > 0 ? arr.join(', ') : '(none)';
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

    for (let j = 0; j < widgets.length; j++) {
      const w = widgets[j];
      const widgetId = typeof w.id === 'string' ? w.id : `(widget ${j})`;
      const where = `dashboard "${dashName}" › widget "${widgetId}"`;
      const path = `dashboards[${i}].widgets[${j}]`;
      const suppressed = (rule: string): boolean =>
        Array.isArray(w.suppressWarnings) && w.suppressWarnings.includes(rule);
      const push = (f: Omit<WidgetBindingFinding, 'where' | 'path'>): void => {
        if (f.severity === 'warning' && suppressed(f.rule)) return;
        findings.push({ ...f, where, path });
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
            `Declared datasets: ${list(datasets.keys())}.${suggest(dsName, datasets.keys())} ` +
            `Define the dataset with defineDataset() or fix the reference (ADR-0021).`,
        });
      }
      // Without a resolved dataset there is nothing to check names against.
      if (!dataset) continue;

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
            `Widgets select dataset dimensions BY NAME.${suggest(dims[k], dimensionNames)} ` +
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
            `${suggest(values[k], measures.keys())} ` +
            `Add the measure to the dataset or fix the reference.`,
        });
      }

      // ── (d) chartConfig bindings resolve against the widget's selection ──
      const chartConfig = (w.chartConfig && typeof w.chartConfig === 'object')
        ? (w.chartConfig as AnyRec)
        : undefined;
      const isChartType = typeof w.type === 'string' && CHART_TYPES.has(w.type);

      if (chartConfig) {
        // The query result carries the widget's selected dimensions and
        // measures; resolve every chartConfig field against that shape.
        const selectedValues = new Set(values.filter((v) => measures.has(v)));

        const xAxis = (chartConfig.xAxis && typeof chartConfig.xAxis === 'object')
          ? (chartConfig.xAxis as AnyRec)
          : undefined;
        // A field naming an entry of the widget's own (already-validated)
        // selection is not re-reported here — rules (b)/(c) own that error.
        if (xAxis && typeof xAxis.field === 'string'
            && !dimensionNames.has(xAxis.field) && !dims.includes(xAxis.field)) {
          push({
            severity: 'error',
            rule: CHART_FIELD_UNKNOWN,
            message:
              `chartConfig.xAxis.field "${xAxis.field}" does not resolve to a ` +
              `dimension of dataset "${dsName}" (declared dimensions: ${list(dimensionNames)}).`,
            hint: `Point xAxis.field at a dataset dimension name.${suggest(xAxis.field, dimensionNames)}`,
          });
        }

        const measureField = (label: string, field: string): void => {
          if (values.includes(field)) return; // resolvable, or already errored via rule (c)
          const declaredButUnselected = measures.has(field);
          push({
            severity: 'error',
            rule: CHART_FIELD_UNKNOWN,
            message: declaredButUnselected
              ? `chartConfig.${label} "${field}" is a measure of dataset "${dsName}" ` +
                `but is not selected in the widget's values (${list(values)}), so the ` +
                `query result will not contain it.`
              : `chartConfig.${label} "${field}" does not resolve to a measure of ` +
                `dataset "${dsName}" (declared measures: ${list(measures.keys())}).`,
            hint: declaredButUnselected
              ? `Add "${field}" to the widget's values, or bind the chart to a selected measure.`
              : `Post-cutover data is keyed by the dataset's measure NAME, not the ` +
                `base column.${suggest(field, selectedValues.size > 0 ? selectedValues : measures.keys())}`,
          });
        };

        const yAxes = Array.isArray(chartConfig.yAxis) ? (chartConfig.yAxis as AnyRec[]) : [];
        for (let k = 0; k < yAxes.length; k++) {
          const field = yAxes[k]?.field;
          if (typeof field === 'string') measureField(`yAxis[${k}].field`, field);
        }
        const series = Array.isArray(chartConfig.series) ? (chartConfig.series as AnyRec[]) : [];
        for (let k = 0; k < series.length; k++) {
          const name = series[k]?.name;
          if (typeof name === 'string') measureField(`series[${k}].name`, name);
        }
      } else if (isChartType) {
        push({
          severity: 'warning',
          rule: CHART_CONFIG_MISSING,
          message:
            `chart-type widget ('${w.type}') has no chartConfig — the renderer ` +
            `cannot determine which measure to plot, so the series renders empty.`,
          hint:
            `Add chartConfig with xAxis.field set to a dimension (${list(dims)}) and ` +
            `yAxis[].field set to a measure name (${list(values)}). If the default ` +
            `rendering is intentional, suppress with: suppressWarnings: ['${CHART_CONFIG_MISSING}']`,
        });
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
