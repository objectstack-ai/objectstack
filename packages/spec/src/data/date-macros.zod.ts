// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Date Macro Tokens — the declarative placeholders the UI substitutes
 * into filter values before sending a query to the data engine.
 *
 * # Why this lives in `spec`
 *
 * Filter values in dashboards, views, reports and pages travel as JSON.
 * Because JSON cannot evaluate code, callers cannot write `daysAgo(30)`
 * inline; they use a tiny placeholder grammar instead:
 *
 *     { published_at: { $gte: '{last_quarter_start}' } }
 *     { signal_at:    { $gte: '{30_days_ago}' } }
 *
 * The placeholders are expanded on **both** sides of the wire, so a
 * filter behaves the same wherever it is executed (framework#3582):
 *
 * - **Client** — `resolveDateMacros()` in `@object-ui/core`, just
 *   before the filter is handed to the data source.
 * - **Server** — `resolveFilterTokens()` in `@objectstack/core`, wired
 *   into the ObjectQL read AND write paths (`find`/`findOne`/`count`/
 *   `aggregate`/`update`/`delete`) and the analytics dataset executor.
 *   Filters that reach the database WITHOUT passing through a renderer —
 *   dashboard widgets, dataset definitions, REST query params, flow node
 *   filters — need this: before it, the token compared as a literal
 *   string and matched nothing. The write verbs are covered for the same
 *   reason (#3810): one filter must select one row set regardless of
 *   which verb consumes it, or a flow's `find` preview and its
 *   `update` act on different rows.
 *
 * Either way the DRIVER only ever sees ISO date / timestamp strings,
 * never `{tokens}`. Translating an ISO comparand into a column's on-disk
 * form — canonical UTC text on SQLite, a native `timestamptz` on
 * Postgres, a `DATETIME(3)` literal on MySQL, and `YYYY-MM-DD` text for
 * a calendar day on every dialect — is the driver's job; see
 * `SqlDriver.temporalFilterValue`.
 *
 * A token OUTSIDE this vocabulary is rejected rather than passed
 * through: `@objectstack/lint`'s `validate-filter-tokens` fails the
 * build, and the runtime resolver throws. Silently matching nothing is
 * the failure mode the vocabulary exists to prevent.
 *
 * AI agents and template authors author these placeholders directly,
 * so the **set of recognised tokens is part of the platform contract**
 * and must live here next to the rest of the JSON-DSL schemas, not
 * inside any single UI implementation.
 *
 * # Two flavours of token
 *
 * 1. **Fixed tokens** — small, finite list (`{today}`,
 *    `{current_quarter_start}`, `{last_year_end}`, …). Enumerated by
 *    `DATE_MACRO_TOKENS` below.
 *
 * 2. **Parameterised tokens** — `{N_days_ago}`, `{N_weeks_from_now}`,
 *    etc., where `N` is any non-negative integer. Matched by
 *    `DATE_MACRO_PARAM_RE`. Units: `minute(s)`, `hour(s)`, `day(s)`,
 *    `week(s)`, `month(s)`, `year(s)`. Directions: `ago`, `from_now`.
 *
 * # Out of scope
 *
 * - CEL expressions (`cel\`daysAgo(30)\``) run **server-side** in the
 *   formula engine. They are unrelated to these placeholders; see
 *   `@objectstack/formula`.
 * - Token resolution semantics (week-start day, timezone, fiscal
 *   calendars) are defined by the resolver implementation; spec only
 *   freezes the **vocabulary**. One property is worth stating here
 *   because it is authored against: a `*_end` token is the period's
 *   last calendar DAY (`{current_year_end}` → `2026-12-31`), so on a
 *   `datetime` column `<= {current_year_end}` stops at midnight on the
 *   31st. Filter a timestamp with the half-open `< {next_year_start}`.
 */

/** Single-point tokens — moments in time. */
export const DATE_MACRO_INSTANT_TOKENS = [
  'today',
  'yesterday',
  'tomorrow',
  'now',
] as const;

/** Period boundaries for the current/last/next week/month/quarter/year. */
export const DATE_MACRO_PERIOD_TOKENS = [
  'current_week_start',  'current_week_end',
  'current_month_start', 'current_month_end',
  'current_quarter_start', 'current_quarter_end',
  'current_year_start',  'current_year_end',

  'last_week_start',     'last_week_end',
  'last_month_start',    'last_month_end',
  'last_quarter_start',  'last_quarter_end',
  'last_year_start',     'last_year_end',

  'next_week_start',     'next_week_end',
  'next_month_start',    'next_month_end',
  'next_quarter_start',  'next_quarter_end',
  'next_year_start',     'next_year_end',
] as const;

/**
 * Bare aliases — `{week_start}` means `{current_week_start}`, etc.
 * Provided because every other major dashboard tool accepts them and
 * AI agents reach for them by default.
 */
export const DATE_MACRO_ALIAS_TOKENS = [
  'week_start',   'week_end',
  'month_start',  'month_end',
  'quarter_start','quarter_end',
  'year_start',   'year_end',
] as const;

/** All fixed tokens — concat of the three groups above. */
export const DATE_MACRO_TOKENS = [
  ...DATE_MACRO_INSTANT_TOKENS,
  ...DATE_MACRO_PERIOD_TOKENS,
  ...DATE_MACRO_ALIAS_TOKENS,
] as const;

export type DateMacroToken = (typeof DATE_MACRO_TOKENS)[number];

/**
 * Parameterised token grammar.
 *
 *     {<N>_<unit>(s)?_<direction>}
 *
 * Examples that match:
 *   - `30_days_ago`
 *   - `1_day_ago`
 *   - `90_days_from_now`
 *   - `2_weeks_ago`
 *   - `6_months_from_now`
 *   - `1_year_ago`
 *   - `15_minutes_ago`
 *   - `2_hours_from_now`
 *
 * Capture groups: 1=N (string of digits), 2=unit (singular or plural,
 * no trailing `s` stripped), 3=direction (`ago` | `from_now`).
 */
export const DATE_MACRO_PARAM_RE =
  /^(\d+)_(minutes?|hours?|days?|weeks?|months?|years?)_(ago|from_now)$/;

/**
 * Units recognised by the parameterised grammar. Listed here so the
 * resolver and any token-completion UI can share the source of truth.
 */
export const DATE_MACRO_UNITS = [
  'minute', 'hour', 'day', 'week', 'month', 'year',
] as const;

export type DateMacroUnit = (typeof DATE_MACRO_UNITS)[number];
export type DateMacroDirection = 'ago' | 'from_now';

export interface DateMacroParamMatch {
  readonly n: number;
  readonly unit: DateMacroUnit;
  readonly direction: DateMacroDirection;
}

/**
 * Test helper: return whether `token` (without braces) is a valid
 * date macro — either a fixed token or a parameterised one. Use
 * this in lint passes or AI-side validators.
 */
export function isDateMacroToken(token: string): boolean {
  return (
    (DATE_MACRO_TOKENS as readonly string[]).includes(token) ||
    DATE_MACRO_PARAM_RE.test(token)
  );
}

/** Parse a parameterised token. Returns null if the token isn't parameterised. */
export function parseDateMacroParam(token: string): DateMacroParamMatch | null {
  const m = token.match(DATE_MACRO_PARAM_RE);
  if (!m) return null;
  const unit = m[2].replace(/s$/, '') as DateMacroUnit;
  return {
    n: parseInt(m[1], 10),
    unit,
    direction: m[3] as DateMacroDirection,
  };
}

/**
 * Strict zod schema for the **token name** (the bit inside `{}`).
 * Accepts any fixed token or anything matching `DATE_MACRO_PARAM_RE`.
 */
export const DateMacroTokenSchema = z
  .string()
  .refine(isDateMacroToken, {
    message:
      'Unknown date macro. Must be a fixed token (see DATE_MACRO_TOKENS) ' +
      'or match {N_<unit>_(ago|from_now)} where unit is one of: ' +
      DATE_MACRO_UNITS.join(', '),
  });

/**
 * Match the **wrapped** form, i.e. the literal a filter author writes:
 * `{today}` or `${30_days_ago}`. Used by lint passes that walk filter
 * trees looking for placeholder strings.
 */
export const DATE_MACRO_WRAPPED_RE = /^\$?\{([a-zA-Z0-9_]+)\}$/;

/**
 * Zod schema for a complete placeholder string (`'{today}'`,
 * `'${30_days_ago}'`). Use as an opt-in refinement on filter values
 * to fail loudly on unknown tokens instead of silently sending them
 * to SQL.
 */
export const DateMacroPlaceholderSchema = z
  .string()
  .refine(
    (s) => {
      const m = s.match(DATE_MACRO_WRAPPED_RE);
      return !!m && isDateMacroToken(m[1]);
    },
    { message: 'Not a recognised {date-macro} placeholder' },
  );
export type DateMacroPlaceholder = z.input<typeof DateMacroPlaceholderSchema>;

/**
 * Description table — handy for skill / docs generation. Pure data,
 * intentionally not exported through any zod schema.
 */
export const DATE_MACRO_DESCRIPTIONS: Record<DateMacroToken, string> = {
  today:    'Start of today (YYYY-MM-DD).',
  yesterday:'Start of yesterday.',
  tomorrow: 'Start of tomorrow.',
  now:      'Current timestamp (full ISO).',

  current_week_start:    'Monday 00:00 of this week.',
  current_week_end:      'Sunday of this week.',
  current_month_start:   '1st of this month.',
  current_month_end:     'Last day of this month.',
  current_quarter_start: '1st day of this quarter.',
  current_quarter_end:   'Last day of this quarter.',
  current_year_start:    'Jan 1 of this year.',
  current_year_end:      'Dec 31 of this year.',

  last_week_start:    'Monday of last week.',
  last_week_end:      'Sunday of last week.',
  last_month_start:   '1st of last month.',
  last_month_end:     'Last day of last month.',
  last_quarter_start: '1st day of last quarter.',
  last_quarter_end:   'Last day of last quarter.',
  last_year_start:    'Jan 1 of last year.',
  last_year_end:      'Dec 31 of last year.',

  next_week_start:    'Monday of next week.',
  next_week_end:      'Sunday of next week.',
  next_month_start:   '1st of next month.',
  next_month_end:     'Last day of next month.',
  next_quarter_start: '1st day of next quarter.',
  next_quarter_end:   'Last day of next quarter.',
  next_year_start:    'Jan 1 of next year.',
  next_year_end:      'Dec 31 of next year.',

  week_start:    'Alias for current_week_start.',
  week_end:      'Alias for current_week_end.',
  month_start:   'Alias for current_month_start.',
  month_end:     'Alias for current_month_end.',
  quarter_start: 'Alias for current_quarter_start.',
  quarter_end:   'Alias for current_quarter_end.',
  year_start:    'Alias for current_year_start.',
  year_end:      'Alias for current_year_end.',
};
