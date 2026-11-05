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
 *   filter is written with date macros. A FORWARD window steps back the same
 *   way (objectstack#30140): `next_month_*` / `next_quarter_*` become the
 *   current month / quarter, and the rolling `{today}` … `{N_days_from_now}`
 *   pair becomes the N + 1 days that end yesterday.
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

/**
 * The forward calendar tokens a dashboard date-range preset emits
 * (`next_month`, `next_quarter`), mapped to the period just before them: the
 * current one. Without this map a forward window kept its own tokens and was
 * compared with itself, so the delta always read 0 (objectstack#30140).
 *
 * Only the pairs that close a window are listed. `next_week_start` and
 * `next_year_start` have no `_end` partner in the macro vocabulary, so no
 * preset or closed filter is written with them.
 */
const NEXT_TO_CURRENT_TOKENS: Record<string, string> = {
  next_month_start: 'current_month_start',
  next_month_end: 'current_month_end',
  next_quarter_start: 'current_quarter_start',
  next_quarter_end: 'current_quarter_end',
};

/** Every token `previousPeriod` moves back one period, backward and forward. */
const PREVIOUS_PERIOD_TOKENS: Record<string, string> = {
  ...CURRENT_TO_LAST_TOKENS,
  ...NEXT_TO_CURRENT_TOKENS,
};

const WHOLE_TOKEN_RE = /^\$?\{([a-zA-Z0-9_]+)\}$/;
const DAYS_FROM_NOW_RE = /^(\d+)_days_from_now$/;

/** The bare token a string is made of, or undefined when it is anything else. */
function wholeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.match(WHOLE_TOKEN_RE)?.[1];
}

/**
 * The two places a forward rolling window can sit in: the operator entries of
 * one field's condition (`{ $gte: '{today}', $lte: '{30_days_from_now}' }`)
 * or the two members of a `$between` array. Returns the replacement for each
 * bound, by position, when the pair is `{today}` and `{N_days_from_now}`, else
 * undefined. Two FIELDS that hold those tokens (`{ a: '{today}', b: … }`) are
 * not one window, which is why only `$`-keyed entries are read.
 *
 * That window holds today and the N days after it, N + 1 days in all
 * (`next_30_days`, `DATE_RANGE_PRESET_MACRO_WINDOWS`). The equal-length window
 * just before it ends yesterday and starts N + 1 days ago, so both bounds move
 * back by the window's own length: `{today}` → `{(N+1)_days_ago}` and
 * `{N_days_from_now}` → `{yesterday}`. The generic `today` → `yesterday`
 * substitution would have moved only the start, overlapping the current window
 * on every day but one.
 */
function forwardRollingPair(values: readonly unknown[]): Map<number, string> | undefined {
  const tokens = values.map(wholeToken);
  const todayAt = tokens.indexOf('today');
  if (todayAt === -1 || tokens.lastIndexOf('today') !== todayAt) return undefined;
  const forward = tokens
    .map((tok, i) => ({ i, m: tok?.match(DAYS_FROM_NOW_RE) }))
    .filter((x) => x.m);
  if (forward.length !== 1) return undefined;
  const n = parseInt(forward[0].m![1], 10);
  return new Map([
    [todayAt, `{${n + 1}_days_ago}`],
    [forward[0].i, '{yesterday}'],
  ]);
}

/** Rewrite every forward rolling window in `value` to the window just before it. */
function shiftForwardRollingWindows<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const pair = value.length === 2 ? forwardRollingPair(value) : undefined;
    return value.map((v, i) => pair?.get(i) ?? shiftForwardRollingWindows(v)) as any;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const operators = Object.keys(value as any).filter((k) => k.startsWith('$'));
  const pair = forwardRollingPair(operators.map((k) => (value as any)[k]));
  const out: Record<string, any> = {};
  for (const k of Object.keys(value as any)) {
    const at = operators.indexOf(k);
    out[k] = (at === -1 ? undefined : pair?.get(at)) ?? shiftForwardRollingWindows((value as any)[k]);
  }
  return out as any;
}

/** Does `value` hold a window {@link shiftForwardRollingWindows} would move? */
function hasForwardRollingWindow(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return (value.length === 2 && !!forwardRollingPair(value)) || value.some(hasForwardRollingWindow);
  }
  const entries = Object.entries(value as object);
  const operands = entries.filter(([k]) => k.startsWith('$')).map(([, v]) => v);
  return !!forwardRollingPair(operands) || entries.some(([, v]) => hasForwardRollingWindow(v));
}

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
 *   before resolving. A forward window moves back first: `next_month_*` /
 *   `next_quarter_*` become `current_*`, and `{today}` … `{N_days_from_now}`
 *   becomes `{(N+1)_days_ago}` … `{yesterday}` (objectstack#30140). Each token
 *   is substituted once, so no window moves back twice.
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
  // previousPeriod. The rolling pair goes first, so it claims its `{today}`
  // before the generic `today` → `yesterday` swap can; the tokens it writes
  // are keys of neither map. Both maps then apply in ONE pass: a second pass
  // would carry `next_month_start` on through `current_month_start` to
  // `last_month_start`.
  const rolled = shiftForwardRollingWindows(filter);
  const substituted = substituteTokens(rolled, PREVIOUS_PERIOD_TOKENS);
  return resolveDateMacros(substituted, now);
}

/**
 * Derive a translation key suffix (under `dashboard.trend.*`) describing the
 * comparison window. Used by metric widgets to label the trend delta.
 *
 * The key names the window {@link shiftFilterByCompareTo} really compares
 * with. A forward month or quarter compares with the CURRENT one
 * (`vsThisMonth` / `vsThisQuarter`), and a forward rolling window with the
 * equal-length days before it (`vsPreviousPeriod`) (objectstack#30140). Each
 * forward check sits before the backward check whose pattern also matches it
 * (`quarter_start` is inside `next_quarter_start`).
 */
export function compareToTrendLabelKey(
  compareTo: CompareToConfig,
  filter?: unknown,
): string {
  if (compareTo.kind === 'previousYear') return 'vsLastYear';
  // previousPeriod — sniff the dominant token in the filter
  const json = filter ? JSON.stringify(filter) : '';
  if (/current_year_|year_start|year_end/.test(json)) return 'vsLastYear';
  if (/next_quarter_(start|end)/.test(json)) return 'vsThisQuarter';
  if (/current_quarter_|quarter_start|quarter_end/.test(json)) return 'vsLastQuarter';
  if (/next_month_(start|end)/.test(json)) return 'vsThisMonth';
  if (/current_month_|month_start|month_end/.test(json)) return 'vsLastMonth';
  if (/current_week_|week_start|week_end/.test(json)) return 'vsLastWeek';
  if (hasForwardRollingWindow(filter)) return 'vsPreviousPeriod';
  if (/\btoday\b/.test(json)) return 'vsYesterday';
  return 'vsPreviousPeriod';
}
