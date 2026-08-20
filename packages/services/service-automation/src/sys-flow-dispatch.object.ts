// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_flow_dispatch — Persisted idempotency ledger for trigger dispatches
 * (#10220).
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
 * Writers: the automation engine's {@link FlowDispatchStore} (`claim()`),
 * check-and-record under a system context. Readers: the same claim path, and
 * operability surfaces ("what did this sweep dispatch?").
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
    'Idempotency ledger for trigger dispatches (#10220): one row per claimed (flow, record, matched-window) key, so a re-scan or a rebuilt kernel never re-launches a flow for a window it already dispatched.',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['id', 'dispatched_at'],

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
