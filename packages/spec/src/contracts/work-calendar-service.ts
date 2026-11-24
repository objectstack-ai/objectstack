// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/work-calendar-service
 *
 * [ADR-0157 D1, D2, D8; open point 4] The working-calendar service: resolve a
 * calendar under D2 (the named code, else the organization's default, else a
 * refusal, never wall-clock time), load its exceptions, cache the result until
 * a calendar or exception row is written, and count working time over it.
 * `@objectstack/objectql` implements it (`WorkCalendarService`) and registers
 * it under {@link WORK_CALENDAR_SERVICE}; the arithmetic it counts with is
 * `@objectstack/formula`'s.
 *
 * Every method rejects with `ERR_WORK_CALENDAR_UNRESOLVED`,
 * `ERR_WORK_CALENDAR_NOT_MAINTAINED` or `ERR_WORK_CALENDAR_INVALID`
 * (`@objectstack/spec/data`; `isWorkCalendarRefusal` in
 * `@objectstack/formula` classifies them); none answers wall-clock time.
 */

import type { WorkCalendar } from '../data/work-calendar.js';

/** Kernel service name the working-calendar service registers under (`ctx.getService`). */
export const WORK_CALENDAR_SERVICE = 'work-calendar' as const;

/**
 * Which calendar a computation reads (ADR-0157 D2, open point 4).
 *
 * `organizationId` is the organization the COMPUTATION belongs to: the
 * record's own `organization_id` (for the approval sweep, the request's),
 * never the caller's ambient active organization. A system context has none,
 * and a package-seeded calendar carries the same code in every organization,
 * so a code without an organization names nothing.
 *
 * The service reads in that organization elevated, as the exchange-rate
 * reader does (ADR-0144 D5): a rank-and-file member cannot read the calendar
 * tables, yet every deadline of theirs is counted through them.
 *
 * An absent `organizationId` is refused `ERR_WORK_CALENDAR_UNRESOLVED`
 * (reason `no_organization`) before any read, in every tenancy posture but
 * `single`. Under `single` there is one logical tenant and the read runs
 * without an organization scope; a read that matches more than one row is
 * refused `ambiguous`, never settled by picking one.
 */
export interface WorkCalendarRef {
  readonly organizationId: string | undefined;
  /** The code the consumer names (a formula argument, `escalation.calendar`); blank takes the organization default. */
  readonly calendar?: string | null;
}

/**
 * The working-calendar service contract.
 *
 * {@link IWorkCalendarService.resolve} hands back plain, frozen data, so a
 * caller that must compute synchronously (a formula evaluated over pinned
 * data) resolves first and then counts with `@objectstack/formula`'s
 * `addWorkingDays` and its siblings itself.
 */
export interface IWorkCalendarService {
  /** The calendar a computation reads, under D2. */
  resolve(ref: WorkCalendarRef): Promise<WorkCalendar>;
  /** Is the instant inside a working period of its own local date? */
  isWorkingTime(ref: WorkCalendarRef, at: number | Date): Promise<boolean>;
  /** The calendar day `days` working days after `day` (the start day is never counted). */
  addWorkingDays(ref: WorkCalendarRef, day: string, days: number): Promise<string>;
  /** The working days from `start` (excluded) to `end` (included); negative when `end` is earlier. */
  workingDaysBetween(ref: WorkCalendarRef, start: string, end: string): Promise<number>;
  /** The instant `hours` of working time after `start`, as epoch milliseconds (D11 elapsed time). */
  addWorkingHours(ref: WorkCalendarRef, start: number | Date, hours: number): Promise<number>;
  /** Drop every cached calendar; the next computation reads the rows again. */
  invalidate(): void;
}
