// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `timeDimensions[].dateRange` — the ONE lowering of the closed date-range
 * preset vocabulary into a concrete window, and the ONE refusal for a string
 * outside it (#16322, the driver half of #16041).
 *
 * ## Why this lives here and not in a driver
 *
 * #16041 closed the string arm of `AnalyticsQuery.timeDimensions[].dateRange`
 * to `DATE_RANGE_PRESETS`. The drivers were then asked to align to that closed
 * contract "rather than each guessing" — and there is more than one of them:
 * `driver-memory`'s cube face resolves a window itself, and the SQL analytics
 * path (`@objectstack/service-analytics`' ObjectQL and native-SQL strategies)
 * lowers the same field into filter bounds and into raw SQL. A second
 * implementation is how the two backends came to answer the SAME bad input
 * with OPPOSITE wrong answers in the first place — memory matched every
 * `Date`-typed row, SQL read a bare string as a single ISO day, neither an
 * error. So the lowering is written ONCE, in the package all of them already
 * depend on, exactly like {@link resolveFilterToken} one file over.
 *
 * ⛔ The preset LIST is never hand-copied. {@link PRESET_WINDOW_TOKENS} is a
 * `Record<DateRangePreset, …>`, so a name added to or removed from
 * `DATE_RANGE_PRESETS` fails this package's own type-check, and
 * `analytics-date-range.test.ts` pins the key set against that module at run
 * time as well. `date-range-presets.ts`'s header records that the vocabulary
 * once existed in three drifting copies; a fourth in a driver would repeat it.
 *
 * ## Every boundary is a `{date-macro}` token, resolved by the one resolver
 *
 * The windows below are not calendar arithmetic — they are pairs of tokens
 * from the platform's one date-macro vocabulary, handed to
 * {@link resolveFilterToken}. Three things follow, and each is a defect this
 * file therefore cannot have:
 *
 *   - **One calendar.** The resolver anchors on the reference timezone's
 *     calendar day and does its arithmetic on a UTC proxy (#15825's two
 *     defects, both of which were a driver doing this itself).
 *   - **One answer per question.** `dateRange: 'this_month'` and a
 *     `{month_start}` filter token select the same boundary, because they ARE
 *     the same call.
 *   - **One migration.** A month-length clamp or a Monday-based week start
 *     fixed there is fixed here.
 *
 * The START token of every preset is the one `DATE_RANGE_PRESET_MACRO_WINDOWS`
 * already prescribes for it (pinned in the test), so the window a driver
 * resolves and the window the refusal message tells an author to write open at
 * the same instant.
 *
 * ## ⭐ The END is stated as the day the window STOPS BEFORE
 *
 * Half-open, and deliberately: the macro vocabulary's own documented shape is
 * `>= {current_year_start} AND < {next_year_start}`. Two adjacent windows that
 * both claim the boundary instant double-count a row stamped on it — the
 * #16179 defect, measured on `'today'`, which counted the first instant of
 * tomorrow.
 *
 * ⚠️ {@link ResolvedAnalyticsDateRange.endExclusive} is the flag that carries
 * that reading to the comparison, and it is NOT constant across the
 * vocabulary:
 *
 *   - the ten CALENDAR presets end at a day boundary the window must not
 *     contain ⇒ `endExclusive: true`;
 *   - the three ROLLING `last_N_days` presets end at NOW, an instant the
 *     window REACHES ⇒ `endExclusive: false`.
 *
 * ⛔ And it is never `true` for a window a CALLER wrote out as an explicit
 * `[a, b]` array — that arm never reaches this file. `$lte` on a caller's
 * bound is the reading published since the analytics face existed (#16179);
 * this module resolves only the string arm, so the separation is structural.
 *
 * ⛔ A bare `YYYY-MM-DD` is never emitted as a bound from here. Both bounds are
 * rendered as INSTANTS through {@link zonedDateStartToUtcMs}, i.e. that zone's
 * midnight. A bare day would be widened by `nextUtcCalendarDay` and cut at UTC
 * midnight, undoing #16042 for every non-UTC caller — measured on
 * `Asia/Shanghai`, eight hours late. The failure is silent, which is why the
 * road is closed here rather than left to each caller.
 */

import {
  isDateRangePresetName,
  analyticsDateRangeRefusalMessage,
  type DateRangePreset,
} from '@objectstack/spec/data';
import { zonedDateStartToUtcMs } from './datetime.js';
import { resolveFilterToken } from './filter-tokens.js';

/**
 * A resolved `dateRange` window: two instants, plus what the upper one means.
 *
 * `start` and `end` are ISO instants (`toISOString()`), never bare calendar
 * days — see the module header for why that road is closed on this path.
 */
export interface ResolvedAnalyticsDateRange {
  /** The first instant the window contains, inclusive. */
  readonly start: string;
  /** The upper bound; {@link endExclusive} says whether the window contains it. */
  readonly end: string;
  /**
   * Is `end` the first instant AFTER the window rather than its last instant?
   * `true` for the ten calendar presets, `false` for the three rolling ones,
   * whose upper bound is NOW.
   */
  readonly endExclusive: boolean;
}

/**
 * The `{date-macro}` token pair each preset resolves to — `[start, endBefore]`
 * in the UNWRAPPED spelling {@link resolveFilterToken} takes.
 *
 * `endBefore: null` means the window has no calendar upper bound and runs to
 * the reference instant (the rolling `last_N_days` family), matching the
 * `end: null` of `DATE_RANGE_PRESET_MACRO_WINDOWS`.
 *
 * ⚠️ The end token names the day the window STOPS BEFORE, not its last day —
 * `this_week` ends at `next_week_start`, not at `week_end`. That is why this
 * table states the ends itself instead of reading the spec's prescription
 * pair: `DATE_RANGE_PRESET_MACRO_WINDOWS` is written for `$between`, whose
 * bare-day upper bound is INCLUSIVE of that whole day, so its end names one
 * CALENDAR day earlier than the token here — for EVERY calendar preset, with
 * no remainder; the rolling ones are `null` on both sides and have no end to
 * be earlier. ⛔ A uniform offset is still not a derivable one: every boundary
 * here is a macro token the one resolver answers, so shifting the spec's day
 * by one would be calendar arithmetic performed in this file — the second
 * implementation the module header exists to refuse. ⛔ And it is a CALENDAR
 * day, never 86_400_000 ms: `Pacific/Chatham` ends DST on a Sunday, so
 * `this_week`'s own prescribed last day is 25 hours long there.
 *
 * The STARTS agree exactly, and the test pins BOTH halves — deriving the
 * calendar/rolling split from the spec table rather than counting presets in
 * this sentence, which is how the count here came to read "the eight period
 * presets" and stayed there after `today` and `yesterday` were corrected to
 * close on their own last day (#17341).
 */
const PRESET_WINDOW_TOKENS: Readonly<
  Record<DateRangePreset, readonly [start: string, endBefore: string | null]>
> = {
  today:        ['today', 'tomorrow'],
  yesterday:    ['yesterday', 'today'],
  this_week:    ['week_start', 'next_week_start'],
  last_week:    ['last_week_start', 'week_start'],
  this_month:   ['month_start', 'next_month_start'],
  last_month:   ['last_month_start', 'month_start'],
  this_quarter: ['quarter_start', 'next_quarter_start'],
  last_quarter: ['last_quarter_start', 'quarter_start'],
  this_year:    ['year_start', 'next_year_start'],
  last_year:    ['last_year_start', 'year_start'],
  last_7_days:  ['7_days_ago', null],
  last_30_days: ['30_days_ago', null],
  last_90_days: ['90_days_ago', null],
};

/** Options every `dateRange` resolution reads. */
export interface AnalyticsDateRangeResolutionOptions {
  /** Reference instant. Defaults to `new Date()` at call time. */
  readonly now?: Date;
  /**
   * IANA reference timezone the window is anchored on — which calendar day
   * "today" is, and where that day BEGINS as an instant. An unset, `'UTC'` or
   * unknown zone degrades to UTC rather than throwing, matching
   * `calendarPartsInTzOrUtc`.
   */
  readonly timezone?: string;
}

/** That macro token's calendar day, then the instant it BEGINS in `timezone`. */
function tokenDayStart(token: string, now: Date, timezone?: string): string {
  const day = resolveFilterToken(token, { now, timezone });
  // Every token in the table above is a calendar-day macro, so the resolver
  // answers `YYYY-MM-DD`. A non-string answer would mean the vocabulary moved
  // under this table, which the pin test catches long before a caller does.
  return new Date(zonedDateStartToUtcMs(String(day), timezone)).toISOString();
}

/**
 * Lower one preset name to its window.
 *
 * @param preset - A member of `DATE_RANGE_PRESETS`.
 * @param options - Reference instant and timezone; see
 *   {@link AnalyticsDateRangeResolutionOptions}.
 */
export function resolveAnalyticsDateRangePreset(
  preset: DateRangePreset,
  options: AnalyticsDateRangeResolutionOptions = {},
): ResolvedAnalyticsDateRange {
  const now = options.now ?? new Date();
  const [startToken, endToken] = PRESET_WINDOW_TOKENS[preset];
  const start = tokenDayStart(startToken, now, options.timezone);
  if (endToken === null) {
    // The rolling family. The upper bound is the current INSTANT, which no
    // zone moves — and it is a moment the window REACHES, so it stays
    // INCLUSIVE (#16179 leaves this leg alone).
    return { start, end: now.toISOString(), endExclusive: false };
  }
  return { start, end: tokenDayStart(endToken, now, options.timezone), endExclusive: true };
}

/**
 * The ADR-0112 refusal every analytics face raises for a `dateRange` string
 * outside the closed vocabulary — `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`.
 *
 * ONE constructor, called by `driver-memory`'s cube face and by both
 * `service-analytics` strategies, because "memory and SQL refuse identically"
 * is a property a shared conformance fixture can only hold if there is one
 * refusal to hold. The wording is the spec's
 * {@link analyticsDateRangeRefusalMessage} — the same sentence the schema door
 * answers with (the #5240 convention: one condition, one wording), quoted
 * rather than restated.
 *
 * ⚠️ The code is registered under `@objectstack/runtime` (the door that names
 * the wire vocabulary) and this package carries a recorded provenance waiver
 * in `error-code-ledger.zod.ts` — the shared-constructor shape, the same one
 * `UPDATE_ID_MISMATCH` records.
 *
 * Reachability: on `POST /analytics/query` and `/analytics/sql` the schema door
 * refuses first and this never fires. It is the answer for the in-process
 * caller past that door — `AnalyticsService.query`, a driver's cube face
 * called directly, and `POST /analytics/dataset/query`, which types
 * `selection.timeDimensions` from `AnalyticsQuery` but does not Zod-parse it.
 */
export function analyticsDateRangeUnrecognizedError(input: unknown): Error {
  const err = new Error(analyticsDateRangeRefusalMessage(input)) as Error & {
    code?: string;
    status?: number;
  };
  err.code = 'ANALYTICS_DATE_RANGE_UNRECOGNIZED';
  err.status = 400;
  return err;
}

/**
 * Resolve the STRING arm of `dateRange` — a preset name to its window, and
 * anything else to the refusal.
 *
 * ⛔ The array arm never comes here: an explicit `[a, b]` is the CALLER's
 * window and keeps its published inclusive-upper reading (#16179).
 *
 * @throws the {@link analyticsDateRangeUnrecognizedError} envelope for a
 *   string outside `DATE_RANGE_PRESETS` — never a silent widening, which is
 *   the defect #16041 abolished at the contract and this closes at the faces.
 */
export function resolveAnalyticsDateRangeString(
  range: string,
  options: AnalyticsDateRangeResolutionOptions = {},
): ResolvedAnalyticsDateRange {
  if (!isDateRangePresetName(range)) throw analyticsDateRangeUnrecognizedError(range);
  return resolveAnalyticsDateRangePreset(range, options);
}
