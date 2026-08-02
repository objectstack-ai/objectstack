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
            description: "Recipient user id, or '*' for the admin-global default.",
        }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            defaultValue: '*',
            description: "Notification topic, or '*' for all topics.",
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            defaultValue: '*',
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
        { fields: ['user_id', 'topic', 'channel'], unique: true },
        { fields: ['topic'] },
    ],
});
