// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_preference` — per-user × topic × channel delivery toggle
 * (ADR-0030 Layer 3).
 *
 * The mute/allow matrix the preference filter consults before fan-out. A row
 * declares whether `user_id` wants `topic` on `channel`. Resolution is
 * most-specific-wins with wildcards:
 *
 *   (user, topic, channel) → (user, topic, *) → (user, *, channel) →
 *   (user, *, *) → ('*', topic, channel) → … → ('*', '*', '*') → default ON
 *
 * `user_id = '*'` rows are the **admin global default**; a real-user row
 * **overrides** it. `topic = '*'` / `channel = '*'` are wildcards. Mandatory
 * topics (configured on the service) bypass this object entirely.
 *
 * Belongs to `service-messaging` (owner of the delivery pipeline).
 */
export const NotificationPreference = ObjectSchema.create({
    name: 'sys_notification_preference',
    label: 'Notification Preference',
    pluralLabel: 'Notification Preferences',
    icon: 'bell-ring',
    isSystem: true,
    // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema: a
    // user authors their own mute/allow rows (and admins the `user_id = '*'`
    // global defaults) from the Setup "Notification Preferences" grid. The bucket
    // default is full CRUD, so no `userActions` block is needed — RLS is the authz.
    managedBy: 'system-data',
    description: 'Per-user × topic × channel notification toggle (mute/allow), with admin-global defaults.',
    titleFormat: '{user_id} · {topic} · {channel}',
    highlightFields: ['user_id', 'topic', 'channel', 'enabled', 'digest'],

    fields: {
        id: Field.text({ label: 'Preference ID', required: true, readonly: true }),

        user_id: Field.text({
            label: 'User',
            required: true,
            searchable: true,
            // [#12978] Referenced-column bound (#11374 route A): a
            // `sys_user.id` — physical varchar(255), the id column driver-sql
            // creates (`table.string('id').primary()`) — or the 1-char
            // literal '*'.
            maxLength: 255,
            description: "Recipient user id, or '*' for the admin-global default.",
        }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            defaultValue: '*',
            // [#12978] Sibling-declaration bound (#11374 route A): rows are
            // matched against the event's `sys_notification.topic`
            // (maxLength: 200 there) — `preference-resolver` keys
            // `${user}|${topic}|${channel}` against `ctx.topic` — so a longer
            // stored topic could never match an event the platform can store.
            // '*' is 1 char.
            maxLength: 200,
            description: "Notification topic, or '*' for all topics.",
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: '*',
            // [#12978] Machine channel-id vocabulary (#11374 route A), same
            // sourcing as `sys_notification_delivery.channel`: registered
            // `MessagingChannel.id`s (inbox/email/sms today; spec's widest
            // enum member is 7 chars), 64 per the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64). '*' is
            // 1 char.
            maxLength: 64,
            description: "Channel id (inbox/email/push/…), or '*' for all channels.",
        }),

        enabled: Field.boolean({
            label: 'Enabled',
            defaultValue: true,
            description: 'When false, this (user, topic, channel) is muted.',
        }),

        digest: Field.select(['none', 'daily', 'weekly'], {
            label: 'Digest',
            required: false,
            defaultValue: 'none',
            description: 'Batch cadence (P3 digest middleware).',
        }),

        quiet_hours: Field.json({
            label: 'Quiet Hours',
            required: false,
            description: 'Optional { tz, start, end } window (P3 quiet-hours middleware).',
        }),

        created_at: Field.datetime({ label: 'Created At', readonly: true }),
        updated_at: Field.datetime({ label: 'Updated At', required: false }),
    },

    indexes: [
        // [#8554] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index
        // bare `unique: true` is the positional spelling of `'global'` — the
        // listed columns VERBATIM — so `(user_id, topic, channel)` was an
        // installation-wide key on a tenant-scoped object. This is the near-exact
        // analogue of `sys_user_preference` (#8323): a user who belongs to two
        // organizations could not hold INDEPENDENT per-topic toggles, because the
        // first organization's row claimed the triple for the whole installation.
        // Measured live before the fix: org_jia creates
        // (user_u1, billing.invoice, email) 201 / org_yi the SAME triple 409
        // UNIQUE_VIOLATION / org_yi the same pair on `push` 201 / org_yi a
        // different topic on `email` 201 / org_yi's own GET on the colliding
        // triple 0 rows.
        //
        // ⚠️ `managedBy: 'system-data'` is NOT a reason to exempt this object.
        // The already-ruled `sys_user_preference` is `system-data` too; the
        // ruling's phrase is ADMIN-AUTHORED CONTENT — the provenance of the
        // rows, not the management mode of the object.
        { fields: ['user_id', 'topic', 'channel'], unique: 'organization' },
        { fields: ['topic'] },
    ],
});
