// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_notification — Notification Event (ADR-0030 Layer 2)
 *
 * **Re-modeled (ADR-0030)**: this object was previously a per-user inbox. It is
 * now the platform's notification **event** — one row per `emit()`, the single
 * ingress through which every producer (the flow `notify` node, collaboration
 * `@mention`, record assignment, system alerts) publishes. It carries no
 * recipient and no read-state: those live downstream in the delivery
 * materialization (`sys_inbox_message`) and the receipt
 * (`sys_notification_receipt`).
 *
 * Layering (ADR-0012 / ADR-0030):
 *   L2 event       → this object (`topic` / `payload` / `dedup_key` / `severity`)
 *   L4 delivery    → `sys_notification_delivery` (outbox; P1)
 *   L5 materialize → `sys_inbox_message` (in-app), email/push/… per channel
 *   L5 receipt     → `sys_notification_receipt` (read/clicked/dismissed)
 *
 * Writers: `NotificationService.emit()` only — **no producer writes this row
 * directly** (single-ingress rule). Readers: the delivery pipeline; the admin
 * notification-event log. The Console bell reads `sys_inbox_message`, not this.
 *
 * @namespace sys
 */
export const SysNotification = ObjectSchema.create({
  name: 'sys_notification',
  label: 'Notification Event',
  pluralLabel: 'Notification Events',
  icon: 'bell',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0057: one 90d window across the whole notification pipeline
  // (event → delivery → receipt/inbox), enforced by the LifecycleService
  // (the retired NotificationRetention sweeper kept the same default).
  lifecycle: {
    class: 'telemetry',
    retention: { maxAge: '90d' },
  },
  description: 'Notification events — one row per emit() (ADR-0030 Layer 2 ingress)',
  displayNameField: 'topic',
  nameField: 'topic', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{topic}',
  highlightFields: ['topic', 'severity', 'source_object', 'created_at'],

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_notification' },
      columns: ['topic', 'severity', 'actor_id', 'source_object', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: { title: 'No events', message: 'No notification events have been emitted.' },
    },
    by_topic: {
      type: 'grid',
      name: 'by_topic',
      label: 'By Topic',
      data: { provider: 'object', object: 'sys_notification' },
      columns: ['topic', 'severity', 'source_object', 'source_id', 'created_at'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 100 },
      grouping: { fields: [{ field: 'topic', order: 'asc', collapsed: false }] },
    },
  },

  fields: {
    id: Field.text({
      label: 'Notification ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    // ── Event identity ───────────────────────────────────────────
    topic: Field.text({
      label: 'Topic',
      required: true,
      maxLength: 200,
      searchable: true,
      description: 'Notification topic, e.g. task.assigned, collab.mention',
      group: 'Event',
    }),

    payload: Field.json({
      label: 'Payload',
      required: false,
      description: 'Template inputs carried to channels (title/body/url/actor/source/…)',
      group: 'Event',
    }),

    severity: Field.select(['info', 'warning', 'critical'], {
      label: 'Severity',
      required: false,
      defaultValue: 'info',
      description: 'Severity hint for rendering / filtering',
      group: 'Event',
    }),

    // [#17732] Channels fan-out did not even attempt, and why.
    //
    // A channel the tenant cannot send on (no transport configured) used to get
    // one `sys_notification_delivery` row per recipient that dead-lettered on
    // its first attempt. Fan-out now asks the channel first
    // (`MessagingChannel.isAvailable`) and writes no delivery row at all; the
    // fact is recorded HERE instead, so the suppression stays auditable at the
    // event level rather than disappearing.
    //
    // Value: `[{ channel, reason }]`, NULL when nothing was suppressed (the
    // overwhelmingly common path). JSON rather than a `select` because one
    // event fans out to several channels and each carries its OWN reason — a
    // scalar column would have to drop either the channel or the reason.
    //
    // `reason` is a CLOSED set, inlined here: `transport_not_configured`.
    // `packages/platform-objects` is a lower layer than service-messaging and
    // cannot import its `CHANNEL_UNAVAILABLE_REASONS`, so the two copies are
    // held equal by an executable assertion in
    // `packages/services/service-messaging/src/channel-availability.test.ts`
    // — ⛔ a comment is not what keeps them in step.
    suppressed_channels: Field.json({
      label: 'Suppressed Channels',
      required: false,
      description:
        'Channels fan-out skipped because they are unavailable for this tenant, as [{channel, reason}]; reason is the closed set: transport_not_configured',
      group: 'Event',
    }),

    dedup_key: Field.text({
      label: 'Dedup Key',
      required: false,
      maxLength: 255,
      description: 'Idempotency key within a topic window; a repeat emit is a no-op',
      group: 'Event',
    }),

    // ── Source linkage ───────────────────────────────────────────
    source_object: Field.text({
      label: 'Source Object',
      required: false,
      maxLength: 100,
      description: 'Object name of the related record (e.g. lead, opportunity)',
      group: 'Source',
    }),

    source_id: Field.text({
      label: 'Source Record',
      required: false,
      maxLength: 100,
      description: 'Record id within source_object',
      group: 'Source',
    }),

    actor_id: Field.lookup('sys_user', {
      label: 'Actor',
      required: false,
      description: 'User who caused the event (mentioner, assigner)',
      group: 'Source',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['topic', 'created_at'] },
    // Idempotency spine (ADR-0030). UNIQUE so `emit()` dedup is race-safe: a
    // concurrent emit with the same dedup_key loses the insert and converges to
    // the winner (mirrors the delivery outbox). SQL treats NULLs as distinct, so
    // the (common) events with no dedup_key are unconstrained.
    { fields: ['dedup_key'], unique: true },
    { fields: ['source_object', 'source_id'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: emitted only by NotificationService (single
    // ingress, SYSTEM_CTX), never the generic data API. Reads stay open.
    apiMethods: ['get', 'list'],
  },
});
