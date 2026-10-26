/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';

/** Returns true when the widget data config uses provider: 'object' (async data source). */
export function isObjectProvider(widgetData: unknown): widgetData is { provider: 'object'; object?: string; aggregate?: any; filter?: any } {
  return (
    widgetData != null &&
    typeof widgetData === 'object' &&
    !Array.isArray(widgetData) &&
    (widgetData as any).provider === 'object'
  );
}

/**
 * A record key → a human column header: `unit_price` / `unitPrice` → "Unit Price".
 *
 * Single home for the convention, because both halves of the `table` widget
 * family need it and they must agree: the object-bound path normalizes an
 * author's `string[]` shorthand with it (`normalizeColumns`), and the static
 * path derives headers with it when no columns were declared at all.
 */
export function humanizeFieldKey(key: string): string {
  return key
    // snake_case → spaces
    .replace(/_/g, ' ')
    // camelCase → spaces before uppercase letters
    .replace(/([A-Z])/g, ' $1')
    .trim()
    // Title Case each word
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * Resolve a chart series label — the SINGLE authority both dashboard relays
 * (`DashboardRenderer`, `DashboardGridLayout`) call, so the three-arm decision
 * below lives once instead of as two copies that could drift.
 *
 * Originated as a `DashboardRenderer`-local `useCallback` (objectui#9055,
 * which fixed arms 2 and 3 there). `DashboardGridLayout` composed
 * `series: [{ dataKey }]` with no `label` key on either of its branches — the
 * legend and tooltip rendered the raw field key while the sibling relay's
 * chart for the same widget rendered the humanized one (objectui#9172). That
 * card is what moved this here rather than growing a second copy of the
 * three-arm logic: a helper duplicated across the two relays is exactly the
 * "one value, two spellings" class `56f4e34c0` ruled out.
 *
 * ⭐ THREE ARMS, and only the last two derive a display string from a FIELD
 * KEY:
 *
 *   arm 1  synthetic y-field ('value' / 'count' / '') + an aggregate function
 *          -> an i18n'd aggregate name (Count / Sum / Average …), so a
 *          fieldless count aggregate doesn't leak the placeholder 'value' /
 *          'count' string into the legend / tooltip.
 *   arm 2  a real object + a real field -> `fieldLabel`'s bundle lookup, with
 *          the HUMANIZED key (not the raw one) as its fallback.
 *   arm 3  no object name at all (a static-data chart) -> the humanized key
 *          outright.
 *
 * `t` and `fieldLabel` are injected rather than the hooks themselves, so this
 * stays a plain function callable from either relay's own
 * `useObjectTranslation()` / `useObjectLabel()` instances — no shared hook
 * identity to manage, and each relay keeps memoizing its own `useCallback`
 * wrapper over this (objectui#10's caution against depending on a memo's
 * IDENTITY is about correctness, not about composing plain functions like
 * this one).
 */
export function composeSeriesLabel(
  t: ReturnType<typeof useObjectTranslation>['t'],
  fieldLabel: ReturnType<typeof useObjectLabel>['fieldLabel'],
  objectName: string | undefined,
  yField: string,
  aggFn: string | undefined,
): string {
  const isSynthetic = !yField || yField === 'value' || yField === 'count';
  if (aggFn && (isSynthetic || aggFn === 'count')) {
    return t(`report.aggregate.${aggFn}`, { defaultValue: aggFn });
  }
  const humanized = humanizeFieldKey(yField);
  if (objectName) {
    return fieldLabel(objectName, yField, humanized);
  }
  return humanized;
}

/**
 * Columns for a STATIC (inline `options.data`) table widget whose author
 * declared none — objectui#4618.
 *
 * `DataTableSchema.columns` is a REQUIRED key (`@object-ui/types`
 * `data-display.ts`), and a `data-table` handed rows but no columns draws one
 * empty `tr` per row: no `th`, no `td`, nothing readable. Both dashboard
 * surfaces built exactly that node whenever the widget carried only
 * `options.data`, so a documented authoring surface rendered a silent blank.
 *
 * The object-bound half of the same widget family has always derived columns
 * from the fetched rows when none were declared (`ObjectDataTable`), so this is
 * that behaviour reaching the static half — not a new capability. Keys come
 * from the FIRST row for the same reason it does there: the first record is the
 * shape the author is describing, and scanning every row would let one ragged
 * record widen the table.
 *
 * `_`-prefixed keys are internal bookkeeping and stay out. Non-record rows
 * (strings, numbers, arrays) have no keys to name, so they derive nothing and
 * the table renders its own empty state rather than a header row of noise.
 */
export function deriveStaticTableColumns(rows: unknown): Array<{ header: string; accessorKey: string }> {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0];
  if (first == null || typeof first !== 'object' || Array.isArray(first)) return [];
  return Object.keys(first as Record<string, unknown>)
    .filter((key) => !key.startsWith('_'))
    .map((key) => ({ header: humanizeFieldKey(key), accessorKey: key }));
}

// Re-export the date-macro resolver from core so existing internal imports
// (`import { resolveDateMacros } from './utils'`) keep working.
//
// Prefer `resolveFilterPlaceholders` in renderers: it expands BOTH placeholder
// vocabularies (date macros AND `{current_user_id}` / `{current_org_id}`).
// Calling `resolveDateMacros` alone is exactly what left every dashboard
// widget unable to resolve user-scoped filters — they silently rendered 0
// (objectstack-ai/objectstack#3574).
export { resolveDateMacros, resolveFilterPlaceholders } from '@object-ui/core';

// Re-export compareTo helpers from core for convenience.
export {
  shiftFilterByCompareTo,
  compareToTrendLabelKey,
  type CompareToConfig,
} from '@object-ui/core';

/**
 * A period-over-period delta as `computeMetricDelta` returns it.
 *
 * `value` is the absolute percentage change, or `null` when the change has no
 * percentage: a zero baseline with a non-zero current value (objectui#12677).
 * Going from 0 to 10 is not a 100% increase — a percent change from zero is
 * undefined — so the delta keeps its direction and states no number. Every
 * reader draws it through {@link formatMetricDeltaPercent}.
 */
export interface MetricDelta {
  value: number | null;
  direction: 'up' | 'down' | 'neutral';
}

/**
 * Compute a percentage delta between the current and previous metric values.
 *
 * Returns `null` when comparison is meaningless:
 * - current is not finite (null / undefined / NaN / Infinity)
 * - previousValue is null / undefined (no comparison data)
 *
 * Edge cases:
 * - both 0 → neutral, `value: 0`
 * - previous is 0 and current ≠ 0 → current's direction, `value: null` (no
 *   percentage is defined from a zero baseline; objectui#12677)
 * - previous is negative → uses |previous| as denominator so that "less
 *   negative" reads as a positive (up) delta.
 */
export function computeMetricDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): MetricDelta | null {
  if (previous === null || previous === undefined) return null;
  if (current === null || current === undefined) return null;
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return null;

  if (previous === 0) {
    if (current === 0) return { value: 0, direction: 'neutral' };
    return { value: null, direction: current > 0 ? 'up' : 'down' };
  }

  const diff = current - previous;
  if (diff === 0) return { value: 0, direction: 'neutral' };
  const pct = Math.round((diff / Math.abs(previous)) * 100);
  return {
    value: Math.abs(pct),
    direction: pct > 0 ? 'up' : 'down',
  };
}

/**
 * The text a delta badge draws for {@link MetricDelta.value}: `20%` for a
 * defined percentage, and an em dash — never a number — when there is none
 * (a zero baseline, objectui#12677). A symbol, not a word, so no locale pack
 * carries it. The direction arrow beside it still says which way it moved.
 */
export function formatMetricDeltaPercent(value: number | null): string {
  return value === null ? '\u2014' : `${value}%`;
}

