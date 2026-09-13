// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_delivery` — the durable outbox (ADR-0030 Layer 4).
 *
 * One row per `(event × recipient × channel)`. The spine of reliable delivery:
 * `emit()` writes rows in `pending`; the `NotificationDispatcher` claims them
 * (`pending → in_flight`), sends via the channel, and acks the outcome
 * (`success` / back to `pending` with a `next_attempt_at` for retry / `dead`
 * once the retry budget is exhausted). Mirrors `sys_webhook_delivery`.
 *
 * `payload` snapshots the rendered notification content at enqueue time so a
 * later edit of the L2 event can't rewrite an in-flight delivery (and so the
 * dispatcher needs no second read to send). Scheduling fields (`claimed_at`,
 * `next_attempt_at`, `last_attempted_at`) are epoch ms; the builtin
 * `created_at` / `updated_at` audit columns are native timestamps.
 */
export const NotificationDelivery = ObjectSchema.create({
    name: 'sys_notification_delivery',
    label: 'Notification Delivery',
    pluralLabel: 'Notification Deliveries',
    icon: 'send',
    isSystem: true,
    managedBy: 'engine-owned',
    // ADR-0057: pipeline telemetry. TWO windows, because this table
    // interleaves rows that still carry work with rows that never will.
    //
    // [#17611] A tenant with no transport configured for a fanned-out channel
    // dead-letters that channel's row on its FIRST attempt (`attempts: 1`),
    // and every `notify` writes one such row forever after. Measured on a
    // production tenant: 2,876 `email`/`dead` rows at +316/day, zero pending.
    // Those rows carry no work — nothing ever claims, retries or acks them
    // again — yet they sat in the claim query's table for the full 90d.
    //
    // `retention.onlyWhen` scopes the SHORT window to the terminal-FAILURE
    // statuses, the same shape `sys_job_queue`, `sys_automation_run` and
    // `sys_upload_session` already declare. `success` is deliberately NOT in
    // the scope: the ruling keeps delivery history at the table window.
    //
    // ⚠️ The 7d scope does not REPLACE the table's bound, it sits under it —
    // `retention` is a single block, so scoping it would have left every
    // non-terminal row (`pending`, `in_flight`, `success`) with no age bound
    // at all, unbounding the larger half of this table's growth on the very
    // card that exists to bound it. The `ttl` leg restates the 90d window the
    // object has always declared, on the same `created_at` clock `retention`
    // reaps by, so non-terminal rows keep exactly today's behaviour. Both legs
    // run: `LifecycleService.reapObject` takes `ttl` and `retention` in
    // independent `if`s, not an either/or.
    //
    // ⛔ The `$in` list is a third copy of a vocabulary the WRITERS own
    // (`SqlNotificationOutbox.ack` / `MemoryNotificationOutbox.ack`), so it
    // must be widened in the same change as a writer — the `sys_automation_run`
    // lesson: a widened writer against a narrow sweep scope means the new
    // status is simply never aged out, silently, forever. Today those two are
    // the only terminal-failure statuses either ack path can produce.
    // `failed` is a legal member of the `status` field below but NO writer of
    // THIS object ever sets it (it is `sys_http_delivery`'s terminal status),
    // so naming it here would scope the sweep on a value that cannot occur.
    lifecycle: {
        class: 'telemetry',
        // The table window — every row, same 90d as sys_notification.
        ttl: { field: 'created_at', expireAfter: '90d' },
        // The terminal-failure window — rows that will never carry work again.
        retention: {
            maxAge: '7d',
            onlyWhen: { status: { $in: ['dead', 'suppressed'] } },
        },
    },
    description: 'Durable per-recipient × channel delivery outbox (ADR-0030 Layer 4).',
    titleFormat: '{channel} → {recipient_id}',
    highlightFields: ['notification_id', 'recipient_id', 'channel', 'status', 'attempts'],

    fields: {
        id: Field.text({ label: 'Delivery ID', required: true, readonly: true }),

        notification_id: Field.text({
            label: 'Notification Event',
            required: true,
            searchable: true,
            // [#12978] Referenced-column bound (#11374 route A): FK to
            // `sys_notification.id`, whose physical column is the id column
            // driver-sql creates — `table.string('id').primary()`, knex's
            // varchar(255), spelled `DEFAULT_STRING_VARCHAR_CHARS`. 255 by
            // transitivity from the id itself, the same sourcing the
            // plugin-audit record-id pins assert by value.
            maxLength: 255,
            description: 'FK → sys_notification (L2 event)',
        }),
        recipient_id: Field.text({
            label: 'Recipient User',
            required: true,
            searchable: true,
            // [#12978] Referenced-column bound (#11374 route A): a resolved
            // recipient is a `sys_user.id` (physical varchar(255), as above)
            // or an email-shaped value `RecipientResolver.resolveOne()` keeps
            // verbatim (#9807) — RFC 5321 caps an address at 254 octets and
            // `sys_user.email` stores one in a string-family varchar(255)
            // column. 255 admits both producers.
            maxLength: 255,
        }),
        channel: Field.text({
            label: 'Channel',
            required: true,
            // [#12978] Machine channel-id vocabulary (#11374 route A): values
            // are the `MessagingChannel.id`s the service fans out to —
            // `registerChannel` registers `inbox` / `email` / `sms` today, and
            // the spec's `NotificationChannelSchema` widest member is
            // `webhook` (7 chars). 64 follows the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64; adopted by
            // sys_device_code.status), so a future channel id is never refused
            // by the column.
            maxLength: 64,
        }),
        topic: Field.text({ label: 'Topic', searchable: true }),

        // P3b-2 digest: when the recipient's preference batches this channel
        // (`digest: daily|weekly`), the row enqueues deferred to the next window
        // and carries `${recipient}|${channel}|${window}` here. The dispatcher's
        // digest pass collapses all same-key rows into ONE rendered message at
        // window time. Null ⇒ an ordinary (immediate / quiet-hours) delivery.
        digest_key: Field.text({ label: 'Digest Key', searchable: true,
            // [#12978] Derived bound (#11374 route A): the one producer is
            // `enqueueDeliveries`' `${recipient}|${channel}|${digest.window}`
            // — recipient ≤ 255 (recipient_id above) + '|' + channel ≤ 64
            // (channel above) + '|' + window ≤ 10 (`digestDeferral` emits a
            // local ISO date, YYYY-MM-DD, for both cadences). 255+1+64+1+10.
            maxLength: 331,
            description: 'recipient|channel|window grouping key for batched (digest) deliveries; null for normal sends.' }),

        payload: Field.json({
            label: 'Payload',
            description: 'Snapshot of the rendered notification content for dispatch.',
        }),

        status: Field.select(['pending', 'in_flight', 'success', 'failed', 'dead', 'suppressed'], {
            label: 'Status',
            required: true,
            defaultValue: 'pending',
        }),

        attempts: Field.number({ label: 'Attempts', defaultValue: 0 }),
        partition_key: Field.number({ label: 'Partition Key', defaultValue: 0 }),

        claimed_by: Field.text({ label: 'Claimed By', description: 'Node id while in_flight' }),
        claimed_at: Field.number({ label: 'Claimed At (ms)' }),
        next_attempt_at: Field.number({ label: 'Next Attempt At (ms)' }),
        last_attempted_at: Field.number({ label: 'Last Attempted At (ms)' }),
        error: Field.textarea({ label: 'Error' }),

        // Builtin audit columns: the SQL driver provisions `created_at` /
        // `updated_at` as native TIMESTAMP columns (Postgres/MySQL), so they are
        // declared `datetime` and written as `Date`s — a bare epoch-ms number is
        // rejected by a real timestamp column. See SqlNotificationOutbox.
        created_at: Field.datetime({ label: 'Created At', readonly: true }),
        updated_at: Field.datetime({ label: 'Updated At' }),
    },

    indexes: [
        // Dedup: one delivery per (event, recipient, channel).
        { fields: ['notification_id', 'recipient_id', 'channel'], unique: true },
        // The hot claim query.
        { fields: ['status', 'partition_key', 'next_attempt_at'] },
        // Stale-in_flight reaper.
        { fields: ['status', 'claimed_at'] },
        { fields: ['notification_id'] },
        // P3b-2: the digest collapse pass — claim due batched rows by group.
        { fields: ['digest_key', 'status', 'next_attempt_at'] },
    ],

    enable: {
        // [ADR-0103] Engine-owned delivery outbox: written only by the messaging
        // service (context-less raw-engine writes), never via the data API.
        apiMethods: ['get', 'list'],
    },
});
