// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_job_queue — Durable Background Job / Message Queue + DLQ
 *
 * The persistent backing store for `DbQueueAdapter`. Each row is one
 * enqueued message — pending until a worker leases (`status='running'`),
 * then `completed`, `failed`, or finally `dlq` after exhausting retries.
 *
 * DLQ rows are simply `status='dlq'` rows in this same table; no separate
 * table needed. Listing/replay is a filter on `status`.
 *
 * Idempotency: `idempotency_key` + `queue` are deduplicated by the adapter
 * over a configurable window (default 24h) — the column is indexed.
 *
 * Concurrency: workers claim a row by CAS-updating `status` from `pending`
 * to `running` plus setting `locked_by`/`locked_until`. Reads only return
 * rows whose lock has not been claimed (or whose lease expired).
 *
 * Writers: `DbQueueAdapter` (publish/lease/complete/fail).
 * Readers: Studio DLQ view, ops dashboards, the adapter's worker loop.
 *
 * Retention: `completed` rows are swept by the platform LifecycleService —
 * see the `lifecycle` block below (#5179).
 *
 * @namespace sys
 */
export const SysJobQueue = ObjectSchema.create({
  name: 'sys_job_queue',
  label: 'Job Queue Message',
  pluralLabel: 'Job Queue Messages',
  icon: 'inbox',
  isSystem: true,
  managedBy: 'engine-owned',

  /**
   * [ADR-0057 §3.1/§3.3, #5179] The queue table only ever GREW: the adapter
   * marks a delivered message `completed` and nothing ever touched the row
   * again (`purge()` had zero production callers, `purgeFailed()` is a manual
   * dead-letter API). Since #5160 that is one permanent row per email.
   *
   * Bounded declaratively rather than by a sweeper inside `DbQueueAdapter`:
   * ADR-0057 §3.3 puts ONE reaper in the platform (`LifecycleService`), not N
   * per-plugin ones — the same call the sibling `sys_job_run` already makes.
   * That the writer is the adapter itself (never user data) is what makes an
   * unattended delete safe here; the declaration is where an operator can see
   * the window, and `lifecycle` settings can override it per environment
   * without a code change.
   *
   * `onlyWhen: { status: 'completed' }` is the whole safety story:
   *   - `pending` / `running` are LIVE work — reaping them would drop
   *     undelivered messages;
   *   - `dlq` / `failed` are the dead-letter surface and exist precisely to
   *     wait for a human (`listFailed` / `replay` / `purgeFailed`), so they
   *     are never swept automatically, at any age.
   * This is also why the policy is `retention` (age by `created_at` + row
   * filter) and not `ttl` on `completed_at`: TTL has no row filter, and `dlq`
   * rows stamp `completed_at` too — a TTL would eat the dead-letter queue.
   *
   * Window = 7d, and it MUST stay ≥ the adapter's idempotency window
   * (`DbQueueAdapterOptions.idempotencyWindowMs`, default 24h): publish
   * dedups against terminal rows by comparing `created_at` to that window
   * (`db-queue-adapter.ts`), and the Reaper cuts off on the very same
   * `created_at` axis — so a retention ≥ the dedup window means a row the
   * dedup check still needs can never have been reaped, with no clock skew
   * between the two rules. 7d gives a week of delivery history for debugging
   * and 7× headroom over the default dedup window. `DbQueueAdapter` reads
   * this declaration and refuses to start when the two are configured the
   * wrong way round, so the invariant cannot drift apart silently.
   *
   * `class: 'transient'` ("workflow / ephemeral state" — ADR-0057 §3.1), not
   * `telemetry`: this is live work state, not a log, and per §3.6 a
   * `telemetry`/`event`/`audit` class RELOCATES the table to the dedicated
   * `telemetry` datasource wherever one is registered. Moving a live queue's
   * store is a migration, not a cleanup — `transient` deliberately stays on
   * the primary.
   */
  lifecycle: {
    class: 'transient',
    retention: {
      maxAge: '7d',
      onlyWhen: { status: 'completed' },
    },
  },
  description: 'Durable job/message queue including dead letters',
  displayNameField: 'queue',
  nameField: 'queue', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{queue} #{id}',
  highlightFields: ['queue', 'status', 'attempts', 'scheduled_for', 'last_error'],

  fields: {
    id: Field.text({ label: 'Message ID', required: true, readonly: true, group: 'System' }),

    queue: Field.text({
      label: 'Queue',
      required: true,
      maxLength: 255,
      searchable: true,
      description: 'Logical queue name (snake_case)',
      group: 'Identity',
    }),

    idempotency_key: Field.text({
      label: 'Idempotency Key',
      required: false,
      maxLength: 255,
      description: 'Deduplication key within (queue, window)',
      group: 'Identity',
    }),

    payload_json: Field.textarea({
      label: 'Payload (JSON)',
      required: false,
      description: 'Serialized message body',
      group: 'Content',
    }),

    metadata_json: Field.textarea({
      label: 'Metadata (JSON)',
      required: false,
      description: 'Serialized metadata bag (tenant_id, source_record, ...)',
      group: 'Content',
    }),

    status: Field.select(
      ['pending', 'running', 'completed', 'failed', 'dlq'],
      {
        label: 'Status',
        required: true,
        defaultValue: 'pending',
        description: 'Lifecycle state',
        group: 'State',
      },
    ),

    priority: Field.number({
      label: 'Priority',
      required: false,
      defaultValue: 100,
      description: 'Lower = higher priority',
      group: 'Schedule',
    }),

    attempts: Field.number({ label: 'Attempts', required: false, defaultValue: 0, group: 'State' }),
    max_attempts: Field.number({ label: 'Max Attempts', required: false, defaultValue: 3, group: 'State' }),

    backoff_type: Field.select(
      ['fixed', 'exponential'],
      { label: 'Backoff', required: false, defaultValue: 'exponential', group: 'Schedule' },
    ),
    backoff_delay_ms: Field.number({
      label: 'Backoff Base (ms)',
      required: false,
      defaultValue: 1000,
      group: 'Schedule',
    }),
    backoff_max_delay_ms: Field.number({
      label: 'Backoff Cap (ms)',
      required: false,
      group: 'Schedule',
    }),

    scheduled_for: Field.datetime({
      label: 'Scheduled For',
      required: false,
      description: 'Earliest time a worker may lease this message',
      group: 'Schedule',
    }),

    locked_by: Field.text({
      label: 'Locked By',
      required: false,
      maxLength: 255,
      description: 'Worker id holding the lease',
      group: 'Lease',
    }),
    locked_until: Field.datetime({
      label: 'Locked Until',
      required: false,
      description: 'Lease expiry; if past, another worker may claim',
      group: 'Lease',
    }),

    last_error: Field.textarea({ label: 'Last Error', required: false, group: 'State' }),
    completed_at: Field.datetime({ label: 'Completed At', required: false, group: 'State' }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    { fields: ['queue', 'status', 'scheduled_for'] },
    { fields: ['idempotency_key', 'queue'] },
    { fields: ['status'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the job queue runner (SYSTEM_CTX),
    // never the generic data API. Reads stay open for the Setup grid.
    apiMethods: ['get', 'list'],
  },
});
