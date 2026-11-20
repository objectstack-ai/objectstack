// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Working-calendar arithmetic (ADR-0157): what a calendar's rows MEAN, as pure
 * synchronous functions over one resolved calendar.
 *
 * ## Why this lives in the formula package
 *
 * ADR-0157 open point 3: there is exactly one daylight-saving rule (D11), and
 * two readers count with a calendar: the calendar service
 * (`WorkCalendarService`, `@objectstack/objectql`, which the approval clock
 * reads) and the working-day formula functions, which evaluate synchronously
 * over data pinned before evaluation. Both already depend on this package, so
 * the arithmetic sits here and neither keeps a copy. The contract package
 * keeps what it may hold (Prime Directive #2: schemas, types and constants
 * only): the refusal codes, the column names, the {@link WorkCalendar} shape
 * and the wall-clock primitive this module converts through
 * (`zonedWallClockToUtcMs`, `@objectstack/spec/data`). Nothing here reads a
 * row, a clock or a host zone: the service resolves, refuses and caches; this
 * module only counts, and states what a stored row MEANS.
 *
 * ## The rows, as this module reads them (ADR-0157 D1, D7, D10)
 *
 * - A calendar carries one period list per weekday (`monday_periods` …
 *   `sunday_periods`, `WORK_CALENDAR_WEEKDAY_FIELDS`), each local
 *   `HH:mm-HH:mm` periods separated by commas; a blank weekday is not worked.
 * - A period's end is later than its start on the same local day: a period
 *   that crosses midnight is refused (D7). `24:00` is a legal end (D10). The
 *   platform's `time` value refuses it, so the calendar validates its own
 *   periods ({@link parseWorkPeriods}).
 * - An exception row overrides one date: `off` carries no periods and means
 *   the whole date is off; `on` carries that date's FULL periods and never
 *   borrows a weekday's (D10). One row per calendar and date.
 * - `maintained_from` .. `maintained_through` is the span the organization
 *   keeps the calendar's exceptions for. A computation that needs a date
 *   outside it is refused ({@link WorkCalendarNotMaintainedError}): past the
 *   end is D8 (a missing next year must not read as "no holidays"), and before
 *   the start is the same refusal on the other side. There is no fallback to
 *   the weekly pattern alone and none to wall-clock time (D2, D8).
 *
 * ## Elapsed time (D11)
 *
 * Each local period becomes two instants through `zonedWallClockToUtcMs` and
 * counts its REAL duration, so on a transition day a period can be an hour
 * shorter or longer than its clock face. A skipped or repeated reading
 * resolves the way that primitive resolves it (the earlier candidate); a
 * period whose end the primitive resolves at or before its start counts no
 * time.
 *
 * ## The four counts, and their ends
 *
 * - {@link isWorkingTime}: the instant lies in `[start, end)` of a period of
 *   its own local date.
 * - {@link addWorkingDays}: step `days` working days from a calendar day; the
 *   start day is never counted, so `0` answers the start day itself.
 * - {@link workingDaysBetween}: the working days stepped through from `start`
 *   to `end`, excluding `start` and including `end`, negative when `end` is
 *   earlier, so `workingDaysBetween(d, addWorkingDays(d, n)) === n`.
 * - {@link addWorkingHours}: consume working time from an instant, forward or
 *   (negative hours) backward; a start outside working time begins at the next
 *   (previous) period edge, and an answer that lands on a period's end is that
 *   end.
 *
 * These are the service's semantics. The working-day FORMULA functions' own
 * argument semantics are their card's public contract (ADR-0157 D4); they are
 * expressible over these primitives and {@link isWorkingDay}.
 */

import {
  WORK_CALENDAR_INVALID_CODE,
  WORK_CALENDAR_NOT_MAINTAINED_CODE,
  WORK_CALENDAR_UNRESOLVED_CODE,
  WORK_CALENDAR_WEEKDAY_FIELDS,
  nextUtcCalendarDay,
  wallClockToUtcMs,
  zonedWallClockToUtcMs,
  type WorkCalendar,
  type WorkCalendarDay,
  type WorkCalendarUnresolvedReason,
  type WorkPeriod,
  type WorkPeriodsParse,
  type WorkPeriodsRefusal,
} from '@objectstack/spec/data';
import { isValueDomainMember } from '@objectstack/spec/shared';

// ── Refusals (codes: ADR-0112 ledger, defined in `@objectstack/spec/data`) ──

/**
 * ADR-0157 D2: the consumer named no calendar that exists, named none and the
 * organization has no single default, or named no organization where one is
 * required. Never answered with wall-clock time.
 */
export class WorkCalendarUnresolvedError extends Error {
  readonly code = WORK_CALENDAR_UNRESOLVED_CODE;
  readonly status = 400;
  readonly reason: WorkCalendarUnresolvedReason;
  /** The calendar code the consumer named, when it named one. */
  readonly calendar?: string;
  constructor(reason: WorkCalendarUnresolvedReason, calendar?: string) {
    super(unresolvedMessage(reason, calendar));
    this.name = 'WorkCalendarUnresolvedError';
    this.reason = reason;
    if (calendar !== undefined) this.calendar = calendar;
  }
}

function unresolvedMessage(reason: WorkCalendarUnresolvedReason, calendar: string | undefined): string {
  switch (reason) {
    case 'not_found':
      return `No working calendar has the code '${calendar}' in this organization. Create it, or name an existing calendar.`;
    case 'no_default':
      return 'No working calendar is marked as the default in this organization, and none was named. ' +
        'Mark one calendar as the default, or name a calendar code.';
    case 'no_organization':
      return 'The computation names no organization, and this installation keeps organizations apart, ' +
        'so no working calendar can be chosen. Name the organization the computation belongs to.';
    case 'ambiguous':
      return calendar === undefined
        ? 'More than one working calendar is marked as the default in this organization. ' +
          'Clear the default flag on all but one of them.'
        : `More than one working calendar answers the code '${calendar}'. ` +
          'Name the organization the computation belongs to.';
  }
}

/**
 * ADR-0157 D8: the computation needs `date`, which lies outside the span the
 * calendar is maintained for. Fixed by entering the exceptions for that span
 * and moving the bound, never by a weekly-pattern guess.
 */
export class WorkCalendarNotMaintainedError extends Error {
  readonly code = WORK_CALENDAR_NOT_MAINTAINED_CODE;
  readonly status = 400;
  readonly calendar: string;
  readonly date: string;
  readonly maintainedFrom: string;
  readonly maintainedThrough: string;
  constructor(calendar: WorkCalendar, date: string) {
    const after = date > calendar.maintainedThrough;
    super(
      `Working calendar '${calendar.code}' is maintained from ${calendar.maintainedFrom} through ` +
        `${calendar.maintainedThrough}, and this computation needs ${date}. ` +
        (after
          ? 'Enter the holidays and make-up workdays after that date, then move "Maintained Through" forward.'
          : 'Enter the holidays and make-up workdays before that date, then move "Maintained From" back.'),
    );
    this.name = 'WorkCalendarNotMaintainedError';
    this.calendar = calendar.code;
    this.date = date;
    this.maintainedFrom = calendar.maintainedFrom;
    this.maintainedThrough = calendar.maintainedThrough;
  }
}

/** ADR-0157 D7/D10: a stored row the calendar cannot read; `field` names the column. */
export class WorkCalendarInvalidError extends Error {
  readonly code = WORK_CALENDAR_INVALID_CODE;
  readonly status = 400;
  readonly calendar: string;
  readonly field: string;
  constructor(calendar: string, field: string, problem: string) {
    super(`Working calendar '${calendar}' cannot be used: ${field} ${problem}. Correct the row in Setup.`);
    this.name = 'WorkCalendarInvalidError';
    this.calendar = calendar;
    this.field = field;
  }
}

/** The three codes above, read structurally so a duplicated module copy still classifies. */
export function isWorkCalendarRefusal(err: unknown): err is
  WorkCalendarUnresolvedError | WorkCalendarNotMaintainedError | WorkCalendarInvalidError {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === WORK_CALENDAR_UNRESOLVED_CODE
    || code === WORK_CALENDAR_NOT_MAINTAINED_CODE
    || code === WORK_CALENDAR_INVALID_CODE;
}

// ── Periods ──────────────────────────────────────────────────────────────

const PERIOD = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/;

/**
 * Parse a period list: `HH:mm-HH:mm` periods separated by commas, ascending
 * and not overlapping (two periods may touch). Blank (`''`, `null`,
 * `undefined`) is the empty list, a day with no working time. ADR-0157 D7
 * refuses a period that crosses midnight; D10 admits `24:00` as an end, and
 * only as an end.
 */
export function parseWorkPeriods(text: unknown): WorkPeriodsParse {
  if (text === null || text === undefined) return { ok: true, periods: [] };
  if (typeof text !== 'string') return refuse('malformed', 'must be text such as "09:00-12:00, 13:00-18:00"');
  if (text.trim() === '') return { ok: true, periods: [] };
  const periods: WorkPeriod[] = [];
  for (const token of text.split(',')) {
    const m = PERIOD.exec(token.trim());
    if (!m) return refuse('malformed', `"${token.trim()}" is not a period written HH:mm-HH:mm, such as 09:00-12:00`);
    const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (sh > 23 || sm > 59 || eh > 24 || em > 59 || (eh === 24 && em !== 0)) {
      return refuse('malformed', `"${token.trim()}" names a time that does not exist (a start runs 00:00-23:59, an end 00:01-24:00)`);
    }
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end < start) {
      return refuse('crosses_midnight', `"${token.trim()}" crosses midnight; end a period by 24:00 and start the next day's at 00:00`);
    }
    if (end === start) return refuse('empty_period', `"${token.trim()}" has no length`);
    const prev = periods[periods.length - 1];
    if (prev && start < prev.end) {
      return refuse('overlap', `"${token.trim()}" starts before the period ahead of it ends; list periods in order, without overlap`);
    }
    periods.push({ start, end });
  }
  return { ok: true, periods };
}

function refuse(reason: WorkPeriodsRefusal, message: string): WorkPeriodsParse {
  return { ok: false, reason, message };
}

// ── The resolved calendar ────────────────────────────────────────────────

/** A frozen copy of one period list, its periods frozen too. */
function frozenPeriods(periods: readonly WorkPeriod[]): readonly WorkPeriod[] {
  return Object.freeze(periods.map((p) => Object.freeze({ start: p.start, end: p.end })));
}

/**
 * Build a {@link WorkCalendar} from a `sys_work_calendar` row and its
 * `sys_work_calendar_exception` rows, validating every value the arithmetic
 * reads. A row that fails is refused with {@link WorkCalendarInvalidError}
 * naming the column, never read leniently: a typo'd zone would otherwise
 * count in UTC, and an unreadable period would silently drop working time.
 * Exceptions outside the maintained span are left out (no computation can
 * reach them).
 *
 * The answer is frozen to its periods, so the calendar service can hand one
 * cached calendar to every caller and no caller can change what it answers.
 */
export function buildWorkCalendar(
  row: Readonly<Record<string, unknown>>,
  exceptionRows: readonly Readonly<Record<string, unknown>>[],
): WorkCalendar {
  const code = typeof row.code === 'string' && row.code !== '' ? row.code : '(no code)';
  const timezone = row.timezone;
  if (typeof timezone !== 'string' || !isValueDomainMember('iana_time_zone', timezone)) {
    throw new WorkCalendarInvalidError(code, 'timezone', `'${String(timezone ?? '')}' is not an IANA time zone`);
  }
  const maintainedFrom = calendarDayOf(row.maintained_from);
  if (!maintainedFrom) throw new WorkCalendarInvalidError(code, 'maintained_from', 'is blank or not a date');
  const maintainedThrough = calendarDayOf(row.maintained_through);
  if (!maintainedThrough) throw new WorkCalendarInvalidError(code, 'maintained_through', 'is blank or not a date');
  if (maintainedFrom > maintainedThrough) {
    throw new WorkCalendarInvalidError(code, 'maintained_through', `(${maintainedThrough}) is before maintained_from (${maintainedFrom})`);
  }
  const weekly = WORK_CALENDAR_WEEKDAY_FIELDS.map((field) => {
    const parsed = parseWorkPeriods(row[field]);
    if (!parsed.ok) throw new WorkCalendarInvalidError(code, field, parsed.message);
    return frozenPeriods(parsed.periods);
  });
  const exceptions: Record<string, WorkCalendarDay> = {};
  for (const ex of exceptionRows) {
    const date = calendarDayOf(ex.date);
    if (!date) throw new WorkCalendarInvalidError(code, 'exception date', `'${String(ex.date ?? '')}' is not a date`);
    const day = exceptionDayOf(ex);
    if (typeof day === 'string') throw new WorkCalendarInvalidError(code, `the ${date} exception`, day);
    if (date < maintainedFrom || date > maintainedThrough) continue;
    if (Object.prototype.hasOwnProperty.call(exceptions, date)) {
      throw new WorkCalendarInvalidError(code, `the ${date} exception`, 'appears twice; keep one row per date');
    }
    exceptions[date] = Object.freeze({ kind: day.kind, periods: frozenPeriods(day.periods) });
  }
  return Object.freeze({
    code,
    timezone,
    maintainedFrom,
    maintainedThrough,
    weekly: Object.freeze(weekly),
    exceptions: Object.freeze(exceptions),
  });
}

/**
 * An exception row's day, or why it cannot be one (ADR-0157 D10): `off` with
 * no periods, `on` with that date's full, valid periods.
 */
export function exceptionDayOf(row: Readonly<Record<string, unknown>>): WorkCalendarDay | string {
  const parsed = parseWorkPeriods(row.periods);
  if (row.kind === 'off') {
    if (!parsed.ok || parsed.periods.length > 0) return 'is a day off and carries periods; an off day has none';
    return { kind: 'off', periods: [] };
  }
  if (row.kind === 'on') {
    if (!parsed.ok) return `has periods that ${parsed.message}`;
    if (parsed.periods.length === 0) return "is a working day with no periods; write the date's full periods";
    return { kind: 'on', periods: parsed.periods };
  }
  return `has kind '${String(row.kind ?? '')}'; it must be off or on`;
}

/**
 * A stored calendar-day value as `YYYY-MM-DD`, or `undefined`: a driver hands a
 * `date` column back as that text or as a `Date` at UTC midnight.
 */
export function calendarDayOf(value: unknown): string | undefined {
  let day: string | undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    day = formatDay(value.getTime());
  } else if (typeof value === 'string') {
    day = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/.exec(value.trim())?.[1];
  }
  return day !== undefined && nextUtcCalendarDay(day) !== null ? day : undefined;
}

// ── Day arithmetic (calendar days are zone-free, ADR-0053) ──────────────

function partsOf(day: string): { year: number; month: number; day: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) };
}

function formatDay(utcMs: number): string {
  const d = new Date(utcMs);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  const p = partsOf(day);
  return formatDay(wallClockToUtcMs({ ...p, day: p.day + n }));
}

/** Index into {@link WorkCalendar.weekly}: Monday 0 … Sunday 6. */
function weekdayIndex(day: string): number {
  return (new Date(wallClockToUtcMs(partsOf(day))).getUTCDay() + 6) % 7;
}

function requireDay(value: string, name: string): string {
  const day = calendarDayOf(value);
  if (!day) throw new RangeError(`${name} must be a calendar day written YYYY-MM-DD; got '${String(value)}'`);
  return day;
}

function requireMaintained(cal: WorkCalendar, day: string): void {
  if (day < cal.maintainedFrom || day > cal.maintainedThrough) throw new WorkCalendarNotMaintainedError(cal, day);
}

/** The instant a local minute-of-day of `day` happens at, through the one DST rule (D11). */
function instantOf(cal: WorkCalendar, day: string, minute: number): number {
  return zonedWallClockToUtcMs({ ...partsOf(day), hour: Math.floor(minute / 60), minute: minute % 60 }, cal.timezone);
}

/** The local calendar day an instant falls on, found with the same primitive. */
function localDayOf(cal: WorkCalendar, at: number): string {
  const utcDay = formatDay(at);
  for (const day of [addDays(utcDay, -1), utcDay, addDays(utcDay, 1)]) {
    if (instantOf(cal, day, 0) <= at && at < instantOf(cal, addDays(day, 1), 0)) return day;
  }
  throw new RangeError(`no local day of '${cal.timezone}' holds the instant ${new Date(at).toISOString()}`);
}

function instantArg(value: number | Date, name: string): number {
  const t = value instanceof Date ? value.getTime() : value;
  if (typeof t !== 'number' || !Number.isFinite(t)) throw new RangeError(`${name} must be a valid instant`);
  return t;
}

// ── The four counts ─────────────────────────────────────────────────────

/**
 * The working periods of `day`: its exception's periods when one is entered,
 * else its weekday's. Refused outside the maintained span (D8).
 */
export function workingPeriodsOn(cal: WorkCalendar, day: string): readonly WorkPeriod[] {
  const d = requireDay(day, 'day');
  requireMaintained(cal, d);
  const exception = cal.exceptions[d];
  return exception ? exception.periods : (cal.weekly[weekdayIndex(d)] ?? []);
}

/** Does `day` carry any working time? */
export function isWorkingDay(cal: WorkCalendar, day: string): boolean {
  return workingPeriodsOn(cal, day).length > 0;
}

/** Is the instant inside a working period of its own local date (`[start, end)`)? */
export function isWorkingTime(cal: WorkCalendar, at: number | Date): boolean {
  const t = instantArg(at, 'at');
  const day = localDayOf(cal, t);
  return workingPeriodsOn(cal, day).some((p) => instantOf(cal, day, p.start) <= t && t < instantOf(cal, day, p.end));
}

/**
 * The calendar day `days` working days after `day` (before it, for a negative
 * count). The start day is never counted; `0` answers `day`. Every day the
 * walk reads, the start included, must lie in the maintained span (D8).
 */
export function addWorkingDays(cal: WorkCalendar, day: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError(`days must be a whole number; got ${String(days)}`);
  let d = requireDay(day, 'day');
  requireMaintained(cal, d);
  const step = days < 0 ? -1 : 1;
  for (let remaining = Math.abs(days); remaining > 0;) {
    d = addDays(d, step);
    if (isWorkingDay(cal, d)) remaining -= 1;
  }
  return d;
}

/**
 * The working days stepped through from `start` to `end`: `start` excluded,
 * `end` included, negative when `end` is earlier. Both ends must lie in the
 * maintained span (D8). The inverse of {@link addWorkingDays}.
 */
export function workingDaysBetween(cal: WorkCalendar, start: string, end: string): number {
  const s = requireDay(start, 'start');
  const e = requireDay(end, 'end');
  requireMaintained(cal, s);
  requireMaintained(cal, e);
  const forward = e >= s;
  let count = 0;
  // Forward counts (s, e]; backward counts [e, s), so each direction steps
  // over exactly the days `addWorkingDays` would.
  for (let d = forward ? addDays(s, 1) : e; forward ? d <= e : d < s; d = addDays(d, 1)) {
    if (isWorkingDay(cal, d)) count += 1;
  }
  return forward ? count : -count;
}

/**
 * The instant `hours` of working time after `start` (before it, for negative
 * hours), counted as elapsed time (D11). A start outside working time begins
 * at the next period's start (the previous one's end); an answer landing on a
 * period's end is that end. Returns epoch milliseconds. Every day the walk
 * reads must lie in the maintained span (D8).
 */
export function addWorkingHours(cal: WorkCalendar, start: number | Date, hours: number): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) throw new RangeError(`hours must be a finite number; got ${String(hours)}`);
  const t0 = instantArg(start, 'start');
  let day = localDayOf(cal, t0);
  requireMaintained(cal, day);
  // Whole milliseconds, so a fractional hour (1/3) answers an instant a
  // `Date` holds exactly and two evaluations compare equal.
  let remaining = Math.round(Math.abs(hours) * 3_600_000);
  if (remaining === 0) return t0;
  const forward = hours > 0;
  let t = t0;
  for (;;) {
    const periods = workingPeriodsOn(cal, day);
    for (const p of forward ? periods : [...periods].reverse()) {
      const ps = instantOf(cal, day, p.start);
      const pe = instantOf(cal, day, p.end);
      if (pe <= ps) continue;
      if (forward) {
        if (pe <= t) continue;
        const from = Math.max(ps, t);
        if (pe - from >= remaining) return from + remaining;
        remaining -= pe - from;
        t = pe;
      } else {
        if (ps >= t) continue;
        const to = Math.min(pe, t);
        if (to - ps >= remaining) return to - remaining;
        remaining -= to - ps;
        t = ps;
      }
    }
    day = addDays(day, forward ? 1 : -1);
    requireMaintained(cal, day);
  }
}
