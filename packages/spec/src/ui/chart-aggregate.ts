// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Object-bound chart aggregation — the shape, and the **result-column naming
 * convention** its axis bindings resolve against (issue #3701).
 *
 * ## Why this file exists
 *
 * A chart binds its data one of two ways:
 *
 *   * **dataset-bound** (ADR-0021) — `dataset` + `dimensions` + `values`.
 *     Result rows are keyed by the DECLARED dimension/measure NAME
 *     (`sum_amount`), because a `DatasetMeasure` carries an explicit `name`.
 *     That explicit name is what lets `validate-chart-bindings` resolve an
 *     axis against the dataset.
 *   * **object-bound** — `objectName` + an inline `aggregate`. Rows come back
 *     from one ad-hoc `IDataEngine.aggregate()` call. Nothing here carries an
 *     author-chosen name, so until now nothing in the repo said what the
 *     result columns are called — and an axis binding that cannot be resolved
 *     cannot be validated (#3701, split out of #3583 Phase 2 / #3684).
 *
 * The runtime has in fact always agreed on an answer; it was simply never
 * written down. All four paths that can serve an object-bound chart produce
 * the SAME columns:
 *
 *   | path | category column | value column |
 *   |---|---|---|
 *   | engine `aggregate()` w/ structured groupBy (`objectui` ObjectChart) | `groupBy.alias ?? groupBy.field` | the aggregation `alias`, which ObjectChart sets to `field \|\| function` |
 *   | legacy analytics/cube query | `groupBy` | remapped back to `field` |
 *   | client-side fallback (`aggregateRecords`) | `groupBy` | `field` |
 *   | the console's own object chart-view wiring (`ObjectView`) | `xAxisKey: groupBy` | `series[].dataKey: field` |
 *
 * So the convention below is a RECORD of the contract the renderers already
 * implement, not a new invention — which is the only defensible basis for a
 * lint rule (ADR-0072 D1: a false positive is what makes authors stop trusting
 * the linter; ADR-0078 §5: verify, then enforce).
 *
 * ## The convention
 *
 * An object-bound aggregate query returns one row per group, keyed by the RAW
 * FIELD NAMES it was given — there is no `sum_`/`_sum` decoration:
 *
 * ```ts
 * { field: 'total', function: 'sum', groupBy: 'status' }
 * // →  [{ status: 'open', total: 1200 }, { status: 'paid', total: 800 }, …]
 * ```
 *
 *   * **category column** = the `groupBy` field name (`groupBy.alias ??
 *     groupBy.field` when `groupBy` is a structured node).
 *   * **value column** = `aggregate.field`. Only `count` may omit `field`; the
 *     column is then the literal `'count'` (the fieldless-count alias).
 *   * **comparison column** — when a chart also renders a period-over-period
 *     overlay, the previous window's value arrives under the value column plus
 *     {@link CHART_AGGREGATE_COMPARISON_SUFFIX} (`total__comparison`).
 *
 * Contrast this with the dataset path deliberately: there the value column is
 * the measure's `name`, NOT the underlying field, which is exactly the trap
 * `chart-measure-unknown` catches. The two paths key their rows differently
 * because only one of them has an author-chosen name to key by.
 *
 * ## No business logic here (Prime Directive #2)
 *
 * The helpers below are pure contract derivations — they map a declaration to
 * the column names the contract says it produces, the same way
 * `data/display-name.ts` derives a title field from an object declaration.
 * They exist so producers (renderers) and checkers (lint) cannot drift apart
 * by each re-deriving the rule. The SHAPE they read — `ChartAggregateSchema`
 * — lives with the other chart schemas in `chart.zod.ts`, per Zod-First.
 */

/**
 * Suffix the previous-window value carries when a chart renders a
 * period-over-period comparison overlay: `total` → `total__comparison`.
 */
export const CHART_AGGREGATE_COMPARISON_SUFFIX = '__comparison';

/** The subset of {@link ChartAggregate} the naming rule reads. */
export interface ChartAggregateLike {
  field?: string;
  function?: string;
  groupBy?: unknown;
}

/**
 * The CATEGORY column an object-bound aggregate produces — what a chart's
 * x-axis binding must name.
 *
 * `undefined` when `groupBy` is absent or malformed: an ungrouped aggregate
 * returns a single row with no category column at all.
 */
export function chartAggregateCategoryKey(aggregate: ChartAggregateLike | undefined): string | undefined {
  const groupBy = aggregate?.groupBy;
  if (typeof groupBy === 'string') return groupBy || undefined;
  if (groupBy && typeof groupBy === 'object' && !Array.isArray(groupBy)) {
    const node = groupBy as { field?: unknown; alias?: unknown };
    const alias = typeof node.alias === 'string' && node.alias ? node.alias : undefined;
    const field = typeof node.field === 'string' && node.field ? node.field : undefined;
    return alias ?? field;
  }
  return undefined;
}

/**
 * The VALUE column an object-bound aggregate produces — what a chart's series
 * / y-axis binding must name.
 *
 * `aggregate.field`, or the literal `'count'` for a fieldless count (the alias
 * the engine projects `COUNT(*)` under). `undefined` when neither applies,
 * i.e. a non-count aggregate with no `field` — a declaration
 * {@link ChartAggregateSchema} already rejects.
 */
export function chartAggregateValueKey(aggregate: ChartAggregateLike | undefined): string | undefined {
  const field = aggregate?.field;
  if (typeof field === 'string' && field) return field;
  return aggregate?.function === 'count' ? 'count' : undefined;
}

/**
 * Every column name an object-bound aggregate can put on a result row — the
 * exact set an axis binding may resolve against.
 *
 * `comparison` is only ever present alongside `value`; a chart without a
 * `compareTo` overlay simply never emits that column, so binding a series to
 * it plots nothing. It is included here because a chart WITH the overlay binds
 * it legitimately, and a checker must not flag that as unknown.
 */
export function chartAggregateResultKeys(aggregate: ChartAggregateLike | undefined): {
  category?: string;
  value?: string;
  comparison?: string;
} {
  const category = chartAggregateCategoryKey(aggregate);
  const value = chartAggregateValueKey(aggregate);
  return {
    category,
    value,
    comparison: value ? `${value}${CHART_AGGREGATE_COMPARISON_SUFFIX}` : undefined,
  };
}
