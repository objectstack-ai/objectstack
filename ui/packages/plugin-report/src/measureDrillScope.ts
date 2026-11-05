/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEASURE half of a report drill (ADR-0021 D2, objectstack-ai/objectstack#30615).
 *
 * A dataset number is computed under the dataset's own `filter`, the measure's
 * own `filter` and the report's `runtimeFilter` at once. This renderer never
 * reads the dataset definition, so the first two reach it only as the answer's
 * `drillScopes`: per selected measure, the list filter on the answer's
 * `object` that selects the records that measure aggregates (`{}` = nothing
 * beyond the bucket and the report scope). A measure with NO entry — a derived
 * measure, or a scope that names a relationship path — has no record list that
 * matches its number, and so offers no drill: "A tile whose dataset filter
 * cannot be expressed as a list filter offers no click, rather than a list
 * that does not match the number." (the ruling this card carries, #30080
 * comment 6631202970).
 *
 * A drill therefore stands for a MEASURE, not only for a bucket. A table row
 * holds every selected measure, so it stands for all of them at once, which is
 * a list only when they all agree on one scope ({@link sharedMeasureDrillScope}).
 *
 * ⛔ Every "cannot tell" here answers `undefined`, never a looser scope: a
 * malformed map or entry is read as no entry.
 */

import { composeDrillFilter } from '@object-ui/core';

/** One measure's list filter (`{}` = no leg beyond the bucket and the scope). */
export type MeasureDrillScope = Record<string, unknown>;

const isConditionObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The answer's `drillScopes` entry for `measure`, or `undefined` when the
 * answer has none: no map at all, no entry, or an entry that is not a
 * condition object.
 */
export function measureDrillScope(drillScopes: unknown, measure: string): MeasureDrillScope | undefined {
  if (!isConditionObject(drillScopes)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(drillScopes, measure)) return undefined;
  const entry = drillScopes[measure];
  return isConditionObject(entry) ? entry : undefined;
}

/** Key-order-free spelling of a JSON condition, so two equal scopes compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isConditionObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * The one scope every measure in `measures` shares, or `undefined` when any
 * of them has no entry, or two of them select different records (a row holding
 * a plain count beside a filtered count stands for two record lists, so the
 * row as a whole is no list: each measure cell drills on its own instead).
 */
export function sharedMeasureDrillScope(
  drillScopes: unknown,
  measures: readonly string[],
): MeasureDrillScope | undefined {
  if (measures.length === 0) return undefined;
  const first = measureDrillScope(drillScopes, measures[0]);
  if (!first) return undefined;
  const key = canonical(first);
  for (const m of measures.slice(1)) {
    const scope = measureDrillScope(drillScopes, m);
    if (!scope || canonical(scope) !== key) return undefined;
  }
  return first;
}

/**
 * The report scope a drill composes with the clicked bucket: `runtimeFilter`
 * AND the measure's scope. A `{}` scope hands `runtimeFilter` back UNTOUCHED,
 * so a drill on an unfiltered measure stays byte-identical to the
 * bucket-and-scope drill it always was. Composed through `composeDrillFilter`,
 * never spread, and it throws that seam's `FilterOperatorError` on a refused
 * filter, which the caller already reports.
 */
export function scopeDrillFilter(runtimeFilter: unknown, scope: MeasureDrillScope): unknown {
  if (Object.keys(scope).length === 0) return runtimeFilter;
  return composeDrillFilter(runtimeFilter, scope);
}
