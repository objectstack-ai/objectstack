// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_inbox_message` — user-facing in-app notification rows (ADR-0012 §4, §11;
 * ADR-0030 Layer 5).
 *
 * Written by the always-on `inbox` messaging channel, one row per
 * `(notification, recipient)`, as the **materialization** of an L2
 * `sys_notification` event delivered to the in-app channel. The Console bell
 * pulls these (ADR-0030 re-points the bell here from `sys_notification`);
 * `service-realtime` decides when to ping an online user. Belongs to
 * `service-messaging` per the "protocol + service ownership" pattern.
 *
 * Read-state is **not** stored here — it lives in `sys_notification_receipt`
 * (ADR-0030), so cross-channel read semantics stay reachable. `notification_id`
 * links back to the event; `delivery_id` links to the outbox row (P1).
 */
export const InboxMessage = ObjectSchema.create({
    name: 'sys_inbox_message',
    label: 'Inbox Message',
    pluralLabel: 'Inbox Messages',
    icon: 'inbox',
    // ADR-0057: user-facing but ephemeral — expires with the pipeline's 90d
    // window, enforced by the platform LifecycleService.
    lifecycle: {
        class: 'transient',
        ttl: { field: 'created_at', expireAfter: '90d' },
    },
    description: 'User-facing in-app notification rows materialized by the inbox messaging channel.',
    nameField: 'title', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
    titleFormat: '{title}',
    highlightFields: ['title', 'user_id', 'severity', 'created_at'],

    listViews: {
        mine: {
            type: 'grid',
            name: 'mine',
            label: 'Notifications',
            data: { provider: 'object', object: 'sys_inbox_message' },
            columns: ['title', 'topic', 'severity', 'created_at'],
            filter: [{ field: 'user_id', operator: 'equals', value: '{current_user_id}' }],
            sort: [{ field: 'created_at', order: 'desc' }],
            pagination: { pageSize: 50 },
            emptyState: { title: 'Inbox zero', message: 'No notifications.' },
        },
    },

    fields: {
        id: Field.text({
            label: 'Inbox Message ID',
            required: true,
            readonly: true,
        }),

        user_id: Field.text({
            label: 'Recipient User',
            required: true,
            searchable: true,
        }),

        notification_id: Field.text({
            label: 'Notification Event',
            searchable: true,
            description: 'FK → sys_notification (the L2 event this row materializes)',
        }),

        delivery_id: Field.text({
            label: 'Delivery',
            description: 'FK → sys_notification_delivery (outbox row); null until P1',
        }),

        actor_id: Field.lookup('sys_user', {
            label: 'Actor',
            required: false,
            description:
                'User who caused the event (mentioner, assigner) — same semantics as sys_notification.actor_id. Lets a client answer "did I cause this?" with a local comparison and suppress its own receipts. Null on a digest row by construction: a collapsed group has no single actor.',
        }),

        topic: Field.text({
            label: 'Topic',
            searchable: true,
        }),

        title: Field.text({
            label: 'Title',
            required: true,
        }),

        body_md: Field.markdown({
            label: 'Body',
        }),

        severity: Field.select({
            label: 'Severity',
            options: [
                { label: 'Info', value: 'info' },
                { label: 'Warning', value: 'warning' },
                { label: 'Critical', value: 'critical' },
            ],
        }),

        action_url: Field.text({
            label: 'Action URL',
        }),

        created_at: Field.datetime({
            label: 'Created At',
            readonly: true,
        }),
    },
});
