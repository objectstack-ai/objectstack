// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Time-Relative Trigger Protocol
 *
 * A **declarative** trigger for time-relative business rules — "act on records
 * whose date field is coming up (or overdue) relative to today" — without the
 * author hand-writing a cron job + range query, and without the fragile
 * date-equality-on-record-change anti-pattern (#1874).
 *
 * ## The anti-pattern it replaces
 *
 * Authors used to express "alert 60 days before `end_date`" as a `record_change`
 * flow gated on `end_date == daysFromNow(60)`. That predicate is only evaluated
 * when the record *happens to change*, so it fires only if the record is edited
 * on exactly that day — i.e. almost never, unattended. The robust alternative
 * was a hand-written `schedule` flow that queries a date range every day, which
 * every author re-implemented (contracts `renewal_alert`, hr
 * `document_expiring_soon`, procurement `po_overdue`, …).
 *
 * ## What this declares instead
 *
 * A `time_relative` trigger sweeps an object on a schedule (daily by default)
 * and launches the flow **once per matching record**, with that record in the
 * automation context (so `{record.<field>}` interpolation and the start-node
 * `condition` gate work exactly as they do for record-change flows). The
 * descriptor is carried on the flow's start node as `config.timeRelative`.
 *
 * @example T-minus renewal reminders (fires on the day a contract is 60/30/7 days out)
 * ```ts
 * // flow start node
 * config: {
 *   timeRelative: {
 *     object: 'contracts',
 *     dateField: 'end_date',
 *     offsetDays: [60, 30, 7],
 *     filter: { status: 'active' },
 *   },
 *   // optional sweep cadence — defaults to daily at 08:00 UTC
 *   schedule: { type: 'cron', expression: '0 8 * * *' },
 * }
 * ```
 *
 * @example "Expiring soon" range (fires every day a document is within 30 days of expiry)
 * ```ts
 * config: {
 *   timeRelative: { object: 'hr_document', dateField: 'expires_on', withinDays: 30 },
 * }
 * ```
 *
 * @example Overdue sweep (fires for POs up to 14 days past due)
 * ```ts
 * config: {
 *   timeRelative: { object: 'purchase_order', dateField: 'due_date', withinDays: -14, filter: { status: 'open' } },
 * }
 * ```
 */

/** snake_case machine-name pattern (object / field names). */
const MACHINE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Declarative descriptor for a time-relative trigger. Lives on a flow's start
 * node under `config.timeRelative`. Exactly ONE windowing mode — `withinDays`
 * (a range) or `offsetDays` (discrete thresholds) — must be set.
 */
export const TimeRelativeTriggerSchema = lazySchema(() =>
  z
    .object({
      /**
       * Object whose records are swept. Its machine name — the canonical id
       * everywhere (matches exactly, snake_case).
       */
      object: z
        .string()
        .regex(MACHINE_NAME)
        .describe('Object (machine name) to sweep, e.g. "contracts".'),

      /**
       * The `date` / `datetime` field compared against "now". Its value is
       * matched day-granular against the computed window/offsets.
       */
      dateField: z
        .string()
        .regex(MACHINE_NAME)
        .describe('Date or datetime field evaluated relative to today, e.g. "end_date".'),

      /**
       * **Range mode.** Fire for every record whose `dateField` lies within this
       * many days of today (inclusive, day-granular):
       *  - `withinDays > 0` → upcoming: `dateField ∈ [startOfToday, endOf(today + N)]`
       *    (the "expiring soon" case). Fires every day the record stays in range.
       *  - `withinDays < 0` → overdue: `dateField ∈ [startOf(today − |N|), endOfToday]`
       *    (a bounded "past due" lookback — bounded on purpose, so an ancient
       *    record does not re-alert forever).
       *  - `withinDays === 0` → due today.
       *
       * Mutually exclusive with {@link offsetDays}.
       */
      withinDays: z
        .number()
        .int()
        .optional()
        .describe(
          'Range mode: fire while dateField is within N days of today. Positive = upcoming, negative = overdue lookback, 0 = today.',
        ),

      /**
       * **Offset mode.** Fire when `dateField` falls exactly `offset` days from
       * today, for each offset listed — the robust form of the T-minus reminder
       * (`[60, 30, 7]` = alert at 60, 30, and 7 days out). Evaluated by the daily
       * sweep, so it fires on the right day regardless of when the record last
       * changed. Positive = future, negative = past (e.g. `[-1]` the day after).
       *
       * Mutually exclusive with {@link withinDays}.
       */
      offsetDays: z
        .array(z.number().int())
        .min(1)
        .optional()
        .describe('Offset mode: fire when dateField is exactly today + each offset (e.g. [60, 30, 7]).'),

      /**
       * Optional additional filter, ANDed with the computed date window — a
       * plain ObjectQL `where` map (e.g. `{ status: 'active' }`) so the sweep
       * only launches the flow for records in a relevant state.
       */
      filter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Extra ObjectQL where-map ANDed with the date window (e.g. { status: "active" }).'),

      /**
       * Cap on how many records one sweep launches the flow for, so a
       * misconfigured window can't fan out unboundedly. Defaults to
       * {@link TIME_RELATIVE_DEFAULT_MAX_RECORDS}; the sweep logs when it clamps.
       */
      maxRecords: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max records launched per sweep (default 1000). The sweep logs when it clamps.'),
    })
    .refine((v) => (v.withinDays === undefined) !== (v.offsetDays === undefined), {
      message: 'Provide exactly one of `withinDays` (range mode) or `offsetDays` (offset mode).',
    }),
);

export type TimeRelativeTrigger = z.infer<typeof TimeRelativeTriggerSchema>;
/** Authoring input for {@link TimeRelativeTrigger} (defaulted fields optional). */
export type TimeRelativeTriggerInput = z.input<typeof TimeRelativeTriggerSchema>;

/**
 * Default per-sweep record cap when a descriptor omits `maxRecords`. Keeps a
 * mis-scoped window (e.g. `withinDays: 3650`) from launching the flow for an
 * entire table in one tick.
 */
export const TIME_RELATIVE_DEFAULT_MAX_RECORDS = 1000;

/**
 * Default sweep cadence when a time-relative flow's start node carries no
 * `schedule` descriptor: once a day at 08:00 UTC. A daily cadence is the point
 * of the feature (evaluate the window every day so a threshold is never missed),
 * so this default — not "never" — is what an author who omits it expects.
 */
export const TIME_RELATIVE_DEFAULT_CRON = '0 8 * * *';
