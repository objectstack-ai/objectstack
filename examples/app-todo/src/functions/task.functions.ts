// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Named callables the app's `script` flow nodes invoke, registered through
 * `defineStack({ functions })` in `objectstack.config.ts` (#1870).
 *
 * A flow function is PURE (#4396): it takes `input`, RETURNS a value, and a
 * later declarative node persists it. It does no data I/O of its own, which is
 * why none of these declares an `effect`.
 */

/** The recurrence cadences `todo_task.recurrence_type` offers. */
const RECURRENCE_TYPES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

/** Coerce a `Field.date` value to a `Date`. It reaches a flow as a `Date`, an
 * ISO string, or an epoch number depending on the driver, so all three are
 * accepted — the same coercion `@objectstack/formula`'s date functions do. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  return new Date(String(value));
}

/** Add `n` days in UTC. */
function addDaysUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Add `n` calendar months in UTC, clamping the day to the target month's last
 * day so Jan 31 + 1 month is Feb 28 rather than Mar 3.
 *
 * Deliberately the same rule as `@objectstack/formula`'s `addMonths` (see
 * `packages/formula/src/stdlib.ts`), so a monthly recurrence spawned by this
 * flow lands on the same day a `addMonths(...)` formula field would compute for
 * it. Two different answers for "one month after Jan 31" inside one app is the
 * kind of drift an example must not demonstrate.
 */
function addMonthsUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** `YYYY-MM-DD` — the calendar-date form a `Field.date` stores and compares on. */
function toCalendarDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One cadence per authored `recurrence_type` option — total over the select. */
const NEXT_DUE_BY_TYPE: Record<RecurrenceType, (due: Date, interval: number) => Date> = {
  daily: (due, interval) => addDaysUtc(due, interval),
  weekly: (due, interval) => addDaysUtc(due, interval * 7),
  monthly: (due, interval) => addMonthsUtc(due, interval),
  yearly: (due, interval) => addMonthsUtc(due, interval * 12),
};

/**
 * Next due date for a recurring task: the completed task's `due_date` shifted
 * by `recurrence_interval` units of `recurrence_type`.
 *
 * **Why this is a function and not an expression** (#7037). `TaskCompletionFlow`
 * used to write the literal string
 * `DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "...")`
 * into `create_record`'s `due_date`. `DATEADD` exists nowhere in the platform,
 * and a `create_record` node's `fields` are TEMPLATE-interpolated rather than
 * evaluated — the `{...}` holes are filled and the surrounding text passed
 * through verbatim — so the driver received `DATEADD(2026-08-10, 1, "daily")`
 * and refused the write with `Due Date must be a valid date (ISO-8601)`.
 *
 * No flow node evaluates a value-producing expression: the builtin vocabulary's
 * only expression slots are PREDICATES (`config.condition`, `edge.condition`,
 * `decision.conditions[].expression`, `screen.fields[].visibleWhen`) and
 * `flow-template` references (`loop.collection`, `map.collection`) — see
 * `FLOW_NODE_EXPRESSION_PATHS` in `@objectstack/spec/automation`. An
 * `assignment` node interpolates too; it does not evaluate. So the value has to
 * be computed BEFORE the create node, and a `script` node calling this function
 * is the shipped way to do that.
 *
 * @param input.dueDate         the completed task's `due_date`
 * @param input.recurrenceType  one of daily / weekly / monthly / yearly
 * @param input.interval        `recurrence_interval` (schema default 1, min 1)
 * @returns the next due date as `YYYY-MM-DD`, or `null` when the completed task
 *   carried no `due_date` — with no previous due date there is nothing to shift,
 *   and the spawned task starts undated rather than on an invented day.
 */
export function computeNextTaskDueDate({ input }: { input: Record<string, unknown> }): string | null {
  const { dueDate, recurrenceType, interval } = input;

  if (dueDate === null || dueDate === undefined || dueDate === '') return null;
  const due = toDate(dueDate);
  if (Number.isNaN(due.getTime())) {
    throw new Error(`computeNextTaskDueDate: '${String(dueDate)}' is not a valid due date`);
  }

  const type = String(recurrenceType ?? '').trim().toLowerCase();
  const next = NEXT_DUE_BY_TYPE[type as RecurrenceType];
  // Refuse loudly rather than guessing a cadence. An unknown value here means
  // the record disagrees with `todo_task.recurrence_type`'s own option list, and
  // a silently-skipped recurrence is the failure mode this whole card is about.
  if (!next) {
    throw new Error(
      `computeNextTaskDueDate: unknown recurrence_type '${String(recurrenceType)}' ` +
      `(expected one of ${RECURRENCE_TYPES.join(', ')})`,
    );
  }

  // An absent interval takes the field's own declared default (1), which is what
  // the schema would have written; anything present but not a positive whole
  // number is a contradiction of `min: 1` and refuses rather than being coerced.
  const steps = interval === null || interval === undefined || interval === '' ? 1 : Number(interval);
  if (!Number.isFinite(steps) || steps < 1) {
    throw new Error(
      `computeNextTaskDueDate: recurrence_interval must be a number >= 1, got '${String(interval)}'`,
    );
  }

  return toCalendarDate(next(due, Math.trunc(steps)));
}
