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
 * links back to the event (FK → `sys_notification`); `delivery_id` was meant to
 * link the outbox row (FK → `sys_notification_delivery`), but no writer sets it
 * on an inbox row today, so it is always empty.
 *
 * [#32444] Engine-owned, like its siblings `sys_notification`,
 * `sys_notification_receipt`, `sys_notification_delivery` and
 * `sys_http_delivery`. ADR-0030's single ingress: "No producer writes an
 * inbox/materialization row directly." The generic New/Edit door broke that:
 * a row written through it carries no `notification_id`, so read-state (keyed
 * by the event) can never be recorded for it and it stays unread until its
 * TTL. Two halves close the door, the same pair the siblings declare:
 *   - `managedBy: 'engine-owned'` resolves every write affordance to `false`
 *     (the console offers no New/Edit/Delete) and makes the security plugin's
 *     ADR-0103 write guard refuse a user-context engine write;
 *   - `enable.apiMethods: ['get', 'list']` answers the REST data door's
 *     create/update/delete with `405 OBJECT_API_METHOD_NOT_ALLOWED`.
 * The one writer, the inbox channel, writes under `isSystem` and is unaffected.
 * Consequence carried with the bucket: these rows outlive an organization
 * delete (they no longer make it refuse), as the siblings' rows already do.
 */
export const InboxMessage = ObjectSchema.create({
    name: 'sys_inbox_message',
    label: 'Inbox Message',
    pluralLabel: 'Inbox Messages',
    icon: 'inbox',
    // [#32444] Engine-owned: written only by the inbox channel (see above).
    managedBy: 'engine-owned',
    // ADR-0057: user-facing but ephemeral — expires with the pipeline's 90d
    // window, enforced by the platform LifecycleService.
    lifecycle: {
        class: 'transient',
        ttl: { field: 'created_at', expireAfter: '90d' },
    },
    description: 'User-facing in-app notification rows materialized by the inbox messaging channel.',
    nameField: 'title', // [ADR-0079] canonical primary-title pointer (single-field titleFormat)
    highlightFields: ['title', 'user_id', 'severity', 'created_at'],

    listViews: {
        mine: {
            type: 'grid',
            name: 'mine',
            label: 'Notifications',
            data: { provider: 'object', object: 'sys_inbox_message' },
            // [#30126 row 8] No `topic`: it is the producer's machine id
            // (`notify`, `collab.mention`), not a word a recipient reads, and
            // there is no catalog that labels it. The column stays on the
            // object (searchable, filterable); only this view stops showing it.
            columns: ['title', 'severity', 'created_at'],
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

        // FK → `sys_notification`: the event this row materializes. Read-state
        // is keyed by it (`sys_notification_receipt`), so a row without one
        // can never be marked read.
        notification_id: Field.text({
            label: 'Notification Event',
            searchable: true,
            description:
                'The notification this message delivers. Marking the message read records it against this notification.',
        }),

        // FK → `sys_notification_delivery` (the outbox row). No writer sets it
        // on an inbox row: the inbox channel writes `delivery_id: null` on the
        // RECEIPT only and omits it here, so the column is always empty.
        delivery_id: Field.text({
            label: 'Delivery',
            description: 'The delivery record of this message. Not filled in for in-app messages.',
        }),

        // Same semantics as `sys_notification.actor_id`: the mentioner or
        // assigner. It is not a sender: a client compares it to the current
        // user to suppress its own receipts locally. Null on a digest row by
        // construction (a collapsed group has no single actor).
        actor_id: Field.lookup('sys_user', {
            label: 'Triggered By',
            required: false,
            description:
                'The person whose action raised this notification, for example who mentioned or assigned the recipient. Empty when the message groups several notifications.',
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

        // [#32240] Written once, by the inbox channel, at delivery; read by
        // the reader-locale middleware (`inbox-reader-locale.ts`). Keys and
        // params only, never text rendered in another language.
        keyed_text: Field.json({
            label: 'Text Keys',
            readonly: true,
            description:
                'The catalog keys and params the title and body were rendered from at delivery. A read re-renders the title and body from them in the reader\'s language; null when the notification carried no keys, and the stored title and body are then served as written.',
        }),
    },

    enable: {
        // [#32444, ADR-0103] Engine-owned: written only by the inbox channel
        // under `isSystem`, never via the generic data API. Reads stay open
        // (the owner's own rows through the `_self` RLS policy).
        apiMethods: ['get', 'list'],
    },
});
