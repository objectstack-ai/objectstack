/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { resolveDateMacros } from './date-macros.js';

/**
 * Period-over-period comparison config for dashboard widgets.
 *
 * Converged (objectstack#5011) onto the contract the analytics executor
 * already implements — `DatasetSelection.compareTo`, i.e. `DatasetCompareTo`
 * in `@objectstack/spec` (`contracts/analytics-service.ts`). This type is that
 * contract's thin projection, so the same widget key means the same thing on
 * the ADR-0021 dataset path and on this legacy inline object-provider path.
 *
 * - `kind: 'previousPeriod'` — the equal-length window immediately before the
 *   current one. On the inline path that is done by substituting `current_*` /
 *   `today` date macro tokens with their `last_*` / `yesterday` counterparts
 *   (`current_quarter_start` → `last_quarter_start`), so it works best when the
 *   filter is written with date macros.
 * - `kind: 'previousYear'` — re-resolve the filter's date macros against a
 *   `now` shifted back one calendar year (same week / month / quarter, one year
 *   earlier).
 * - `dimension` — OPTIONAL, and deliberately never read on this path. It names
 *   the dataset time dimension whose `dateRange` the EXECUTOR shifts. That
 *   resolution lives at the producer of the comparison so that every caller
 *   gets the same answer or the same loud error; a renderer that guessed a
 *   dimension would trade "loud error" for "quietly wrong window" — precisely
 *   the failure class this convergence exists to end.
 *
 * **Design note — a plain strict object, NOT a union** (objectstack#5011,
 * framework#5014). The retired shape was a three-branch union
 * (`'previousPeriod' | 'previousYear' | { offset }`); zod collapses a failed
 * union into a bare `Invalid input`, so the prescriptions written inside each
 * arm never reached the author. One strict object keeps the rejection specific.
 * It also leaves this renderer with exactly one contract to read — no second
 * de-facto dialect to be tolerant about (AGENTS.md #0.1).
 *
 * The `{ offset: '7d' | '1M' | '1y' }` arm went with the union: `{ offset: '1y' }`
 * IS `kind: 'previousYear'` (rewritten deterministically upstream), while
 * `'7d'` / `'1M'` have no faithful target — an author restates that window on
 * the widget's own `filter` and asks for `kind: 'previousPeriod'` (registered
 * semantic migration `dashboard-widget-compareto-offset`).
 */
export interface CompareToConfig {
  kind: 'previousPeriod' | 'previousYear';
  dimension?: string;
}

const CURRENT_TO_LAST_TOKENS: Record<string, string> = {
  current_week_start: 'last_week_start',
  current_week_end: 'last_week_end',
  current_month_start: 'last_month_start',
  current_month_end: 'last_month_end',
  current_quarter_start: 'last_quarter_start',
  current_quarter_end: 'last_quarter_end',
  current_year_start: 'last_year_start',
  current_year_end: 'last_year_end',
  week_start: 'last_week_start',
  week_end: 'last_week_end',
  month_start: 'last_month_start',
  month_end: 'last_month_end',
  quarter_start: 'last_quarter_start',
  quarter_end: 'last_quarter_end',
  year_start: 'last_year_start',
  year_end: 'last_year_end',
  today: 'yesterday',
};

function substituteTokens<T>(value: T, map: Record<string, string>): T {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(/\$?\{([a-zA-Z0-9_]+)\}/g, (m, tok) => {
      const target = map[tok];
      return target ? `{${target}}` : m;
    }) as any;
  }
  if (Array.isArray(value)) return value.map((v) => substituteTokens(v, map)) as any;
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value as any)) out[k] = substituteTokens((value as any)[k], map);
    return out as any;
  }
  return value;
}

/**
 * Resolve a filter for a period-over-period comparison query. Dispatches on
 * `compareTo.kind` — the only discriminator the converged shape has:
 *
 * - `previousYear` — re-resolve date macros against a `now` shifted back by one year.
 * - `previousPeriod` — substitute `current_*` / `today` tokens with `last_*` / `yesterday`
 *   before resolving.
 */
export function shiftFilterByCompareTo<T = any>(
  filter: T,
  compareTo: CompareToConfig,
  now: Date = new Date(),
): T {
  if (compareTo.kind === 'previousYear') {
    const shifted = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );
    return resolveDateMacros(filter, shifted);
  }
  // previousPeriod
  const substituted = substituteTokens(filter, CURRENT_TO_LAST_TOKENS);
  return resolveDateMacros(substituted, now);
}

/**
 * Derive a translation key suffix (under `dashboard.trend.*`) describing the
 * comparison window. Used by metric widgets to label the trend delta.
 */
export function compareToTrendLabelKey(
  compareTo: CompareToConfig,
  filter?: unknown,
): string {
  if (compareTo.kind === 'previousYear') return 'vsLastYear';
  // previousPeriod — sniff the dominant token in the filter
  const json = filter ? JSON.stringify(filter) : '';
  if (/current_year_|year_start|year_end/.test(json)) return 'vsLastYear';
  if (/current_quarter_|quarter_start|quarter_end/.test(json)) return 'vsLastQuarter';
  if (/current_month_|month_start|month_end/.test(json)) return 'vsLastMonth';
  if (/current_week_|week_start|week_end/.test(json)) return 'vsLastWeek';
  if (/\btoday\b/.test(json)) return 'vsYesterday';
  return 'vsPreviousPeriod';
}
