// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_subscription` — who is subscribed to a topic (ADR-0030
 * Layer 3).
 *
 * Declares standing interest in a `topic` by a `principal` (`role:x`, `team:x`,
 * `user:id`, or a bare user id). Where a producer emits with `audience:
 * 'subscribers'` (or no explicit audience), the resolver expands the topic's
 * subscriptions into recipients — the opt-in counterpart to the explicit
 * audience most producers pass today.
 *
 * Distinct from `sys_notification_preference`: a subscription says "include me
 * for this topic"; a preference says "but mute it on this channel".
 *
 * Belongs to `service-messaging`.
 */
export const NotificationSubscription = ObjectSchema.create({
    name: 'sys_notification_subscription',
    label: 'Notification Subscription',
    pluralLabel: 'Notification Subscriptions',
    icon: 'rss',
    isSystem: true,
    // [ADR-0103, #3355] Admin/user-writable DATA on a platform-defined schema:
    // authored from the Setup "Notification Subscriptions" grid. The bucket
    // default is full CRUD, so no `userActions` block is needed.
    managedBy: 'system-data',
    description: 'Standing subscription of a principal (role/team/user) to a notification topic.',
    titleFormat: '{principal} · {topic}',
    highlightFields: ['topic', 'principal', 'enabled', 'created_at'],

    fields: {
        id: Field.text({ label: 'Subscription ID', required: true, readonly: true }),

        topic: Field.text({
            label: 'Topic',
            required: true,
            searchable: true,
            description: 'Notification topic this principal subscribes to.',
        }),

        principal: Field.text({
            label: 'Principal',
            required: true,
            searchable: true,
            description: "Subscriber selector: 'role:x' | 'team:x' | 'user:id' | bare user id.",
        }),

        enabled: Field.boolean({
            label: 'Enabled',
            defaultValue: true,
            description: 'When false, the subscription is inactive.',
        }),

        created_at: Field.datetime({ label: 'Created At', readonly: true }),
    },

    indexes: [
        { fields: ['topic', 'principal'], unique: true },
        { fields: ['topic'] },
    ],
});
