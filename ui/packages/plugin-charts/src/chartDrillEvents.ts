/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Pure mappers from a Recharts element-click payload to the shared
 * `{ category, series, value }` drill event consumed by ObjectChart's drill
 * drawer. Kept separate from AdvancedChartImpl so the (Recharts-shape-sensitive)
 * payload extraction can be unit-tested without rendering a chart.
 */

export interface ChartDrillEvent {
  category?: string;
  series?: string;
  value?: number;
}

interface SeriesLike {
  dataKey?: string;
}

function seriesKey(series: SeriesLike[] | undefined): string {
  return series?.[0]?.dataKey || 'value';
}

/**
 * Scatter point click. Recharts spreads the data row onto the node and also
 * exposes it under `.payload`; we read the category (xAxisKey) and the
 * y-measure from whichever is present. Returns `null` when there's no category.
 */
export function mapScatterClick(
  node: any,
  xAxisKey: string,
  series: SeriesLike[] | undefined,
): ChartDrillEvent | null {
  if (!node) return null;
  const row = node.payload ?? node;
  const cat = row?.[xAxisKey];
  if (cat == null) return null;
  const dk = seriesKey(series);
  return {
    category: String(cat),
    series: dk,
    value: typeof row?.[dk] === 'number' ? row[dk] : undefined,
  };
}

/**
 * Treemap tile click. The node carries the category label as `name` and the
 * measure as `value`/`size`. Returns `null` when there's no name.
 */
export function mapTreemapClick(
  node: any,
  series: SeriesLike[] | undefined,
): ChartDrillEvent | null {
  if (!node) return null;
  const name = node.name ?? node.payload?.name ?? node.root?.name;
  if (name == null) return null;
  const val = node.value ?? node.size ?? node.payload?.size;
  return {
    category: String(name),
    series: seriesKey(series),
    value: typeof val === 'number' ? val : undefined,
  };
}

/**
 * Sankey click. Drill only on flow *nodes* (categories): links carry
 * source/target indices but no `name`, and the synthetic root node (depth 0)
 * aggregates everything. Returns `null` for those so they don't drill.
 */
export function mapSankeyClick(
  payload: any,
  series: SeriesLike[] | undefined,
): ChartDrillEvent | null {
  if (!payload) return null;
  const node = payload.payload ?? payload;
  const name = node?.name;
  if (name == null || node?.depth === 0) return null;
  return {
    category: String(name),
    series: seriesKey(series),
    value: typeof node?.value === 'number' ? node.value : undefined,
  };
}
