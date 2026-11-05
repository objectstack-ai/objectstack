/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record list behind a dataset-bound KPI tile (ADR-0021 D2).
 *
 * A tile's number is the dataset's own scope AND the measure's own filter AND
 * the widget's filter (the dashboard's filters are already merged into it).
 * The first two live in the dataset definition, which this package never
 * reads: only the server knows them, so the tile drills only when the answer
 * hands over that measure's scope as a list filter. Without it, a tile whose
 * measure carries a filter would open more records than its number counts.
 *
 * Invariant: a tile offers a click only when its list provably matches its
 * number. Every "cannot tell" answer below is `null`, never a looser filter.
 */

import { buildDatasetDrillFilter, composeDrillFilter, FilterOperatorError } from '@object-ui/core';
import type { DatasetDrillRange } from '@object-ui/core';

export interface MetricDrillInput {
  /** The dataset's base object, from the answer (`object`). */
  object: string | undefined;
  /**
   * The tile measure's own scope as a list filter: the dataset's filter AND
   * the measure's filter, already lowered by the server.
   * - `undefined`: the answer did not say (no click).
   * - `null`: the server says the scope is not a list filter (no click).
   * - an object (possibly empty): that scope.
   */
  measureScope: Record<string, unknown> | null | undefined;
  /** The widget's resolved filter (placeholders already resolved). */
  runtimeFilter: unknown;
  /** The answer's date windows for the tile's single row (`drillRanges[0]`). */
  ranges?: Record<string, DatasetDrillRange>;
}

/**
 * The list filter a tile's click opens, or `null` when the tile must offer no
 * click. Computed before rendering, so a refused filter shows no affordance
 * instead of a click that does nothing.
 */
export function metricDrillFilter(input: MetricDrillInput): Record<string, unknown> | null {
  const { object, measureScope, runtimeFilter, ranges } = input;
  if (!object || measureScope == null) return null;
  try {
    const hasScope = Object.keys(measureScope).length > 0;
    const scoped = hasScope ? composeDrillFilter(runtimeFilter, measureScope) : runtimeFilter;
    return buildDatasetDrillFilter(undefined, [], {}, scoped, ranges);
  } catch (error) {
    if (error instanceof FilterOperatorError) return null;
    throw error;
  }
}

/**
 * Read the tile measure's scope off a dataset answer.
 *
 * The server sidecar this reads is not on the wire yet; until it is, every
 * answer reads as "did not say" and no tile offers a click.
 */
export function readMeasureDrillScope(
  _answer: unknown,
  _measure: string,
): Record<string, unknown> | null | undefined {
  return undefined;
}
