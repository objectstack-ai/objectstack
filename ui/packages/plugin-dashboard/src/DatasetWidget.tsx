// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasetWidget — renders a dashboard widget that binds to a semantic-layer
 * `dataset` (ADR-0021) instead of an inline `object` + `valueField` query.
 *
 * It selects the dataset's dimensions/measures BY NAME and runs them through
 * `dataSource.queryDataset` — the same governed path the dataset preview and
 * dataset-bound reports use — so the numbers match everywhere.
 *
 * Rendering dispatch (by `widget.type`):
 *  - metric / kpi / gauge / solid-gauge / bullet → KPI value with the
 *    measure's display label + format. So does a widget of any other type that
 *    declares no dimensions, UNLESS it carries two or more measures and is a
 *    table / pivot or a chart of the bar family (bar / column / horizontal-bar)
 *    or line / area / combo (objectui#11261, objectui#8894): those render every
 *    measure — one row of them, or one mark per measure with the measures'
 *    labels on the category axis.
 *  - table / pivot → a grouped table of `dimensions` + `values`. Rows drill
 *    through to the underlying records (ADR-0021 D2) when the server returns the
 *    dataset's `object` + dimension→field mapping.
 *  - bar / column / horizontal-bar / line / area / pie / donut / funnel /
 *    scatter / radar / treemap / sankey → the shared advanced `chart` renderer
 *    with its TRUE chart type and one series per measure (a pie / donut /
 *    funnel / treemap / sankey draws the first of them, and the dropped-measure
 *    diagnostic says so, objectui#11417). A type the renderer can't draw maps
 *    to its closest family (never a silent blank bar).
 *
 * Errors surface instead of silently showing wrong/empty numbers.
 *
 * Field access goes through `as any` because the bundled `@object-ui/types`
 * `DashboardWidgetSchema` only gains `dataset`/`dimensions`/`values` once
 * objectui bumps its `@objectstack/spec` dependency (cross-repo spec skew).
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
// `useDatasetDimensionMeta` is the analytics label net's SHARED React glue
// (objectui#4389): the locale-free metadata read this widget and the dataset
// report block both take, lifted out of the two longhand copies PR #4388 left
// behind. It lives in `@object-ui/react` because it reads the host context —
// see its file header for the measured dependency direction. This widget
// layers its CHART-ONLY colour/order derivation on top, below.
import { SchemaRenderer, useDatasetDimensionMeta, useDataInvalidation, classifyLoadError } from '@object-ui/react';
import {
  buildChartSeries,
  buildOptionColorMap,
  buildCategoryOrder,
  buildCategoryRank,
  relabelDimensions,
  localizeFieldOptions,
  deriveDimensionLabelMaps,
  dimensionOptionTranslator,
  findChartSeriesRow,
  formatMeasure,
  formatDimensionValue,
  buildDatasetFieldHelpers,
  buildDatasetDrillFilter,
  FilterOperatorError,
  // The pivot key encoders now live in `@object-ui/core` so this widget and the
  // report renderer's cross-tab share ONE implementation — each having written
  // its own is why the same collision had to be fixed twice (objectstack#5473,
  // objectstack#5665). Imported under the shared name because BOTH of this
  // widget's axes now use it: the across axis used to spell its single-value id
  // as a bare string, which was a second encoding of the same kind of id and
  // carried the placeholder collision on its own (objectui#4056).
  pivotBucketId,
  pivotDimensionValue,
  pivotCellKey,
  // Which chart families ignore `compareTo` — ONE declaration, read by the
  // inline chart path too (objectui#7495). See `compareTo` below.
  chartTypeIgnoresCompareTo,
  // The authored half of the same split — moved to core beside `buildChartSeries`
  // so this widget and the report's embedded chart lower one vocabulary once
  // (objectui#4877). Re-exported below under its original name.
  chartConfigPresentation,
  // The console's ONE client-side sort primitive (objectui#3096). The flat
  // dataset table below sorts through it rather than inlining `a < b`, so a
  // dashboard table and a list view order the same values identically — and
  // so the relational/blank/numeric cases it already settles are not decided a
  // second time here.
  getSortValue,
  compareSortValues,
  type ChartSegmentClickEvent,
  type CompareToConfig,
  type DatasetResultField,
  type DatasetDrillRange,
} from '@object-ui/core';
import { cn, Skeleton, ChartSkeleton, GridSkeleton, RefreshIndicator } from '@object-ui/components';
import { builtinAggregateLabels, useSafeFieldLabel, useSafeTranslate, useDisplayLocale } from '@object-ui/i18n';
import { AlertTriangle, ShieldAlert, Download, ArrowUpIcon, ArrowDownIcon, MinusIcon, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
// objectui#7063 — the default empty state is stated ONCE for the dashboard
// surface (see that component's header for why it is dashboard-local).
import { WidgetEmptyState } from './WidgetEmptyState';
import { useFilterScope } from '@object-ui/react';
import { resolveFilterPlaceholders, computeMetricDelta, formatMetricDeltaPercent } from './utils';
import { metricAccentTextClass } from './colorVariants';
import {
  METRIC_TILE_CONTAINER_CLASS,
  METRIC_TILE_TITLE_CLASS,
  METRIC_TILE_MEASURE_LABEL_CLASS,
  METRIC_TILE_VALUE_CLASS,
  metricTileTooltip,
} from './metricTile';
import { DrillDownDrawer } from './DrillDownDrawer';
import { specDefaultWidgetType } from './widgetDispatch';
import { DASHBOARD_WIDGET_MULTI_MEASURE_TYPES } from '@objectstack/spec/ui';

type Row = Record<string, unknown>;
// One RESULT-side totals grouping (the response's `totals[]`), named apart from
// `@objectstack/spec/api`'s `DatasetTotals`, which since 17.5.0 is the REQUEST side
// (`{ groupings }`, what to compute) — objectui#11073.
interface DatasetResultTotals { dimensions: string[]; rows: Row[] }
interface DatasetResult { rows: Row[]; fields?: DatasetResultField[]; object?: string; dimensionFields?: Record<string, string>; drillRawRows?: Row[]; drillRanges?: Array<Record<string, DatasetDrillRange>>; totals?: DatasetResultTotals[] }
interface DatasetCapableSource {
  queryDataset?: (dataset: string, selection: unknown) => Promise<DatasetResult>;
}

/**
 * Build the record-list filter for a drilled row. Re-exported for back-compat;
 * the implementation now lives in `@object-ui/core` (`buildDatasetDrillFilter`)
 * so the dashboard and the report renderer drill identically.
 */
export const buildDrillFilter = buildDatasetDrillFilter;

/**
 * The pivot key encoders, re-exported for back-compat; the implementations now
 * live in `@object-ui/core` (`pivotBucketId` / `pivotCellKey`) so this widget
 * and the report renderer's cross-tab key their buckets identically. See that
 * module for why both are `JSON.stringify` rather than a delimiter character,
 * and why an empty value encodes as JSON `null` rather than a placeholder
 * string (objectui#4056).
 *
 * Every consumer of a bucket id — the cell index below, the row-total lookup
 * AND the column-total lookup in the cross-tab renderer — must build its key
 * with these, over values normalized by `pivotDimensionValue`; a second,
 * hand-rolled encoding of the same id is what made the old bug invisible.
 *
 * `pivotRowId` is the historical name of the axis-neutral encoder, kept as an
 * alias so this package's published surface does not change.
 */
const pivotRowId = pivotBucketId;
export { pivotRowId, pivotCellKey };

/**
 * Pivot flat dataset rows into a cross-tab: `rowDims` go DOWN, `colDim` spreads
 * ACROSS. Returns ordered row/column headers (display labels from the rows) and
 * a map from a `pivotCellKey(rowId, colId)` cell key to the FLAT row index
 * holding that combination's measure values. No re-aggregation — the dataset
 * already grouped by every dimension, so each cell maps to exactly one row (the
 * index is also what drill-through uses to read `drillRawRows`).
 *
 * `locale` is the display-locale tag the header LABELS are formatted in
 * (objectui#4566) — this is a plain exported function, not a component, so it
 * cannot read `useDisplayLocale()` itself. It affects `rowHeaders`/`colHeaders`
 * only; the `id`s are opaque keys built by `pivotBucketId` from the RAW values
 * and are deliberately untouched by it, so a locale change can never re-key a
 * cell (which would break the `cellIndex` lookup and drill-through with it).
 */
export function buildPivot(
  rows: Array<Record<string, unknown>>,
  rowDims: string[],
  colDim: string,
  locale?: string,
): {
  rowHeaders: Array<{ id: string; labels: string[] }>;
  colHeaders: Array<{ id: string; label: string }>;
  cellIndex: Map<string, number>;
} {
  const rowHeaders: Array<{ id: string; labels: string[] }> = [];
  const colHeaders: Array<{ id: string; label: string }> = [];
  const rowSeen = new Set<string>();
  const colSeen = new Set<string>();
  const cellIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    // Both ids are opaque lookup keys, never displayed — the visible text comes
    // from `labels`/`label` via formatDimensionValue. BOTH go through the shared
    // encoder, over values normalized by `pivotDimensionValue`. The column id
    // used to be the bare value on the reasoning that a single value needs no
    // boundary; that is true of the boundary and false of everything else the
    // encoder does, and it left the across axis on its own encoding — which then
    // carried the null-placeholder collision independently (objectui#4056). A
    // one-element tuple costs nothing and keeps one encoding for one kind of id.
    const rid = pivotBucketId(rowDims.map((d) => pivotDimensionValue(row[d])));
    const cid = pivotBucketId([pivotDimensionValue(row[colDim])]);
    if (!rowSeen.has(rid)) { rowSeen.add(rid); rowHeaders.push({ id: rid, labels: rowDims.map((d) => formatDimensionValue(row[d], locale)) }); }
    if (!colSeen.has(cid)) { colSeen.add(cid); colHeaders.push({ id: cid, label: formatDimensionValue(row[colDim], locale) }); }
    cellIndex.set(pivotCellKey(rid, cid), index);
  });
  return { rowHeaders, colHeaders, cellIndex };
}

/** RFC4180-ish CSV cell: quote when it contains a comma, quote, or newline. */
function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const str = String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Serialize a 2D array (first row = headers) to CSV text. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Trigger a client-side CSV download (no-op outside the browser). A UTF-8 BOM
 *  is prepended so Excel opens non-ASCII labels (e.g. Chinese) correctly. */
function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  if (typeof document === 'undefined') return;
  const base = filename && filename.trim() ? filename.trim() : 'export';
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = base.endsWith('.csv') ? base : `${base}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Column the executor attaches a comparison window's value under. */
const COMPARE_SUFFIX = '__compare';
const compareColumn = (measure: string) => `${measure}${COMPARE_SUFFIX}`;

/**
 * English fallbacks for the `dashboard.trend.*` keys — the SAME vocabulary the
 * inline `MetricWidget` / `ObjectMetricWidget` label their trend with, so a
 * dataset-bound and an inline KPI comparing the same window read identically.
 * No new key is introduced here.
 */
const TREND_LABEL_DEFAULTS: Record<string, string> = {
  vsLastQuarter: 'vs last quarter',
  vsLastMonth: 'vs last month',
  vsLastWeek: 'vs last week',
  vsLastYear: 'vs last year',
  vsYesterday: 'vs yesterday',
  vsPreviousPeriod: 'vs previous period',
};

/**
 * The `dashboard.trend.*` key a comparison is labelled with on THIS path, read
 * off `compareTo.kind` alone (objectui#11632).
 *
 * The dataset executor decides the comparison window from the kind: for
 * `previousPeriod` it is the equal-length window immediately before the
 * resolved one, and for `previousYear` the same window one calendar year back
 * (`DatasetCompareTo` in `@objectstack/spec`). So each kind's label holds for
 * every window it is applied to. "vs previous period" is true of a 30-day
 * window and of a quarter alike.
 *
 * ⛔ Not `compareToTrendLabelKey` from `@object-ui/core`. That helper guesses
 * the window from the RAW filter's date-macro tokens (`{today}` reads
 * "vs yesterday"). The guess is faithful on the inline path, where
 * `shiftFilterByCompareTo` really does swap `{today}` for `{yesterday}`. Here
 * no token is swapped, because the executor shifts the whole resolved window.
 * A dashboard date range of `last_30_days` (`{30_days_ago}` to `{today}`)
 * compared the previous 30 days and was labelled "vs yesterday".
 *
 * Both keys already exist (`TREND_LABEL_DEFAULTS` above), so a dataset-bound
 * and an inline KPI comparing one year back still read the same. `satisfies`
 * makes a third kind added to `CompareToConfig` a compile error here instead
 * of a comparison with no label of its own.
 */
const COMPARE_KIND_TREND_KEY = {
  previousPeriod: 'vsPreviousPeriod',
  previousYear: 'vsLastYear',
} as const satisfies Record<CompareToConfig['kind'], string>;

/**
 * ISO calendar date, optionally carrying a time part — `2026-01-15`,
 * `2026-01-15T08:30:00Z`. Deliberately narrower than `Date.parse` (which also
 * accepts `2026` and `March 5, 2026`); the same shape the dashboard filter
 * layer already holds date values to (`core/utils/dashboard-filters.ts`).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A `DatasetSelection.timeDimensions` entry stating a bounded window. */
export interface DatasetTimeWindow {
  dimension: string;
  dateRange: [string, string];
}

/**
 * A **bounded, closed** date window, or null. Exactly `{ $gte, $lte }` with two
 * ISO-date bounds qualifies, and nothing else:
 *
 *  - `{ $gte: 1000 }` on an amount is a numeric range, not a window;
 *  - `$gt` / `$lt` are EXCLUSIVE, and `dateRange` has no exclusive bound —
 *    converting one would silently widen the window by a day;
 *  - a half-open `{ $gte }` alone has no end to shift. A period-over-period
 *    comparison is only defined against a bounded window, so leaving it in the
 *    filter is what makes the executor say so out loud.
 */
function boundedDateWindow(value: unknown): [string, string] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value as object);
  if (keys.length !== 2 || !keys.includes('$gte') || !keys.includes('$lte')) return null;
  const { $gte: from, $lte: to } = value as { $gte: unknown; $lte: unknown };
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) return null;
  return [from, to];
}

/**
 * Split a RESOLVED runtime filter into the bounded date windows it states and
 * the rest of the filter (objectui#3337 point 5).
 *
 * The executor shifts exactly one thing for a `compareTo`: a `timeDimensions`
 * entry carrying a `dateRange`. A widget states its window in its own `filter`
 * instead (a date macro, or the dashboard's date-range filter merged in by
 * `DashboardRenderer`), which is why forwarding a structured `compareTo` alone
 * still came back "compareTo needs a dated window to shift".
 *
 * Windows are **moved, not copied**: the comparison pass re-runs with the
 * shifted `timeDimensions` but the SAME `runtimeFilter`, so a copy left behind
 * would intersect the shifted window with the current one and every
 * `<measure>__compare` column would come back empty.
 *
 * Only CONJUNCTIVE positions are walked — the top level and `$and` members. A
 * window inside `$or` / `$not` is not a window the whole query runs in, so it
 * stays in the filter untouched.
 *
 * **Which dimension gets shifted is not decided here.** Every window found is
 * lowered under the name the author wrote. Zero of them, or two, is the
 * executor's error to raise — it names the candidates (`resolveCompareDimension`).
 * Guessing one renderer-side would trade a loud error for a quietly wrong
 * window, which is the failure class objectstack#5011 set out to end.
 */
export function extractDateWindows(filter: unknown): {
  windows: DatasetTimeWindow[];
  rest: Record<string, unknown> | undefined;
} {
  // Insertion-ordered so the lowered windows (and any executor message listing
  // them) are deterministic.
  const ranges = new Map<string, [string, string]>();

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const out: Record<string, unknown> = {};
    let conjuncts: Record<string, unknown>[] | null = null;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$and' && Array.isArray(value)) {
        conjuncts = value
          .map(walk)
          .filter(
            (c): c is Record<string, unknown> =>
              !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length > 0,
          );
        continue;
      }
      // Any other operator ($or, $not, …) is left whole, contents included.
      if (key.startsWith('$')) {
        out[key] = value;
        continue;
      }
      const range = boundedDateWindow(value);
      if (!range) {
        out[key] = value;
        continue;
      }
      const prev = ranges.get(key);
      // Two conjunctive windows on ONE dimension are their intersection — plain
      // arithmetic on the AND, not a heuristic. (The realistic pair: a widget
      // that dates its own filter under a dashboard date-range filter bound to
      // the same field.) Lexicographic comparison is chronological for ISO
      // dates, whose fixed-width prefix orders bare dates and timestamps alike.
      ranges.set(
        key,
        prev
          ? [prev[0] > range[0] ? prev[0] : range[0], prev[1] < range[1] ? prev[1] : range[1]]
          : range,
      );
    }
    if (conjuncts && conjuncts.length > 0) out.$and = conjuncts;
    return out;
  };

  const walked = walk(filter) as Record<string, unknown> | undefined;
  let rest = walked && Object.keys(walked).length > 0 ? walked : undefined;
  // `{ $and: [x] }` — a one-member conjunction left after its sibling was
  // lowered — is just `x`. Unwrapped only at the top level and only when it is
  // the sole key, so no sibling condition can be overwritten by the merge.
  const only = rest && Object.keys(rest).length === 1 && Array.isArray(rest.$and) && rest.$and.length === 1
    ? (rest.$and[0] as Record<string, unknown>)
    : undefined;
  if (only) rest = only;

  return {
    windows: Array.from(ranges, ([dimension, dateRange]) => ({ dimension, dateRange })),
    rest,
  };
}

/** Single-value KPI widget types — rendered as a number, not a chart. */
const METRIC_TYPES = new Set(['metric', 'kpi', 'gauge', 'solid-gauge', 'bullet']);

/**
 * The chart families that draw a DIMENSIONLESS widget's measures: one mark per
 * measure, the measures' labels on the category axis (objectui#11261).
 *
 * The spec's own list, imported, never restated (objectui#11334 placement
 * ruling 5925828806): `DASHBOARD_WIDGET_MULTI_MEASURE_TYPES` is the one list of
 * the types that render several measures with no dimension — `table` / `pivot`
 * and the chart families `bar` / `column` / `horizontal-bar` / `line` / `area` /
 * `combo` — and the spec's chart measure-arity check refuses two or more
 * measures on a dimensionless widget of any other type. It is read here off the
 * family a widget renders AS (`CHART_TYPE_MAP`), so a `stacked-bar` draws as a
 * `bar` does; `table` / `pivot` are no `CHART_TYPE_MAP` family, and take
 * `isTable` instead.
 *
 * `column` and `horizontal-bar` are the `bar` family drawn in another
 * orientation (objectui#8894, triage's answer on the card): `column` draws the
 * measures' labels along the bottom as `bar` does, and `horizontal-bar` runs
 * them down the left with one bar across per measure.
 *
 * A dimensionless widget of any other family (pie, donut, funnel, scatter,
 * radar, treemap, sankey) keeps the tile it always rendered: its display
 * semantics for several measures are not invented here, and since
 * `@objectstack/spec` 17.7.0 the spec refuses that shape at its door, which
 * objectui's door follows (objectui#11717). A stored widget from before that
 * refusal still says which measures it drops (see `renderedMeasures` in the
 * component).
 */
const MEASURE_AXIS_CHART_FAMILIES: ReadonlySet<string> = new Set(DASHBOARD_WIDGET_MULTI_MEASURE_TYPES);

/**
 * The chart families that draw ONE series, whatever the widget declares
 * (objectui#11417). The shared chart renderer (`AdvancedChartImpl` in
 * `@object-ui/plugin-charts`) binds `series[0]` on its `pie` / `donut`,
 * `funnel`, `treemap` and `sankey` arms and reads no other series there, so a
 * chart of one of these families WITH a dimension draws its first measure and
 * drops every other one, although this widget hands each measure on as a
 * series. (Without a dimension these families take the tile, `isMetric`.)
 *
 * Read off the family a widget renders AS (`CHART_TYPE_MAP`), so a `pyramid`
 * widget, which renders as a `funnel`, is in it too.
 *
 * Kept here, once, because the renderer has no declaration of it to read:
 * those arms are `chartType === …` branches, and the one set it does declare
 * (`SERIES_ONLY_CHART_TYPES`, the families that draw `series.map(…)` and
 * nothing else) is not this set's complement. Two families sit outside both:
 *  - `radar` draws every series;
 *  - `scatter` (and `bubble`, which renders as one) refuses a second series out
 *    loud, with a notice on the chart that names the series, so nothing is
 *    dropped in silence and this widget has nothing to add.
 * `DatasetWidget.singleSeriesMeasures-11417.test.tsx` ties this set to what
 * the renderer draws: for every chart type, a second measure's values either
 * change the drawn chart or this set names its family.
 *
 * Triage's ruling on objectui#11417 is that the spec refuses two or more
 * measures on these five types with a dimension too (objectstack#21293). Since
 * `@objectstack/spec` 17.7.0 the spec's door and objectui's refuse the shape
 * (objectui#11717); for a widget stored before that, the dropped-measure
 * diagnostic below is what says so.
 */
const SINGLE_SERIES_CHART_FAMILIES = new Set(['pie', 'donut', 'funnel', 'treemap', 'sankey']);

/**
 * The columns of a dimensionless chart's transposed rows (objectui#11261): the
 * measure a mark stands for, and that measure's value. A transposed row carries
 * these and nothing else, so no dataset measure name can collide with them.
 */
const MEASURE_CATEGORY_KEY = '__measure';
const MEASURE_VALUE_KEY = '__value';

/**
 * Where a select dimension's value sits in the order its field DECLARES its
 * options (objectui#11809), read off a `buildCategoryRank` map, which keys the
 * stored value and the display label alike: a declared option at its declared
 * position, then any value the options do not declare, then the empty bucket.
 * Callers sort STABLY on it, so undeclared values keep the dataset's order
 * among themselves, as the funnel keeps them.
 */
function declaredOptionPosition(value: unknown, rank: ReadonlyMap<string, number>, emptyLabel?: string): number {
  const declared = value == null ? undefined : rank.get(String(value));
  if (declared !== undefined) return declared;
  if (value == null || value === '' || (emptyLabel !== undefined && value === emptyLabel)) return Number.MAX_SAFE_INTEGER;
  return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * The name the dataset DECLARES for a chart's null bucket, or `undefined` when
 * it declares none (objectstack#25330). A dimension column whose dataset
 * dimension carries `nullLabel` (System Overview names its null user "System")
 * says so on its descriptor, `fields[].nullLabel`, already resolved to the
 * request's locale by the server, as its `label` is.
 *
 * `buildChartSeries` draws every null bucket of one chart under ONE label: the
 * x-axis dimension's, and on a pivot (two dimensions, one measure) the series
 * dimension's too. So a pivot takes a declared name only when both of its
 * dimensions declare the same one; any other pivot keeps the default rather
 * than naming one dimension's null group with the other's label.
 */
function declaredNullCategoryLabel(
  fields: readonly DatasetResultField[] | undefined,
  dimensions: readonly string[],
  measures: readonly string[],
): string | undefined {
  const nullLabelOf = (dimension: string | undefined) =>
    dimension === undefined ? undefined : fields?.find((f) => f.name === dimension)?.nullLabel;
  const xLabel = nullLabelOf(dimensions[0]);
  if (dimensions.length >= 2 && measures.length === 1) {
    return xLabel !== undefined && xLabel === nullLabelOf(dimensions[1]) ? xLabel : undefined;
  }
  return xLabel;
}

/**
 * Map a dashboard widget `type` to the advanced chart renderer's `chartType`.
 * Families the renderer doesn't draw distinctly fall back to their closest
 * relative (e.g. `spline`/`step-line` → line, `stacked-area` → area,
 * `pyramid` → funnel, grouped/stacked/bi-polar bars → bar) so a widget never
 * renders blank or as a misleading default.
 *
 * `combo` is NOT such a fallback: the renderer draws it distinctly (mixed
 * marks on a `ComposedChart`, a left and a right y-axis), and it is a
 * `ChartTypeSchema` member since spec 17.0.0-rc.1 — so it maps to ITSELF.
 * Until #4229 it had no entry at all and fell through the `?? 'bar'` default,
 * which is one of the two halves that made an authored combo render as grouped
 * bars. `widgetDispatch` already resolves a `combo` widget to
 * `chartType: 'combo'` (`SERIES_CHART_TYPES`), so this entry makes the two
 * surfaces agree.
 *
 * The other half of #4229, the per-series mark and axis binding merged from
 * `chartConfig.series` / `yAxis`, is gone with those keys (objectui#11315):
 * spec 17.5.0 refuses them on a dashboard widget. A `combo` widget still draws
 * as a combo; each series takes the renderer's own positional mark (the combo
 * arm of `AdvancedChartImpl` decides it) rather than an authored one.
 */
const CHART_TYPE_MAP: Record<string, string> = {
  bar: 'bar',
  column: 'column',
  'horizontal-bar': 'horizontal-bar',
  'grouped-bar': 'bar',
  'stacked-bar': 'bar',
  'bi-polar-bar': 'bar',
  line: 'line',
  spline: 'line',
  'step-line': 'line',
  area: 'area',
  'stacked-area': 'area',
  pie: 'pie',
  donut: 'donut',
  funnel: 'funnel',
  pyramid: 'funnel',
  scatter: 'scatter',
  bubble: 'scatter',
  radar: 'radar',
  treemap: 'treemap',
  sankey: 'sankey',
  combo: 'combo',
};

/**
 * The authored chart CHROME, which now lives in `@object-ui/core`'s
 * `chart-presentation` beside `buildChartSeries` — the derivation it is lowered
 * onto (objectui#4877).
 *
 * It was written here (#3135 → objectstack#7016 → #4229) and moved when the
 * report renderer's embedded chart turned out to need the SAME lowering over
 * the same spec keys, and a second copy of the split beside this one is
 * precisely the duplication objectui#4389 filed as a defect. The doctrine — the
 * two admission criteria, the data/presentation ruling, why `aria` stays
 * unforwarded — travelled with the code; see that module's header and
 * `chartConfigPresentation`'s docblock.
 *
 * Re-exported under its original name. The series/axis presentation merge
 * (`mergeAuthoredPresentation`) was re-exported here too until objectui#11315:
 * a dashboard widget's `chartConfig` no longer carries the `series` / `xAxis` /
 * `yAxis` it read (spec 17.5.0), so this widget stopped calling it, and
 * objectui#11372 then removed it from `@object-ui/core`.
 */
export { chartConfigPresentation } from '@object-ui/core';

/**
 * A dataset-bound widget: a metric tile, a table / pivot, or a chart, drawn
 * from one dataset query.
 *
 * ⛔ No sub-caption prop, and no read of a `description` key in the options
 * bag: the metric sub-caption is retired at both ends (objectui#11389, ruling
 * C, after objectstack's half in `@objectstack/spec` 17.7.0). A widget keeps
 * one authored description, `widget.description`, which the dashboard surface
 * draws as the card-header subtitle. If a caption under a metric's value
 * returns, it returns as a declared widget-level key outside the options bag,
 * never as a key inside it. The options census in `@object-ui/sdui-parser`
 * reads this file's text, comments included, which is why this note does not
 * spell the bag's member access.
 */
/**
 * [objectui#12528] The heading a dashboard surface hands a dataset-bound
 * metric tile instead of drawing its own card header: the widget's resolved
 * title, and its resolved description, which becomes the title's tooltip.
 */
export interface DatasetMetricHeading {
  title: string;
  description?: string;
}

/**
 * The heading line of a metric tile: the title alone (objectui#12623). It owns
 * the line, up to two lines; the measure label is drawn under the value, and
 * rides in this tooltip so a tile too narrow to draw it still carries it.
 */
function MetricHeadingRow({ heading, label }: { heading: DatasetMetricHeading; label?: string }) {
  return (
    <div className="flex w-full min-w-0" data-testid="dataset-metric-heading">
      {heading.title && (
        <span
          className={METRIC_TILE_TITLE_CLASS}
          title={metricTileTooltip(heading.title, heading.description, label)}
          data-testid="dataset-metric-title"
        >
          {heading.title}
        </span>
      )}
    </div>
  );
}

export function DatasetWidget({ widget, dataSource, heading }: { widget: any; dataSource: unknown; heading?: DatasetMetricHeading }) {
  const datasetName = String(widget?.dataset ?? '');
  const dimensions: string[] = useMemo(() => (Array.isArray(widget?.dimensions) ? widget.dimensions.filter(Boolean) : []), [widget]);
  const values: string[] = useMemo(() => (Array.isArray(widget?.values) ? widget.values.filter(Boolean) : []), [widget]);
  // An absent `type` is the spec's default, `metric` (objectui#11514, Q2 A),
  // as the two dashboard surfaces resolve it before they reach this widget.
  const widgetType = String(widget?.type ?? specDefaultWidgetType());
  const isTable = widgetType === 'table' || widgetType === 'pivot';
  // ── Which widgets are a one-number tile (objectui#11261) ─────────────────
  // By TYPE, only the metric family. By SHAPE, a widget that declares no
  // dimension, with one exception: two or more measures on a type the spec
  // states a dimensionless rendering for. A `table` / `pivot` renders one row
  // carrying every measure, and a chart of the bar family (`bar` / `column` /
  // `horizontal-bar`) or a `line` / `area` / `combo` one mark per measure
  // (`MEASURE_AXIS_CHART_FAMILIES`). Those used to become a tile as
  // well and render `values[0]` alone, although every door accepts them and
  // the spec's own refusal text sends authors there for "several numbers in
  // ONE widget".
  //
  // ONE measure and no dimension stays a tile on every type: nothing is
  // dropped there, and the tile is what it has always rendered. So does every
  // type the spec's text does not name, whatever its measure count — see
  // `MEASURE_AXIS_CHART_FAMILIES` for why.
  //
  // Read off `CHART_TYPE_MAP` directly, never through `chartType`'s `?? 'bar'`
  // default: that default belongs to a type the map does not name. A widget with
  // no `type` is already `metric` here (above), so it is a tile by type.
  const rendersEveryMeasureWithoutDimension =
    values.length > 1 && (isTable || MEASURE_AXIS_CHART_FAMILIES.has(CHART_TYPE_MAP[widgetType] ?? ''));
  const isMetric = METRIC_TYPES.has(widgetType) || (dimensions.length === 0 && !rendersEveryMeasureWithoutDimension);
  // The chart family a widget that reaches the chart branch below renders as —
  // `bubble` → `scatter`, `pyramid` → `funnel` (CHART_TYPE_MAP). Only meaningful
  // when neither `isMetric` nor `isTable` holds; resolved up here because what
  // the widget renders (just below) and the query (see `compareTo`) need it,
  // not only the chart branch.
  const chartType = CHART_TYPE_MAP[widgetType] ?? 'bar';
  // A chart of a single-series family draws its first measure only, with a
  // dimension too (`SINGLE_SERIES_CHART_FAMILIES`, objectui#11417). The chart
  // branch still hands every measure on as a series: what is drawn does not
  // change here, only what this widget says it renders.
  const drawsFirstMeasureOnly = !isMetric && !isTable && SINGLE_SERIES_CHART_FAMILIES.has(chartType);
  // ── What this widget RENDERS of what it declares (objectui#8894) ─────────
  // Settled here, by the branch decision just above, and read by both the tile
  // below and the dropped-measure diagnostic, so the two cannot disagree. A
  // tile shows ONE number, the first declared measure's, and a chart of a
  // single-series family draws the first declared measure's series. Every
  // other branch renders every declared measure: a table one column per
  // measure, a chart one series per measure, a dimensionless chart one mark
  // per measure.
  //
  // "Renders" is what reaches the screen. For a chart that is decided in the
  // shared chart renderer, which this widget hands every measure to as a
  // series; the one family of arms there that draws a single series is
  // stated here as `SINGLE_SERIES_CHART_FAMILIES`, with the pin that ties the
  // two named in its docblock.
  const renderedMeasures = isMetric || drawsFirstMeasureOnly ? values.slice(0, 1) : values;
  const droppedMeasures = values.filter((m) => !renderedMeasures.includes(m));
  // `widget.compareTo` IS the executor's contract since objectstack#5011 —
  // `{ kind, dimension? }`, the same `DatasetCompareTo` the selection carries —
  // so it forwards unchanged. It used to be a three-branch union whose two
  // string arms had no meaning downstream and were dropped right here; the
  // convergence deleted the arms instead of keeping the workaround, so there is
  // no longer a widget form this path has to quietly discard. A stale string
  // left in stored metadata is now INVALID metadata, rejected where it is
  // authored/published — not laundered here into a different query
  // (AGENTS.md #0.1).
  //
  // ⭐ Except on a CHART of a family that ignores `compareTo` (pie / donut /
  // funnel / scatter, and the `bubble` / `pyramid` widget types that render as
  // one) — `chartTypeIgnoresCompareTo`, the one declaration the inline chart
  // path reads too (objectui#7495). There the widget asks the executor for NO
  // comparison: no `compareTo` in the selection, no window lowered into
  // `timeDimensions`, so the comparison pass never runs and no overlay series is
  // appended. Before this, the dashboard carried its own narrower copy of the
  // list (scatter only), so a compare-to pie ran a comparison query whose
  // overlay the renderer then dropped. Gated on the CHART branch, not on the
  // widget type: a pie widget with no dimensions renders as a metric tile
  // (`isMetric`), which does show the comparison as a delta, so it keeps it.
  const compareTo: CompareToConfig | undefined =
    !isMetric && !isTable && chartTypeIgnoresCompareTo(chartType) ? undefined : widget?.compareTo;
  // pivot with ≥2 dims → a true cross-tab: last dim spreads across as columns,
  // the rest go down as rows. Computed up-front so the fetch can also request
  // the matching subtotal groupings.
  const isMatrix = widgetType === 'pivot' && dimensions.length >= 2;
  const rowDims = isMatrix ? dimensions.slice(0, -1) : [];
  const colDim = isMatrix ? dimensions[dimensions.length - 1] : '';

  // ── Query-affecting widget options (framework#3588) ──────────────────────
  // `options` is the renderer-extras bag, but four of its keys are NOT
  // presentation-only: they change the query the server compiles. They were
  // accepted by the metadata layer and then dropped here — this component never
  // read `options` at all — so `dateGranularity: 'month'` grouped by the raw
  // timestamp (one bar per record) and `sortBy` produced no ordering. Lower
  // them into the `DatasetSelection` the server already understands.
  const options: Record<string, unknown> =
    widget?.options && typeof widget.options === 'object' && !Array.isArray(widget.options)
      ? (widget.options as Record<string, unknown>)
      : {};
  const dateGranularity = typeof options.dateGranularity === 'string' ? options.dateGranularity : undefined;
  const sortBy = typeof options.sortBy === 'string' && options.sortBy ? options.sortBy : undefined;
  // Only order by something this widget actually projects — the server rejects
  // an order key it can't resolve, and a stale `sortBy` left behind by an edit
  // should degrade to "unordered", not fail the whole widget.
  const sortable = sortBy && (dimensions.includes(sortBy) || values.includes(sortBy)) ? sortBy : undefined;
  const order = sortable
    ? { [sortable]: options.sortOrder === 'desc' ? ('desc' as const) : ('asc' as const) }
    : undefined;
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : undefined;

  // ── Server-computed marginal totals ──────────────────────────────────────
  // The cross-tab asks for three groupings: row subtotals, column subtotals,
  // and the grand total (`[]`). The FLAT table asks for the grand total alone
  // and renders it as a `tfoot` (objectui#5846). Both are computed by the
  // server with the measure's TRUE aggregate over the underlying rows and are
  // never re-derived here — an avg/min/max cannot be recombined from the
  // bucketed values on screen, which is why this is a query-shape change and
  // not a rendering one.
  //
  // Measured cost of the flat table's one extra grouping (100k-row opportunity
  // table, real pipeline: compileDataset → AnalyticsService NativeSQL → SQLite):
  // ONE extra statement, `SELECT SUM(…), AVG(…) FROM t` — the same WHERE, no
  // GROUP BY — at 9.6ms beside the primary's 48.8ms, i.e. +20% on the widget's
  // query, holding at +19%/1M rows and +28%/10k. The cross-tab has shipped
  // THREE such groupings, ungated, since objectstack-ai/objectstack#1753; one is strictly less.
  //
  // NOT requested when `options.limit` truncates the table. The executor drops
  // `limit` for a totals query by design (a total covers the whole selection),
  // so a top-N table would print a grand total the reader cannot reconcile
  // against the rows in front of them — and "don't make the reader add it up"
  // is the whole point of the row. No request is issued in that case, so the
  // cost is not paid either.
  //
  // Nor for a DIMENSIONLESS table (objectui#11261). Its selection groups by
  // nothing, so the one row it answers already IS the `[]` grouping, and a
  // footer would print that row a second time.
  const wantsFlatTotals = isTable && !isMatrix && dimensions.length > 0 && limit == null;
  const totalsGroupings = isMatrix
    ? [rowDims, [colDim], []]
    : wantsFlatTotals
      ? [[] as string[]]
      : undefined;

  const tt = useSafeTranslate();
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  // The display locale every measure and dimension value below is formatted in
  // (objectui#4566). `formatMeasure` / `formatDimensionValue` are pure
  // functions in `@object-ui/core`, so the tag has to arrive as an argument —
  // this is the one place in this component allowed to read it. Nothing here
  // formats inside a `useMemo`, so unlike objectui#4542 / #4553 there is no
  // dependency array to add it to; the sites below are all in the render body
  // and re-run whenever the provider changes.
  const displayLocale = useDisplayLocale();

  // ADR-0021 dual-form: the widget's presentation-scope `filter` must flow into
  // the dataset query as `runtimeFilter`, or a dataset-bound widget renders the
  // UNFILTERED total (e.g. "open pipeline" showing the grand total). Resolve
  // placeholders client-side first — exactly as the legacy widget renderers do
  // (the server expands neither `{current_quarter_start}` nor
  // `{current_user_id}`). Keyed on the raw filter ref so the resolution is
  // stable across renders.
  //
  // Resolve BOTH vocabularies. This used to call `resolveDateMacros` alone, so
  // a user-scoped widget sent `{current_user_id}` to SQL as a literal, matched
  // no row, and rendered 0 with no error anywhere (objectstack-ai/objectstack#3574).
  const filterScope = useFilterScope();
  // The object-schema probe's host-authenticated fetch (objectui#4121) is no
  // longer read here: it moved INTO `useDatasetDimensionMeta` along with the
  // rest of the read, so the property is stated once for both surfaces instead
  // of once per surface (objectui#4389). The hook consults the context the same
  // way this widget did — directly, not via a throwing `useSchemaContext()` —
  // so a widget rendered outside a host still degrades to the global fetch.
  const rawFilter = widget?.filter;
  const runtimeFilter = useMemo(
    () => (rawFilter && typeof rawFilter === 'object' && Object.keys(rawFilter).length > 0
      ? resolveFilterPlaceholders(rawFilter, filterScope)
      : undefined),
    [rawFilter, filterScope],
  );

  // ── The comparison window (objectui#3337 point 5) ────────────────────────
  // Lower the widget's already-resolved date window into the one place the
  // executor can shift it — `selection.timeDimensions[].dateRange` — and only
  // when a comparison is actually asked for. Without a comparison the window
  // says exactly the same thing in `runtimeFilter`, and leaving every other
  // widget's query byte-identical keeps this change to the path it is about.
  // See `extractDateWindows` for why the windows are MOVED and why the choice
  // of dimension is left to the executor.
  const { windows: compareWindows, rest: selectionFilter } = useMemo(
    () => (compareTo
      ? extractDateWindows(runtimeFilter)
      : { windows: [] as DatasetTimeWindow[], rest: runtimeFilter }),
    [compareTo, runtimeFilter],
  );

  // `signature` is the query an `ok` answer was read for, and `refreshing` marks
  // a re-read of that same query in flight (objectui#10815, see the effect).
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; rows: Row[]; fields?: DatasetResultField[]; object?: string; dimensionFields?: Record<string, string>; drillRawRows?: Array<Record<string, unknown>>; drillRanges?: Array<Record<string, DatasetDrillRange>>; totals?: DatasetResultTotals[]; error?: string; forbidden?: boolean; signature?: string; refreshing?: boolean }>({ status: 'idle', rows: [] });
  // Drill-through (ADR-0021 D2): the clicked bucket's record-list filter + title.
  const [drill, setDrill] = useState<{ filter: Record<string, unknown>; title: string } | null>(null);
  // ── The flat table's client-side sort (objectui#5827) ────────────────────
  // `null` = the dataset's own order. Declared up here with the other hooks
  // because the table branch sits AFTER this component's early returns, where a
  // `useState` would be conditional.
  //
  // Client-side is the design, not a shortcut: this widget issues ONE
  // `queryDataset` call and paginates nothing, so the rows on screen ARE the
  // whole result set and reordering them needs no round trip. `options.limit`
  // does truncate that set server-side — a sort then orders exactly the set the
  // unsorted table was already showing, never a different slice of the data.
  const [tableSort, setTableSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  // Signature uses the RAW filter (stable) — the resolved one carries a
  // render-time `now` and would otherwise force a refetch loop. The
  // query-affecting options join it so editing a widget's granularity/sort in
  // the designer refetches instead of re-rendering the previous grid.
  const signature = `${widgetType}|${datasetName}|${dimensions.join(',')}|${values.join(',')}|${JSON.stringify(rawFilter ?? null)}|${JSON.stringify(compareTo ?? null)}|${dateGranularity ?? ''}|${JSON.stringify(order ?? null)}|${limit ?? ''}`;

  // ── The data-invalidation bus (objectui#10815) ───────────────────────────
  // `notifyDataChanged` from `@object-ui/react`, read the objectui#10623 /
  // objectui#10778 way: the nonce moves when a write to the object this widget
  // QUERIES is declared, and the fetch effect below names it, so the tile is
  // re-read in place. Without it a write declared on the bus (a page action over
  // raw HTTP, a flow, a server action) left the tile stale until something
  // remounted it.
  //
  // A dataset node carries no `objectName`: the object is the dataset's base
  // object, which only the query's ANSWER names (`object`). It is kept in its
  // own state, set from each answer that names one, the same key `ObjectChart`
  // subscribes a dataset-bound chart on (`datasetObject`, objectui#10035). Kept
  // apart from `state` so a re-read or a failed read does not drop the
  // subscription. An adapter that cannot run dataset queries never answers, so
  // nothing subscribes; a widget with no measures queries nothing and does not
  // subscribe either.
  const [datasetObject, setDatasetObject] = useState<string | undefined>(undefined);
  const invalidationNonce = useDataInvalidation(values.length > 0 ? datasetObject : undefined);

  useEffect(() => {
    const src = dataSource as DatasetCapableSource | undefined;
    if (!src || typeof src.queryDataset !== 'function') {
      setState({ status: 'error', rows: [], error: tt('dashboard.datasetUnsupported', 'This data source does not support dataset queries.') });
      return;
    }
    if (values.length === 0) { setState({ status: 'idle', rows: [] }); return; }
    let cancelled = false;
    // A re-read of the query already on screen (the bus moved the nonce) keeps
    // the current answer up under a `RefreshIndicator` instead of swapping the
    // tile for its loading skeleton, so the table node, its sort and an open
    // drill survive the re-read (AGENTS.md #8). A different query (the widget's
    // dimensions, measures, filter or options changed) starts from the skeleton:
    // the rows on screen answer another question.
    setState((prev) => (prev.status === 'ok' && prev.signature === signature
      ? { ...prev, refreshing: true }
      : { status: 'loading', rows: [] }));
    src.queryDataset(datasetName, {
      dimensions,
      measures: values,
      ...(selectionFilter ? { runtimeFilter: selectionFilter } : {}),
      ...(compareWindows.length > 0 ? { timeDimensions: compareWindows } : {}),
      ...(compareTo ? { compareTo } : {}),
      ...(totalsGroupings ? { totals: { groupings: totalsGroupings } } : {}),
      ...(dateGranularity ? { dateGranularity } : {}),
      ...(order ? { order } : {}),
      ...(limit != null ? { limit } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        setState({ status: 'ok', rows: Array.isArray(res?.rows) ? res.rows : [], fields: Array.isArray(res?.fields) ? res.fields : [], object: res?.object, dimensionFields: res?.dimensionFields, drillRawRows: Array.isArray(res?.drillRawRows) ? res.drillRawRows : undefined, drillRanges: Array.isArray(res?.drillRanges) ? res.drillRanges : undefined, totals: Array.isArray(res?.totals) ? res.totals : undefined, signature });
        if (typeof res?.object === 'string' && res.object) setDatasetObject(res.object);
      })
      .catch((e) => {
        if (cancelled) return;
        // A READ refusal (403 / `PERMISSION_DENIED` — the analytics read
        // admission, objectui#10899) is not a failure to explain: it is the same
        // "you can't see this data" the list view over the same object states in
        // its localized no-access panel. Classified by the shared, adapter-
        // agnostic `classifyLoadError`, never by matching the message text.
        if (classifyLoadError(e) === 'forbidden') {
          setState({ status: 'error', rows: [], forbidden: true });
          return;
        }
        setState({ status: 'error', rows: [], error: String((e as Error)?.message ?? e) });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, invalidationNonce]);

  // ── Declared measures this widget never shows (objectui#8894) ────────────
  // The query above runs every declared measure (`measures: values`), and the
  // branch decision keeps some of them off the screen (`droppedMeasures`). That
  // drop used to happen in silence: a tile answering a NARROWER question than
  // its metadata asked still reads as a finished product, which is the
  // declared-but-unenforced shape ADR-0049 exists to end. This diagnostic keeps
  // the drop audible. It does not render the dropped measures, so the tile's
  // markup is byte-unchanged (objectui#8887 pins that, and the drop itself).
  //
  // Three shapes reach a drop now that `@objectstack/spec` 17.5.0 judges the
  // metric family (ruling D on objectui#8894):
  //  - a metric-family tile with two or more measures. The spec refuses it at
  //    its door (`checkDashboardWidgetMetricMeasureArity`, which objectui's
  //    `DashboardWidgetSchema` re-attaches), so it arrives here as a document
  //    stored before that narrowing: the read path serves stored rows as they
  //    are, and the ADR-0087 entry is a semantic migration with no conversion;
  //  - a dimensionless widget whose type the spec's text gives no rendering of
  //    several measures (see `MEASURE_AXIS_CHART_FAMILIES`), which takes the
  //    tile. Every door accepts it until the spec refuses that shape;
  //  - a chart WITH a dimension whose family draws one series
  //    (`SINGLE_SERIES_CHART_FAMILIES`, objectui#11417): the renderer draws
  //    the first measure. Every door accepts it until the spec refuses that
  //    shape too (objectstack#21293).
  // The condition is the set difference between what is declared and what the
  // branch renders, never a list of types, so it goes quiet by itself wherever
  // a branch starts rendering a measure (objectui#11261 took the table and the
  // bar / line / area / combo charts off it, objectui#8894 column and
  // horizontal-bar).
  //
  // What it says: which widget, what it renders, and which measures it queried
  // and never displayed. Then, for a tile, where the spec states what to author
  // instead — the `replacement` of the metric-family refusal's ADR-0087 entry,
  // which answers for a one-number tile that declares several measures. It
  // names no widget types and gives no advice of its own: the entry is the
  // spec's advice, and a second copy written here would drift from it.
  //
  // A single-series chart is not a one-number tile, so that entry does not
  // answer for it, and the message does not point there. It states the cause
  // instead (the chart family draws one series, the first declared measure)
  // and names no type but that family. No spec entry answers for this shape
  // at the spec objectui pins, and the message invents no advice in its place.
  //
  // ⚠️ "Queried … never displayed", NOT "ignored": the extra measures are not
  // inert, and a message saying they were would itself be false. They are
  // computed by the server, they join the refetch `signature` above, and
  // `options.sortBy` accepts any of them (`values.includes(sortBy)`) — which,
  // on a metric-TYPE widget that also declares dimensions, decides which row
  // becomes `rows[0]` and therefore which number is shown. Only the DISPLAY
  // drops them, and only that is what this claims.
  //
  // The message itself is the effect's dependency, so it speaks once per mount
  // and again only when what it would say changes. A module-level one-shot Set
  // (`warnSuppressedListNav`'s shape) was deliberately not used: it would need
  // an exported reset and leak across tests.
  const quoteMeasures = (measures: string[]) => measures.map((m) => `"${m}"`).join(', ');
  const unrenderedMeasureWarning =
    droppedMeasures.length > 0
      ? `[DatasetWidget] Widget "${String(widget?.id ?? '')}" (type "${widgetType}", dataset "${datasetName}") `
        + `renders ${renderedMeasures.length} of its ${values.length} declared measures: ${quoteMeasures(renderedMeasures)}. `
        + `Queried and then never displayed: ${quoteMeasures(droppedMeasures)}. `
        + (drawsFirstMeasureOnly
          ? `Its chart family "${chartType}" draws a single series: the first declared measure.`
          : 'The spec states what to author instead of a one-number tile with several measures in the '
            + 'replacement of its ADR-0087 entry "dashboard-widget-metric-family-multi-measure-refused".')
      : '';
  useEffect(() => {
    if (unrenderedMeasureWarning) console.warn(unrenderedMeasureWarning);
  }, [unrenderedMeasureWarning]);

  // ── The analytics label net's INPUT: resolved field metadata, locale-free ──
  // ONE object-schema read per dataset query, yielding `{ object, field,
  // options }` per dimension field path. Everything this widget DISPLAYS
  // (per-category colours, {value → label} maps, the declared category order)
  // is derived from it during render, one memo down, because that derivation is
  // where the locale bundle applies (objectui#4030): keeping the fetched
  // metadata locale-free means switching language re-renders the labels instead
  // of re-fetching the schema.
  //
  // The read itself — the host-authenticated `apiFetch` channel (objectui#4121),
  // the locale-free state, the effect deps, the best-effort failure shape — now
  // lives ONCE in `@object-ui/react`'s `useDatasetDimensionMeta`, shared with
  // the dataset report block (objectui#4389). It was written out here and again
  // in plugin-report by PR #4388; both copies stated the same two bug fixes, and
  // that is precisely the drift #4389 was filed to close. What stays local is
  // the part that is genuinely this widget's: WHICH dimensions to resolve, and
  // the chart-only colour/order derivation in the memo below.
  //
  // The METRIC branch renders ONE measure value plus that measure's header
  // label — a dimension's value never reaches its output in any spelling — so
  // there is nothing on that path to relabel and resolving would be a metadata
  // read nothing consumes (objectui#4263, pinned via `enabled`).
  //
  // Which dimensions resolve (objectui#4263 → #4330): EVERY dimension, on every
  // non-metric widget type — one rule, no per-widget-type dialect. #4263 ruled a
  // narrower one: on table/pivot the SERVER resolves a LOCAL dimension's display
  // label (ADR-0021), so this client net stayed off there and opened only for
  // DOTTED paths, where the server is silent too. That boundary was ruled for
  // LABEL RESOLUTION — "the label already exists, don't produce it twice" — and
  // it held exactly as long as resolution was the only thing downstream of the
  // read. objectui#4030 / PR #4324 put a second consumer there: the locale
  // bundle, which needs the option LIST, not the label. So a local select on a
  // table had its label resolved by the server, in English, with nothing on the
  // client to translate it against — the cells read `Domestic` beside a related
  // list reading 国内 (objectui#4330). The read is what closes that, and the PM
  // amended the #4263 boundary deliberately for it.
  //
  // It is not a second resolution: `buildDimensionLabelMap` carries BOTH the
  // stored value and the AUTHORED label as keys, and `relabelDimensions` is
  // value-wise and idempotent — a server-resolved `Domestic` maps to 国内 once,
  // and under `en` (or with no bundle entry) the display equals the authored
  // label, so no key is emitted and the rows pass through by identity.
  //
  // WHY THE READ IS NOT GATED ON "the dimension is a select" (measured, see the
  // amended pins): select-ness is not observable before the read.
  // `DatasetDimension.type` is `string|number|date|boolean|lookup` — the spec
  // has no `select` member — and every select dimension in the live example apps
  // declares `type: 'string'`; on the wire, `AnalyticsResult.fields[]` types a
  // select column `'string'` too (the analytics cube registry's
  // `fieldTypeToDimensionType` default). The select gate therefore lands on the
  // read's OUTPUT, where it is exact: `resolveDimensionFieldMeta` yields an entry
  // only for a terminal field that actually carries `options`, so a text /
  // number / date / lookup dimension produces no map and no relabel.
  const dimensionMeta = useDatasetDimensionMeta(
    state.object,
    state.dimensionFields,
    dimensions,
    { enabled: !isMetric },
  );

  // ── The analytics label net's OUTPUT, with the locale bundle applied ──────
  // objectui#4030 (source thread objectstack#5076): the net above RESOLVES a
  // select dimension's option label but used to hand the object's authored
  // English label straight to the axis, the legend, the table cells and the
  // CSV — the same screen's related list showing the translation beside it.
  // The bundle is applied HERE, once, on the shared `{value → label}` /
  // localized-options pair every one of those consumers reads, rather than per
  // surface. `fieldOptionLabel` is the resolver list and form surfaces already
  // use (`fieldOptions.<object>.<field>.<value>`), reached through the
  // provider-safe wrapper so a widget rendered without an I18nProvider keeps
  // its authored labels instead of crashing.
  //
  // `deriveDimensionLabelMaps` is core's — the same derivation the dataset
  // report block runs, stated once (objectui#4389). Per-category COLOURS and
  // the declared category ORDER are NOT: they key the palette and the axis
  // sequence, neither of which a table or pivot renders, so they stay null on
  // that path exactly as they did when it returned early (objectui#4263).
  // #4330 widened only WHICH DIMENSIONS get a label map, never what a table
  // consumes — hence the `isTable` gate on `firstDimPath` and nothing else.
  const { categoryColors, dimensionLabels, categoryOrder, seriesOrder } = useMemo(() => {
    if (!dimensionMeta) return { categoryColors: null, dimensionLabels: null, categoryOrder: null, seriesOrder: null };
    const { metaByPath, relabel } = dimensionMeta;
    // Colours and declared order read `option.label`, so they are fed the
    // LOCALIZED options — the same "translate the options, then render them"
    // shape the list side uses (`translateOptions` → `SelectCellRenderer`).
    // That keeps them keyed by the string the relabeled rows actually carry.
    // `relabel[0]` is the first dimension: `relabel` is built from the same
    // already-`Boolean`-filtered `dimensions` array this widget passes in, in
    // order, so `relabel[0].path` is `fieldOf(dimensions[0])`.
    const firstDimPath = isTable ? undefined : relabel[0]?.path;
    const firstDimMeta = firstDimPath ? metaByPath[firstDimPath] : undefined;
    const firstDimOptions = firstDimPath
      ? localizeFieldOptions(firstDimMeta?.options, dimensionOptionTranslator(firstDimMeta, fieldOptionLabel))
      : undefined;
    // objectui#11809 — the SECOND dimension's declared order too: a chart that
    // pivots it into series lists those series in its legend, and a select
    // there reads in its declared order like the axis does. Chart-only, gated
    // as the first dimension's order is.
    const secondDimPath = isTable ? undefined : relabel[1]?.path;
    const secondDimMeta = secondDimPath ? metaByPath[secondDimPath] : undefined;
    const secondDimOptions = secondDimPath
      ? localizeFieldOptions(secondDimMeta?.options, dimensionOptionTranslator(secondDimMeta, fieldOptionLabel))
      : undefined;
    return {
      categoryColors: buildOptionColorMap(firstDimOptions),
      dimensionLabels: deriveDimensionLabelMaps(metaByPath, relabel, fieldOptionLabel),
      categoryOrder: buildCategoryOrder(firstDimOptions),
      seriesOrder: buildCategoryOrder(secondDimOptions),
    };
  }, [dimensionMeta, fieldOptionLabel, isTable]);

  // objectui#12528 — a tile handed a `heading` draws it in every state, so a
  // loading, refused or failed tile still says which KPI it is. Only the
  // answered tile knows its measure label; it draws the row itself, below.
  const framed = (node: ReactElement): ReactElement =>
    heading ? (
      <div className={cn('flex h-full w-full min-w-0 flex-col gap-1', METRIC_TILE_CONTAINER_CLASS)}>
        <MetricHeadingRow heading={heading} />
        {node}
      </div>
    ) : node;

  if (values.length === 0) {
    return framed(<div className="flex h-full w-full items-center justify-center rounded border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">{tt('dashboard.pickMeasures', 'Pick measures (values) for this dataset widget.')}</div>);
  }
  // Pending → a SHAPE-MATCHED skeleton, not a 0-value chart or an empty table.
  // The widget's eventual footprint (chart bars / table rows / a KPI number) is
  // hinted while `queryDataset` is in flight so the first paint reads as
  // "loading", never as "broken / empty". Three states stay distinct: this is
  // loading; `state.rows.length === 0 && status==='ok'` is the empty state
  // ("No rows" / a KPI 0) handled below; data renders last.
  if (state.status === 'loading' || state.status === 'idle') {
    return framed(
      <div
        className="h-full w-full p-2"
        data-testid="dataset-loading"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{tt('dashboard.loading', 'Loading…')}</span>
        {isMetric ? (
          <div className="flex h-full w-full flex-col items-start justify-center gap-2 p-2">
            <Skeleton className="h-8 w-32 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        ) : isTable ? (
          <GridSkeleton
            className="h-full"
            rows={5}
            columns={Math.max(2, dimensions.length + values.length)}
          />
        ) : (
          <ChartSkeleton className="h-full" />
        )}
      </div>,
    );
  }
  if (state.status === 'error' && state.forbidden) {
    // The viewer may not read the data behind this tile (objectui#10899). A
    // localized statement of that fact, in the list view's words — never the
    // transport's `Dataset query failed: 403 Forbidden — …` string.
    return framed(
      <div
        role="alert"
        data-testid="dataset-widget-forbidden"
        className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-muted-foreground"
      >
        <ShieldAlert className="h-5 w-5 text-muted-foreground/70" aria-hidden="true" />
        <span className="font-medium text-foreground/80">
          {tt('dashboard.widgetForbiddenTitle', 'You don’t have access')}
        </span>
        <span>
          {tt('dashboard.widgetForbiddenMessage', 'You don’t have permission to view the data behind this widget.')}
        </span>
      </div>,
    );
  }
  if (state.status === 'error') {
    return framed(
      <div role="alert" className="flex h-full w-full items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span className="break-words">{state.error}</span>
      </div>,
    );
  }
  // A re-read of the answer on screen is in flight (objectui#10815): the rows
  // below stay, and this bar marks the refresh. Each data branch's root is
  // positioned, so the bar anchors to the tile's top edge.
  const refreshBar = <RefreshIndicator active={!!state.refreshing} ariaLabel={tt('dashboard.refreshing', 'Refreshing…')} />;
  // A metric (single value) over an empty dataset is 0, not an empty state —
  // the latter reads as broken for KPIs like "Total Books" on a fresh app.
  // Charts and tables keep the empty state (there is genuinely nothing to
  // plot).
  //
  // objectui#7063: this used to be a one-line `dashboard.noRows` fragment in a
  // dashed box — 'No rows' / `暂无数据行` — with no role, no explanation and no
  // mention of WHAT was empty, which is why a legitimately young tile read as
  // "the dashboard failed to load" beside eleven populated ones. `datasetName`
  // is `widget.dataset` and is non-empty on every path that reaches here (a
  // widget with no dataset never mounts this component), but it is passed
  // defensively so a blank binding degrades to the un-sourced copy rather than
  // printing an empty label.
  if (state.rows.length === 0 && !isMetric) {
    return (
      <WidgetEmptyState
        className="rounded border border-dashed bg-muted/20"
        source={datasetName || undefined}
      />
    );
  }

  // Measure metadata (label + format + currency) + header-label resolution,
  // shared with the report renderer via @object-ui/core.
  //
  // objectui#7534 — the same `builtinAggregateLabels` seam the chart below
  // uses (#7258): the KPI/metric caption and the table & pivot column headers
  // resolve through `headerLabel`, so without it a widget's legend read `计数`
  // while its own header still said the server's built-in English `Count`.
  const { measureField, headerLabel } = buildDatasetFieldHelpers(
    state.fields,
    state.object,
    fieldLabel,
    builtinAggregateLabels(tt),
  );

  // --- Comparison overlay (objectui#3337) ---------------------------------
  // The executor attaches a `<measure>__compare` column per measure once it has
  // a window to shift. Showing it is the visible half of the comparison:
  // forwarding `compareTo` and lowering the window only get the numbers INTO
  // the result, and a widget that then drops them renders the very "silently no
  // comparison" this issue is about. The comparison values carry the base
  // measure's own format (they are the same measure over an earlier window).
  const comparedValues = compareTo
    ? values.filter((m) => state.rows.some((r) => r[compareColumn(m)] != null))
    : [];
  // Window label from the SAME `dashboard.trend.*` vocabulary the inline metric
  // widget uses, read off `compareTo.kind` and never off the filter's macro
  // tokens (objectui#11632). The executor shifts the whole resolved window, so
  // the kind is all there is to say about which window was compared. See
  // `COMPARE_KIND_TREND_KEY`. This one label names the window on every surface
  // below: the KPI delta, the table's comparison column header, the cross-tab
  // caption and the chart's comparison series.
  const compareTrendKey = compareTo ? COMPARE_KIND_TREND_KEY[compareTo.kind] : '';
  const compareLabel = compareTo
    ? tt(`dashboard.trend.${compareTrendKey}`, TREND_LABEL_DEFAULTS[compareTrendKey] ?? 'vs previous period')
    : '';

  // --- Drill-through (shared by table/pivot AND chart) -------------------
  // Available when the server returned the dataset's base object + at least one
  // drillable dimension this widget groups by. Tables/pivots drill by row index;
  // charts map a clicked segment back to its dataset row (see handleChartDrill).
  const { object: drillObject, dimensionFields, drillRawRows, drillRanges } = state;
  const drillDims = dimensionFields ? dimensions.filter((d) => d in dimensionFields) : [];
  // objectstack-ai/objectstack#1752: a date-only widget has no equality drill dim but still drills by the
  // server's per-row date RANGE, so the presence of ranges makes it drillable too.
  const canDrill = !!drillObject && (drillDims.length > 0 || !!drillRanges?.length);
  const openDrill = (index: number, title: string) => {
    if (!drillObject) return;
    // objectui#10789 — composing the widget's filter with the clicked bucket
    // lowers both through the throwing converter form. A widget filter the
    // dataset query carried to the server can still be one this layer refuses
    // (a spec `$not`), and the click then threw out of this handler uncaught.
    // The refusal opens no drawer (never with "no filter", which would list
    // every record the widget is scoped to exclude) and is logged, naming the
    // operator — the channel a failed drill already reports on (`ReportView`'s
    // drill handler). Only a `FilterOperatorError` is caught.
    let merged: Record<string, unknown>;
    try {
      merged = buildDrillFilter(drillRawRows?.[index], drillDims, dimensionFields ?? {}, runtimeFilter, drillRanges?.[index]);
    } catch (error) {
      if (!(error instanceof FilterOperatorError)) throw error;
      console.warn(`[DatasetWidget] drill-down refused — the drilled list cannot be scoped: ${error.message}`);
      return;
    }
    setDrill({ filter: merged, title: title || String(widget?.title ?? '') });
  };
  const drillDrawer = drill && drillObject ? (
    <DrillDownDrawer
      open
      onClose={() => setDrill(null)}
      title={drill.title || String(widget?.title ?? tt('dashboard.details', 'Details'))}
      objectName={drillObject}
      filter={drill.filter}
      dataSource={dataSource}
    />
  ) : null;

  // Metric / KPI — show the single measure value of the first row, using the
  // measure's display label (not the raw name) and its format (e.g. "$616,000").
  // The measure is the one `renderedMeasures` settled for the tile, the same
  // derivation the dropped-measure diagnostic reads (objectui#8894).
  if (isMetric) {
    const tileMeasure = renderedMeasures[0];
    const f = measureField(tileMeasure);
    const value = state.rows[0]?.[tileMeasure] ?? 0;
    // Period-over-period delta, computed from the SAME `computeMetricDelta` the
    // inline KPI uses so both surfaces round and sign it identically.
    const previous = state.rows[0]?.[compareColumn(tileMeasure)];
    const delta = comparedValues.includes(tileMeasure)
      ? computeMetricDelta(
          typeof value === 'number' ? value : null,
          typeof previous === 'number' ? previous : null,
        )
      : null;
    // ── The declared accent (objectui#3359, objectstack#5010 ruling B) ──────
    // `widget.colorVariant` has been spec-declared and authored for a long time
    // (16 live authorizations across platform-objects' system_overview and
    // app-showcase's dashboards, every one of them a dataset-bound `metric`) —
    // and `dataset` being REQUIRED on DashboardWidgetSchema means every legal
    // widget lands here, in a component that read the key nowhere. So the
    // renderer painted all sixteen identically and the key was declared but
    // never enforced.
    //
    // It maps onto the accent system this package already has rather than a new
    // one: no icon chip and no card chrome is rendered here, exactly like
    // MetricWidget's `bare` layout, so the accent lands where that layout puts
    // it — on the big number, via the same shared `VARIANT_TEXT_CLASSES`. A
    // dataset-bound KPI and an inline `bare` KPI declaring the same variant now
    // read the same. No declaration (and the enum's own `'default'`) resolves to
    // `undefined`, which `cn` drops: the markup of every widget that never
    // declared the key stays byte-identical.
    const accentClass = metricAccentTextClass(widget?.colorVariant);
    const measureLabel = headerLabel(tileMeasure);
    // ── No sub-caption (objectui#11389, ruling C) ──────────────────────────
    // The tile draws the value, the delta and the measure label, and nothing
    // from the options bag. Its `description` key was the sub-caption
    // (objectui#7293), fed by the server's `subCaption` overlay and a client
    // bundle limb; both ends are retired, and the spec never declared the key.
    // An authored one now draws the parser's `unconsumed-widget-option` warning
    // instead of a caption node. The card-header subtitle, `widget.description`,
    // is the surface's to draw, not this tile's.
    return (
      // Positioned only while a re-read is in flight, for the refresh bar: the
      // idle tile's markup is pinned byte-for-byte (`DatasetWidget.colorVariant`,
      // `.subCaption`, `.unrenderedMeasures-8894` tests), and it moves by nothing.
      <div className={cn('flex h-full w-full flex-col items-start justify-center gap-1 p-2', heading && cn('min-w-0', METRIC_TILE_CONTAINER_CLASS), state.refreshing && 'relative')}>
        {refreshBar}
        {/* objectui#12623 — with a heading, the title owns the first line, the
            value never wraps, and the measure label is a line under it (the
            shared rule in `./metricTile`). Without one, the tile's markup is
            unchanged: the label is then the only text naming the value. */}
        {heading && <MetricHeadingRow heading={heading} label={measureLabel} />}
        <span className={cn(heading ? cn('font-semibold', METRIC_TILE_VALUE_CLASS) : 'text-2xl font-semibold tabular-nums', accentClass)}>{formatMeasure(value, f?.format, f?.currency, f?.percentScale, displayLocale)}</span>
        {heading && measureLabel && (
          <span className={METRIC_TILE_MEASURE_LABEL_CLASS} data-testid="dataset-metric-label">{measureLabel}</span>
        )}
        {delta && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="dataset-compare-trend">
            <span className={cn(
              'flex shrink-0 items-center font-medium',
              delta.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
              delta.direction === 'down' && 'text-rose-600 dark:text-rose-400',
              delta.direction === 'neutral' && 'text-muted-foreground',
            )}>
              {delta.direction === 'up' && <ArrowUpIcon className="mr-1 h-3 w-3" />}
              {delta.direction === 'down' && <ArrowDownIcon className="mr-1 h-3 w-3" />}
              {delta.direction === 'neutral' && <MinusIcon className="mr-1 h-3 w-3" />}
              {formatMetricDeltaPercent(delta.value)}
            </span>
            <span className="min-w-0 truncate">{compareLabel}</span>
          </div>
        )}
        {!heading && <span className="text-xs text-muted-foreground">{measureLabel}</span>}
      </div>
    );
  }

  // Table / pivot — a grouped table or, for a pivot with ≥2 dimensions, a true
  // cross-tab.
  if (isTable) {
    // ── The display rows (objectui#4263, widened by #4330) ──────────────────
    // The table/pivot branch renders `state.rows` as they arrived unless a
    // dimension resolved a label map. `dimensionLabels` covers EVERY dimension
    // whose terminal field carries `options` — dotted (the server resolved
    // nothing) and local (the server resolved the AUTHORED label, which under
    // a non-default locale is the wrong one, objectui#4330). A dimension whose
    // field carries no options gets no entry, so a text/number/date/lookup
    // table still gets `state.rows` ITSELF back — same array identity, same
    // rendered bytes. The map is value-AND-authored-label keyed and
    // `relabelDimensions` is idempotent, so neither spelling double-resolves.
    //
    // Row ORDER and COUNT are preserved, which is what keeps `openDrill(i)`
    // and `pivot.cellIndex` aligned with the raw `drillRawRows` they index
    // into — a drill still filters by the stored value, never the label.
    const displayRows = relabelDimensions(state.rows, dimensionLabels);
    // Drill-through (canDrill / openDrill / drillDrawer) is computed above and
    // shared with the chart path — tables/pivots drill by flat row index.
    // CSV export — display-label headers + the underlying grouped rows (measures
    // kept numeric so the data round-trips into a spreadsheet). Shared by the flat
    // table and the cross-tab.
    // Measure columns, each followed by its comparison column when the executor
    // attached one. `compareOf` names the base measure a comparison column
    // belongs to — its format, and the label it is qualified with, both come
    // from that measure (a comparison is the same measure over an earlier
    // window). A measure literally named `<x>__compare` is still itself.
    const compareOf = (column: string): string | undefined => {
      if (values.includes(column) || !column.endsWith(COMPARE_SUFFIX)) return undefined;
      const base = column.slice(0, -COMPARE_SUFFIX.length);
      return values.includes(base) ? base : undefined;
    };
    const columnLabel = (column: string): string => {
      const base = compareOf(column);
      return base ? `${headerLabel(base)} · ${compareLabel}` : headerLabel(column);
    };
    const measureColumns = values.flatMap((m) =>
      comparedValues.includes(m) ? [m, compareColumn(m)] : [m],
    );
    // The cross-tab exports its comparison columns too (objectui#3614), even
    // though its DISPLAY stacks them inside the cell: a CSV is data, not a
    // picture of the table. So each compared measure keeps its own flat
    // `<measure>__compare` column here and every exported cell stays the bare
    // number a spreadsheet can compute on — serializing the stacked cell would
    // emit strings like "$120 $100 20%", which is a screenshot in CSV clothing.
    const exportColumns = [...dimensions, ...measureColumns];
    // `rows` is a parameter because the flat table now renders its rows in an
    // order of its own (objectui#5827 — blank bucket last, plus whatever the
    // user sorted by), and "the CSV follows the table" has to mean the order
    // too, not just the cell text. The cross-tab passes `displayRows`, which is
    // what this always exported.
    const exportCsv = (rows: Row[]) => downloadCsv(String(widget?.title ?? datasetName ?? 'export'), [
      exportColumns.map((c) => columnLabel(c)),
      // The CSV follows the table's own cells (objectui#4263): a dotted
      // dimension exports the label the table now shows, and a local one is
      // unchanged for the same reason its cell is.
      // …and #4330 widens that to a LOCAL select dimension for the same
      // reason: the CSV is the table's data, so it exports the cell. Measures
      // stay numeric (the raw values that must round-trip into a spreadsheet);
      // the drill filter — the identity key — reads `drillRawRows`, untouched.
      ...rows.map((r) => exportColumns.map((c) => {
        const v = r[c];
        return v == null ? '' : (typeof v === 'number' ? v : String(v));
      })),
    ]);
    const exportBtnFor = (rows: Row[]) => (
      <button
        type="button"
        onClick={() => exportCsv(rows)}
        data-testid="dataset-export"
        title={tt('dashboard.exportCsv', 'Export CSV')}
        aria-label={tt('dashboard.exportCsv', 'Export CSV')}
        className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground opacity-70 hover:bg-accent/50 hover:text-foreground hover:opacity-100"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    );
    const exportBtn = exportBtnFor(displayRows);

    // pivot → a true cross-tab when there are ≥2 dimensions: the LAST dimension
    // spreads ACROSS as columns, the rest go DOWN as rows, measures fill the
    // cells. The dataset already returns one row per dimension combination, so
    // cells just place those pre-aggregated values — no client re-aggregation
    // (an avg/min/max can't be recombined). With <2 dimensions a cross-tab is
    // meaningless, so it degrades to the flat grouped table.
    if (isMatrix) {
      const pivot = buildPivot(displayRows, rowDims, colDim, displayLocale);
      // Single measure → one column per across-bucket; multiple → bucket × measure.
      const cellCols = pivot.colHeaders.flatMap((col) =>
        values.map((m) => ({ col, measure: m, header: values.length === 1 ? col.label : `${col.label} · ${headerLabel(m)}` })),
      );
      const fmtMeasure = (v: unknown, m: string) => formatMeasure(v, measureField(m)?.format, measureField(m)?.currency, measureField(m)?.percentScale, displayLocale);
      // ── The comparison, stacked inside the cell (objectui#3614) ───────────
      // A cross-tab's columns are already `bucket × measure`; giving the
      // comparison a column of its own would make them `bucket × measure ×
      // window` — twice the width and a third header level — on the one widget
      // family whose width is already the scarce resource. So the comparison
      // stacks INSIDE the cell instead: the current value on top, the
      // comparison value and its delta beneath in smaller type. Column
      // structure, header depth and the row/column subtotal correspondence all
      // stay exactly as they were.
      //
      // Presence is read from the DATA — the `<measure>__compare` column the
      // executor attaches — via the same `comparedValues` the KPI, flat-table
      // and chart paths read, so there is no widget flag to set and a pivot the
      // executor sent no comparison for renders exactly as it did before.
      //
      // Subtotals get the same treatment as data cells, deliberately: a Total
      // column that alone showed no comparison reads as "this row has none",
      // which is a different — and false — statement.
      const compareStack = (row: Row | undefined, measure: string) => {
        if (!comparedValues.includes(measure)) return null;
        const previous = row?.[compareColumn(measure)];
        if (previous == null) return null;
        const current = row?.[measure];
        // The SAME delta helper the KPI path uses, so a dataset KPI and a
        // cross-tab cell over the same two windows agree on sign and rounding
        // instead of each rolling their own percentage.
        const delta = computeMetricDelta(
          typeof current === 'number' ? current : null,
          typeof previous === 'number' ? previous : null,
        );
        return (
          <div
            className="flex items-center justify-end gap-1 text-[10px] font-normal leading-tight text-muted-foreground"
            data-testid="matrix-cell-compare"
            data-direction={delta?.direction}
            title={compareLabel}
          >
            {/* A comparison is the same measure over an earlier window, so it
                carries that measure's own format — never a bare number. */}
            <span className="tabular-nums">{fmtMeasure(previous, measure)}</span>
            {delta && (
              <span
                className={cn(
                  'flex shrink-0 items-center tabular-nums font-medium',
                  delta.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
                  delta.direction === 'down' && 'text-rose-600 dark:text-rose-400',
                )}
              >
                {delta.direction === 'up' && <ArrowUpIcon className="h-2.5 w-2.5" />}
                {delta.direction === 'down' && <ArrowDownIcon className="h-2.5 w-2.5" />}
                {delta.direction === 'neutral' && <MinusIcon className="h-2.5 w-2.5" />}
                {formatMetricDeltaPercent(delta.value)}
              </span>
            )}
          </div>
        );
      };
      // One caption names the comparison window for the whole table. The
      // stacked numbers are otherwise unlabeled, and repeating "vs last year"
      // in every cell would drown the grid it annotates. The flat table
      // qualifies its comparison COLUMN header instead; a cross-tab has no
      // per-window header to qualify, which is exactly what stacking traded.
      const compareCaption = comparedValues.length > 0 ? (
        <caption
          className="px-2 pb-1 text-left text-[10px] font-normal text-muted-foreground"
          data-testid="matrix-compare-caption"
        >
          {compareLabel}
        </caption>
      ) : null;
      // Server-supplied marginal totals (ADR-0021): match each grouping by its
      // dimension array, then its rows to the pivot headers via the same bucket
      // ids. Absent (older server) → maps stay empty and no totals UI renders.
      const findTotals = (dims: string[]) => {
        const totalRows = state.totals?.find((t) => Array.isArray(t.dimensions) && t.dimensions.join(',') === dims.join(','))?.rows;
        // Marginal totals arrive keyed by the RAW dimension value, and their
        // bucket ids are re-derived below from those values to meet the
        // pivot's headers. Both sides must speak the same vocabulary, so the
        // totals take the SAME relabel the display rows took (objectui#4263) —
        // otherwise a dotted pivot's headers read `Education` while the
        // row-total lookup still asked for `education` and every total cell
        // silently fell back to `—`.
        return totalRows ? relabelDimensions(totalRows, dimensionLabels) : totalRows;
      };
      const rowTotalById = new Map<string, Row>();
      for (const r of findTotals(rowDims) ?? []) rowTotalById.set(pivotBucketId(rowDims.map((d) => pivotDimensionValue(r[d]))), r);
      const colTotalById = new Map<string, Row>();
      for (const r of findTotals([colDim]) ?? []) colTotalById.set(pivotBucketId([pivotDimensionValue(r[colDim])]), r);
      const grandTotal = findTotals([])?.[0];
      const showTotalCol = rowTotalById.size > 0;
      const showTotalRow = colTotalById.size > 0;
      const totalLabel = tt('dashboard.total', 'Total');
      return (
        <div className="relative h-full w-full overflow-auto p-1" data-testid="dataset-matrix">{refreshBar}{exportBtn}
          <table className="w-full text-xs">
            {compareCaption}
            <thead className="bg-muted/40">
              <tr>
                {rowDims.map((d) => (
                  <th key={d} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{headerLabel(d)}</th>
                ))}
                {cellCols.map((cc) => (
                  <th key={`${cc.col.id}-${cc.measure}`} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{cc.header}</th>
                ))}
                {showTotalCol && values.map((m) => (
                  <th key={`total-${m}`} className="px-2 py-1.5 text-right font-medium whitespace-nowrap" data-testid="matrix-total-col-header">
                    {values.length === 1 ? totalLabel : `${totalLabel} · ${headerLabel(m)}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pivot.rowHeaders.map((rh) => (
                <tr key={rh.id} className="border-t">
                  {rh.labels.map((lbl, di) => (
                    <td key={di} className="px-2 py-1 whitespace-nowrap font-medium">{lbl}</td>
                  ))}
                  {cellCols.map((cc) => {
                    const index = pivot.cellIndex.get(pivotCellKey(rh.id, cc.col.id));
                    const fr = index != null ? state.rows[index] : undefined;
                    const clickable = canDrill && index != null;
                    const title = [...rh.labels, cc.col.label].filter(Boolean).join(' / ');
                    return (
                      <td
                        key={`${cc.col.id}-${cc.measure}`}
                        className={cn('px-2 py-1 text-right tabular-nums whitespace-nowrap', clickable && 'cursor-pointer hover:bg-accent/40')}
                        data-testid={clickable ? 'dataset-drill-cell' : undefined}
                        onClick={clickable ? () => openDrill(index as number, title) : undefined}
                      >
                        {fr ? fmtMeasure(fr[cc.measure], cc.measure) : '—'}
                        {compareStack(fr, cc.measure)}
                      </td>
                    );
                  })}
                  {showTotalCol && values.map((m) => {
                    const rowTotal = rowTotalById.get(rh.id);
                    return (
                      <td key={`total-${m}`} className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-medium" data-testid="matrix-row-total">
                        {fmtMeasure(rowTotal?.[m], m)}
                        {compareStack(rowTotal, m)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {showTotalRow && (
                <tr className="border-t bg-muted/30 font-medium" data-testid="matrix-total-row">
                  {rowDims.length > 0 && (
                    <td colSpan={rowDims.length} className="px-2 py-1 whitespace-nowrap">{totalLabel}</td>
                  )}
                  {cellCols.map((cc) => {
                    const colTotal = colTotalById.get(cc.col.id);
                    return (
                      <td key={`${cc.col.id}-${cc.measure}`} className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                        {fmtMeasure(colTotal?.[cc.measure], cc.measure)}
                        {compareStack(colTotal, cc.measure)}
                      </td>
                    );
                  })}
                  {showTotalCol && values.map((m) => (
                    <td key={`grand-${m}`} className="px-2 py-1 text-right tabular-nums whitespace-nowrap" data-testid="matrix-grand-total">
                      {fmtMeasure(grandTotal?.[m], m)}
                      {compareStack(grandTotal, m)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          {drillDrawer}
        </div>
      );
    }

    // table (and a 1-dimension pivot) → a flat grouped table.
    const columns = [...dimensions, ...measureColumns];

    // ── Which columns are NUMBERS (objectui#5827) ─────────────────────────
    // Right-alignment is a claim about the values, so it is decided from them.
    //
    // The column DESCRIPTOR cannot decide it, contrary to what the card
    // assumed: the executor stamps `type: 'number'` on every measure column it
    // appends (`service-analytics/src/dataset-executor.ts`) without looking at
    // the aggregate, so across measures the declared type is a constant and
    // discriminates nothing. Nor is `tabular-nums` evidence — this table
    // applies it to every cell, dimension cells included.
    //
    // What IS structural is which columns are MEASURES, and only a measure is a
    // candidate: a dimension is a grouping axis even when its bucket keys are
    // digits (a year, a quarter), and right-aligning those would render the
    // axis as if it were a quantity.
    //
    // Within the candidates the test is defensive — EVERY non-null value must
    // be a number. `formatMeasure` falls back to `String(v)` for a non-number,
    // which is exactly what a `min()`/`max()` over a text field yields; that
    // column renders words and stays left-aligned. An all-null column passes
    // vacuously and right-aligns its `—`s: that is the same column with no
    // rows, not a different kind of column.
    //
    // Resolved ONCE per column into a set, not per cell: the predicate scans
    // every row, so calling it from inside the row loop would make rendering
    // quadratic in the row count.
    const numericColumns = new Set(
      columns.filter(
        (c) =>
          (values.includes(c) || compareOf(c) !== undefined) &&
          displayRows.every((r) => r[c] == null || typeof r[c] === 'number'),
      ),
    );

    // ── Row order (objectui#5827) ─────────────────────────────────────────
    // Rows are DECORATED with their incoming index and reordered as decorated
    // pairs, never as bare rows. `openDrill(i)` indexes `drillRawRows` — the
    // server's parallel array of RAW bucket values — so the index has to keep
    // pointing at the row it arrived with. Sorting `displayRows` in place would
    // leave every drill filtering by some other row's bucket, silently: both
    // arrays keep the same length and every click still opens a drawer.
    const entries = displayRows.map((row, index) => ({ row, index }));
    // A sort survives only while its column does. After a re-query on edited
    // metadata the stored column may be gone; falling back to the default order
    // beats sorting every row by `undefined`.
    const activeSort = tableSort && columns.includes(tableSort.column) ? tableSort : null;
    const orderedEntries = activeSort
      ? entries
          // Resolve the key ONCE per row (decorate → sort → undecorate) — the
          // convention `sort-values.ts` documents, because `getSortValue` walks
          // the value and a comparator would repeat that walk O(n log n) times.
          .map((e) => ({ ...e, key: getSortValue(e.row[activeSort.column]) }))
          .sort((a, b) => {
            // Blanks last in BOTH directions. `compareSortValues` places them
            // last ascending and documents that callers negate for descending —
            // negation would float them to the top, so the blank arm is settled
            // BEFORE the direction is applied and never inside it. Since
            // objectui#5845 the descending arm is what a measure column's
            // FIRST click runs, so this is now the very first thing a user
            // exercises rather than the second.
            if (a.key === null && b.key === null) return 0;
            if (a.key === null) return 1;
            if (b.key === null) return -1;
            const cmp = compareSortValues(a.key, b.key);
            return activeSort.dir === 'asc' ? cmp : -cmp;
          })
      : // Default order = the order the dataset returned, with one exception:
        // the EMPTY-dimension bucket sinks below the named ones. It keeps its
        // `—` label — only its position moves. A bucket with no value sorting
        // FIRST reads to the viewer as a data bug. `Array#sort` is stable, so
        // every other pair compares 0 and the server's ordering survives whole.
        [...entries].sort((a, b) => {
          for (const d of dimensions) {
            const aBlank = getSortValue(a.row[d]) === null ? 1 : 0;
            const bBlank = getSortValue(b.row[d]) === null ? 1 : 0;
            if (aBlank !== bBlank) return aBlank - bBlank;
          }
          return 0;
        });

    // ── First-click direction (objectui#5845) ───────────────────────────
    // A numeric MEASURE starts DESCENDING; everything else starts ascending.
    // The question a click asks of a measure is "who is biggest" — the very
    // complaint objectui#5827 opened on (Technology, the largest industry,
    // rendering last) — and one click answering it is what every analytics
    // table does. A dimension is a grouping axis, where A→Z is the idiom the
    // console's DataTable uses and this table keeps.
    //
    // The predicate is `numericColumns`, the SAME set that decides
    // right-alignment: first-click direction is a property of the column's
    // ROLE (a measure whose values really are numbers), not of "it looks like
    // digits". So a digit-keyed dimension (a year, a quarter) still starts
    // ascending, and so does a `min()`/`max()` over a text field.
    const firstDir = (c: string): 'asc' | 'desc' => (numericColumns.has(c) ? 'desc' : 'asc');
    // <first> → <the other one> → back to the default order. Three states, not
    // the two a server-paged grid offers: here the default IS a meaningful
    // order (the dataset's own, which an author can set via `options.sortBy`),
    // so a header has to be able to hand it back. The middle step is written
    // as "whatever `firstDir` is not" rather than as the literal `'desc'`,
    // because hard-coding it would send a measure column desc → desc and cost
    // it the ascending state entirely.
    const cycleSort = (c: string) =>
      setTableSort((prev) => {
        const first = firstDir(c);
        if (prev?.column !== c) return { column: c, dir: first };
        return prev.dir === first
          ? { column: c, dir: first === 'asc' ? 'desc' : 'asc' }
          : null;
      });
    // The console's own indicator (`components/…/data-table.tsx`): an idle
    // column shows nothing until the header is hovered, the sorted one shows a
    // primary-tinted arrow. `aria-hidden` because the `th`'s `aria-sort` is
    // what carries the state to assistive tech.
    // ── The totals row (objectui#5846) ──────────────────────────────────
    // The server's `[]` marginal grouping — requested above — rendered as a
    // `tfoot`. Per aggregate: a `sum` column shows the sum over every row, an
    // `avg`/`min`/`max` column shows that aggregate over the WHOLE set (the
    // average of all records, never an average of the bucket averages). The
    // executor computes it by re-running this selection with no grouping, so
    // nothing here recombines anything.
    //
    // Absent — an older server, or an executor that could not answer `[]` for
    // this dataset shape — the row is simply omitted. Approximating it from the
    // rows on screen is the one thing this file does not do.
    //
    // `wantsFlatTotals` gates the RENDER as well as the request, so the two can
    // never disagree: a server that volunteers a `[]` grouping this widget did
    // not ask for (a truncated `options.limit` table) still shows no footer,
    // rather than a whole-set total sitting under a top-N list.
    const totalsRow = wantsFlatTotals
      ? state.totals?.find((t) => Array.isArray(t.dimensions) && t.dimensions.length === 0)?.rows?.[0]
      : undefined;
    // The console's existing footer vocabulary — the SAME `dashboard.total`
    // key the cross-tab's total row and `PivotTable` already use (en `Total`,
    // zh `总计`). No new string is minted here; the untranslated dataset
    // MEASURE headers beside it are objectstack#10292 and stay untouched.
    const totalRowLabel = tt('dashboard.total', 'Total');
    const sortIcon = (c: string) => {
      if (activeSort?.column !== c) {
        return <ChevronsUpDown className="ml-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" aria-hidden="true" />;
      }
      const Arrow = activeSort.dir === 'asc' ? ChevronUp : ChevronDown;
      return <Arrow className="ml-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />;
    };

    return (
      <div className="relative h-full w-full overflow-auto p-1">{refreshBar}{exportBtnFor(orderedEntries.map((e) => e.row))}
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              {columns.map((c) => {
                const numeric = numericColumns.has(c);
                return (
                  <th
                    key={c}
                    scope="col"
                    aria-sort={activeSort?.column === c ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('group px-2 py-1.5 font-medium whitespace-nowrap', numeric ? 'text-right' : 'text-left')}
                    data-testid={compareOf(c) ? 'dataset-compare-column' : undefined}
                  >
                    {/* A real button, not a click handler on the `th`: the sort
                        has to be reachable from the keyboard and needs an
                        accessible name. It is visually the header text, so the
                        console's header layout is unchanged. */}
                    <button
                      type="button"
                      onClick={() => cycleSort(c)}
                      data-testid="dataset-table-sort"
                      className={cn(
                        'inline-flex w-full select-none items-center font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        numeric ? 'justify-end' : 'justify-between',
                      )}
                    >
                      <span className="truncate">{columnLabel(c)}</span>
                      {sortIcon(c)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {orderedEntries.map(({ row, index }) => (
              <tr
                key={index}
                // Hover feedback on EVERY row, not only a drillable one — the
                // cue that says "this row is a unit" is what the card is about,
                // and a table nobody can drill needs it just as much. A
                // drillable row keeps its stronger accent fill: `cn` runs
                // tailwind-merge, so the later `hover:bg-accent/40` replaces
                // `hover:bg-muted/40` rather than stacking with it.
                className={cn('border-t transition-colors hover:bg-muted/40', canDrill && 'cursor-pointer hover:bg-accent/40')}
                data-testid={canDrill ? 'dataset-drill-row' : undefined}
                onClick={canDrill ? () => openDrill(index, drillDims.map((d) => formatDimensionValue(row[d], displayLocale)).filter(Boolean).join(' / ')) : undefined}
              >
                {columns.map((c) => {
                  // A comparison column formats as the measure it compares.
                  const measure = compareOf(c) ?? (values.includes(c) ? c : undefined);
                  return (
                    <td key={c} className={cn('px-2 py-1 whitespace-nowrap tabular-nums', numericColumns.has(c) && 'text-right')}>
                      {measure
                        ? formatMeasure(row[c], measureField(measure)?.format, measureField(measure)?.currency, measureField(measure)?.percentScale, displayLocale)
                        : formatDimensionValue(row[c], displayLocale)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {/* The totals row lives in `tfoot`, OUTSIDE `orderedEntries`
              entirely — not as a special case inside the sort. Three
              consequences fall out of that placement rather than out of any
              guard: it is exempt from every sort (it was never an entry), it
              renders after the last body row including the `—` null bucket
              (`tfoot` follows `tbody`), and it cannot disturb the (row, index)
              pairing `openDrill` depends on. It carries no click handler and
              no `dataset-drill-row` id, so it drills nowhere. */}
          {totalsRow && (
            <tfoot className="bg-muted/30">
              <tr className="border-t font-medium" data-testid="dataset-table-total-row">
                {/* One label cell spanning the dimension columns. The footer
                    renders only under `wantsFlatTotals`, which requires a
                    dimension (a dimensionless table's one row IS the total,
                    objectui#11261), so the span is never 0. */}
                <td colSpan={dimensions.length} className="px-2 py-1 whitespace-nowrap">{totalRowLabel}</td>
                {measureColumns.map((c) => {
                  // The SAME per-column formatter the body cells use —
                  // `measureField` is keyed by MEASURE, not by row, so the
                  // footer cell and the column above it cannot drift on
                  // currency, decimals or percent scaling. Alignment reads the
                  // same `numericColumns` set for the same reason.
                  const measure = compareOf(c) ?? c;
                  return (
                    <td
                      key={c}
                      className={cn('px-2 py-1 whitespace-nowrap tabular-nums', numericColumns.has(c) && 'text-right')}
                    >
                      {formatMeasure(totalsRow[c], measureField(measure)?.format, measureField(measure)?.currency, measureField(measure)?.percentScale, displayLocale)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {drillDrawer}
      </div>
    );
  }

  // Chart — route to the advanced renderer with the widget's TRUE chart family
  // (`chartType`, resolved at the top because the query reads it too) and one
  // series per measure. Series carry the measure display label so the legend
  // reads "Tasks" rather than "task_count".
  // Resolve select/enum dimension values → display labels before charting, so a
  // value-keyed group (e.g. status=`active`) shows its label (`合作中`) on the
  // axis with its count intact (cloud#667). `chartRows` stays index-aligned with
  // `state.rows`/`drillRawRows`, so drill-through still maps to the raw value.
  const chartRows = relabelDimensions(state.rows, dimensionLabels);
  // objectui#4500 — the null-category bucket's LABEL. `@object-ui/core` is
  // React-free and cannot read the locale bundle, so it falls back to the
  // English `NULL_CATEGORY_LABEL`; the resolved label has to come from here
  // (the same division ObjectChart uses — core takes the string, the renderer
  // holds the provider). ONE binding on purpose: `buildChartSeries` writes it
  // into the rendered rows and `findChartSeriesRow` matches a clicked category
  // against it, so the two drifting apart costs the bucket bar its drill —
  // a visible bar that silently no-ops (#4498's dead-click rule).
  // A name the dataset declares for the bucket (`fields[].nullLabel`,
  // objectstack#25330) wins over that global default.
  const nullCategoryLabel =
    declaredNullCategoryLabel(state.fields, dimensions, values) ?? tt('chart.nullCategory', '(None)');
  // ADR-0021 (#1759): shared helper — pivots a second dimension into grouped
  // series so multi-dimension dataset widgets match the chart-view renderer.
  //
  // `builtinAggregateLabels` (objectui#7258) is the same division for a
  // MEASURE's label: a result field the server minted as a built-in default
  // (`builtinAggregate: 'count'`, objectstack#14492) takes its series label
  // from the locale bundle here — `计数` on a zh console, not the server's
  // English `Count` — while an author-declared measure carries no discriminator
  // and keeps its wire `label` verbatim (objectui#4106).
  //
  // ── A dimensionless chart plots its MEASURES as the categories (objectui#11261) ──
  // Reached only by a chart of the bar family (bar / column / horizontal-bar)
  // or a line / area / combo with two or more measures (`isMetric` keeps every
  // other dimensionless widget a tile). The query
  // grouped by nothing, so it answered ONE row carrying every measure, the
  // `[]` grand-total grouping; that row is `state.rows[0]`, the same row the
  // tile reads. `buildChartSeries` would plot it as one unlabelled category
  // holding a series per measure. The spec states the other shape, one mark per
  // measure, so the row is transposed: one chart row per declared measure, in
  // declaration order, its category the measure's label (`headerLabel`, the
  // widget's one measure-label channel: the tile caption, the table header and
  // the comparison overlay all read it) and its value under a single series.
  // That series is labelled `dashboard.total`, the grouping this row IS and the
  // key the flat table's footer already prints for that same grouping, so no
  // new string is minted.
  const measuresOnAxis = dimensions.length === 0;
  const measureAxisSeriesLabel = tt('dashboard.total', 'Total');
  // The transposed series plots EVERY measure, so it states an aggregate only
  // when all of them share one (objectui#11681). That is what lets a value
  // axis over counts draw whole-number ticks; a mix states none, and the axis
  // keeps its default.
  const measureAxisAggregates = new Set(values.map((m) => measureField(m)?.aggregate));
  const [measureAxisAggregate] = measureAxisAggregates;
  const measureAxisSeries = {
    dataKey: MEASURE_VALUE_KEY,
    label: measureAxisSeriesLabel,
    ...(measureAxisAggregates.size === 1 && typeof measureAxisAggregate === 'string'
      ? { aggregate: measureAxisAggregate }
      : {}),
  };
  // ── A select dimension in its DECLARED order (objectui#11809) ──
  // The dataset answers its buckets in GROUP BY order — the stored values'
  // alphabetical order — so the axis read Backlog, Done, In Progress, In
  // Review, To Do, and a donut's legend High, Low, Medium, Urgent. The field's
  // own option order is the domain order (the Kanban lanes are drawn in it),
  // so the rows are put in it before they are
  // charted: declared options first, undeclared values next, the empty bucket
  // last. Only the copy that is CHARTED is reordered; `chartRows` keeps its
  // index alignment with `drillRawRows`, which the drill lookup below relies
  // on. An explicit `options.sortBy` is the author's order and is kept as the
  // dataset answered it.
  const categoryRank = measuresOnAxis || sortable ? null : buildCategoryRank(categoryOrder);
  const plotRows = categoryRank
    ? [...chartRows].sort(
        (a, b) =>
          declaredOptionPosition(a[dimensions[0]], categoryRank) -
          declaredOptionPosition(b[dimensions[0]], categoryRank),
      )
    : chartRows;
  const { data: chartData, xAxisKey, series: derivedSeries } = measuresOnAxis
    ? {
        data: values.map((m) => ({
          [MEASURE_CATEGORY_KEY]: headerLabel(m),
          [MEASURE_VALUE_KEY]: state.rows[0]?.[m],
          // The comparison window's value rides beside its measure, under the
          // single series' own `__compare` column, for the overlay below.
          ...(comparedValues.includes(m)
            ? { [compareColumn(MEASURE_VALUE_KEY)]: state.rows[0]?.[compareColumn(m)] }
            : {}),
        })),
        xAxisKey: MEASURE_CATEGORY_KEY,
        series: [measureAxisSeries],
      }
    : buildChartSeries(plotRows, dimensions, values, state.fields, {
        nullCategoryLabel,
        builtinAggregateLabels: builtinAggregateLabels(tt),
      });
  // The pivoted series — a second select dimension's values, which the legend
  // lists — in that dimension's declared order too (objectui#11809).
  // `buildChartSeries` pivots a second dimension into the series exactly when
  // the chart carries one measure (`pivotedSeries` below is the same test).
  const seriesRank = dimensions.length >= 2 && values.length === 1 && !sortable ? buildCategoryRank(seriesOrder) : null;
  const series = seriesRank
    ? [...derivedSeries].sort(
        (a, b) =>
          declaredOptionPosition(a.label, seriesRank, nullCategoryLabel) -
          declaredOptionPosition(b.label, seriesRank, nullCategoryLabel),
      )
    : derivedSeries;

  // The chart's STRUCTURE is the dataset's: the series and the category axis
  // above are emitted as derived, and nothing authored is merged onto them.
  // `chartConfig.series` / `xAxis` / `yAxis` used to merge their presentation
  // half here (#4229, through `mergeAuthoredPresentation`, which objectui#11372
  // has since removed from `@object-ui/core`).
  // `@objectstack/spec` 17.5.0 retired all three on a dashboard widget
  // (`DashboardWidgetChartConfigSchema`, ADR-0021 · ADR-0049 D2), so they are
  // refused at parse, and a stored widget that still carries them renders the
  // derivation, not an authored mark or axis (objectui#11315). `chartConfig`
  // keeps the chrome, lowered below.

  // Comparison overlay — one extra series per compared measure, carrying the
  // same `variant: 'comparison'` the inline chart's overlay uses (ObjectChart's
  // augmentedSeries), so AdvancedChartImpl draws it muted/dashed here too.
  // Skipped when buildChartSeries PIVOTED a second dimension into the series:
  // those series are dimension VALUES, not measures, so there is no per-measure
  // series a comparison could pair with (the `__compare` columns are still in
  // the rows — nothing is lost, it just isn't drawn as an overlay).
  //
  // A chart family that IGNORES `compareTo` (pie / donut / funnel / scatter)
  // needs no guard here: `compareTo` is already `undefined` for it (see its
  // definition at the top), so no comparison was queried and `comparedValues`
  // is empty (objectui#7495, objectui#7402).
  const pivotedSeries = dimensions.length >= 2 && values.length === 1;
  // The series a comparison pairs with: one per compared measure, or — on a
  // dimensionless chart (objectui#11261) — the single transposed series, whose
  // rows carry each compared measure's earlier value.
  const comparedSeries = measuresOnAxis
    ? (comparedValues.length > 0 ? [measureAxisSeries] : [])
    : comparedValues.map((m) => {
        const aggregate = measureField(m)?.aggregate;
        return { dataKey: m, label: headerLabel(m), ...(typeof aggregate === 'string' ? { aggregate } : {}) };
      });
  const comparisonSeries = pivotedSeries
    ? []
    : comparedSeries.map(({ dataKey, label, aggregate }) => {
        // An overlay is the SAME measure one period back. It carries no mark
        // and no axis of its own, and neither does its primary: on this
        // carrier no series is authored (objectui#11315), so the renderer
        // decides both for every series alike. Until then an overlay copied
        // its primary's MERGED mark and axis (#4229).
        return {
          dataKey: compareColumn(dataKey),
          label: `${label} · ${compareLabel}`,
          variant: 'comparison' as const,
          // The same measure one period back: the same aggregate, so it
          // never costs its axis the whole-number ticks (objectui#11681).
          ...(aggregate !== undefined ? { aggregate } : {}),
        };
      });
  const chartSeries = comparisonSeries.length > 0
    ? [...series.map((s) => ({ ...s, variant: 'current' as const })), ...comparisonSeries]
    : series;

  // Ordered-sequence charts (funnel/pyramid) need a DEFINED stage order.
  // `options.stageOrder` wins when the author states one explicitly; otherwise
  // the dimension field's declared picklist order does. Explicit values are
  // expanded with their display labels because `chartRows` may already be
  // relabeled — the same value-or-label keying `categoryColors` uses.
  const stageOrder = Array.isArray(options.stageOrder) ? options.stageOrder : undefined;
  const explicitOrder = stageOrder?.flatMap((v) => {
    const key = String(v);
    const label = dimensionLabels?.[dimensions[0]]?.[key];
    return label && label !== key ? [key, label] : [key];
  });
  const effectiveCategoryOrder = explicitOrder?.length ? explicitOrder : categoryOrder;

  // The widget's declared `chartConfig`, lowered onto the chart schema —
  // #3135 for `showLegend`, objectstack#7016 for the rest of the keys the chart
  // block measurably delivers. See `chartConfigPresentation` for the two
  // criteria a key has to meet, and for why `type`/`aria` are deliberately NOT
  // here; `xAxis`/`yAxis`/`series` are not read at all (see the series above,
  // objectui#11315). It also owns the `colors` split, so the per-category map
  // it returns already carries the dimension field's own option colours
  // underneath any explicit author map.
  const chartPresentation = chartConfigPresentation(widget?.chartConfig, categoryColors);

  // Map a clicked chart segment back to its dataset row, then drill through to
  // the underlying records — same governed path the table/pivot rows use.
  const handleChartDrill = (ev: ChartSegmentClickEvent) => {
    // `categoryId` is the clicked bucket's IDENTITY (objectui#4508) and is
    // forwarded whenever the renderer could read one: it is what separates two
    // bars painting the same axis text — a stored `'(None)'` beside the null
    // bucket — so each drills to the rows its own bar was drawn from. Absent,
    // the category text identified the bucket on its own and the lookup says so.
    const idx = findChartSeriesRow(chartRows, dimensions, values, ev?.category, ev?.series, {
      nullCategoryLabel,
      bucketId: ev?.categoryId,
    });
    if (idx < 0) return;
    // `series` is a real (second) dimension value only when pivoted; otherwise
    // it's the measure name — omit it from the drawer title.
    //
    // The title reads the LABEL, not the key (objectui#4682). `ev.series` is a
    // renderer `dataKey`, and the lookup above is the only thing that should
    // consult it: for every ordinary group the key IS the label, but a group
    // whose label cannot name it keys by its `chartBucketId` instead
    // (objectui#4508's collision on the series axis, reachable since
    // objectui#4673), and the drawer then announced `Backlog / [null]` over a
    // segment the user saw labelled `(None)` — the right records under a title
    // that reads as broken data. `seriesLabel` is absent wherever the renderer
    // knew no label, so every other chart's title is byte-identical.
    const pivoted = dimensions.length >= 2 && values.length === 1;
    const seriesTitle = ev?.seriesLabel ?? ev?.series;
    const title = [ev?.category, pivoted ? seriesTitle : undefined].filter(Boolean).map(String).join(' / ');
    openDrill(idx, title);
  };

  // The `chart` schema renders through either ChartRenderer (reads `onChartClick`)
  // or ObjectChart (reads `onSegmentClick` and suppresses its own object-drill) —
  // pass both so the segment click drills regardless of which is registered.
  const chartDrill = canDrill ? handleChartDrill : undefined;
  return (
    <div className={cn('relative h-full w-full min-h-[220px]')}>
      {refreshBar}
      <SchemaRenderer
        // isAnimationActive: false — dashboard charts render at final geometry on
        // the FIRST committed frame. Recharts' entrance animation is a rAF tween
        // that starts at height 0 and, inside react-grid-layout's mount-time
        // measurement churn, can freeze there — bars never draw until an unrelated
        // re-render (#2756, follow-up to #2727's ineffective settle re-mount).
        // Turning the tween off makes the first paint deterministic.
        schema={{ type: 'chart', chartType, data: chartData, xAxisKey, series: chartSeries, isAnimationActive: false, ...chartPresentation, ...(effectiveCategoryOrder ? { categoryOrder: effectiveCategoryOrder } : {}) } as any}
        onChartClick={chartDrill}
        onSegmentClick={chartDrill}
      />
      {drillDrawer}
    </div>
  );
}
