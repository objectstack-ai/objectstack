/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEASURE half of a chart / table / cross-tab drill (ADR-0021 D2,
 * objectstack-ai/objectstack#30615) — the sibling of `./metricDrill`, which
 * does the same for a KPI tile.
 *
 * A dataset number is computed under the dataset's own `filter`, the measure's
 * own `filter` and the widget filter at once. Only the last is the widget's;
 * the server states the other two per measure as the answer's `drillScopes`
 * (`{}` = nothing beyond the bucket and the widget filter). A measure with no
 * entry (a derived measure, or a scope that names a relationship path) has no
 * record list that matches its number and offers no drill, and so does every
 * measure of an answer that carries no `drillScopes` at all.
 *
 * A drill therefore stands for a MEASURE, not only for a bucket: a chart mark
 * for its series' measure, a cross-tab cell for its column's, a table row for
 * every measure it holds, which is one list only when they all agree on one
 * scope ({@link sharedMeasureDrillScope}).
 *
 * ⛔ Every "cannot tell" answers `undefined`, never a looser scope.
 */

import { composeDrillFilter } from '@object-ui/core';
import { readMeasureDrillScope } from './metricDrill';

/** Key-order-free spelling of a JSON condition, so two equal scopes compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * The one scope every measure in `measures` shares on `answer`, or `undefined`
 * when any of them has no entry, or two of them select different records (a
 * row holding a plain count beside a filtered count stands for two lists).
 */
export function sharedMeasureDrillScope(
  answer: { drillScopes?: unknown } | null | undefined,
  measures: readonly string[],
): Record<string, unknown> | undefined {
  if (measures.length === 0) return undefined;
  const first = readMeasureDrillScope(answer, measures[0]);
  if (!first) return undefined;
  const key = canonical(first);
  for (const m of measures.slice(1)) {
    const scope = readMeasureDrillScope(answer, m);
    if (!scope || canonical(scope) !== key) return undefined;
  }
  return first;
}

/**
 * A scope is one measure's list filter (`{}` = no leg beyond the bucket and
 * the widget filter).
 *
 * The widget filter a drill composes with the clicked bucket: `runtimeFilter`
 * AND the measure's scope. A `{}` scope hands `runtimeFilter` back UNTOUCHED,
 * so a drill on an unfiltered measure is byte-identical to the bucket-and-
 * widget-filter drill it always was. Throws the sink's `FilterOperatorError`
 * on a refused filter, which `openDrill` already reports.
 */
export function scopeDrillFilter(runtimeFilter: unknown, scope: Record<string, unknown>): unknown {
  if (Object.keys(scope).length === 0) return runtimeFilter;
  return composeDrillFilter(runtimeFilter, scope);
}
