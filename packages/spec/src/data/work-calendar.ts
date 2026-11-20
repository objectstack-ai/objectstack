// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Working calendars (ADR-0157): the refusal codes, the column names, the
 * machine-code shape and the plain-data shape of one resolved calendar.
 *
 * Prime Directive #2: spec holds schemas, types and constants only. The
 * arithmetic over these types — the period parser, `buildWorkCalendar`, the
 * four counts and the three error classes that carry these codes — lives in
 * `@objectstack/formula` (`work-calendar.ts`), where the working-day formula
 * functions and the calendar service (`@objectstack/objectql`) both read it
 * over a dependency edge they already have. The one daylight-saving rule it
 * converts through stays here (`./wall-clock.ts`, D11). The service contract
 * is `IWorkCalendarService` (`../contracts/work-calendar-service.ts`).
 *
 * ## The rows (ADR-0157 D1, D7, D10)
 *
 * - A calendar carries one period list per weekday
 *   ({@link WORK_CALENDAR_WEEKDAY_FIELDS}), each local `HH:mm-HH:mm` periods
 *   separated by commas; a blank weekday is not worked. A period that crosses
 *   midnight is refused (D7); `24:00` is a legal end (D10).
 * - An exception row overrides one date: `off` carries no periods, `on`
 *   carries that date's FULL periods (D10). One row per calendar and date.
 * - `maintained_from` .. `maintained_through` is the span the organization
 *   keeps the calendar's exceptions for; a computation that needs a date
 *   outside it is refused (D8), never read from the weekly pattern alone or
 *   from wall-clock time (D2).
 */

// ── Refusal codes (ADR-0112 ledger, `@objectstack/spec`) ─────────────────

/** ADR-0157 D2: no calendar resolves — the named code is absent, the organization has no single default, or no organization was named where one is required. */
export const WORK_CALENDAR_UNRESOLVED_CODE = 'ERR_WORK_CALENDAR_UNRESOLVED' as const;

/** ADR-0157 D3/D8: the computation needs a date outside the calendar's maintained span. */
export const WORK_CALENDAR_NOT_MAINTAINED_CODE = 'ERR_WORK_CALENDAR_NOT_MAINTAINED' as const;

/** ADR-0157 D7/D10: a stored calendar or exception row the arithmetic cannot read as written. */
export const WORK_CALENDAR_INVALID_CODE = 'ERR_WORK_CALENDAR_INVALID' as const;

/**
 * ADR-0157 D2: why a calendar did not resolve.
 *
 * - `not_found`: the named code is no calendar of the organization.
 * - `no_default`: no code was named and the organization marks no default.
 * - `ambiguous`: more than one row answers (two defaults); refused, never
 *   settled by picking one.
 * - `no_organization`: the computation names no organization outside the
 *   `single` tenancy posture, where a code or a default names nothing without
 *   one. Refused before any read.
 */
export type WorkCalendarUnresolvedReason = 'not_found' | 'no_default' | 'ambiguous' | 'no_organization';

// ── Periods ──────────────────────────────────────────────────────────────

/** One working period, in minutes from local midnight: `0 <= start < end <= 1440`. */
export interface WorkPeriod {
  readonly start: number;
  readonly end: number;
}

/** Why a period list was refused. */
export type WorkPeriodsRefusal = 'malformed' | 'crosses_midnight' | 'empty_period' | 'overlap';

/** A period list read as written, or why it cannot be. */
export type WorkPeriodsParse =
  | { readonly ok: true; readonly periods: readonly WorkPeriod[] }
  | { readonly ok: false; readonly reason: WorkPeriodsRefusal; readonly message: string };

/** The weekday period columns, Monday first (ISO order); index 0 is Monday. */
export const WORK_CALENDAR_WEEKDAY_FIELDS = [
  'monday_periods',
  'tuesday_periods',
  'wednesday_periods',
  'thursday_periods',
  'friday_periods',
  'saturday_periods',
  'sunday_periods',
] as const;

// ── The resolved calendar ────────────────────────────────────────────────

/** One exception date: `off` (no periods) or `on` (the date's full periods). */
export interface WorkCalendarDay {
  readonly kind: 'off' | 'on';
  readonly periods: readonly WorkPeriod[];
}

/**
 * One resolved calendar with its exceptions, as plain data: what the calendar
 * service hands a consumer and what every count computes over. Built frozen,
 * so a consumer cannot change what a cached calendar answers.
 */
export interface WorkCalendar {
  readonly code: string;
  /** IANA zone the periods are local to (ADR-0157 D7). */
  readonly timezone: string;
  /** First calendar day the exceptions are maintained for (`YYYY-MM-DD`). */
  readonly maintainedFrom: string;
  /** Last calendar day the exceptions are maintained for (`YYYY-MM-DD`). */
  readonly maintainedThrough: string;
  /** Seven period lists, Monday first ({@link WORK_CALENDAR_WEEKDAY_FIELDS}). */
  readonly weekly: readonly (readonly WorkPeriod[])[];
  /** Exception dates (`YYYY-MM-DD`) inside the maintained span. */
  readonly exceptions: Readonly<Record<string, WorkCalendarDay>>;
}

// ── Names ────────────────────────────────────────────────────────────────

/**
 * The machine-code shape a calendar is named by (`sys_work_calendar.code`):
 * snake_case, as every machine name in the platform. A consumer's code that
 * does not match names no calendar, and is never read as a filter token.
 */
export const WORK_CALENDAR_CODE_PATTERN = '^[a-z][a-z0-9_]*$';

/**
 * ADR-0157 D8: how many days before a calendar's `maintained_through` Setup
 * lists it as needing maintenance, before refusals start. Sixty days opens the
 * notice around the window in which the next year's public holidays and 调休
 * days are usually published (around or after November), and leaves weeks to
 * enter them; a longer lead would flag a calendar before the data to extend
 * it exists.
 */
export const WORK_CALENDAR_MAINTENANCE_LEAD_DAYS = 60;
