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
 * reads: the server hands them over per measure as the answer's `drillScopes`
 * entry, already lowered to a list filter on the answer's `object`. A measure
 * with no entry (a derived measure, or a scope naming a relationship path) has
 * no list that selects its records.
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
   * The tile measure's `drillScopes` entry: `undefined` when the answer has
   * none (no click), else the list filter its records need (`{}` = none).
   */
  measureScope: Record<string, unknown> | undefined;
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
  if (!object || measureScope === undefined) return null;
  try {
    const hasScope = Object.keys(measureScope).length > 0;
    const scoped = hasScope ? composeDrillFilter(runtimeFilter, measureScope) : runtimeFilter;
    return buildDatasetDrillFilter(undefined, [], {}, scoped, ranges);
  } catch (error) {
    if (error instanceof FilterOperatorError) return null;
    throw error;
  }
}

/** Read one measure's `drillScopes` entry off a dataset answer. */
export function readMeasureDrillScope(
  answer: { drillScopes?: unknown } | null | undefined,
  measure: string | undefined,
): Record<string, unknown> | undefined {
  const scopes = answer?.drillScopes;
  if (!measure || !scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return undefined;
  const entry = (scopes as Record<string, unknown>)[measure];
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : undefined;
}
