// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The report builder's model (objectstack#36374): the pure reads and writes
 * behind the five settings on the builder's right — report type, data source,
 * measure, grouping, chart — over a dataset-bound `ReportSchema`
 * (ADR-0021 single-form).
 *
 * Everything the builder writes is the spec's own vocabulary, so a report the
 * builder saves is a report the Studio inspector, the renderer and the lint
 * rules already read:
 *
 * - the data source is `dataset` (an existing dataset — the builder never
 *   creates or edits one);
 * - the measure is `values[0]`, a measure the BOUND DATASET declares. A report
 *   cannot aggregate a raw field itself: a "field + function" pick would be a
 *   new dataset measure, which is an edit of the dataset, not of the report;
 * - the grouping is `rows` (one dimension, plus an optional second layer);
 * - the chart is `chart` — `type`, `xAxis` = the first grouping, `yAxis` = the
 *   measure, `seriesBy` = the second layer where the chart can split. The
 *   「表格」 choice is `chart.type: 'table'`, which the renderer draws as the
 *   report's own table and no duplicate chart (`planReportChart`);
 * - the period chip is `dateRange` with a date dimension the report groups by.
 *
 * No function here reads the network: the host hands in the dataset catalog
 * and the bound dataset's members, so the builder is drawable in a test and in
 * any host (the report page's Edit, and the new-report page).
 *
 * @module
 */

/** One dataset the data-source picker offers. */
export interface ReportBuilderDataset {
  name: string;
  /** The author's label in the viewer's language; the name is shown when absent. */
  label?: string;
  description?: string;
}

/** One measure of the bound dataset. */
export interface ReportBuilderMeasure {
  name: string;
  label?: string;
  /** `count` / `sum` / … — how the default measure is chosen and a display hint. */
  aggregate?: string;
}

/** One dimension of the bound dataset. */
export interface ReportBuilderDimension {
  name: string;
  label?: string;
  /** The dimension's field type; `date` / `datetime` turn on the period chip. */
  type?: string;
}

/** The bound dataset's members, as the host read them. */
export interface ReportBuilderMembers {
  measures: ReportBuilderMeasure[];
  dimensions: ReportBuilderDimension[];
}

/** The five chart choices the builder offers, in the order it offers them. */
export const REPORT_BUILDER_CHART_TYPES = ['bar', 'line', 'donut', 'metric', 'table'] as const;
export type ReportBuilderChartType = (typeof REPORT_BUILDER_CHART_TYPES)[number];

/** The chart types that plot a category axis, so they need a grouping. */
const NEEDS_GROUPING: ReadonlySet<string> = new Set(['bar', 'line', 'donut']);
/**
 * The chart types that take a second-layer split (`chart.seriesBy`). A donut
 * is one series by nature, and the spec refuses `seriesBy` on it
 * (`SINGLE_SERIES_CHART_TYPES`, `checkReportChartSeriesSplit`).
 */
const SPLITS_SERIES: ReadonlySet<string> = new Set(['bar', 'line']);
/** The chart types a target line is drawn on (`chart.annotations`, a y-axis line). */
const TAKES_TARGET_LINE: ReadonlySet<string> = new Set(['bar', 'line']);
/** Dimension types the period chip can window by. */
const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

/**
 * The period a report opens on when the builder adds the chip. `this_year`
 * keeps the first picture close to "everything recent" without drawing an
 * unbounded window; the viewer picks another preset on the chip.
 */
export const REPORT_BUILDER_DEFAULT_RANGE = 'this_year';

/** A report document, as the builder edits it: flat, every key optional. */
export type ReportDraft = Record<string, unknown>;

/** Which of the five sections a missing piece belongs to. */
export type ReportBuilderSection = 'type' | 'source' | 'measure' | 'grouping' | 'chart';

/** The piece the report still lacks before it can draw, and where it is set. */
export interface ReportBuilderMissing {
  section: ReportBuilderSection;
  /** The i18n key under `report.builder.missing.*`. */
  reason: 'source' | 'noMeasures' | 'measure' | 'grouping';
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

function chartOf(report: ReportDraft): Record<string, unknown> | undefined {
  const chart = report.chart;
  return chart && typeof chart === 'object' && !Array.isArray(chart) ? (chart as Record<string, unknown>) : undefined;
}

/** The dataset the report binds, or `''`. */
export function boundDataset(report: ReportDraft): string {
  return typeof report.dataset === 'string' ? report.dataset : '';
}

/** The measure the builder shows: the chart's, else the report's first value. */
export function selectedMeasure(report: ReportDraft): string {
  const yAxis = chartOf(report)?.yAxis;
  if (typeof yAxis === 'string' && yAxis) return yAxis;
  return names(report.values)[0] ?? '';
}

/** The grouping the builder shows: `rows[0]` and the optional second layer `rows[1]`. */
export function selectedGrouping(report: ReportDraft): { first: string; second: string } {
  const rows = names(report.rows);
  return { first: rows[0] ?? '', second: rows[1] ?? '' };
}

/**
 * The chart choice the builder shows. A report with no chart draws its table,
 * which is the 「表格」 choice; any other stored type is shown as itself.
 */
export function selectedChartType(report: ReportDraft): string {
  const type = chartOf(report)?.type;
  return typeof type === 'string' && type ? type : 'table';
}

/** The measure a freshly picked dataset starts on: its count measure, else its first. */
export function defaultMeasure(members: ReportBuilderMembers | undefined): string {
  const measures = members?.measures ?? [];
  const count = measures.find((m) => m.aggregate === 'count');
  return (count ?? measures[0])?.name ?? '';
}

/** Whether the dimension `name` is a date the period chip can window by. */
export function isDateDimension(members: ReportBuilderMembers | undefined, name: string): boolean {
  const dim = members?.dimensions.find((d) => d.name === name);
  return !!dim?.type && DATE_TYPES.has(dim.type);
}

/**
 * Rebuild `chart` (and `dateRange`) from the report's selection. Called after
 * every edit, so the chart can never point at a measure or dimension the
 * report no longer selects. Authored chart chrome (`showDataLabels`,
 * `annotations`, `title`, …) is kept.
 */
function reconcile(report: ReportDraft, members: ReportBuilderMembers | undefined, chartType: string): ReportDraft {
  const out: ReportDraft = { ...report };
  const measure = names(out.values)[0] ?? '';
  const { first, second } = selectedGrouping(out);

  if (chartType === 'table') {
    delete out.chart;
  } else {
    const prev = chartOf(report) ?? {};
    const chart: Record<string, unknown> = { ...prev, type: chartType, xAxis: first, yAxis: measure };
    if (second && SPLITS_SERIES.has(chartType)) chart.seriesBy = second;
    else delete chart.seriesBy;
    if (!TAKES_TARGET_LINE.has(chartType)) delete chart.annotations;
    out.chart = chart;
  }

  // The period chip follows a date grouping: added when the report groups by a
  // date and declares no period, removed when the date it named is no longer
  // grouped. A period on a dimension the report never grouped by is the
  // author's own and is left as it is.
  const rows = names(out.rows);
  const dateRow = rows.find((r) => isDateDimension(members, r));
  const declared = out.dateRange && typeof out.dateRange === 'object' ? (out.dateRange as Record<string, unknown>) : undefined;
  if (!declared && dateRow) {
    out.dateRange = { dimension: dateRow, defaultRange: REPORT_BUILDER_DEFAULT_RANGE };
  } else if (declared && typeof declared.dimension === 'string' && !rows.includes(declared.dimension)) {
    const wasGrouped = names(report.rows).includes(declared.dimension);
    if (wasGrouped) {
      if (dateRow) out.dateRange = { ...declared, dimension: dateRow };
      else delete out.dateRange;
    }
  }
  return out;
}

/**
 * Bind the report to `dataset`. Switching datasets clears every member the old
 * one named and starts on the builder's defaults: the dataset's count measure,
 * no grouping, and a single number — so a picture is drawn at once.
 */
export function pickDataset(
  report: ReportDraft,
  dataset: string,
  members: ReportBuilderMembers | undefined,
): ReportDraft {
  if (dataset === boundDataset(report)) return report;
  const out: ReportDraft = { ...report, dataset };
  if (typeof out.type !== 'string' || out.type === 'joined') out.type = 'summary';
  delete out.rows;
  delete out.columns;
  delete out.order;
  delete out.runtimeFilter;
  delete out.dateRange;
  delete out.chart;
  const measure = defaultMeasure(members);
  if (measure) out.values = [measure];
  else delete out.values;
  return reconcile(out, members, 'metric');
}

/**
 * The defaults a dataset picked before its members arrived still owes: once
 * the host has read the members, the report gets its default measure. A
 * report that already selects one is returned unchanged.
 */
export function fillDefaults(report: ReportDraft, members: ReportBuilderMembers | undefined): ReportDraft {
  if (!boundDataset(report) || !members || names(report.values).length > 0) return report;
  const measure = defaultMeasure(members);
  if (!measure) return report;
  // A report with no chart yet starts on the single number, as `pickDataset` does.
  return reconcile({ ...report, values: [measure] }, members, chartOf(report) ? selectedChartType(report) : 'metric');
}

/** Select `measure` as the report's measure (the one it charts). */
export function pickMeasure(report: ReportDraft, measure: string, members: ReportBuilderMembers | undefined): ReportDraft {
  // The measure replaces the FIRST value; further values the author selected
  // (a summary table may show several) stay after it.
  const rest = names(report.values).slice(1).filter((v) => v !== measure);
  const out: ReportDraft = { ...report, values: measure ? [measure, ...rest] : rest };
  if (Array.isArray(out.order)) {
    const keep = new Set([...names(out.values), ...names(out.rows), ...names(out.columns)]);
    out.order = (out.order as Array<{ by?: unknown }>).filter((o) => typeof o?.by === 'string' && keep.has(o.by));
  }
  return reconcile(out, members, selectedChartType(report));
}

/**
 * Group the report by `first` (and the optional second layer `second`). A
 * single number has nothing to group, so grouping one turns it into a bar
 * chart; clearing the grouping of a chart that needs one turns it back into a
 * number.
 */
export function pickGrouping(
  report: ReportDraft,
  first: string,
  second: string,
  members: ReportBuilderMembers | undefined,
): ReportDraft {
  const rows = [first, second].filter((r, i, all) => r && all.indexOf(r) === i);
  const out: ReportDraft = { ...report };
  if (rows.length > 0) out.rows = rows;
  else delete out.rows;
  if (Array.isArray(out.order)) {
    const keep = new Set([...names(out.values), ...rows, ...names(out.columns)]);
    out.order = (out.order as Array<{ by?: unknown }>).filter((o) => typeof o?.by === 'string' && keep.has(o.by));
  }
  let chartType = selectedChartType(report);
  if (rows.length > 0 && chartType === 'metric') chartType = 'bar';
  if (rows.length === 0 && NEEDS_GROUPING.has(chartType)) chartType = 'metric';
  return reconcile(out, members, chartType);
}

/** Draw the report as `chartType`. */
export function pickChartType(report: ReportDraft, chartType: string, members: ReportBuilderMembers | undefined): ReportDraft {
  return reconcile(report, members, chartType);
}

/** Turn the chart's data labels (「显示数值」) on or off. */
export function setShowValues(report: ReportDraft, on: boolean): ReportDraft {
  const chart = chartOf(report);
  if (!chart) return report;
  const next = { ...chart };
  if (on) next.showDataLabels = true;
  else delete next.showDataLabels;
  return { ...report, chart: next };
}

/** The target line's value, when the chart draws one. */
export function targetLine(report: ReportDraft): number | undefined {
  const annotations = chartOf(report)?.annotations;
  if (!Array.isArray(annotations)) return undefined;
  const line = annotations.find(
    (a) => a && typeof a === 'object' && (a.type ?? 'line') === 'line' && (a.axis ?? 'y') === 'y',
  ) as { value?: unknown } | undefined;
  return typeof line?.value === 'number' ? line.value : undefined;
}

/**
 * Set or clear the chart's target line: one y-axis `line` annotation. Other
 * annotations the author wrote are kept.
 */
export function setTargetLine(report: ReportDraft, value: number | undefined, label?: string): ReportDraft {
  const chart = chartOf(report);
  if (!chart) return report;
  const others = (Array.isArray(chart.annotations) ? chart.annotations : []).filter(
    (a: any) => !(a && typeof a === 'object' && (a.type ?? 'line') === 'line' && (a.axis ?? 'y') === 'y'),
  );
  const annotations = value === undefined || !Number.isFinite(value)
    ? others
    : [...others, { type: 'line', axis: 'y', value, ...(label ? { label } : {}) }];
  const next = { ...chart };
  if (annotations.length > 0) next.annotations = annotations;
  else delete next.annotations;
  return { ...report, chart: next };
}

/** Whether the chart in `report` takes a second-layer split. */
export function chartSplits(chartType: string): boolean {
  return SPLITS_SERIES.has(chartType);
}

/** Whether the chart in `report` takes a target line. */
export function chartTakesTargetLine(chartType: string): boolean {
  return TAKES_TARGET_LINE.has(chartType);
}

/**
 * The first piece the report still lacks before it can draw, in the order the
 * five sections stand, or `null` when it can draw. The builder writes the
 * reason where the chart would be and opens that section's picker.
 *
 * `members` undefined means "not read yet": a missing piece that depends on
 * them is not claimed until they arrive.
 */
export function missingPiece(report: ReportDraft, members: ReportBuilderMembers | undefined): ReportBuilderMissing | null {
  if (!boundDataset(report)) return { section: 'source', reason: 'source' };
  if (!members) return null;
  if (members.measures.length === 0) return { section: 'source', reason: 'noMeasures' };
  if (!selectedMeasure(report)) return { section: 'measure', reason: 'measure' };
  if (NEEDS_GROUPING.has(selectedChartType(report)) && !selectedGrouping(report).first) {
    return { section: 'grouping', reason: 'grouping' };
  }
  return null;
}
