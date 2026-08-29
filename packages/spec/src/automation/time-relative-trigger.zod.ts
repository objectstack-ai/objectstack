// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

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
 *
 * ## Closed against unknown keys (#4001 batch 11, ADR-0078)
 *
 * This schema was off the strictness map entirely until the 2026-08-03
 * re-measurement, and for a reason worth leaving here: its single site is
 * written `z\n  .object({`, the ledger's old textual counter matched zero sites,
 * and a zero-site file is SKIPPED by the coverage walk as "nothing to classify".
 * The gate whose whole promise is *no undeclared authorable surface* printed
 * green over this file. The counter now reads the AST (#4852) — but the schema
 * it uncovered was still on default `.strip`, which is what this closes.
 *
 * The stakes here are higher than a dropped key usually is, because the
 * descriptor lands on the node `config` slot, which is open BY DESIGN
 * (ADR-0018) — so the outer flow gate cannot see a typo inside it, and the only
 * gate that can is this one. And the failure is silent in both directions:
 * {@link TimeRelativeTrigger} is `safeParse`d at BIND time by
 * `TimeRelativeTriggerPlugin`, so before this change `offsetDay` (singular) or
 * `withinDay` next to a valid mode key bound a sweep that ran daily, matched
 * with the author's narrowing key discarded, and reported itself configured.
 * After it, the bind refuses and the warning names the key and the fix.
 */
export const TimeRelativeTriggerSchema = lazySchema(() =>
  strictObject(
    {
      surface: "this flow start node's `config.timeRelative` descriptor",
      aliases: {
        // Different WORD, same intent — the words the neighbouring authoring
        // surfaces use. `object`/`filter` are already the ObjectQL spellings
        // (`objectName`/`filters` graduated to ADR-0087 conversions at 17), so
        // an author arriving from a CRUD node's `config` brings exactly these.
        objectName: 'object',
        objectApiName: 'object',
        filters: 'filter',
        where: 'filter',
        // The date field: `field` is what a record-change trigger calls its
        // field, and `dateFieldName`/`targetField` are the same idea one word
        // out. None is within edit distance of `dateField`.
        field: 'dateField',
        dateFieldName: 'dateField',
        targetField: 'dateField',
        limit: 'maxRecords',
        batchSize: 'maxRecords',
      },
      guidance: {
        // The cadence knob is real, but it is a SIBLING of this descriptor on
        // the same `config`, not a member of it — the wrong-layer case the
        // guidance channel exists for. `FlowSchema` carries the same
        // prescription for a top-level `schedule`.
        schedule:
          '`schedule` is a sibling of `timeRelative` on the START node\'s `config`, not a key ' +
          'inside it — write `config: { timeRelative: {…}, schedule: { type: \'cron\', ' +
          'expression: \'0 8 * * *\' } }`. Omitting it means daily at 08:00 UTC.',
        runAs:
          '`runAs` is a FLOW-level key, not part of the descriptor. A sweep has no trigger ' +
          'user, so under the default `runAs: \'user\'` its data operations are REFUSED' +
          ' — declare `runAs: \'system\'` beside `nodes`/`edges`.',
      },
      history:
        'Until this shape was closed, these were dropped silently — the descriptor still parsed and the sweep ' +
        'still bound, so a mis-spelled window or filter produced a trigger that matched ' +
        'nothing (or everything) while reporting itself as configured.',
    },
    {
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
    },
  ).refine((v) => (v.withinDays === undefined) !== (v.offsetDays === undefined), {
    message: 'Provide exactly one of `withinDays` (range mode) or `offsetDays` (offset mode).',
  }),
);

export type TimeRelativeTrigger = z.input<typeof TimeRelativeTriggerSchema>;

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
