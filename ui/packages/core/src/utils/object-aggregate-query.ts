/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * object-aggregate-query — the ONE answer to "which CALL does an object-bound
 * `aggregate` make when its authored `groupBy` is the structured node?"
 * (objectui#8613).
 *
 * ## The two wires, and why the choice is not cosmetic
 *
 * An authored `aggregate.groupBy` is a union: a bare field name, or the
 * structured date-bucketing node `{ field, dateGranularity?, alias? }` — the
 * union `ChartGroupBySchema` declares and `GroupByNodeSchema` (the query AST)
 * mirrors. The adapter routes on the SHAPE of the params it is handed, not on
 * the shape of the authored value:
 *
 *   - `{ groupBy: GroupByNode[], aggregations, where }` — the spec-shape query,
 *     which reaches `engine.aggregate` and runs the server-side date-bucket
 *     engine;
 *   - `{ field, function, groupBy, filter }` — the legacy cube/analytics query,
 *     whose `dimensions` the contract declares as an array of dimension NAMES
 *     and which does NOT honour `dateGranularity` at all.
 *
 * So a structured node forwarded on the legacy wire is posted as a dimension
 * OBJECT where a name is declared: the author asks for monthly buckets and the
 * platform answers a different question, with no diagnostic on the way. That is
 * the defect objectui#8613 records on the metric path, and it was reachable
 * there only because this payload was spelled INSIDE one renderer
 * (`ObjectChart.runAggregate`) rather than anywhere a second renderer could
 * reuse it.
 *
 * ## Why a shared module rather than a second copy
 *
 * The alternative was to transcribe the eight lines into the metric widget.
 * That is the objectui#5042 / #7544 / #8193 / #8266 / #8269 drift shape — a
 * second opinion of one question, with nothing keeping the two in agreement —
 * and it is the same shape those cards' fixes (`chartMeasureKey`,
 * `chartCategoryKey`) exist to end, one column at a time. This module is that
 * move applied to the REQUEST rather than to a result column.
 *
 * ## What is NOT here
 *
 * The legacy bag itself. The two renderers do not agree on it and should not be
 * made to: a chart passes the authored `groupBy` through untouched, while a
 * metric floors an absent one at `'_all'` (one bucket) because it paints a
 * single number. Folding that difference into a shared builder would put a
 * renderer's own default into a module that has no business holding one, so the
 * shared part stops exactly where the agreement stops.
 */

import type { ChartGroupBy } from '@objectstack/spec/ui';
import { chartMeasureKey, type ChartAggregateLike } from './chart-measure-key.js';

/**
 * The STRUCTURED arm of the contract's `groupBy` union — the date-bucketing
 * node, as distinct from the bare field name the same union admits.
 *
 * Extracted from `ChartGroupBy` rather than restated, so a member added to the
 * node upstream (as `alias` once was) arrives here without an edit.
 */
export type StructuredGroupBy = Extract<ChartGroupBy, { field: string }>;

/**
 * The spec-shape aggregate query's `aggregations[]` entry, as
 * `AggregationNodeSchema` declares it: `alias` is REQUIRED (it names the column
 * the measure is projected under), `field` is optional because a `count` counts
 * rows rather than a column.
 */
export interface ObjectAggregationNode {
  function?: string;
  alias: string;
  field?: string;
}

/** The spec-shape query body — `{ groupBy: GroupByNode[], aggregations, where }`. */
export interface ObjectAggregateSpecQuery {
  groupBy: StructuredGroupBy[];
  aggregations: ObjectAggregationNode[];
  where: unknown;
}

/**
 * Is this authored `aggregate.groupBy` the structured node rather than a bare
 * field name?
 *
 * ⚠️ An ARRAY answers `false`. It is an object, but it is not this union's
 * object arm — neither `ChartGroupBySchema` nor `ObjectMetricPropsSchema`'s
 * `aggregate` admits one at this position, and `data-objectstack`'s adapter
 * already refuses it at the wire (`503cd8b89`). Letting it through here would
 * wrap it into `groupBy: [[…]]` and turn a producer-side refusal into a
 * malformed query.
 */
export function isStructuredGroupBy(groupBy: unknown): groupBy is StructuredGroupBy {
  return !!groupBy && typeof groupBy === 'object' && !Array.isArray(groupBy);
}

/**
 * The spec-shape aggregate query for an object-bound `aggregate` whose
 * `groupBy` is the structured node.
 *
 * The measure is projected under {@link chartMeasureKey}'s answer — the raw
 * field name, or the literal `'count'` for a fieldless count — so a caller's
 * existing result readback finds the value under the key it already looks for,
 * and a chart's series binding names the column the rows actually carry.
 *
 * `field` is omitted for `count` so the engine emits `count(*)`: the dashboard
 * relays default `field: 'value'` for a widget with no explicit measure column,
 * and `count(value)` crashes SQL drivers with "no such column: value" on the
 * count-the-rows case that is the common one.
 *
 * @param aggregate the authored inline aggregate
 * @param groupBy   its `groupBy`, already narrowed by {@link isStructuredGroupBy}
 * @param where     the resolved filter, in the spec Query DSL's `where` position
 */
export function objectAggregateSpecQuery(
  aggregate: ChartAggregateLike,
  groupBy: StructuredGroupBy,
  where: unknown,
): ObjectAggregateSpecQuery {
  const aggFn = aggregate.function;
  const node: ObjectAggregationNode = {
    function: aggFn,
    alias: chartMeasureKey(aggregate, aggFn || 'count'),
  };
  if (aggFn !== 'count' && aggregate.field) node.field = aggregate.field;
  return { groupBy: [groupBy], aggregations: [node], where };
}
