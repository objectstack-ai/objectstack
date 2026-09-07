// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_flow_dispatch — Persisted idempotency ledger for trigger dispatches
 * (#10220), and — since #14501 — the record of what each claimed dispatch
 * turned into.
 *
 * A time-relative sweep (`config.timeRelative`) evaluates its date window on
 * every tick and launches the flow once per matching record — but the sweep
 * itself holds no cross-tick memory, so every re-scan of the same window
 * re-dispatched the same records (measured: 15 duplicate reminders in ~70s on
 * a 5s interval, and a kernel rebuild re-dispatches even under a daily cron).
 * This table is that memory: one row per **claimed dispatch key**, written by
 * {@link ObjectStoreFlowDispatchStore.claim} before the flow is launched.
 *
 * The key (the row `id`) names the MATCHED WINDOW's identity, derived from the
 * same `DateWindow` the sweep matched against (maintainer ruling 2026-08-20 on
 * #10220): offset mode keys on `(flowName, recordId, windowDay, offset)`;
 * range mode keys on `(flowName, recordId, sweepDay, rangeSpec)` — so a range
 * flow still "fires every day the record stays in range" (the documented
 * `withinDays` semantic), just never twice in one day, and an offset flow
 * re-fires when the record's date field moves to a new window day.
 *
 * Every key embeds a calendar day, so a row is claimable on exactly one sweep
 * day and is dead weight afterwards — ADR-0057 telemetry retention reaps rows
 * after 30 days (comfortably >= any near-term catch-up horizon for cloud#1288's
 * catch-up sweeps, which this ledger unblocks; widen there if that work needs
 * more).
 *
 * **The row is two-phase since #14501, and this is the one place it stopped
 * being immutable.** #10220 wrote the row once, before the launch, and never
 * touched it again — a row's existence was the whole of its meaning. The
 * maintainer's A + a2 ruling on #14501 needs a second bit the existence of a
 * row cannot carry: `IJobService.replay()` refuses a scheduled flow's window
 * only when that window was **delivered**, and re-runs it when the claim is
 * absent *or failed*. So `claim()` still writes the row before the launch (the
 * race is still won on the primary key), and the dispatcher now settles it
 * afterwards with {@link FlowDispatchStore.settle}.
 *
 * **The write rule, exactly** — `outcome` and `settled_at` are the only columns
 * any writer ever updates, and `succeeded` is ABSORBING:
 *
 * - `null → succeeded` / `null → failed` — an ordinary run settling its claim.
 * - `failed → succeeded` — REQUIRED, not an exception: a plain `replay()`
 *   re-runs a failed window, and when that run lands the window really is
 *   delivered, so the next unforced replay must be refused.
 * - `succeeded → failed` — **refused**. A FORCED replay that throws leaves the
 *   window recorded `succeeded`, because rewriting it would silently reopen the
 *   *unforced* re-delivery door this whole ledger exists to shut. The operator
 *   whose forced replay failed has to force again: louder, and safer.
 *
 * The predicate is `isSettleAllowed` in `flow-dispatch-store.ts`, and refusing
 * is a no-op rather than a throw — it is the invariant working, not an error.
 *
 * A row left at `outcome: null` is a dispatch whose process died mid-flight, or
 * a claim written before #14501, or a `time-relative:` claim (which is never
 * settled at all — only `schedule:` keys have an outcome). All of them read as
 * **not delivered** — the `replay()` contract's "failed" row — because "we
 * claimed it and never saw it finish" is exactly the case an operator replay
 * exists to repair.
 *
 * Writers: the automation engine's {@link FlowDispatchStore} — `claim()`
 * (check-and-record) and `settle()` (outcome only) — under a system context.
 * Readers: the same claim path, `replay()`'s pre-flight check, and operability
 * surfaces ("what did this sweep dispatch, and did it land?").
 *
 * @namespace sys
 */
export const SysFlowDispatch = ObjectSchema.create({
  name: 'sys_flow_dispatch',
  label: 'Flow Dispatch',
  pluralLabel: 'Flow Dispatches',
  icon: 'repeat',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0057: pure telemetry — every row's key embeds the one sweep day it can
  // be claimed on, so rows have no read value after the window passes. 30-day
  // retention per the #10220 ruling (>= the cloud#1288 catch-up horizon).
  lifecycle: {
    class: 'telemetry',
    retention: { maxAge: '30d' },
  },
  description:
    'Idempotency ledger for trigger dispatches (#10220): one row per claimed dispatch key — (flow, record, matched-window) for a time-relative sweep, (flow, tick-window) for a scheduled flow — so a re-scan, a rebuilt kernel or an operator replay never re-launches a flow for a window it already delivered.',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['id', 'dispatched_at', 'outcome'],

  fields: {
    // The dispatch key IS the identity — using it as the primary key makes
    // claim() a natural check-and-record (a concurrent duplicate insert fails
    // on the id, and the claimer re-reads to see it lost the race).
    id: Field.text({ label: 'Dispatch Key', required: true, readonly: true, group: 'System' }),

    dispatched_at: Field.datetime({
      label: 'Dispatched At',
      required: true,
      description: 'When the dispatch key was claimed (immediately before the flow launch it deduplicates).',
      group: 'State',
    }),

    // [#14501] The claim's outcome, and only for a `schedule:` key. OPTIONAL,
    // and its absence is meaningful three ways: the mid-flight state between
    // `claim()` and `settle()`, every row a ledger predating the outcome
    // columns already holds, and every `time-relative:` row — that trigger
    // dedups per (flow, record, window) and never settles, so half this table
    // stays null by design. All three read as "not delivered", the safe
    // direction: a replay re-runs rather than refusing on a claim nobody
    // settled.
    outcome: Field.select(['succeeded', 'failed'], {
      label: 'Outcome',
      required: false,
      description:
        'For a scheduled-flow (schedule:) claim, what the dispatch turned into: succeeded (delivered — an unforced replay of this window is refused) or failed (the flow threw; a replay re-runs it). Succeeded is absorbing: a later failed run never overwrites it. Null means not delivered — claimed and never settled, written before this column existed, or a time-relative claim, which never settles.',
      group: 'State',
    }),

    settled_at: Field.datetime({
      label: 'Settled At',
      required: false,
      description: 'When the outcome was recorded (immediately after the flow launch this row deduplicates returned). Null wherever outcome is.',
      group: 'State',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    // Retention age sweep: the platform Reaper deletes rows older than
    // `retention.maxAge` by created_at.
    { fields: ['created_at'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the automation engine's claim
    // path (SYSTEM_CTX), never via the generic data API. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
