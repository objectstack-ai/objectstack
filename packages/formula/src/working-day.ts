// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The working-day formula functions (ADR-0157 D4): `addWorkingDays`,
 * `workingDaysBetween` and `addWorkingHours`, as CEL functions over the
 * calendars an evaluation was handed ({@link EvalWorkCalendars}).
 *
 * ## One arithmetic, one daylight-saving rule (D11, open point 3)
 *
 * Every count is `work-calendar.ts`'s, the module the calendar service and the
 * approval clock count with. This module only turns CEL arguments into that
 * module's arguments and its answers back into CEL values; it holds no second
 * copy of the walk or of the wall-clock conversion.
 *
 * ## The public contract (D4: the card's to settle, pinned by its tests)
 *
 * - `addWorkingDays(day, n[, calendar])`: the calendar day `n` working days
 *   after `day` (before it, for a negative `n`). `day` itself is never
 *   counted, and `0` answers `day`. The answer is a calendar day: a timestamp
 *   at UTC midnight, as `today()` and a `date` field are (ADR-0053 D1).
 * - `workingDaysBetween(start, end[, calendar])`: the working days stepped
 *   through from `start` to `end`, `start` excluded and `end` included,
 *   negative when `end` is earlier: `workingDaysBetween(d, addWorkingDays(d, n))`
 *   is `n`.
 * - `addWorkingHours(start, hours[, calendar])`: the instant `hours` of working
 *   time after `start` (before it, for negative hours), counted as elapsed time
 *   (D11). A start outside working time begins at the next period's start (the
 *   previous one's end); an answer that lands on a period's end is that end.
 *
 * A calendar DAY argument is `YYYY-MM-DD` text, or a timestamp read on the UTC
 * calendar, as `isoDate()` reads it: `today()` and a `date` field are that day
 * at UTC midnight. To count from an instant's local time, count hours. An
 * INSTANT argument is a timestamp, ISO text or epoch milliseconds, as `date()`
 * reads it. A blank day or start answers blank (a due date with no start has
 * none); a blank count, and a blank end of `workingDaysBetween`, refuse.
 *
 * `calendar` is a calendar code, written as a quoted literal: the caller loads
 * the calendars an expression names before evaluating it, from the calls it
 * spells, so a computed code names a calendar nobody loaded. Without it the
 * call counts with the organization's default calendar (D2).
 *
 * ## Refusals (D2, D8)
 *
 * A calendar that did not resolve, and a count that needs a date outside the
 * span the calendar is maintained for, throw the calendar's own refusal. The
 * evaluation fails (`kind: 'runtime'`): a formula field reads blank and the
 * engine logs one line naming the object, the field and the refusal (D8). Never
 * a count on the weekly pattern or the wall clock instead.
 */

import type { Environment } from '@marcbachmann/cel-js';
import type { WorkCalendar } from '@objectstack/spec/data';

import type { EvalWorkCalendars } from './types';
import { addWorkingDays, addWorkingHours, calendarDayOf, workingDaysBetween } from './work-calendar';

/** The three function names, in the order the catalog lists them. */
export const WORKING_DAY_FUNCTIONS = ['addWorkingDays', 'workingDaysBetween', 'addWorkingHours'] as const;

export type WorkingDayFunction = (typeof WORKING_DAY_FUNCTIONS)[number];

/**
 * Why a working-day call has no calendar to count with: the evaluation was
 * handed no calendars at all. Every evaluation the engine runs for a formula
 * field or a computed field's `expression` is handed them; every other
 * expression is not, and the lint refuses the call there.
 */
export function workCalendarsNotLoadedMessage(fn: WorkingDayFunction): string {
  return `${fn}() counts with the organization's working calendar, and this evaluation was given none: ` +
    "the engine loads calendars only for a formula field's or a computed field's `expression`, " +
    'evaluated on the server. Move the call into such a field, or read the field this expression needs.';
}

function codeNotLoadedMessage(fn: WorkingDayFunction, code: string): string {
  return `${fn}() names the working calendar '${code}', which this evaluation was not given: ` +
    'write the calendar code as a quoted literal in the call, so the engine loads that calendar before it evaluates.';
}

/** The calendar a call counts with, or the throw that says why it has none. */
function calendarFor(fn: WorkingDayFunction, calendars: EvalWorkCalendars | undefined, code?: unknown): WorkCalendar {
  if (!calendars) throw new Error(workCalendarsNotLoadedMessage(fn));
  let entry: unknown;
  if (code === undefined) {
    entry = calendars.default;
    if (entry === undefined) throw new Error(workCalendarsNotLoadedMessage(fn));
  } else {
    if (typeof code !== 'string' || code.trim() === '') {
      throw new Error(`${fn}() takes a calendar code as text, such as 'cn_mainland'; got ${code === null ? 'null' : typeof code}.`);
    }
    const byCode = calendars.byCode ?? {};
    entry = Object.prototype.hasOwnProperty.call(byCode, code) ? byCode[code] : undefined;
    if (entry === undefined) throw new Error(codeNotLoadedMessage(fn, code));
  }
  if (entry instanceof Error) throw entry;
  return entry as WorkCalendar;
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A calendar-day argument as `YYYY-MM-DD`, `undefined` for a blank one, or a
 * throw naming the argument when it is not a day.
 */
function dayArg(fn: WorkingDayFunction, name: string, v: unknown): string | undefined {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    return utcDayOf(v.getTime());
  }
  if (typeof v === 'number' || typeof v === 'bigint') {
    const ms = Number(v);
    if (Number.isFinite(ms)) return utcDayOf(ms);
  } else if (typeof v === 'string') {
    const day = calendarDayOf(v);
    if (day) return day;
    const parsed = new Date(v.trim());
    if (/^\d{4}-\d{2}-\d{2}T/.test(v.trim()) && !Number.isNaN(parsed.getTime())) return utcDayOf(parsed.getTime());
  }
  throw new RangeError(`${fn}() takes ${name} as a calendar day (YYYY-MM-DD text, a date field or today()); got '${String(v)}'.`);
}

/** An instant argument as epoch milliseconds, `undefined` for a blank one, or a throw naming it. */
function instantArg(fn: WorkingDayFunction, name: string, v: unknown): number | undefined {
  if (isBlank(v)) return undefined;
  let ms: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    ms = v.getTime();
  } else if (typeof v === 'number' || typeof v === 'bigint') {
    ms = Number(v);
  } else {
    ms = new Date(String(v).trim()).getTime();
  }
  if (!Number.isFinite(ms)) {
    throw new RangeError(`${fn}() takes ${name} as an instant (a datetime field, now(), ISO text or epoch milliseconds); got '${String(v)}'.`);
  }
  return ms;
}

function countArg(fn: WorkingDayFunction, name: string, v: unknown, whole: boolean): number {
  const n = isBlank(v) ? Number.NaN : Number(v);
  if (whole ? !Number.isSafeInteger(n) : !Number.isFinite(n)) {
    throw new RangeError(`${fn}() takes ${name} as ${whole ? 'a whole number' : 'a number'}; got ${isBlank(v) ? 'no value' : `'${String(v)}'`}.`);
  }
  return n;
}

/** A calendar day as the timestamp a `date` value is: that day at UTC midnight (ADR-0053 D1). */
function dayTimestamp(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Register the three functions, each reading its calendars through `read` when
 * it is CALLED (the stdlib's binding pattern, `registerBoundStdLib`). Each has
 * a two-argument form (the organization default) and a three-argument form
 * (a named calendar). Registered unconditionally: whether the names EXIST is a
 * fact about the platform, never about one call site's data.
 */
export function registerWorkingDayFunctions(env: Environment, read: () => EvalWorkCalendars | undefined): Environment {
  const addDays = (day: unknown, n: unknown, code?: unknown): Date => {
    const d = dayArg('addWorkingDays', 'the start day', day);
    const count = countArg('addWorkingDays', 'the number of days', n, true);
    // A blank start answers blank, before any calendar is read: the unmarked
    // invalid Date a formula field serializes to `null`, the answer `addDays()`
    // gives one.
    if (d === undefined) return new Date(Number.NaN);
    return dayTimestamp(addWorkingDays(calendarFor('addWorkingDays', read(), code), d, count));
  };
  const between = (start: unknown, end: unknown, code?: unknown): bigint => {
    const s = dayArg('workingDaysBetween', 'the start day', start);
    const e = dayArg('workingDaysBetween', 'the end day', end);
    if (s === undefined || e === undefined) {
      throw new RangeError(`workingDaysBetween() needs both days; the ${s === undefined ? 'start' : 'end'} day has no value.`);
    }
    return BigInt(workingDaysBetween(calendarFor('workingDaysBetween', read(), code), s, e));
  };
  const addHours = (start: unknown, hours: unknown, code?: unknown): Date => {
    const t = instantArg('addWorkingHours', 'the start', start);
    const h = countArg('addWorkingHours', 'the number of hours', hours, false);
    if (t === undefined) return new Date(Number.NaN);
    return new Date(addWorkingHours(calendarFor('addWorkingHours', read(), code), t, h));
  };
  return env
    .registerFunction('addWorkingDays(dyn, dyn): google.protobuf.Timestamp', (d: unknown, n: unknown) => addDays(d, n))
    .registerFunction('addWorkingDays(dyn, dyn, string): google.protobuf.Timestamp', (d: unknown, n: unknown, c: unknown) => addDays(d, n, c))
    .registerFunction('workingDaysBetween(dyn, dyn): int', (s: unknown, e: unknown) => between(s, e))
    .registerFunction('workingDaysBetween(dyn, dyn, string): int', (s: unknown, e: unknown, c: unknown) => between(s, e, c))
    .registerFunction('addWorkingHours(dyn, dyn): google.protobuf.Timestamp', (t: unknown, h: unknown) => addHours(t, h))
    .registerFunction('addWorkingHours(dyn, dyn, string): google.protobuf.Timestamp', (t: unknown, h: unknown, c: unknown) => addHours(t, h, c));
}
