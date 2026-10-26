// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25906] The one resolution of a requested measure name to the key a
 * dataset scope's per-measure records hold it under: `measureFilters` and
 * `measureDurations` (`DatasetScope`), both keyed by the measure's bare name.
 *
 * The cube door accepts a measure by its bare name or as `<cube>.<name>`, the
 * spelling the discovery surface lists every cube member under
 * (`AnalyticsService.getMeta`), and `lookupMember` resolves both to the same
 * cube measure. A reader of a scoped record that looks the measure up by the
 * spelling as asked misses under the qualified one, and the measure then
 * aggregates without its filter: a silent wrong number under the measure's
 * own name. So every reader of either record asks here, and the two spellings
 * cannot answer differently on any of them.
 *
 * Own keys only, so a measure named after an `Object.prototype` member
 * (`constructor`) is never read as an entry it is not. Only the measure's own
 * cube qualifies it: any other dotted prefix keys nothing here.
 */

import type { FilterCondition } from '@objectstack/spec/data';
import type { DatasetScope } from './strategies/types.js';

/**
 * The key in `record` that the member `name` names, or `undefined`: `name`
 * itself, else `name` without its `<cubeName>.` qualifier, when the caller
 * passes the cube's name.
 */
export function scopedMeasureKey(
  record: Readonly<Record<string, unknown>> | undefined,
  name: string,
  cubeName?: string,
): string | undefined {
  if (!record || typeof name !== 'string') return undefined;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(record, key);
  if (own(name)) return name;
  const prefix = cubeName ? `${cubeName}.` : undefined;
  if (prefix && name.startsWith(prefix) && own(name.slice(prefix.length))) return name.slice(prefix.length);
  return undefined;
}

/** The scoped filter of the measure `name` names, or `undefined`: {@link scopedMeasureKey} over `scope.measureFilters`. */
export function scopedMeasureFilter(
  scope: Pick<DatasetScope, 'measureFilters'> | undefined,
  name: string,
  cubeName?: string,
): FilterCondition | undefined {
  const filters = scope?.measureFilters;
  const key = scopedMeasureKey(filters, name, cubeName);
  return key === undefined ? undefined : filters![key];
}
