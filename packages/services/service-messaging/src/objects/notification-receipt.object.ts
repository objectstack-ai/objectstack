// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `sys_notification_receipt` — per-recipient × channel delivery receipt
 * (ADR-0030 Layer 5).
 *
 * The single source of truth for **read-state**. When a channel materializes a
 * delivery it writes a `delivered` receipt; the UI flips it to `read` /
 * `clicked` / `dismissed`. Keeping read-state here (rather than on
 * `sys_inbox_message`) makes cross-channel semantics reachable later — e.g.
 * "clicked the email → mark the inbox row read" is a receipt update, not a
 * second source of truth.
 *
 * Keyed by `(notification_id, user_id, channel)`. `delivery_id` links to the
 * `sys_notification_delivery` outbox row once that lands (P1); it is nullable
 * in P0 where the inbox channel dispatches inline.
 *
 * Belongs to `service-messaging` (the owner of the materialization channels).
 */
export const NotificationReceipt = ObjectSchema.create({
    name: 'sys_notification_receipt',
    label: 'Notification Receipt',
    pluralLabel: 'Notification Receipts',
    icon: 'check-check',
    isSystem: true,
    managedBy: 'engine-owned',
    // ADR-0057: read-state rows expire with the pipeline's 90d window — NOT
    // shorter, or read notifications would resurface as unread while their
    // inbox rows are still alive.
    lifecycle: {
        class: 'transient',
        ttl: { field: 'created_at', expireAfter: '90d' },
    },
    description: 'Per-recipient × channel receipt; the source of truth for notification read-state.',
    titleFormat: '{state}',
    highlightFields: ['notification_id', 'user_id', 'channel', 'state', 'at'],

    fields: {
        id: Field.text({
            label: 'Receipt ID',
            required: true,
            readonly: true,
        }),

        notification_id: Field.text({
            label: 'Notification Event',
            required: true,
            searchable: true,
            // [#12978] Referenced-column bound (#11374 route A): FK to
            // `sys_notification.id` — physical varchar(255), the id column
            // driver-sql creates (`table.string('id').primary()`).
            maxLength: 255,
            description: 'FK → sys_notification (L2 event)',
        }),

        delivery_id: Field.text({
            label: 'Delivery',
            required: false,
            description: 'FK → sys_notification_delivery (outbox row); null until P1',
        }),

        user_id: Field.text({
            label: 'Recipient User',
            required: true,
            searchable: true,
            // [#12978] Referenced-column bound (#11374 route A): a
            // `sys_user.id` — physical varchar(255), as above.
            maxLength: 255,
        }),

        channel: Field.text({
            label: 'Channel',
            required: true,
            // [#12978] Machine channel-id vocabulary (#11374 route A), same
            // sourcing as `sys_notification_delivery.channel`: registered
            // `MessagingChannel.id`s, 64 per the landed machine-vocabulary
            // precedent (sys_session.revoke_reason, maxLength: 64).
            maxLength: 64,
            description: 'Channel id this receipt is for (inbox / email / push / …)',
        }),

        state: Field.select(['delivered', 'read', 'clicked', 'dismissed'], {
            label: 'State',
            required: true,
            defaultValue: 'delivered',
        }),

        at: Field.datetime({
            label: 'At',
            required: false,
            description: 'When the receipt reached its current state',
        }),

        created_at: Field.datetime({
            label: 'Created At',
            readonly: true,
        }),
    },

    indexes: [
        { fields: ['notification_id', 'user_id', 'channel'], unique: true },
        { fields: ['user_id', 'state'] },
    ],

    enable: {
        // [ADR-0103] Engine-owned: delivery/read receipts are written by the
        // messaging service (context-less raw-engine writes) when a notification
        // is delivered or marked read, never via the generic data API.
        apiMethods: ['get', 'list'],
    },
});
