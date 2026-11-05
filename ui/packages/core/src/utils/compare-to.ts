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
 *   pair becomes the N + 1 days that end yesterday. A window that is ALREADY
 *   past steps back once more (objectstack#30197): `{yesterday}` becomes the
 *   day before it, `last_week_*` … `last_year_*` the period before last, and
 *   the rolling `{N_days_ago}` … `{today}` pair the N + 1 days before it.
 * - `kind: 'previousYear'` — re-resolve the filter's date macros against a
 *   `now` shifted back one calendar year (same week / month / quarter, one year
 *   earlier). From a 29 February the shifted day is 28 February, so the month
 *   stays February (objectstack#30197).
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
 * Only the forward periods a preset emits are listed. The spec vocabulary
 * also declares `next_week_*` and `next_year_*`, but this package's resolver
 * (`date-macros.ts`) has no `next_week_end` / `next_year_end`, so a closed
 * window written with them does not resolve here in the first place.
 */
const NEXT_TO_CURRENT_TOKENS: Record<string, string> = {
  next_month_start: 'current_month_start',
  next_month_end: 'current_month_end',
  next_quarter_start: 'current_quarter_start',
  next_quarter_end: 'current_quarter_end',
};

/** Every token `previousPeriod` moves back one period by renaming it. */
const PREVIOUS_PERIOD_TOKENS: Record<string, string> = {
  ...CURRENT_TO_LAST_TOKENS,
  ...NEXT_TO_CURRENT_TOKENS,
};

/** `YYYY-MM-DD` moved by whole days, months and years, on the UTC calendar. */
function isoShift(iso: string, { days = 0, months = 0, years = 0 }): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1 + months, d + days)).toISOString().slice(0, 10);
}

/**
 * The period before an already-past one, for the tokens that have no "two
 * periods back" spelling (objectstack#30197). The macro vocabulary
 * (`DATE_MACRO_TOKENS` in `@objectstack/spec/data`) stops at `last_*`, and the
 * parameterised `{N_weeks_ago}` / `{N_months_ago}` grammar counts from today
 * rather than from a period's first day, so no token names the month before
 * last. Each window is therefore COMPUTED: the `last_*` start is resolved in
 * the display zone like every other token, then moved back one period with
 * calendar arithmetic, and the end is the day before that `last_*` start. The
 * result is an ISO day, which `resolveDateMacros` passes through untouched.
 *
 * `{yesterday}` does have a spelling, `{2_days_ago}`, and keeps it.
 */
function lastPeriodBefore(token: string, now: Date): string | undefined {
  const m = token.match(/^last_(week|month|quarter|year)_(start|end)$/);
  if (!m) return token === 'yesterday' ? '{2_days_ago}' : undefined;
  const [, unit, edge] = m;
  const lastStart = resolveDateMacros(`{last_${unit}_start}`, now);
  if (edge === 'end') return isoShift(lastStart, { days: -1 });
  if (unit === 'week') return isoShift(lastStart, { days: -7 });
  if (unit === 'month') return isoShift(lastStart, { months: -1 });
  if (unit === 'quarter') return isoShift(lastStart, { months: -3 });
  return isoShift(lastStart, { years: -1 });
}

const WHOLE_TOKEN_RE = /^\$?\{([a-zA-Z0-9_]+)\}$/;
const ROLLING_DAYS_RE = /^(\d+)_days_(ago|from_now)$/;

/** The bare token a string is made of, or undefined when it is anything else. */
function wholeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.match(WHOLE_TOKEN_RE)?.[1];
}

/**
 * The two places a rolling window can sit in: the operator entries of one
 * field's condition (`{ $gte: '{today}', $lte: '{30_days_from_now}' }`) or the
 * two members of a `$between` array. Returns the replacement for each bound,
 * by position, when the pair is `{today}` and one `{N_days_from_now}` or
 * `{N_days_ago}`, else undefined. Two FIELDS that hold those tokens
 * (`{ a: '{today}', b: … }`) are not one window, which is why only `$`-keyed
 * entries are read.
 *
 * Either window holds today and N other days, N + 1 days in all
 * (`next_30_days`, `last_30_days`; `DATE_RANGE_PRESET_MACRO_WINDOWS`), so both
 * bounds move back by N + 1 days:
 *
 * - forward (objectstack#30140): `{today}` → `{(N+1)_days_ago}` and
 *   `{N_days_from_now}` → `{1_day_ago}`, the N + 1 days that end yesterday;
 * - backward (objectstack#30197): `{N_days_ago}` → `{(2N+1)_days_ago}` and
 *   `{today}` → `{(N+1)_days_ago}`, the N + 1 days that end the day before
 *   the window starts.
 *
 * The generic `today` → `yesterday` substitution would have moved only one
 * bound, overlapping the current window on every day but one. `{1_day_ago}`
 * is written rather than `{yesterday}` because `{yesterday}` is itself a token
 * the substitution moves back.
 */
function rollingPair(values: readonly unknown[]): Map<number, string> | undefined {
  const tokens = values.map(wholeToken);
  const todayAt = tokens.indexOf('today');
  if (todayAt === -1 || tokens.lastIndexOf('today') !== todayAt) return undefined;
  const rolling = tokens
    .map((tok, i) => ({ i, m: tok?.match(ROLLING_DAYS_RE) }))
    .filter((x) => x.m);
  if (rolling.length !== 1) return undefined;
  const n = parseInt(rolling[0].m![1], 10);
  const otherBound = rolling[0].m![2] === 'from_now' ? '{1_day_ago}' : `{${2 * n + 1}_days_ago}`;
  return new Map([
    [todayAt, `{${n + 1}_days_ago}`],
    [rolling[0].i, otherBound],
  ]);
}

/** Rewrite every rolling window in `value` to the equal-length window just before it. */
function shiftRollingWindows<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const pair = value.length === 2 ? rollingPair(value) : undefined;
    return value.map((v, i) => pair?.get(i) ?? shiftRollingWindows(v)) as any;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const operators = Object.keys(value as any).filter((k) => k.startsWith('$'));
  const pair = rollingPair(operators.map((k) => (value as any)[k]));
  const out: Record<string, any> = {};
  for (const k of Object.keys(value as any)) {
    const at = operators.indexOf(k);
    out[k] = (at === -1 ? undefined : pair?.get(at)) ?? shiftRollingWindows((value as any)[k]);
  }
  return out as any;
}

/** Does `value` hold a window {@link shiftRollingWindows} would move? */
function hasRollingWindow(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return (value.length === 2 && !!rollingPair(value)) || value.some(hasRollingWindow);
  }
  const entries = Object.entries(value as object);
  const operands = entries.filter(([k]) => k.startsWith('$')).map(([, v]) => v);
  return !!rollingPair(operands) || entries.some(([, v]) => hasRollingWindow(v));
}

/**
 * Replace every `{token}` / `${token}` in `value` with what `replace` returns
 * for it, in ONE pass, so no replacement is replaced again.
 */
function substituteTokens<T>(value: T, replace: (token: string) => string | undefined): T {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(/\$?\{([a-zA-Z0-9_]+)\}/g, (m, tok) => replace(tok) ?? m) as any;
  }
  if (Array.isArray(value)) return value.map((v) => substituteTokens(v, replace)) as any;
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value as any)) out[k] = substituteTokens((value as any)[k], replace);
    return out as any;
  }
  return value;
}

/**
 * Resolve a filter for a period-over-period comparison query. Dispatches on
 * `compareTo.kind` — the only discriminator the converged shape has:
 *
 * - `previousYear` — re-resolve date macros against a `now` shifted back by one
 *   year, its day clamped to the shifted month's length (29 February → 28).
 * - `previousPeriod` — substitute `current_*` / `today` tokens with `last_*` / `yesterday`
 *   before resolving. A rolling window moves first, by its own length:
 *   `{today}` … `{N_days_from_now}` becomes `{(N+1)_days_ago}` … `{1_day_ago}`
 *   (objectstack#30140), and `{N_days_ago}` … `{today}` becomes
 *   `{(2N+1)_days_ago}` … `{(N+1)_days_ago}` (objectstack#30197). Then
 *   `next_month_*` / `next_quarter_*` become `current_*`, and `{yesterday}` /
 *   `last_*` become the period before them ({@link lastPeriodBefore}). Each
 *   token is substituted once, so no window moves back twice.
 */
export function shiftFilterByCompareTo<T = any>(
  filter: T,
  compareTo: CompareToConfig,
  now: Date = new Date(),
): T {
  if (compareTo.kind === 'previousYear') {
    // `new Date(2027, 1, 29)` is 1 March 2027, which would compare a February
    // window with March; the day is clamped to the shifted month's last day.
    const lastDayOfShiftedMonth = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0).getDate();
    const shifted = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      Math.min(now.getDate(), lastDayOfShiftedMonth),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );
    return resolveDateMacros(filter, shifted);
  }
  // previousPeriod. The rolling pair goes first, so it claims its `{today}`
  // before the generic `today` → `yesterday` swap can; the `{K_day(s)_ago}`
  // tokens it writes are moved by nothing after it. Every other token is then
  // substituted in ONE pass: a second pass would carry `next_month_start` on
  // through `current_month_start` to `last_month_start`, and `today` through
  // `yesterday` to `2_days_ago`.
  const rolled = shiftRollingWindows(filter);
  const substituted = substituteTokens(rolled, (tok) => {
    const renamed = PREVIOUS_PERIOD_TOKENS[tok];
    if (renamed) return `{${renamed}}`;
    return lastPeriodBefore(tok, now);
  });
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
 *
 * A window that is already past (`{yesterday}`, `last_*`) compares with the
 * period before it, and a backward rolling window with the equal-length days
 * before it; no `dashboard.trend.*` key names "the month before last", so all
 * of them read `vsPreviousPeriod` (objectstack#30197). That check comes first:
 * `last_month_start` also contains `month_start`.
 */
export function compareToTrendLabelKey(
  compareTo: CompareToConfig,
  filter?: unknown,
): string {
  if (compareTo.kind === 'previousYear') return 'vsLastYear';
  // previousPeriod — sniff the dominant token in the filter
  const json = filter ? JSON.stringify(filter) : '';
  if (/\{(last_(week|month|quarter|year)_(start|end)|yesterday)\}/.test(json)) return 'vsPreviousPeriod';
  if (/current_year_|year_start|year_end/.test(json)) return 'vsLastYear';
  if (/next_quarter_(start|end)/.test(json)) return 'vsThisQuarter';
  if (/current_quarter_|quarter_start|quarter_end/.test(json)) return 'vsLastQuarter';
  if (/next_month_(start|end)/.test(json)) return 'vsThisMonth';
  if (/current_month_|month_start|month_end/.test(json)) return 'vsLastMonth';
  if (/current_week_|week_start|week_end/.test(json)) return 'vsLastWeek';
  if (hasRollingWindow(filter)) return 'vsPreviousPeriod';
  if (/\btoday\b/.test(json)) return 'vsYesterday';
  return 'vsPreviousPeriod';
}
