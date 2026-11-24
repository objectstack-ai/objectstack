// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime resolution of filter placeholders — the server-side half of the
 * `{token}` contract that `@objectstack/spec` declares (framework#3582).
 *
 * `date-macros.zod.ts` and `context-tokens.zod.ts` freeze the *vocabulary*;
 * `@objectstack/lint`'s `validate-filter-tokens` rejects a token outside it at
 * authoring time. Neither one ever substituted a value: every server-side
 * consumer handed the literal `'{current_year_start}'` to the database, where
 * it compared as a string and matched nothing. The failure was invisible —
 * an empty widget, an unfiltered list — so apps worked around it by computing
 * dates at module load, freezing "this year" into the built artifact.
 *
 * This module is the missing evaluator. It walks a filter tree and replaces
 * every fully-wrapped placeholder with a concrete value:
 *
 *     { close_date: { $gte: '{current_year_start}' } }
 *       → { close_date: { $gte: '2026-01-01' } }
 *     { owner: '{current_user_id}' }
 *       → { owner: 'usr_7f3a…' }
 *
 * # The `$now` anchor resolves here too
 *
 * [#25808] `{ $now: true, addDays: <integer | { $field }> }` (`NowAnchorSchema`)
 * is the current instant shifted by whole days, the days read from a numeric
 * column of the same record or written as a literal. Its `$now: true` is a
 * placeholder like `{now}` and is pinned here to the tree's one instant
 * (`$now: '2026-10-26T15:41:25.000Z'`); the offset stays for the executor —
 * see {@link isUnresolvedNowAnchor} for why the literal arm is not collapsed.
 *
 * # Output form: ISO strings, not driver-native values
 *
 * Date tokens resolve to `YYYY-MM-DD` (or a full ISO timestamp for the
 * sub-day tokens `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`), exactly the
 * form the spec's module doc promises the data engine sees. Translating that
 * to a column's on-disk form is the DRIVER's job and already exists —
 * `SqlDriver.coerceFilterValue` / `temporalFilterValue` turn an ISO comparand
 * into SQLite epoch-ms or leave it alone on native-timestamp dialects. Emitting
 * a driver-native value here would fork that convention into a second source of
 * truth and break the moment a query crosses datasources.
 *
 * [#20844] A day outside the years 0001..9999 has no `YYYY-MM-DD` form; it is
 * spelled in the expanded-year form instead (`+010026-10-01`), so every reader
 * reads the year it resolved to — see {@link asYmd}. Which years a field takes
 * is the engine's question, not this module's: it refuses a resolved token
 * outside its field's years.
 *
 * # A date macro past the instants a `Date` holds refuses here
 *
 * [#21068] An offset can land past every instant a JavaScript `Date` can hold
 * (ECMA-262's time values, ±8.64e15 ms around 1970): `{300000_years_ago}`,
 * `{99999999999999999999_minutes_ago}`. Such a macro names no day and no time,
 * so there is no year left for the engine to judge. It used to resolve to the
 * text `Invalid Date` (a day-or-coarser macro), which compares as text and
 * answered every row of a `$lt`, or to throw an uncoded `RangeError` from
 * `toISOString` (a sub-day one), which the REST door answered `500`. It is
 * refused instead, `INVALID_FILTER` / 400 naming the placeholder — see
 * {@link DateMacroPastDateRangeError}. The test is the `Date`'s own validity,
 * asked once, of the instant the macro computed: ⛔ never a copy of the range.
 *
 * # Period `_end` resolves to a calendar DAY — its WIDTH is ADR-0053 D-D
 *
 * `{current_year_end}` resolves to `2026-12-31`, per the spec's own
 * `DATE_MACRO_DESCRIPTIONS` ("Dec 31 of this year"). Emitting that bare day is
 * the whole of what this module decides. How wide a bare day is once it lands
 * on one side of an operator is a SEPARATE contract, stated once in
 * `packages/spec/src/data/calendar-day.ts` (ADR-0053 D-D) and deliberately not
 * restated here: as an upper bound (`$lte`, a `$between` max, a `dateRange`
 * end) a bare day denotes the WHOLE day, compiled half-open to the following
 * calendar day, so `<= {current_year_end}` reaches the final instant of Dec 31
 * on a `datetime` column; as `$gte` / `$gt` / `$lt` it denotes that day's
 * `00:00:00.000`. `packages/spec/src/data/temporal-conformance.ts` pins the
 * upper-bound half cross-driver ("datetime: bare-day $lte keeps the whole
 * final day").
 *
 * ⛔ So do NOT hand-write a half-open detour (`< {next_year_start}`) to cover
 * a period's last day on a `datetime` column — every backend already applies
 * the widening. And ⛔ do not apply it HERE either: the resolver emits the bare
 * day the vocabulary names and nothing else, because the widening belongs one
 * layer down, where the column type is known; doing it twice would carry the
 * bound a whole day past what the author wrote.
 *
 * # An unknown token throws
 *
 * A value that is entirely `{something}` is a placeholder by construction — no
 * author means the literal six characters `{foo}`. Passing an unrecognised one
 * through is precisely the silent-zero bug this module exists to end, so it is
 * a hard error carrying the near-miss suggestion (`{current_user}` →
 * `{current_user_id}`). Values that merely CONTAIN braces are left untouched.
 *
 * "Entirely `{something}`" means ANY character between the braces (#5586).
 * Until then the recognition grammar was the token-NAME grammar
 * (`[a-zA-Z0-9_]+`), so a placeholder carrying a non-word character —
 * `{TODAY()}`, `{current-user-id}`, `{30 days ago}`, `{user.id}` — was not
 * recognised as a token at all and fell straight through to the literal
 * comparison this module exists to abolish. The failure was inverted against
 * the author: `{TODAY}` threw (diagnostic working), `{TODAY()}` returned rows
 * (diagnostic bypassed) — and the parenthesised, kebab-case and
 * natural-language spellings are exactly what an author migrating from another
 * system's macro syntax reaches for first. See `FILTER_TOKEN_WRAPPED_RE` in
 * `@objectstack/spec`.
 *
 * # A record-context token always refuses here
 *
 * `{record_id}` (`RECORD_CONTEXT_TOKENS` in `@objectstack/spec`) is the id of
 * the record a `type: 'record'` page is showing. Only the page renderer knows
 * that record; no server path has one in context. So a filter that arrives
 * here still carrying `{record_id}` throws {@link UnresolvedFilterTokenError}
 * naming it, on every path, whatever the request carries. It never resolves
 * to `null`, `undefined` or the literal: a count written as "about this
 * record" would otherwise come back as "about nobody", or, with the condition
 * gone, "about everybody".
 *
 * # A period key resolves to its key, never to a date
 *
 * `{current_iso_week}` (`PERIOD_KEY_TOKENS` in `@objectstack/spec`) resolves
 * to the ISO-8601 week key of the reference day, `2026-W47`: the label
 * {@link bucketDateKey} writes for an analytics `week` bucket, in the
 * request's reference timezone, so the two cannot disagree about a week. It
 * is text. The temporal-comparand door judges a resolved DATE MACRO's year;
 * a period key is not one, and this field-agnostic resolver never decides
 * what a column makes of the key.
 *
 * # A `{ $record }` comparand refuses here by name
 *
 * [#34199] The `lookupFilters` comparand `{ $record: 'path' }` reads the record
 * a form is editing, which only that form's record picker knows. Where it IS a
 * field's comparand it is refused here, `INVALID_FILTER` / 400 naming the field,
 * the `$record` path and where it sits; deeper inside a comparand it is data
 * and is left alone — see {@link findRecordReferenceComparand}.
 */

import {
  classifyFilterToken,
  isFixedReadLeaf,
  isPeriodKeyToken,
  isReadableIds,
  isRecordContextToken,
  parseDateMacroParam,
  type DateMacroUnit,
  type PeriodKeyToken,
} from '@objectstack/spec/data';
import type { StandardErrorCode } from '@objectstack/spec/api';
import { bucketDateKey, calendarPartsInTzOrUtc, wallClockToUtcMs } from './datetime.js';
import {
  isOutsideTemporalYearRange,
  SUPPORTED_TEMPORAL_YEARS,
  temporalStorageForm,
} from './temporal-storage-form.js';

/**
 * The slice of an execution context the resolver reads. Structural on purpose —
 * see {@link filterTokenContextFrom}.
 */
export interface ExecutionContextLike {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly timezone?: string;
}

/**
 * The request-scoped values a placeholder can resolve against.
 *
 * `now` is captured ONCE per resolve call so every token in one filter shares
 * an instant — otherwise a `$gte {current_month_start}` / `$lt
 * {next_month_start}` pair evaluated microseconds apart could straddle a
 * month boundary and silently drop a row.
 */
export interface FilterTokenResolutionContext {
  /** Reference instant. Defaults to `new Date()` at call time. */
  now?: Date;
  /** IANA reference timezone for calendar boundaries. Defaults to UTC. */
  timezone?: string;
  /** Resolves `{current_user_id}`. */
  userId?: string;
  /** Resolves `{current_org_id}`. */
  orgId?: string;
}

/**
 * Raised when a filter carries a placeholder outside the vocabulary.
 *
 * Carries `status`/`code` so the REST layer's generic 4xx passthrough maps it
 * to a **400 with a fixable message** rather than a 500: the caller's filter is
 * malformed, the server is fine. (Same convention plugin-sharing uses for its
 * record-scope denial — no runtime dependency in either direction.)
 */
export class UnknownFilterTokenError extends Error {
  readonly token: string;
  readonly suggestion?: string;
  readonly status = 400;
  readonly code = 'FILTER_TOKEN_UNKNOWN';

  constructor(token: string, suggestion?: string) {
    super(
      `Unresolvable filter placeholder "{${token}}". ` +
      (suggestion
        ? `Did you mean "{${suggestion}}"? `
        : 'Resolvable placeholders are the context tokens ({current_user_id}, ' +
          '{current_org_id}), the date macros ({today}, {current_quarter_start}, ' +
          '{30_days_ago}, …) and the ISO week key {current_iso_week}. ') +
      'Sending it to the data engine verbatim would compare it as a literal ' +
      'string and match nothing, which is indistinguishable from an empty result.',
    );
    this.name = 'UnknownFilterTokenError';
    this.token = token;
    this.suggestion = suggestion;
  }
}

/**
 * Raised when a token IS in the vocabulary but the request carries no value
 * for it — an unauthenticated caller filtering on `{current_user_id}`, or any
 * filter carrying the record-context token `{record_id}`, which no server
 * path has a value for (see the module doc).
 *
 * Distinct from {@link UnknownFilterTokenError} because the fix is different:
 * the spelling is correct, the context is not. For `{record_id}` the fix is
 * WHERE the filter is authored or resolved: a component on a `type: 'record'`
 * page, whose renderer resolves the token before the query leaves the
 * browser. `token` names which context is missing. Never silently resolves to
 * `null`/`undefined`, which on most drivers degrades to `IS NULL` and would
 * quietly hand back rows the filter was written to exclude.
 */
export class UnresolvedFilterTokenError extends Error {
  readonly token: string;
  /** 400, not 500 — see {@link UnknownFilterTokenError}. */
  readonly status = 400;
  readonly code = 'FILTER_TOKEN_UNRESOLVED';

  constructor(token: string, detail: string) {
    super(`Filter placeholder "{${token}}" cannot be resolved: ${detail}`);
    this.name = 'UnresolvedFilterTokenError';
    this.token = token;
  }
}

/** A year as a refusal spells it: four digits, `0001`. */
const fourDigitYear = (year: number): string => String(year).padStart(4, '0');

/**
 * [#21068] Raised when a date macro's offset lands past every instant a
 * JavaScript `Date` can hold, so the macro names no day and no time — see the
 * module doc. `token` names the placeholder.
 *
 * `INVALID_FILTER` / 400, the code a date macro's family already answers: the
 * engine refuses one that resolved outside its column's years with it, and the
 * temporal-comparand door a literal of the same value. This one lands past
 * every column's years, and the author's fix is the same (a smaller offset).
 * ⛔ Not `FILTER_TOKEN_UNRESOLVED`: its declared meaning is a context the
 * request does not carry ({@link UnresolvedFilterTokenError}: "the spelling is
 * correct, the context is not"), and here the context is complete. ⛔ Not
 * `FILTER_TOKEN_UNKNOWN` either: the token is in the vocabulary.
 *
 * Not exported: a caller reads `code` and `status`, as for every door's
 * refusal, and the module's public surface stays as it was.
 */
class DateMacroPastDateRangeError extends Error {
  readonly token: string;
  readonly status = 400;
  readonly code = 'INVALID_FILTER' satisfies StandardErrorCode;

  constructor(token: string) {
    const { date, datetime } = SUPPORTED_TEMPORAL_YEARS;
    super(
      `Relative-date placeholder "{${token}}" names no instant: its offset lands past every instant ` +
      'a JavaScript Date can hold, so it resolves to no day and no time, and it is refused rather ' +
      `than compared. A date value names a year from ${fourDigitYear(date.first)} to ` +
      `${fourDigitYear(date.last)}, and a datetime value a year from ${fourDigitYear(datetime.first)} ` +
      `to ${fourDigitYear(datetime.last)}: use a relative-date placeholder whose offset lands inside ` +
      'those years.',
    );
    this.name = 'DateMacroPastDateRangeError';
    this.token = token;
  }
}

/**
 * Calendar arithmetic is done on a UTC "proxy" date built from the reference
 * timezone's calendar parts. Working in UTC keeps the math free of DST jumps
 * (a local-midnight `Date` can shift by an hour when `setMonth` crosses a
 * transition); the zone only decides WHICH calendar day "now" is, which
 * {@link calendarPartsInTzOrUtc} answers from the platform tz database.
 *
 * [#20599] Every proxy date in this file is built by `wallClockToUtcMs`, never
 * `Date.UTC`, which reads a year from 0 to 99 as 1900 + year: a step that lands
 * in 0001..0099 (`{1977_years_ago}`) stays there.
 */
function proxyDay(now: Date, timezone?: string): Date {
  return new Date(wallClockToUtcMs(calendarPartsInTzOrUtc(now, timezone)));
}

/**
 * `YYYY-MM-DD` of a proxy date: the storage rule's `date` spelling, whose year
 * is padded to four digits (`0049-09-30`, never `49-09-30`, which names no
 * day). [#20599] Before the proxy dates kept their year, a step into
 * 0001..0099 came out in the 1900s instead, so this spelling was never reached
 * for those years; a step into 0100..0999 was already spelled unpadded.
 *
 * [#20844] A day outside 0001..9999 has no `YYYY-MM-DD` form, and the storage
 * rule's spelling of one (`10026-10-01`, `0-10-01`, `-1-10-01`) is read by
 * nothing as the day it names: `Date.parse` takes it through the host's
 * legacy parser, in the host's zone, and reads `-1-10-01` as 2001-01-10. So
 * `{2027_years_ago}` was judged inside the range by core's
 * `isOutsideTemporalYearRange` and compared as a day in 2001. Such a day is
 * spelled in the expanded-year form of ECMAScript's date time string format
 * instead (`+010026-10-01`, `-000001-10-01`), the day half of what
 * `toISOString` spells for its instant: every reader reads it as that UTC day,
 * on every host. The range is core's one range, asked of the day itself, never
 * re-derived here. A step past the instants a `Date` holds is not one of these:
 * it has no day at all, and [#21068] never reaches here — {@link resolveFilterToken}
 * refuses it first.
 */
function asYmd(d: Date): string {
  if (!isOutsideTemporalYearRange(d, 'date')) return String(temporalStorageForm(d, 'date'));
  const iso = d.toISOString();
  return iso.slice(0, iso.indexOf('T'));
}

type PeriodKind = 'week' | 'month' | 'quarter' | 'year';

/** Monday-based week start — matches the spec's "Monday 00:00 of this week". */
function startOfPeriod(kind: PeriodKind, d: Date): Date {
  const r = new Date(d.getTime());
  switch (kind) {
    case 'week': {
      const dow = (r.getUTCDay() + 6) % 7; // 0 = Monday
      r.setUTCDate(r.getUTCDate() - dow);
      return r;
    }
    case 'month':
      return new Date(wallClockToUtcMs({ year: r.getUTCFullYear(), month: r.getUTCMonth() + 1, day: 1 }));
    case 'quarter':
      return new Date(
        wallClockToUtcMs({ year: r.getUTCFullYear(), month: Math.floor(r.getUTCMonth() / 3) * 3 + 1, day: 1 }),
      );
    case 'year':
      return new Date(wallClockToUtcMs({ year: r.getUTCFullYear(), month: 1, day: 1 }));
  }
}

/** Days in the given (0-based) month of `year`: day 0 of the next month rolls back to its last. */
function daysInMonth(year: number, month: number): number {
  return new Date(wallClockToUtcMs({ year, month: month + 2, day: 0 })).getUTCDate();
}

/**
 * Shift `d` by `n` months, CLAMPING the day to the target month's length.
 *
 * Bare `setUTCMonth(m - 1)` on the 31st rolls FORWARD into the following month
 * (Mar 31 minus one month = "Feb 31" = Mar 3), which would make
 * `{1_month_ago}` land after `{today}` on five days of the year. Clamping to
 * Feb 28 is what every calendar library does and the only answer an author
 * would call correct.
 */
function addMonthsClamped(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return new Date(wallClockToUtcMs({
    year: targetYear, month: targetMonth + 1, day,
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), millisecond: d.getUTCMilliseconds(),
  }));
}

/** Shift `d` by `n` whole periods of `kind` (negative shifts backwards). */
function addPeriods(kind: PeriodKind, d: Date, n: number): Date {
  switch (kind) {
    case 'week': {
      const r = new Date(d.getTime());
      r.setUTCDate(r.getUTCDate() + n * 7);
      return r;
    }
    case 'month': return addMonthsClamped(d, n);
    case 'quarter': return addMonthsClamped(d, n * 3);
    case 'year': return addMonthsClamped(d, n * 12);
  }
}

/** Shift `d` by `n` units of the parameterised grammar. */
function addUnits(unit: DateMacroUnit, d: Date, n: number): Date {
  const r = new Date(d.getTime());
  switch (unit) {
    case 'minute': r.setUTCMinutes(r.getUTCMinutes() + n); return r;
    case 'hour': r.setUTCHours(r.getUTCHours() + n); return r;
    case 'day': r.setUTCDate(r.getUTCDate() + n); return r;
    case 'week': r.setUTCDate(r.getUTCDate() + n * 7); return r;
    // Month/year steps clamp rather than overflow — see addMonthsClamped.
    case 'month': return addMonthsClamped(d, n);
    case 'year': return addMonthsClamped(d, n * 12);
  }
}

/**
 * `current|last|next` × `week|month|quarter|year` × `start|end`, plus the bare
 * `week_start`-style aliases (which mean `current_`). Returns the period's
 * bounding day, or `undefined` when the token is not a period token.
 */
const PERIOD_RE = /^(?:(current|last|next)_)?(week|month|quarter|year)_(start|end)$/;

function resolvePeriodToken(token: string, today: Date): Date | undefined {
  const m = PERIOD_RE.exec(token);
  if (!m) return undefined;
  const rel = (m[1] ?? 'current') as 'current' | 'last' | 'next';
  const kind = m[2] as PeriodKind;
  const bound = m[3] as 'start' | 'end';
  const offset = rel === 'last' ? -1 : rel === 'next' ? 1 : 0;

  // Normalize to the period's own start BEFORE stepping. Day 1 of a
  // month/quarter/year (and a Monday) shifts exactly — no month-length clamping
  // is involved at all — so the answer never depends on the clamp policy, and
  // the arithmetic reads the same for every `kind`.
  const periodStart = startOfPeriod(kind, addPeriods(kind, startOfPeriod(kind, today), offset));
  if (bound === 'start') return periodStart;
  // `_end` = the last calendar DAY of the period: the day before the next
  // period begins. See the module doc on half-open ranges.
  const next = addPeriods(kind, periodStart, 1);
  next.setUTCDate(next.getUTCDate() - 1);
  return next;
}

/**
 * [#21068] The instant a date macro computes, and how it is spelled: an
 * instant (`{now}`, `{N_hours_*}`, `{N_minutes_*}`) or a calendar day (every
 * other macro). `undefined` when `token` is not a date macro. Computing it
 * apart from spelling it lets {@link resolveFilterToken} ask the one question
 * every macro owes before either spelling — does the instant exist? — in one
 * place.
 */
function dateMacroInstant(
  token: string,
  now: Date,
  timezone: string | undefined,
): { at: Date; spelled: 'instant' | 'day' } | undefined {
  const today = proxyDay(now, timezone);

  switch (token) {
    case 'now': return { at: now, spelled: 'instant' };
    case 'today': return { at: today, spelled: 'day' };
    case 'yesterday': return { at: addUnits('day', today, -1), spelled: 'day' };
    case 'tomorrow': return { at: addUnits('day', today, 1), spelled: 'day' };
  }

  const period = resolvePeriodToken(token, today);
  if (period !== undefined) return { at: period, spelled: 'day' };

  const param = parseDateMacroParam(token);
  if (!param) return undefined;
  const sign = param.direction === 'ago' ? -1 : 1;
  // Sub-day units are instants — they must keep their time-of-day, so they
  // shift `now` and render as a full ISO timestamp. Day-and-coarser units are
  // calendar quantities and render as `YYYY-MM-DD` off the reference day.
  if (param.unit === 'minute' || param.unit === 'hour') {
    return { at: addUnits(param.unit, now, sign * param.n), spelled: 'instant' };
  }
  return { at: addUnits(param.unit, today, sign * param.n), spelled: 'day' };
}

/**
 * Each period-key token's resolver: the key of the period the reference
 * instant falls in, as seen in the reference timezone. `satisfies` keeps it
 * exhaustive: a token added to the spec's list without a resolver here fails
 * to compile rather than resolving to nothing.
 *
 * `{current_iso_week}` is {@link bucketDateKey}'s `week` label, the one
 * statement of the ISO week rule (Monday-start weeks, the ISO week-numbering
 * year at the year edges).
 */
const PERIOD_KEY_RESOLVERS = {
  current_iso_week: (now: Date, timezone: string | undefined) => bucketDateKey(now, 'week', timezone),
} satisfies Record<PeriodKeyToken, (now: Date, timezone: string | undefined) => string | null>;

/**
 * Resolve one token NAME (the bit inside the braces) to its concrete value.
 * Throws {@link UnresolvedFilterTokenError} for a vocabulary token the request
 * carries no value for, and [#21068] `INVALID_FILTER` / 400 for a date macro
 * whose offset lands past every instant a `Date` holds
 * ({@link DateMacroPastDateRangeError}). Returns `undefined` only when the
 * token is outside the vocabulary — callers turn that into
 * {@link UnknownFilterTokenError}.
 */
export function resolveFilterToken(
  token: string,
  ctx: FilterTokenResolutionContext = {},
): unknown {
  const now = ctx.now ?? new Date();

  // ── Context tokens ────────────────────────────────────────────────────
  if (token === 'current_user_id') {
    if (!ctx.userId) {
      throw new UnresolvedFilterTokenError(
        token,
        'the request has no authenticated user. A filter scoped to the signed-in ' +
        'user cannot run for an anonymous or system caller — gate the surface on ' +
        'authentication, or drop the token from the filter.',
      );
    }
    return ctx.userId;
  }
  if (token === 'current_org_id') {
    if (!ctx.orgId) {
      throw new UnresolvedFilterTokenError(
        token,
        'the request carries no active organization (ExecutionContext.tenantId is ' +
        'unset). Set the active org on the request, or drop the token from the filter.',
      );
    }
    return ctx.orgId;
  }

  // ── Record-context tokens ─────────────────────────────────────────────
  // Never resolvable here, whatever the request carries: the server does not
  // know which record a page is showing. See the module doc.
  if (isRecordContextToken(token)) {
    throw new UnresolvedFilterTokenError(
      token,
      'no record in context on the server. {record_id} is the id of the record a ' +
      "`type: 'record'` page is showing, and only that page's renderer knows it: it " +
      'resolves the token before the query leaves the browser. A filter still carrying ' +
      'it here was authored on a surface with no record in context (a list view, a ' +
      'dashboard widget, a report, a dataset, a page that is not a record page), or sent ' +
      'by a client that did not resolve it. Move the filter onto a component of a record ' +
      'page, or filter on a concrete id. Resolving it to null would count no records, and ' +
      'dropping the condition would count them all.',
    );
  }

  // ── Period keys ───────────────────────────────────────────────────────
  // A key such as `2026-W47`: text, never a day. `bucketDateKey` answers
  // `null` only for an invalid instant, which is no key at all.
  if (isPeriodKeyToken(token)) {
    return PERIOD_KEY_RESOLVERS[token as PeriodKeyToken](now, ctx.timezone) ?? undefined;
  }

  // ── Date macros ───────────────────────────────────────────────────────
  const macro = dateMacroInstant(token, now, ctx.timezone);
  if (macro === undefined) return undefined;
  // [#21068] An offset past every instant a `Date` holds computes an invalid
  // `Date`: `asYmd` would spell it as the text `Invalid Date` and
  // `toISOString` would throw an uncoded `RangeError`. Refused here, once,
  // before either spelling.
  if (Number.isNaN(macro.at.getTime())) throw new DateMacroPastDateRangeError(token);
  return macro.spelled === 'instant' ? macro.at.toISOString() : asYmd(macro.at);
}

/**
 * Does this tree contain any fully-wrapped placeholder at all?
 *
 * A read-only pre-pass so the overwhelmingly common case — an internal query
 * whose filter is entirely literal — costs one allocation-free walk instead of
 * a full structural copy. This runs on every server-side read, so "no
 * placeholders" must be close to free.
 */
function hasFilterToken(node: unknown): boolean {
  if (typeof node === 'string') return classifyFilterToken(node) !== null;
  if (Array.isArray(node)) return node.some(hasFilterToken);
  // An engine-internal leaf is a comparand value: its inputs name a table and
  // a principal and are never a placeholder (see `resolveFilterTokens`).
  if (isEngineInternalLeaf(node)) return false;
  if (node && typeof node === 'object' && !(node instanceof Date)) {
    // [#25808] An unresolved `$now` anchor is a placeholder by construction.
    if (isUnresolvedNowAnchor(node)) return true;
    return Object.values(node as Record<string, unknown>).some(hasFilterToken);
  }
  return false;
}

/**
 * [#25808] `{ $now: true, addDays }` — the now-anchored comparand
 * (`NowAnchorSchema`, `@objectstack/spec/data`) as an AUTHOR writes it. It is
 * a placeholder for the instant the query runs at, and it resolves HERE, beside
 * `{now}`, to the one instant the whole tree shares: `$now: true` becomes the
 * pinned ISO instant, and the offset — a literal or a `{ $field }` column
 * reference — stays as written for the executor, which adds it in the target
 * column's own form (`driver-sql` per dialect, `@objectstack/formula` in
 * memory). The anchor is not collapsed to a string even for a literal offset:
 * whether "now minus 30 days" is an instant or a calendar day is the TARGET
 * column's question, which this field-agnostic resolver cannot answer — the
 * executor that reads the column's declaration shifts the instant in that
 * column's form, so both paths answer the same rows. A node whose `$now` is
 * already a string is resolved and passes through.
 *
 * `true` only — `$now: 'now'`, `$now: 1` are not anchors: left to the
 * comparand-type door's plain-object refusal, where a malformed one belongs.
 */
function isUnresolvedNowAnchor(node: unknown): node is { $now: true; addDays?: unknown } {
  return !!node && typeof node === 'object' && !Array.isArray(node)
    && (node as Record<string, unknown>).$now === true;
}

/**
 * [#25808] A `$now` anchor with no usable offset, met at resolution. The schema
 * door refuses it at authoring in the same sentence; this is the runtime twin
 * for a `where` no face re-validates (`find()` takes one), raised here rather
 * than resolved to an instant the author never asked for. `INVALID_FILTER` /
 * 400, the code every comparand door answers with.
 */
class MalformedNowAnchorError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_FILTER' satisfies StandardErrorCode;

  constructor(detail: string) {
    super(
      `A { "$now": true } comparand ${detail}. A now-anchored comparand is ` +
      '{ "$now": true, "addDays": <offset> }: the current instant shifted by whole days, where ' +
      'addDays is an integer literal of any sign (a negative value subtracts) or a nested ' +
      '{ "$field": "numeric_column" } reference to a column of the same record. For the ' +
      'unshifted instant write the "{now}" placeholder.',
    );
    this.name = 'MalformedNowAnchorError';
  }
}

/**
 * [#34199] `{ $record: 'path' }` — the `lookupFilters` comparand that reads the
 * RECORD BEING EDITED (`LookupFilterRecordReferenceSchema`,
 * `@objectstack/spec/data`): a field of that record, or one lookup hop from it
 * (`account.cb_market`). Only the record picker of the form editing that
 * record can resolve it — it sends the referenced value in its place before
 * the query leaves the browser — and no server path knows which record a form
 * is editing. The KEY decides, not the shape: a malformed reference
 * (`{ $record: 1 }`, a key beside `$record`) is no more resolvable.
 */
function isRecordReference(node: unknown): node is Record<string, unknown> {
  return !!node && typeof node === 'object' && !Array.isArray(node)
    && Object.prototype.hasOwnProperty.call(node, '$record');
}

/**
 * [ADR-0139 D1, ADR-0155 D1] A branded engine-internal comparand: a
 * `ReadableIds` leaf or a fixed-read leaf (`SharedRecordIds`). Each is frozen,
 * holds no placeholder, and keeps its meaning only while it keeps its
 * non-enumerable brand, so every walk here hands it back by reference.
 */
function isEngineInternalLeaf(node: unknown): boolean {
  return isReadableIds(node) || isFixedReadLeaf(node);
}

/** A plain filter object (not a `Date`, not a branded engine-internal leaf). */
function isFilterObject(node: unknown): node is Record<string, unknown> {
  return !!node && typeof node === 'object' && !Array.isArray(node)
    && !(node instanceof Date) && !isEngineInternalLeaf(node);
}

/** An operator object: a field's value carrying at least one `$` key. */
function isOperatorObject(node: unknown): node is Record<string, unknown> {
  return isFilterObject(node) && Object.keys(node).some((k) => k.startsWith('$'));
}

/** [#34199] A `{ $record }` met where it is a field's comparand. */
interface RecordReferenceComparand {
  readonly reference: Record<string, unknown>;
  readonly field: string;
  readonly at: string;
}

/**
 * [#34199] The first `{ $record }` that IS a field's comparand, walking the
 * filter's node grammar (`FilterCondition`): the field's own value (the eq
 * shorthand `{ f: { $record } }`, which is what the picker's flat lowering of
 * `eq` sends) or the value of an operator on that field (`{ f: { $gt: {
 * $record } } }`), under any `$and` / `$or` / `$not` nesting. `at` is spelled
 * from the filter's root: `filter.$or[1].cb_market`.
 *
 * Deliberately NOT judged — each left exactly as it was before this pass
 * learned the reference:
 *
 * - **Inside a no-`$` object beneath a field** (`{ attachment: { meta: {
 *   $record: 'x' } } }`). That object is a deep-equality comparand or a
 *   nested-relation condition, and only the field's declaration tells the two
 *   apart, which this field-agnostic resolver never reads. As a deep-equality
 *   comparand the `$record` key is part of a literal a driver may compare
 *   whole (driver-memory does), so refusing it here would refuse a filter that
 *   answers today.
 * - **A member of an operator's list** (`$in: ['NA', { $record }]`) and
 *   anything deeper inside an operator's value: the comparand-type door
 *   refuses a plain-object list member on the engine's path first.
 * - **A `$` key in a node position that is not `$and` / `$or` / `$not`**
 *   (`{ $record: 'x' }` at the root): it is not a field's comparand, and the
 *   drivers already refuse an undeclared node key.
 * - **A legacy `[field, op, value]` tuple** (an array whose first member is a
 *   string other than `and` / `or`, the split `parseFilterAST` lowers by):
 *   it is a comparison, not a list of nodes, and its third member is a
 *   comparand — `['attachment', '=', { meta: { $record: 'x' } }]` is the same
 *   deep-equality literal as the object spelling above, and comes back by
 *   reference like it. An `['and' | 'or', …]` array is walked from its second
 *   member, and any other array as a list of nodes.
 *
 * Allocation-free and shallow (it never enters a comparand), so it costs a
 * read whose filter holds no reference one walk of its node keys.
 */
function findRecordReferenceComparand(node: unknown, at = 'filter'): RecordReferenceComparand | undefined {
  if (Array.isArray(node)) {
    let start = 0;
    if (typeof node[0] === 'string') {
      const head = node[0].toLowerCase();
      // A `[field, op, value]` tuple: a comparison whose value is a comparand — not judged.
      if (head !== 'and' && head !== 'or') return undefined;
      start = 1;
    }
    for (let i = start; i < node.length; i++) {
      const hit = findRecordReferenceComparand(node[i], `${at}[${i}]`);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isFilterObject(node)) return undefined;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$and' || key === '$or' || key === '$not') {
      const hit = findRecordReferenceComparand(value, `${at}.${key}`);
      if (hit) return hit;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (isRecordReference(value)) return { reference: value, field: key, at: `${at}.${key}` };
    // A no-`$` object: a deep-equality comparand or a nested-relation condition — not judged.
    if (!isOperatorObject(value)) continue;
    for (const [op, comparand] of Object.entries(value)) {
      if (op.startsWith('$') && isRecordReference(comparand)) {
        return { reference: comparand, field: key, at: `${at}.${key}.${op}` };
      }
    }
  }
  return undefined;
}

/**
 * [#34199] An unresolved `{ $record }` met where it is a field's comparand —
 * see {@link findRecordReferenceComparand}. `INVALID_FILTER` / 400, the code
 * every comparand door answers with and the one the drivers answered this
 * input with before; the message names the field, the `$record` path and
 * where it sits. ⛔ Not `FILTER_TOKEN_UNRESOLVED`: that code's declared meaning
 * is a vocabulary placeholder STRING the request carries no context for, and
 * the reference is a comparand object.
 *
 * On the engine's object path the doors in front of this pass meet most
 * operator forms first: the comparand-type door refuses any plain object
 * under an operator (`{ f: { $gt: { $record } } }`), and the temporal door the
 * eq shorthand on a temporal column — each in its own words. What reaches
 * this pass there is the eq shorthand on any other column, and every shape
 * from a caller with no such door in front.
 *
 * Not exported, like the module's other `INVALID_FILTER` refusals: a caller
 * reads `code` and `status`.
 */
class UnresolvedRecordReferenceError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_FILTER' satisfies StandardErrorCode;

  constructor({ reference, field, at }: RecordReferenceComparand) {
    super(
      `A { "$record": ${previewReferencePath(reference.$record)} } comparand on field "${field}" at ${at} ` +
      'reached the server unresolved, and is refused rather than compared. { $record } reads the record ' +
      'being edited (a field of it, or one lookup hop such as "account.cb_market"), and only the record ' +
      'picker of the form editing that record can resolve it: the picker sends the referenced value in ' +
      'its place. No server path knows which record a form is editing, so reading the reference as null, ' +
      'or comparing the object as a literal, would answer rows the filter was written to exclude. Send ' +
      'the referenced value itself, or write { $record } only in a lookup field\'s lookupFilters, where ' +
      'the picker resolves it.',
    );
    this.name = 'UnresolvedRecordReferenceError';
  }
}

/**
 * [#34199] The `$record` value as the refusal echoes it: JSON, bounded to 60
 * characters like the sibling comparand doors' previews — a malformed
 * reference came off the wire and can carry any JSON value.
 */
function previewReferencePath(path: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(path) ?? String(path);
  } catch {
    text = String(path);
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** [#25808] The anchor with its instant pinned — see {@link isUnresolvedNowAnchor}. */
function resolveNowAnchor(node: { $now: true; addDays?: unknown }, now: Date): Record<string, unknown> {
  const offset = node.addDays;
  if (offset === undefined) throw new MalformedNowAnchorError('carries no addDays offset');
  const isColumn = !!offset && typeof offset === 'object' && !Array.isArray(offset)
    && typeof (offset as Record<string, unknown>).$field === 'string';
  if (typeof offset === 'number' ? !Number.isInteger(offset) : !isColumn) {
    throw new MalformedNowAnchorError(
      `carries an addDays offset that is neither an integer nor a { "$field" } reference (${JSON.stringify(offset)})`,
    );
  }
  // One instant for the whole tree, in the spelling `{now}` resolves to.
  return { ...node, $now: now.toISOString() };
}

/**
 * Deep-replace every fully-wrapped placeholder in `filter` with its resolved
 * value, returning a NEW tree (the caller's metadata is never mutated — a view
 * or dataset definition is shared across requests, so resolving in place would
 * bake one request's user id, and one day's dates, into every later render).
 *
 * Returns the input unchanged, by reference, when it holds no placeholders.
 *
 * [ADR-0139 D1] A branded `ReadableIds` leaf is returned BY REFERENCE, never
 * rebuilt. Its brand is a non-enumerable symbol key, so the plain-object copy
 * below would hand back an unbranded `{ object }`: a leaf beside a resolved
 * placeholder would then reach the engine's executor boundary as a plain
 * object in a `$in` comparand, which the engine cannot compose. The leaf holds
 * no placeholder and is frozen, so returning it unchanged is exact.
 *
 * [ADR-0155 D1] A fixed-read leaf (`isFixedReadLeaf`, `SharedRecordIds`
 * today) is returned by reference for the same reason: rebuilt, it would
 * arrive unbranded and be refused at the comparand door as a non-list
 * (`INVALID_FILTER` / 400), so a read scope carrying a placeholder beside the
 * leaf would fail every read it scopes.
 */
export function resolveFilterTokens<T>(
  filter: T,
  ctx: FilterTokenResolutionContext = {},
): T {
  if (filter == null) return filter;
  // [#34199] Before the fast path: the refusal must not depend on a string
  // token being in the same tree, and it reads only comparand positions.
  const reference = findRecordReferenceComparand(filter);
  if (reference) throw new UnresolvedRecordReferenceError(reference);
  if (!hasFilterToken(filter)) return filter;

  // One instant for the whole tree (see FilterTokenResolutionContext.now).
  const pinned: FilterTokenResolutionContext = { ...ctx, now: ctx.now ?? new Date() };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const cls = classifyFilterToken(node);
      if (!cls) return node;
      if (cls.kind === 'unknown') throw new UnknownFilterTokenError(cls.token, cls.suggestion);
      const resolved = resolveFilterToken(cls.token, pinned);
      // `classifyFilterToken` already vouched for the token, so `undefined`
      // here would mean the spec vocabulary and this resolver have drifted
      // apart — surface it loudly rather than silently emitting `undefined`.
      if (resolved === undefined) throw new UnknownFilterTokenError(cls.token);
      return resolved;
    }
    if (Array.isArray(node)) return node.map(walk);
    // [ADR-0139 D1, ADR-0155 D1] The leaf by reference, brand intact (see above).
    if (isEngineInternalLeaf(node)) return node;
    if (node && typeof node === 'object') {
      // Dates and other class instances are comparands, not filter structure.
      if (node instanceof Date) return node;
      // [#25808] The now anchor: its instant pinned, its offset kept.
      if (isUnresolvedNowAnchor(node)) return resolveNowAnchor(node, pinned.now!);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  return walk(filter) as T;
}

/**
 * Convenience bridge from an execution context to the resolver's inputs.
 * `{current_org_id}` reads `tenantId` — the active organization IS the tenant
 * on the read path (same value the RLS compiler binds to
 * `current_user.organization_id`).
 *
 * Typed structurally, not as `ExecutionContext`, so both the parsed context
 * (`ExecutionContextParsed`, defaults applied) and the pre-parse
 * `ExecutionContext` a caller holds mid-pipeline satisfy it. The three fields
 * read here are optional in both.
 */
export function filterTokenContextFrom(
  execCtx: ExecutionContextLike | undefined,
  now?: Date,
): FilterTokenResolutionContext {
  return {
    now,
    timezone: execCtx?.timezone,
    userId: execCtx?.userId,
    orgId: execCtx?.tenantId,
  };
}
